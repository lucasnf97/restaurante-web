// ── MURO — feed Social con paridad total con la web ───────────
// Token de LOCAL (contexto restaurante): grupos, feed con cursor, fijados,
// reacciones, comentarios, prioritarias inline, edición/moderación (⋮),
// panel de acuses/vistas (editor), composer con adjuntos/enlace/menciones y
// toggles Fijar/Prioritaria (editor). Vistas trackeadas en batch.

import { esc, escAttr, displayName, API_URL, urlSegura } from "../core/api.js";
import { getRestaurantes, getLocalActivo, setLocalActivo, apiLocal, getUserLocal, getTokenLocal, hasPermisoLocal } from "../core/sesion.js";
import * as drawer from "../drawer.js";
import { haceCuanto } from "../core/fechas.js";
import { elegirArchivos, thumb, verImagen, abrirArchivo, filesAB64 } from "../core/adjuntos.js";

const EMOJIS = ["👍", "❤️", "👏", "🎉"];

let _vivo = false;
let _rid = null;
let _grupos = [];
let _grupoSel = null;          // null = feed general
let _puedeGestionar = false;   // editor de social en el local
let _posts = [];
let _fijados = [];
let _fin = false;
let _cargando = false;
let _vistasMandadas = new Set();
let _es = null;                // EventSource propio (token del LOCAL)
let _pollTimer = null;
let _debounce = null;

export async function mount(el) {
    _vivo = true;
    _vistasMandadas = new Set();
    const locales = await getRestaurantes();
    _rid = getLocalActivo();

    el.innerHTML = `
    <div class="pantalla">
        ${drawer.headerConMenu("Muro")}
        ${locales.length > 1 ? `<div class="chips" id="mu-locales">${locales.map(r =>
            `<button class="chip ${r.restaurante_id === _rid ? "activa" : ""}" data-rid="${r.restaurante_id}">${esc(r.restaurante || r.codigo)}</button>`).join("")}</div>` : ""}
        <div class="chips" id="mu-grupos"></div>
        <div class="pantalla-body" id="mu-body">
            <div id="mu-feed"><div class="muted centrado" style="padding:30px;">Cargando muro…</div></div>
            <div id="mu-mas" class="centrado" style="padding:8px 0 20px;"></div>
        </div>
        <button class="fab" id="mu-fab" title="Publicar">＋</button>
    </div>`;

    el.querySelectorAll("#mu-locales .chip").forEach(ch => ch.addEventListener("click", async () => {
        _rid = parseInt(ch.dataset.rid, 10);
        await setLocalActivo(_rid);
        el.querySelectorAll("#mu-locales .chip").forEach(c => c.classList.toggle("activa", c === ch));
        _grupoSel = null;
        await _initLocal();
    }));
    el.querySelector("#mu-fab").addEventListener("click", () => _abrirComposer());

    // Scroll infinito
    el.querySelector("#mu-body").addEventListener("scroll", (e) => {
        const b = e.target;
        if (!_fin && !_cargando && b.scrollTop + b.clientHeight > b.scrollHeight - 600) _cargarMas();
    });

    await _initLocal();
    _pollTimer = setInterval(() => { if (_vivo && !document.hidden) _recargar(true); }, 60000);
}

export function onResume() { if (_vivo) _recargar(true); }

export function unmount() {
    _vivo = false;
    clearTimeout(_debounce);
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_es) { _es.close(); _es = null; }
}

async function _initLocal() {
    if (!_rid) {
        document.getElementById("mu-feed").innerHTML = `<div class="muted centrado" style="padding:30px;">No tenés locales asignados.</div>`;
        return;
    }
    await getUserLocal(_rid);   // asegura permisos del local cargados
    _conectarSSE();
    try {
        const g = await apiLocal(_rid).get("/social/grupos");
        _grupos = (g && g.grupos) || [];
        _puedeGestionar = !!(g && g.puede_gestionar) || hasPermisoLocal(_rid, "edicion_social");
    } catch (e) { _grupos = []; _puedeGestionar = hasPermisoLocal(_rid, "edicion_social"); }
    _pintarGrupos();
    await _recargar();
}

// SSE con el token del LOCAL (el broker publica por schema del token; el token
// de cuenta no tiene schema). EventSource propio de esta pantalla.
async function _conectarSSE() {
    try {
        if (_es) { _es.close(); _es = null; }
        const tok = await getTokenLocal(_rid);
        _es = new EventSource(`${API_URL}/eventos/stream?token=${encodeURIComponent(tok)}`);
        _es.onmessage = () => {
            clearTimeout(_debounce);
            _debounce = setTimeout(() => { if (_vivo) _recargar(true); }, 800);
        };
        _es.onerror = () => {};
    } catch (_) {}
}

function _pintarGrupos() {
    const cont = document.getElementById("mu-grupos");
    if (!cont) return;
    const chips = [`<button class="chip ${_grupoSel === null ? "activa" : ""}" data-g="">General</button>`]
        .concat(_grupos.map(g => `<button class="chip ${_grupoSel === g.id ? "activa" : ""}" data-g="${g.id}">${esc(g.nombre)}</button>`));
    cont.innerHTML = chips.join("");
    cont.querySelectorAll(".chip").forEach(ch => ch.addEventListener("click", () => {
        _grupoSel = ch.dataset.g === "" ? null : parseInt(ch.dataset.g, 10);
        cont.querySelectorAll(".chip").forEach(c => c.classList.toggle("activa", c === ch));
        _recargar();
    }));
}

async function _recargar(silencioso = false) {
    if (!_rid) return;
    _cargando = true;
    try {
        const q = _grupoSel != null ? `grupo_id=${_grupoSel}&` : "";
        const r = await apiLocal(_rid)[silencioso ? "getSilent" : "get"](`/social/feed?${q}limit=10`);
        if (!_vivo) return;
        _fijados = (r && r.fijados) || [];
        _posts = (r && r.posts) || [];
        _fin = _posts.length < 10;
        _pintarFeed();
        _marcarVistas([..._fijados, ..._posts]);
    } catch (e) {
        if (!silencioso) {
            const f = document.getElementById("mu-feed");
            if (f) f.innerHTML = `<div class="muted centrado" style="padding:30px;">No se pudo cargar el muro.<br>${esc(e.message)}</div>`;
        }
    } finally { _cargando = false; }
}

async function _cargarMas() {
    if (_fin || _cargando || !_posts.length) return;
    _cargando = true;
    try {
        const before = _posts[_posts.length - 1].id;
        const q = _grupoSel != null ? `grupo_id=${_grupoSel}&` : "";
        const r = await apiLocal(_rid).getSilent(`/social/feed?${q}before_id=${before}&limit=10`);
        const nuevos = (r && r.posts) || [];
        if (!nuevos.length) { _fin = true; }
        else {
            _posts = _posts.concat(nuevos);
            _pintarFeed();
            _marcarVistas(nuevos);
        }
    } catch (_) {} finally {
        _cargando = false;
        const m = document.getElementById("mu-mas");
        if (m) m.innerHTML = _fin ? `<span class="muted" style="font-size:13px;">— fin del muro —</span>` : "";
    }
}

function _marcarVistas(posts) {
    const ids = posts.map(p => p.id).filter(id => !_vistasMandadas.has(id));
    if (!ids.length) return;
    ids.forEach(id => _vistasMandadas.add(id));
    apiLocal(_rid).post("/social/vistas", { post_ids: ids }).catch(() => {});
}

// ── Render ────────────────────────────────────────────────────
function _pintarFeed() {
    const f = document.getElementById("mu-feed");
    if (!f) return;
    const todos = [..._fijados.map(p => ({ ...p, _fijadoTop: true })), ..._posts.filter(p => !_fijados.some(x => x.id === p.id))];
    f.innerHTML = todos.length
        ? todos.map(_postHTML).join("")
        : `<div class="muted centrado" style="padding:30px;">Sin publicaciones todavía. ¡Publicá la primera!</div>`;
    _engancharPosts(f);
}

function _buscarPost(id) { return [..._fijados, ..._posts].find(p => p.id === id); }

function _postHTML(p) {
    const imgs = (p.adjuntos || []).filter(a => a.tipo === "imagen");
    const files = (p.adjuntos || []).filter(a => a.tipo !== "imagen");
    const grupoNombre = p.grupo_id ? ((_grupos.find(g => g.id === p.grupo_id) || {}).nombre || "") : "";
    return `
    <div class="post card" data-id="${p.id}">
        <div class="post-head">
            <div class="post-avatar">${esc((displayName(p) || "?").split(" ").map(x => x[0]).slice(0, 2).join("").toUpperCase())}</div>
            <div class="crece">
                <div class="post-autor">${esc(displayName(p))}</div>
                <div class="post-meta muted">${esc(haceCuanto(p.creado_en))}${p.editado_en ? " · editado" : ""}${grupoNombre ? ` · ${esc(grupoNombre)}` : ""}</div>
            </div>
            ${p._fijadoTop || p.fijado ? `<span class="badge-pin">📌</span>` : ""}
            ${p.can_edit || _puedeGestionar ? `<button class="post-menu" data-acc="menu">⋮</button>` : ""}
        </div>
        ${p.prioritaria ? `<div class="post-prio ${p.aceptado_por_mi ? "ok" : ""}">
            🚨 Prioritaria ${p.aceptado_por_mi ? "· ✔ Aceptada" : `<button class="post-prio-btn" data-acc="aceptar">Aceptar</button>`}
            ${_puedeGestionar && p.audiencia_total ? `<button class="post-prio-acuses" data-acc="acuses">✔ ${p.acuses_count || 0}/${p.audiencia_total}</button>` : ""}
        </div>` : ""}
        <div class="post-texto">${_linkify(esc(p.contenido || ""))}</div>
        ${p.enlace ? (urlSegura(p.enlace)
            ? `<a class="post-enlace" href="${escAttr(urlSegura(p.enlace))}" target="_blank" rel="noopener noreferrer">🔗 ${esc(p.enlace)}</a>`
            : `<span class="post-enlace">🔗 ${esc(p.enlace)}</span>`) : ""}
        ${imgs.length ? `<div class="post-imgs n${Math.min(imgs.length, 3)}">${imgs.map(a =>
            `<img src="${escAttr(thumb(a.url))}" data-full="${escAttr(a.url)}" loading="lazy" alt="">`).join("")}</div>` : ""}
        ${files.map(a => `<button class="post-file" data-url="${escAttr(a.url)}">📄 ${esc(a.nombre || "archivo")}</button>`).join("")}
        ${p.solicitud_id ? `<button class="post-solicitud" data-sid="${p.solicitud_id}">
            ${p.solicitud_tipo === "abierto" ? "🟢 Turno abierto" : "📣 Oferta de turno"} · ${esc(p.solicitud_estado || "")} — Ver ›</button>` : ""}
        <div class="post-acciones">
            ${EMOJIS.map(e => {
                const r = (p.reacciones || []).find(x => x.emoji === e);
                const n = r ? r.n : 0;
                return `<button class="post-reac ${p.mi_reaccion === e ? "mia" : ""}" data-emoji="${e}">${e}${n ? ` ${n}` : ""}</button>`;
            }).join("")}
            <button class="post-com" data-acc="comentarios">💬 ${p.comentarios_count || 0}</button>
            ${_puedeGestionar ? `<span class="muted post-vistas" data-acc="vistas">👁 ${p.vistas_count || 0}</span>` : ""}
        </div>
        <div class="post-comentarios" id="coms-${p.id}" style="display:none;"></div>
    </div>`;
}

function _linkify(t) {
    return t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
            .replace(/@([\wáéíóúñÁÉÍÓÚÑ.]+)/g, '<b class="post-mencion">@$1</b>');
}

function _engancharPosts(f) {
    f.querySelectorAll(".post").forEach(card => {
        const id = parseInt(card.dataset.id, 10);
        card.querySelectorAll(".post-reac").forEach(b => b.addEventListener("click", async () => {
            const p = _buscarPost(id);
            const emoji = b.dataset.emoji === p.mi_reaccion ? null : b.dataset.emoji;
            try {
                const r = await apiLocal(_rid).put(`/social/posts/${id}/reaccion`, { emoji });
                p.reacciones = r.reacciones; p.mi_reaccion = r.mi_reaccion;
                _pintarFeed();
            } catch (e) { UI.toast(e.message, "error"); }
        }));
        card.querySelectorAll("[data-acc=comentarios]").forEach(b => b.addEventListener("click", () => _toggleComentarios(id)));
        card.querySelectorAll("[data-acc=aceptar]").forEach(b => b.addEventListener("click", async () => {
            try {
                await apiLocal(_rid).post(`/social/posts/${id}/aceptar`, {});
                const p = _buscarPost(id);
                p.aceptado_por_mi = true; p.acuses_count = (p.acuses_count || 0) + 1;
                _pintarFeed();
            } catch (e) { UI.toast(e.message, "error"); }
        }));
        card.querySelectorAll("[data-acc=acuses]").forEach(b => b.addEventListener("click", () => _verAcuses(id)));
        card.querySelectorAll("[data-acc=vistas]").forEach(b => b.addEventListener("click", () => _verVistas(id)));
        card.querySelectorAll("[data-acc=menu]").forEach(b => b.addEventListener("click", () => _menuPost(_buscarPost(id))));
        card.querySelectorAll(".post-imgs img").forEach(img => img.addEventListener("click", () => verImagen(img.dataset.full)));
        card.querySelectorAll(".post-file").forEach(b => b.addEventListener("click", () => abrirArchivo(b.dataset.url)));
        card.querySelectorAll(".post-solicitud").forEach(b => b.addEventListener("click", () => window._ir("solicitud/" + b.dataset.sid)));
    });
}

// ── Comentarios ───────────────────────────────────────────────
async function _toggleComentarios(id) {
    const cont = document.getElementById("coms-" + id);
    if (!cont) return;
    if (cont.style.display !== "none") { cont.style.display = "none"; return; }
    cont.style.display = "";
    cont.innerHTML = `<div class="muted" style="font-size:13px;">Cargando…</div>`;
    await _pintarComentarios(id);
}

async function _pintarComentarios(id) {
    const cont = document.getElementById("coms-" + id);
    if (!cont) return;
    try {
        const coms = await apiLocal(_rid).getSilent(`/social/posts/${id}/comentarios`) || [];
        cont.innerHTML = coms.map(c => `
            <div class="com">
                <b>${esc(c.nombre_display || c.username)}</b> <span class="muted" style="font-size:11px;">${esc(haceCuanto(c.creado_en))}</span>
                ${c.can_delete ? `<button class="com-del" data-cid="${c.id}">🗑</button>` : ""}
                <div class="com-texto">${esc(c.texto)}</div>
            </div>`).join("") + `
            <div class="com-nuevo">
                <input id="com-inp-${id}" placeholder="Comentar…" maxlength="2000">
                <button class="btn-primario" id="com-btn-${id}">➤</button>
            </div>`;
        cont.querySelectorAll(".com-del").forEach(b => b.addEventListener("click", async () => {
            try { await apiLocal(_rid).del(`/social/comentarios/${b.dataset.cid}`); _pintarComentarios(id); }
            catch (e) { UI.toast(e.message, "error"); }
        }));
        const enviar = async () => {
            const inp = document.getElementById("com-inp-" + id);
            const texto = inp.value.trim();
            if (!texto) return;
            try {
                await apiLocal(_rid).post(`/social/posts/${id}/comentarios`, { texto });
                const p = _buscarPost(id);
                if (p) p.comentarios_count = (p.comentarios_count || 0) + 1;
                await _pintarComentarios(id);
            } catch (e) { UI.toast(e.message, "error"); }
        };
        document.getElementById("com-btn-" + id).addEventListener("click", enviar);
        document.getElementById("com-inp-" + id).addEventListener("keydown", e => { if (e.key === "Enter") enviar(); });
    } catch (e) {
        cont.innerHTML = `<div class="muted" style="font-size:13px;">No se pudieron cargar los comentarios.</div>`;
    }
}

// ── Acuses / vistas (editor) ──────────────────────────────────
async function _verAcuses(id) {
    try {
        const r = await apiLocal(_rid).get(`/social/posts/${id}/acuses`);
        _modalLista("✔ Acuses de lectura", `
            <div class="muted" style="font-size:13px;margin-bottom:8px;">Aceptaron ${(r.aceptaron || []).length} de ${r.audiencia_total}</div>
            ${(r.aceptaron || []).map(a => `<div class="pf-local">✅ ${esc(a.nombre_display || a.username)} <span class="muted" style="font-size:12px;">· ${esc(haceCuanto(a.creado_en))}</span></div>`).join("")}
            ${(r.pendientes || []).map(a => `<div class="pf-local muted">⏳ ${esc(a.nombre_display || a.username)}</div>`).join("")}`);
    } catch (e) { UI.toast(e.message, "error"); }
}

async function _verVistas(id) {
    try {
        const r = await apiLocal(_rid).get(`/social/posts/${id}/vistas`);
        _modalLista(`👁 Vistas (${r.total})`, (r.usuarios || []).map(u =>
            `<div class="pf-local">${esc(u.nombre_display || u.username)} <span class="muted" style="font-size:12px;">· ${esc(haceCuanto(u.creado_en))}</span></div>`).join("") || "<div class='muted'>Nadie todavía.</div>");
    } catch (e) { UI.toast(e.message, "error"); }
}

function _modalLista(titulo, html) {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box"><div class="modal-head">${titulo}</div>
        <div class="modal-body">${html}</div>
        <div class="modal-foot"><button class="btn-secundario">Cerrar</button></div></div>`;
    ov.addEventListener("click", e => {
        if (e.target === ov || (e.target.tagName === "BUTTON" && e.target.textContent === "Cerrar")) ov.remove();
    });
    document.body.appendChild(ov);
}

// ── Menú ⋮ del post ───────────────────────────────────────────
function _menuPost(p) {
    if (!p) return;
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    const items = [];
    if (p.can_edit) items.push(`<button class="menu-it" data-acc="editar">✏️ Editar</button>`);
    if (_puedeGestionar) items.push(`<button class="menu-it" data-acc="fijar">${p.fijado ? "📌 Desfijar" : "📌 Fijar"}</button>`);
    if (p.can_edit || _puedeGestionar) items.push(`<button class="menu-it peligro" data-acc="borrar">🗑 Eliminar</button>`);
    ov.innerHTML = `<div class="modal-box"><div class="modal-body" style="padding:14px;">${items.join("")}</div></div>`;
    ov.addEventListener("click", async e => {
        if (e.target === ov) { ov.remove(); return; }
        const acc = e.target.dataset && e.target.dataset.acc;
        if (!acc) return;
        ov.remove();
        if (acc === "fijar") {
            try { await apiLocal(_rid).patch(`/social/posts/${p.id}/fijar`, { fijado: !p.fijado }); _recargar(); }
            catch (err) { UI.toast(err.message, "error"); }
        } else if (acc === "borrar") {
            if (!confirm("¿Eliminar esta publicación?")) return;
            try { await apiLocal(_rid).del(`/social/posts/${p.id}`); _recargar(); }
            catch (err) { UI.toast(err.message, "error"); }
        } else if (acc === "editar") {
            _abrirComposer(p);
        }
    });
    document.body.appendChild(ov);
}

// ── Composer (crear / editar) ─────────────────────────────────
async function _abrirComposer(editar = null) {
    const esEditor = _puedeGestionar;
    let archivos = [];
    let quitar = new Set();
    let mencionSel = { usuarios: [], roles: [] };

    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
        <div class="modal-head">${editar ? "✏️ Editar publicación" : "📣 Nueva publicación"}</div>
        <div class="modal-body">
            <textarea id="cp-texto" rows="4" placeholder="¿Qué querés compartir?" maxlength="4000">${editar ? esc(editar.contenido || "") : ""}</textarea>
            <input id="cp-enlace" placeholder="Enlace (opcional)" value="${editar ? escAttr(editar.enlace || "") : ""}" style="margin-top:8px;">
            ${!editar ? `<select id="cp-grupo" style="margin-top:8px;">
                <option value="">📢 General (todos)</option>
                ${_grupos.map(g => `<option value="${g.id}" ${_grupoSel === g.id ? "selected" : ""}>${esc(g.nombre)}</option>`).join("")}
            </select>` : ""}
            <div class="fila" style="margin-top:10px;flex-wrap:wrap;">
                <button class="btn-secundario" id="cp-adj" style="min-height:42px;">📎 Adjuntar</button>
                <button class="btn-secundario" id="cp-men" style="min-height:42px;">@ Mencionar</button>
                ${esEditor ? `<label class="cp-tog"><input type="checkbox" id="cp-fijado" ${editar && editar.fijado ? "checked" : ""}>📌 Fijar</label>
                <label class="cp-tog"><input type="checkbox" id="cp-prio" ${editar && editar.prioritaria ? "checked" : ""}>🚨 Prioritaria</label>` : ""}
            </div>
            <div id="cp-men-sel" class="muted" style="font-size:12px;margin-top:6px;"></div>
            <div id="cp-adjs" style="margin-top:6px;font-size:13px;"></div>
            ${editar && (editar.adjuntos || []).length ? `<div style="margin-top:8px;font-size:13px;"><b>Adjuntos actuales</b> (tocá para quitar):
                <div id="cp-actuales">${(editar.adjuntos || []).map(a =>
                    `<button class="chip" data-pid="${escAttr(a.public_id || "")}" style="margin:4px 4px 0 0;">${a.tipo === "imagen" ? "🖼" : "📄"} ${esc((a.nombre || "").slice(0, 22) || "imagen")}</button>`).join("")}</div></div>` : ""}
            <div id="cp-msg" style="color:var(--peligro);font-size:13px;font-weight:600;margin-top:8px;"></div>
        </div>
        <div class="modal-foot">
            <button class="btn-secundario" id="cp-cancelar">Cancelar</button>
            <button class="btn-primario" id="cp-publicar">${editar ? "Guardar" : "Publicar"}</button>
        </div>
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    ov.querySelector("#cp-cancelar").addEventListener("click", () => ov.remove());

    const pintarAdjs = () => {
        ov.querySelector("#cp-adjs").innerHTML = archivos.map((f, i) =>
            `<span class="chip" style="margin:2px;">${esc(f.name.slice(0, 24))} <b data-i="${i}" style="cursor:pointer;color:var(--peligro);">✕</b></span>`).join("");
        ov.querySelectorAll("#cp-adjs b").forEach(b => b.addEventListener("click", () => {
            archivos.splice(parseInt(b.dataset.i, 10), 1);
            pintarAdjs();
        }));
    };
    ov.querySelector("#cp-adj").addEventListener("click", async () => {
        const fs = await elegirArchivos({ multiple: true });
        archivos = archivos.concat(fs);
        pintarAdjs();
    });

    ov.querySelectorAll("#cp-actuales .chip").forEach(ch => ch.addEventListener("click", () => {
        const pid = ch.dataset.pid;
        if (quitar.has(pid)) { quitar.delete(pid); ch.style.opacity = "1"; ch.style.textDecoration = "none"; }
        else { quitar.add(pid); ch.style.opacity = ".45"; ch.style.textDecoration = "line-through"; }
    }));

    ov.querySelector("#cp-men").addEventListener("click", async () => {
        let usuarios = [], roles = [];
        try { usuarios = (await apiLocal(_rid).getSilent("/auth/usuarios") || []).filter(u => u.activo !== false && u.rol !== "admin"); } catch (_) {}
        try { roles = await apiLocal(_rid).getSilent("/roles") || []; } catch (_) {}
        const ov2 = document.createElement("div");
        ov2.className = "modal-overlay";
        ov2.innerHTML = `<div class="modal-box"><div class="modal-head">@ Mencionar</div>
            <div class="modal-body">
                ${roles.length ? `<b style="font-size:13px;">Roles</b>` : ""}
                ${roles.map(r => `<label class="cp-check"><input type="checkbox" data-rol="${escAttr(r.nombre)}" ${mencionSel.roles.includes(r.nombre) ? "checked" : ""}> ${esc(r.nombre)}</label>`).join("")}
                <b style="font-size:13px;">Personas</b>
                ${usuarios.map(u => `<label class="cp-check"><input type="checkbox" data-uid="${u.id}" ${mencionSel.usuarios.includes(u.id) ? "checked" : ""}> ${esc(displayName(u))}</label>`).join("")}
            </div>
            <div class="modal-foot"><button class="btn-primario">Listo</button></div></div>`;
        ov2.addEventListener("click", e => {
            if (e.target === ov2 || (e.target.tagName === "BUTTON" && e.target.textContent === "Listo")) {
                mencionSel = {
                    usuarios: [...ov2.querySelectorAll("[data-uid]")].filter(c => c.checked).map(c => parseInt(c.dataset.uid, 10)),
                    roles: [...ov2.querySelectorAll("[data-rol]")].filter(c => c.checked).map(c => c.dataset.rol),
                };
                ov.querySelector("#cp-men-sel").textContent = (mencionSel.usuarios.length || mencionSel.roles.length)
                    ? `Menciona a ${mencionSel.usuarios.length} persona(s) y ${mencionSel.roles.length} rol(es) — se les avisa por Mensajes.` : "";
                ov2.remove();
            }
        });
        document.body.appendChild(ov2);
    });

    ov.querySelector("#cp-publicar").addEventListener("click", async () => {
        const msg = ov.querySelector("#cp-msg");
        const texto = ov.querySelector("#cp-texto").value.trim();
        const enlace = ov.querySelector("#cp-enlace").value.trim();
        if (!texto && !archivos.length && !(editar && (editar.adjuntos || []).length)) {
            msg.textContent = "Escribí algo o adjuntá un archivo."; return;
        }
        const prio = esEditor && ov.querySelector("#cp-prio") && ov.querySelector("#cp-prio").checked;
        if (prio && !(editar && editar.prioritaria)) {
            if (!confirm("Una publicación PRIORITARIA aparece en primer plano al entrar y cada persona debe aceptarla para continuar. ¿Publicar como prioritaria?")) return;
        }
        const btn = ov.querySelector("#cp-publicar");
        btn.disabled = true; btn.textContent = "Publicando…";
        try {
            if (editar) {
                // Edición TAMBIÉN por JSON+base64 (el multipart del webview falla en iOS).
                await apiLocal(_rid).post(`/social/posts/${editar.id}/editar-json`, {
                    contenido: texto, enlace,
                    quitar: [...quitar],
                    menciones_usuarios: mencionSel.usuarios,
                    menciones_roles: mencionSel.roles,
                    ...(esEditor ? {
                        fijado: !!(ov.querySelector("#cp-fijado") && ov.querySelector("#cp-fijado").checked),
                        prioritaria: !!prio,
                    } : {}),
                    adjuntos: await filesAB64(archivos),
                });
            } else {
                // Crear: JSON + adjuntos en base64 → transporte NATIVO (en iOS el
                // multipart del webview falla con "Load failed").
                const adjuntos = await filesAB64(archivos);
                const g = ov.querySelector("#cp-grupo").value;
                await apiLocal(_rid).post("/social/posts-json", {
                    contenido: texto, enlace,
                    grupo_id: g ? parseInt(g, 10) : null,
                    menciones_usuarios: mencionSel.usuarios,
                    menciones_roles: mencionSel.roles,
                    fijado: !!(esEditor && ov.querySelector("#cp-fijado") && ov.querySelector("#cp-fijado").checked),
                    prioritaria: !!prio,
                    adjuntos,
                });
            }
            ov.remove();
            UI.toast(editar ? "Publicación actualizada" : "Publicado en el muro", "success");
            _recargar();
        } catch (e) {
            msg.textContent = e.message;
            btn.disabled = false; btn.textContent = editar ? "Guardar" : "Publicar";
        }
    });
}
