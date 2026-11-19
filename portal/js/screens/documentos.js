// ── DOCUMENTOS — drive interno (paridad con la web) ───────────
// Secciones: 📢 General (nivel CADENA), 👥 Grupos (por local), 🔒 Personal
// (gate por contraseña → agregado de todos los locales), 🎓 Capacitaciones
// (firmar con contraseña). Con edicion_documentos: crear/renombrar/borrar
// carpetas y subir/borrar archivos (endpoints normales y variantes /cadena).

import { esc, escAttr, apiCuenta } from "../core/api.js";
import { getRestaurantes, getLocalActivo, setLocalActivo, apiLocal } from "../core/sesion.js";
import * as drawer from "../drawer.js";
import { haceCuanto } from "../core/fechas.js";
import { elegirArchivos, verImagen, abrirArchivo, fileAB64 } from "../core/adjuntos.js";

let _vivo = false;
let _rid = null;
let _sec = "general";          // general | grupos | personal | capacitaciones
let _grupos = [];
let _grupoSel = null;
let _carpeta = null;           // carpeta actual (id) — general/grupos
let _personalOk = false;       // gate de contraseña superado (solo esta visita)

export async function mount(el) {
    _vivo = true;
    _sec = "general"; _carpeta = null; _grupoSel = null; _personalOk = false;
    const locales = await getRestaurantes();
    _rid = getLocalActivo();

    el.innerHTML = `
    <div class="pantalla">
        ${drawer.headerConMenu("Documentos")}
        ${locales.length > 1 ? `<div class="chips" id="dc-locales">${locales.map(r =>
            `<button class="chip ${r.restaurante_id === _rid ? "activa" : ""}" data-rid="${r.restaurante_id}">${esc(r.restaurante || r.codigo)}</button>`).join("")}</div>` : ""}
        <div class="chips" id="dc-secciones">
            <button class="chip activa" data-s="general">📢 General</button>
            <button class="chip" data-s="grupos">👥 Grupos</button>
            <button class="chip" data-s="personal">🔒 Personal</button>
            <button class="chip" data-s="capacitaciones">🎓 Capacitaciones</button>
        </div>
        <div class="pantalla-body" id="dc-body">
            <div id="dc-cont"><div class="muted centrado" style="padding:30px;">Cargando…</div></div>
        </div>
    </div>`;

    el.querySelectorAll("#dc-locales .chip").forEach(ch => ch.addEventListener("click", async () => {
        _rid = parseInt(ch.dataset.rid, 10);
        await setLocalActivo(_rid);
        el.querySelectorAll("#dc-locales .chip").forEach(c => c.classList.toggle("activa", c === ch));
        _carpeta = null; _grupoSel = null; _personalOk = false;
        _cargar();
    }));
    el.querySelectorAll("#dc-secciones .chip").forEach(ch => ch.addEventListener("click", () => {
        _sec = ch.dataset.s;
        el.querySelectorAll("#dc-secciones .chip").forEach(c => c.classList.toggle("activa", c === ch));
        _carpeta = null; _grupoSel = null;
        _cargar();
    }));

    await _cargar();
}

export function unmount() { _vivo = false; }

async function _cargar() {
    const cont = document.getElementById("dc-cont");
    if (!cont) return;
    cont.innerHTML = `<div class="muted centrado" style="padding:30px;">Cargando…</div>`;
    try {
        if (_sec === "general") await _pintarArbol(true);
        else if (_sec === "grupos") await _pintarGrupos();
        else if (_sec === "personal") await _pintarPersonal();
        else await _pintarCapacitaciones();
    } catch (e) {
        if (cont) cont.innerHTML = `<div class="muted centrado" style="padding:30px;">No se pudo cargar.<br>${esc(e.message)}</div>`;
    }
}

// ── General (cadena) y Grupos (local) — árbol de carpetas ─────
async function _pintarArbol(esCadena) {
    const cont = document.getElementById("dc-cont");
    let d;
    if (esCadena) {
        d = await apiLocal(_rid).get(`/documentos/cadena${_carpeta ? `?parent_id=${_carpeta}` : ""}`);
    } else {
        const q = new URLSearchParams({ categoria: "grupos", grupo_id: _grupoSel });
        if (_carpeta) q.set("carpeta_id", _carpeta);
        d = await apiLocal(_rid).get(`/documentos/contenido?${q}`);
    }
    if (!_vivo || !cont) return;
    const ruta = d.ruta || [];
    const puede = !!d.puede_editar;
    cont.innerHTML = `
        ${!esCadena ? `<button class="chip" id="dc-volver-grupos" style="margin-bottom:10px;">‹ Grupos</button>` : ""}
        <div class="dc-ruta">
            <button class="dc-mig" data-c="">🏠</button>
            ${ruta.map(r => `<span>›</span><button class="dc-mig" data-c="${r.id}">${esc(r.nombre)}</button>`).join("")}
        </div>
        ${puede ? `<div class="fila" style="margin:10px 0;">
            <button class="btn-secundario" id="dc-nueva-carpeta" style="min-height:42px;flex:1;">📁＋ Carpeta</button>
            <button class="btn-primario" id="dc-subir" style="min-height:42px;flex:1;">⬆ Subir archivo</button>
        </div>` : ""}
        <div id="dc-items">
            ${(d.carpetas || []).map(c => `
                <div class="dc-item" data-tipo="carpeta" data-id="${c.id}" data-n="${escAttr(c.nombre)}">
                    <span class="dc-ico">📁</span><span class="crece">${esc(c.nombre)}</span>
                    ${puede ? `<button class="dc-menu" data-menu="carpeta" data-id="${c.id}" data-n="${escAttr(c.nombre)}">⋮</button>` : ""}
                </div>`).join("")}
            ${(d.archivos || []).map(a => `
                <div class="dc-item" data-tipo="archivo" data-url="${escAttr(a.url)}" data-rt="${escAttr(a.resource_type || "")}">
                    <span class="dc-ico">${a.resource_type === "image" ? "🖼" : "📄"}</span>
                    <span class="crece">${esc(a.nombre)}<div class="muted" style="font-size:11.5px;">${esc(haceCuanto(a.creado_en))}</div></span>
                    ${puede ? `<button class="dc-menu" data-menu="archivo" data-id="${a.id}" data-n="${escAttr(a.nombre)}">⋮</button>` : ""}
                </div>`).join("")}
            ${!(d.carpetas || []).length && !(d.archivos || []).length ? `<div class="muted centrado" style="padding:24px;">Carpeta vacía.</div>` : ""}
        </div>`;

    const vg = cont.querySelector("#dc-volver-grupos");
    if (vg) vg.addEventListener("click", () => { _grupoSel = null; _carpeta = null; _cargar(); });
    cont.querySelectorAll(".dc-mig").forEach(b => b.addEventListener("click", () => {
        _carpeta = b.dataset.c ? parseInt(b.dataset.c, 10) : null;
        _cargar();
    }));
    cont.querySelectorAll(".dc-item").forEach(it => it.addEventListener("click", (e) => {
        if (e.target.closest(".dc-menu")) return;
        if (it.dataset.tipo === "carpeta") { _carpeta = parseInt(it.dataset.id, 10); _cargar(); }
        else {
            const url = it.dataset.url;
            if (it.dataset.rt === "image") verImagen(url);
            else abrirArchivo(url);
        }
    }));
    cont.querySelectorAll(".dc-menu").forEach(b => b.addEventListener("click", () => _menuItem(esCadena, b.dataset.menu, parseInt(b.dataset.id, 10), b.dataset.n)));
    const nc = cont.querySelector("#dc-nueva-carpeta");
    if (nc) nc.addEventListener("click", async () => {
        const nombre = prompt("Nombre de la carpeta nueva:");
        if (!nombre || !nombre.trim()) return;
        try {
            if (esCadena) await apiLocal(_rid).post("/documentos/cadena/carpetas", { nombre: nombre.trim(), parent_id: _carpeta });
            else await apiLocal(_rid).post("/documentos/carpetas", { categoria: "grupos", grupo_id: _grupoSel, parent_id: _carpeta, nombre: nombre.trim() });
            _cargar();
        } catch (e) { UI.toast(e.message, "error"); }
    });
    const su = cont.querySelector("#dc-subir");
    if (su) su.addEventListener("click", async () => {
        const fs = await elegirArchivos({ multiple: false });
        if (!fs.length) return;
        UI.toast("Subiendo…", "info");
        try {
            // JSON + base64 por el transporte NATIVO (el multipart del webview
            // falla en iOS con "Load failed").
            const adjunto = await fileAB64(fs[0]);
            if (esCadena) {
                await apiLocal(_rid).post("/documentos/cadena/archivos-json",
                    { parent_id: _carpeta || null, adjunto });
            } else {
                await apiLocal(_rid).post("/documentos/archivos-json", {
                    categoria: "grupos", grupo_id: _grupoSel,
                    carpeta_id: _carpeta || null, adjunto,
                });
            }
            UI.toast("Archivo subido", "success");
            _cargar();
        } catch (e) { UI.toast(e.message, "error"); }
    });
}

function _menuItem(esCadena, tipo, id, nombre) {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box"><div class="modal-body" style="padding:14px;">
        <div style="font-weight:700;padding:6px 8px;">${esc(nombre)}</div>
        ${tipo === "carpeta" ? `<button class="menu-it" data-acc="renombrar">✏️ Renombrar</button>` : ""}
        <button class="menu-it peligro" data-acc="borrar">🗑 Eliminar</button>
    </div></div>`;
    ov.addEventListener("click", async e => {
        if (e.target === ov) { ov.remove(); return; }
        const acc = e.target.dataset && e.target.dataset.acc;
        if (!acc) return;
        ov.remove();
        try {
            if (acc === "renombrar") {
                const n = prompt("Nuevo nombre:", nombre);
                if (!n || !n.trim()) return;
                await apiLocal(_rid).patch(`/documentos/${esCadena ? "cadena/" : ""}carpetas/${id}`, { nombre: n.trim() });
            } else {
                const q = tipo === "carpeta"
                    ? "¿Eliminar la carpeta y TODO su contenido?"
                    : "¿Eliminar este archivo?";
                if (!confirm(q)) return;
                await apiLocal(_rid).del(`/documentos/${esCadena ? "cadena/" : ""}${tipo === "carpeta" ? "carpetas" : "archivos"}/${id}`);
            }
            _cargar();
        } catch (err) { UI.toast(err.message, "error"); }
    });
    document.body.appendChild(ov);
}

// ── Grupos ────────────────────────────────────────────────────
async function _pintarGrupos() {
    const cont = document.getElementById("dc-cont");
    if (_grupoSel != null) { await _pintarArbol(false); return; }
    try {
        const r = await apiLocal(_rid).get("/documentos/grupos");
        _grupos = (r && r.grupos) || [];
    } catch (e) { _grupos = []; }
    if (!_vivo || !cont) return;
    cont.innerHTML = _grupos.length ? _grupos.map(g => `
        <div class="dc-item" data-g="${g.id}">
            <span class="dc-ico">👥</span><span class="crece">${esc(g.nombre)}</span><span class="muted">›</span>
        </div>`).join("")
        : `<div class="muted centrado" style="padding:30px;">No pertenecés a ningún grupo de documentos.</div>`;
    cont.querySelectorAll(".dc-item").forEach(it => it.addEventListener("click", () => {
        _grupoSel = parseInt(it.dataset.g, 10);
        _carpeta = null;
        _cargar();
    }));
}

// ── Personal (gate por contraseña → agregado de la cadena) ────
async function _pintarPersonal() {
    const cont = document.getElementById("dc-cont");
    if (!_personalOk) {
        cont.innerHTML = `
        <div class="card res-card centrado" style="padding:26px 18px;">
            <div style="font-size:38px;">🔒</div>
            <div style="font-weight:700;margin:8px 0 4px;">Documentos personales</div>
            <div class="muted" style="font-size:13.5px;">Por tu privacidad, reingresá tu contraseña.</div>
            <input id="dp-pass" type="password" placeholder="Contraseña" style="margin-top:14px;">
            <div id="dp-msg" style="color:var(--peligro);font-size:13px;font-weight:600;margin-top:8px;min-height:18px;"></div>
            <button class="btn-primario" id="dp-entrar" style="width:100%;margin-top:6px;">Desbloquear</button>
        </div>`;
        const entrar = async () => {
            const pass = document.getElementById("dp-pass").value;
            if (!pass) return;
            try {
                await apiLocal(_rid).post("/documentos/personal/verificar", { password: pass });
                _personalOk = true;
                _cargar();
            } catch (e) {
                document.getElementById("dp-msg").textContent = e.message || "Contraseña incorrecta";
            }
        };
        document.getElementById("dp-entrar").addEventListener("click", entrar);
        document.getElementById("dp-pass").addEventListener("keydown", e => { if (e.key === "Enter") entrar(); });
        return;
    }
    // Con token de LOCAL: el endpoint resuelve los demás locales del empleado a
    // partir del esquema del token (con el token de cuenta, sin esquema, da vacío).
    const archivos = await apiLocal(_rid).get("/documentos/personal-cadena") || [];
    if (!_vivo || !cont) return;
    cont.innerHTML = archivos.length ? archivos.map(a => `
        <div class="dc-item" data-url="${escAttr(a.url)}" data-rt="${escAttr(a.resource_type || "")}">
            <span class="dc-ico">${a.resource_type === "image" ? "🖼" : "📄"}</span>
            <span class="crece">${esc(a.nombre)}
                <div class="muted" style="font-size:11.5px;">${a.restaurante ? "🏠 " + esc(a.restaurante) + " · " : ""}${esc(haceCuanto(a.creado_en))}</div>
            </span>
        </div>`).join("")
        : `<div class="muted centrado" style="padding:30px;">No tenés documentos personales.</div>`;
    cont.querySelectorAll(".dc-item").forEach(it => it.addEventListener("click", () => {
        if (it.dataset.rt === "image") verImagen(it.dataset.url);
        else abrirArchivo(it.dataset.url);
    }));
}

// ── Capacitaciones ────────────────────────────────────────────
async function _pintarCapacitaciones() {
    const cont = document.getElementById("dc-cont");
    const rc = await apiLocal(_rid).get("/documentos/capacitaciones");
    const caps = (rc && rc.capacitaciones) || [];
    if (!_vivo || !cont) return;
    // Pendientes de firmar arriba (mi_firmado_en === null); las del editor no llevan firma propia.
    const orden = [...caps].sort((a, b) => (a.mi_firmado_en ? 1 : 0) - (b.mi_firmado_en ? 1 : 0));
    cont.innerHTML = orden.length ? orden.map(c => `
        <div class="card res-card">
            <div style="font-weight:700;">🎓 ${esc(c.titulo)}</div>
            ${c.descripcion ? `<div class="muted" style="font-size:13px;margin-top:4px;">${esc(c.descripcion)}</div>` : ""}
            <div class="muted" style="font-size:12px;margin-top:4px;">${esc(haceCuanto(c.creado_en))}</div>
            <div class="fila" style="margin-top:10px;flex-wrap:wrap;">
                <button class="btn-secundario" data-url="${escAttr(c.url)}" style="min-height:42px;flex:1;">📄 Abrir documento</button>
                ${c.soy_destinatario && !c.mi_firmado_en ? `<button class="btn-primario" data-firmar="${c.id}" data-t="${escAttr(c.titulo)}" style="min-height:42px;flex:1;">✍ Firmar</button>`
                    : (c.soy_destinatario && c.mi_firmado_en ? `<span class="res-pill" style="background:#dcfce7;color:#166534;align-self:center;">✔ Firmada</span>` : "")}
            </div>
        </div>`).join("")
        : `<div class="muted centrado" style="padding:30px;">Sin capacitaciones.</div>`;
    cont.querySelectorAll("[data-url]").forEach(b => b.addEventListener("click", () => abrirArchivo(b.dataset.url)));
    cont.querySelectorAll("[data-firmar]").forEach(b => b.addEventListener("click", () => _firmar(parseInt(b.dataset.firmar, 10), b.dataset.t)));
}

function _firmar(id, titulo) {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
        <div class="modal-head">✍ Firmar capacitación</div>
        <div class="modal-body">
            <div style="font-size:14px;">Confirmás que recibiste y leíste <b>${esc(titulo)}</b>. La firma queda registrada con fecha y comprobante en tus documentos personales.</div>
            <label class="campo">Tu contraseña</label>
            <input id="fc-pass" type="password">
            <div id="fc-msg" style="color:var(--peligro);font-size:13px;font-weight:600;margin-top:8px;min-height:18px;"></div>
        </div>
        <div class="modal-foot">
            <button class="btn-secundario" id="fc-cancelar">Cancelar</button>
            <button class="btn-primario" id="fc-ok">Firmar</button>
        </div>
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    ov.querySelector("#fc-cancelar").addEventListener("click", () => ov.remove());
    ov.querySelector("#fc-ok").addEventListener("click", async () => {
        const pass = ov.querySelector("#fc-pass").value;
        if (!pass) return;
        const btn = ov.querySelector("#fc-ok");
        btn.disabled = true;
        try {
            const ahora = new Date();
            const fecha_local = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")} ${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
            await apiLocal(_rid).post(`/documentos/capacitaciones/${id}/firmar`, { password: pass, fecha_local });
            ov.remove();
            UI.toast("Capacitación firmada", "success");
            _cargar();
        } catch (e) {
            ov.querySelector("#fc-msg").textContent = e.message;
            btn.disabled = false;
        }
    });
}
