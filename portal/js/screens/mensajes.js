// ── MENSAJES — buzón por local + agregado de cadena ───────────
// Con token de LOCAL: Recibidos/Enviados completos (leer, favorito, archivar,
// categoría, eliminar, responder, redactar con adjuntos, tarjetas de
// solicitud de turno). Chip "🌐 Todos" (si hay 2+ locales): agregado
// read-only vía /mensajes/recibidos-cadena con token de CUENTA.

import { esc, escAttr, displayName, apiCuenta, esGerente } from "../core/api.js";
import * as config from "../core/config.js";
import { getRestaurantes, getLocalActivo, setLocalActivo, apiLocal } from "../core/sesion.js";
import * as drawer from "../drawer.js";
import { haceCuanto } from "../core/fechas.js";
import { elegirArchivos, verImagen, abrirArchivo, filesAB64 } from "../core/adjuntos.js";

const CATS = {
    personal:   { icono: "💬", label: "Personal" },
    horarios:   { icono: "📅", label: "Horarios" },
    social:     { icono: "📣", label: "Social" },
    documentos: { icono: "📁", label: "Documentos" },
    tareas:     { icono: "✅", label: "Tareas" },
    stock:      { icono: "📦", label: "Control de Stock" },
};

// Acciones asignables a los gestos de swipe (config por usuario en Perfil).
export const ACCIONES = {
    responder: { icono: "↩️", label: "Responder",       color: "#4f46e5" },
    reenviar:  { icono: "↪️", label: "Reenviar",        color: "#0891b2" },
    carpeta:   { icono: "📁", label: "Mover a carpeta", color: "#d97706" },
    eliminar:  { icono: "🗑️", label: "Eliminar",        color: "#dc2626" },
};
export const SWIPE_DEFAULT = { der: "responder", izq: "eliminar" };
function _accionDer() { return config.get("msg_swipe_der") || SWIPE_DEFAULT.der; }
function _accionIzq() { return config.get("msg_swipe_izq") || SWIPE_DEFAULT.izq; }

let _vivo = false;
let _rid = null;
let _modoTodos = false;      // chip 🌐 (agregado cadena, read-only)
let _tab = "recibidos";      // recibidos | enviados | papelera
let _cat = "";               // filtro por categoría
let _soloFav = false;
let _verArchivados = false;
let _lista = [];
let _pollTimer = null;

function _filtrosActivos() { return (_cat ? 1 : 0) + (_soloFav ? 1 : 0) + (_verArchivados ? 1 : 0); }

export async function mount(el) {
    _vivo = true;
    const locales = await getRestaurantes();
    _rid = getLocalActivo();
    _modoTodos = false;
    _tab = "recibidos";

    el.innerHTML = `
    <div class="pantalla">
        ${drawer.headerConMenu("Mensajes", `<button class="hbtn" id="mj-config-btn" title="Configurar deslizables" aria-label="Configurar deslizables">🛠️</button>`)}
        ${locales.length > 1 ? `<div class="chips" id="mj-locales">
            ${esGerente() ? "" : `<button class="chip" data-rid="todos">🌐 Todos</button>`}
            ${locales.map(r => `<button class="chip ${r.restaurante_id === _rid ? "activa" : ""}" data-rid="${r.restaurante_id}">${esc(r.restaurante || r.codigo)}</button>`).join("")}
        </div>` : ""}
        <div class="mj-tabs" id="mj-tabs">
            <button class="mj-tab activa" data-t="recibidos">Recibidos</button>
            <button class="mj-tab" data-t="enviados">Enviados</button>
            <button class="mj-tab" data-t="papelera">Papelera</button>
        </div>
        <div class="mj-barra" id="mj-barra">
            <button class="chip mj-filtros-btn" id="mj-filtros-btn">⚙️ Filtros<span class="mj-filtros-n" id="mj-filtros-n" style="display:none;"></span></button>
        </div>
        <div class="pantalla-body" id="mj-body">
            <div id="mj-lista"><div class="muted centrado" style="padding:30px;">Cargando…</div></div>
        </div>
        <button class="fab" id="mj-fab" title="Redactar">✉️</button>
    </div>`;

    el.querySelectorAll("#mj-locales .chip").forEach(ch => ch.addEventListener("click", async () => {
        el.querySelectorAll("#mj-locales .chip").forEach(c => c.classList.toggle("activa", c === ch));
        if (ch.dataset.rid === "todos") { _modoTodos = true; }
        else { _modoTodos = false; _rid = parseInt(ch.dataset.rid, 10); await setLocalActivo(_rid); }
        _actualizarTabs();
        _cargar();
    }));
    el.querySelectorAll(".mj-tab").forEach(t => t.addEventListener("click", () => {
        _tab = t.dataset.t;
        el.querySelectorAll(".mj-tab").forEach(x => x.classList.toggle("activa", x === t));
        _actualizarBarra();
        _cargar();
    }));
    el.querySelector("#mj-fab").addEventListener("click", () => _componer());
    el.querySelector("#mj-filtros-btn").addEventListener("click", () => _abrirFiltros());
    el.querySelector("#mj-config-btn").addEventListener("click", () => _abrirConfigGestos());

    _actualizarBarra();
    await _cargar();
    _pollTimer = setInterval(() => { if (_vivo && !document.hidden) _cargar(true); }, 90000);
}

export function onResume() { if (_vivo) _cargar(true); }

export function unmount() {
    _vivo = false;
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function _actualizarTabs() {
    // En modo 🌐 Todos: solo recibidos (agregado read-only) y sin redactar
    const tabs = document.getElementById("mj-tabs");
    const fab = document.getElementById("mj-fab");
    if (_modoTodos) {
        if (_tab !== "recibidos") _tab = "recibidos";
        if (tabs) tabs.style.display = "none";
        if (fab) fab.style.display = "none";
    } else {
        if (tabs) tabs.style.display = "";
    }
    _actualizarBarra();
}

// Barra de filtros: un botón que abre el popup + badge con cuántos filtros hay.
// La papelera y el modo Todos no usan filtros de categoría/fav/archivados.
function _actualizarBarra() {
    const barra = document.getElementById("mj-barra");
    const fab = document.getElementById("mj-fab");
    const usaFiltros = !_modoTodos && _tab !== "papelera";
    if (barra) barra.style.display = usaFiltros ? "" : "none";
    if (fab) fab.style.display = (_modoTodos || _tab === "papelera") ? "none" : "";
    const n = document.getElementById("mj-filtros-n");
    if (n) {
        const c = _filtrosActivos();
        n.textContent = c;
        n.style.display = c ? "" : "none";
    }
    const btn = document.getElementById("mj-filtros-btn");
    if (btn) btn.classList.toggle("activa", _filtrosActivos() > 0);
}

// Configuración de los gestos de swipe (movida acá desde Perfil).
async function _abrirConfigGestos() {
    const opts = (sel) => Object.entries(ACCIONES).map(([k, a]) =>
        `<option value="${k}" ${k === sel ? "selected" : ""}>${a.icono} ${esc(a.label)}</option>`).join("");
    // Preferencias de notificación por etiqueta (default: todas notifican)
    let prefs = {};
    try { const r = await apiCuenta.getSilent("/empleado/notif-prefs"); prefs = (r && r.etiquetas) || {}; } catch { }
    const notif = k => prefs[k] !== false;
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
        <div class="modal-head">🛠️ Configuración</div>
        <div class="modal-body">
            <div class="res-card-titulo" style="font-size:14px;">Deslizables</div>
            <div class="muted" style="font-size:12.5px;margin-bottom:6px;">Elegí qué hace deslizar un mensaje hacia cada lado.</div>
            <label class="campo">Deslizar a la derecha →</label>
            <select id="cg-der">${opts(_accionDer())}</select>
            <label class="campo">← Deslizar a la izquierda</label>
            <select id="cg-izq">${opts(_accionIzq())}</select>
            <div class="res-card-titulo" style="font-size:14px;margin-top:18px;">Notificaciones al celular</div>
            <div class="muted" style="font-size:12.5px;margin-bottom:8px;">Elegí qué etiquetas te avisan al celular. (El aviso llega apenas se active el push.)</div>
            ${Object.entries(CATS).map(([k, c]) => `<label class="cp-check"><input type="checkbox" class="cg-notif" data-cat="${k}" ${notif(k) ? "checked" : ""}> ${c.icono} ${esc(c.label)}</label>`).join("")}
        </div>
        <div class="modal-foot">
            <button class="btn-secundario" id="cg-cerrar">Cerrar</button>
            <button class="btn-primario" id="cg-guardar">Guardar</button>
        </div>
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    ov.querySelector("#cg-cerrar").addEventListener("click", () => ov.remove());
    ov.querySelector("#cg-guardar").addEventListener("click", async () => {
        await config.set("msg_swipe_der", ov.querySelector("#cg-der").value);
        await config.set("msg_swipe_izq", ov.querySelector("#cg-izq").value);
        const etiquetas = {};
        ov.querySelectorAll(".cg-notif").forEach(c => { etiquetas[c.dataset.cat] = c.checked; });
        ov.remove();
        _pintarLista();
        try { await apiCuenta.put("/empleado/notif-prefs", { etiquetas }); } catch (e) { }
        UI.toast("Configuración guardada", "success");
    });
}

function _abrirFiltros() {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
        <div class="modal-head">⚙️ Filtros</div>
        <div class="modal-body">
            <div class="mj-f-lbl">Categoría</div>
            <div class="mj-f-cats">
                <button class="chip ${!_cat ? "activa" : ""}" data-cat="">Todas</button>
                ${Object.entries(CATS).map(([k, c]) => `<button class="chip ${_cat === k ? "activa" : ""}" data-cat="${k}">${c.icono} ${c.label}</button>`).join("")}
            </div>
            <label class="cp-check"><input type="checkbox" id="mf-fav" ${_soloFav ? "checked" : ""}> ⭐ Solo favoritos</label>
            <label class="cp-check"><input type="checkbox" id="mf-arch" ${_verArchivados ? "checked" : ""}> 📦 Ver archivados</label>
        </div>
        <div class="modal-foot">
            <button class="btn-secundario" id="mf-limpiar">Limpiar</button>
            <button class="btn-primario" id="mf-aplicar">Aplicar</button>
        </div>
    </div>`;
    document.body.appendChild(ov);
    let cat = _cat;
    ov.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => {
        cat = b.dataset.cat;
        ov.querySelectorAll("[data-cat]").forEach(x => x.classList.toggle("activa", x === b));
    }));
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    ov.querySelector("#mf-limpiar").addEventListener("click", () => {
        _cat = ""; _soloFav = false; _verArchivados = false;
        ov.remove(); _actualizarBarra(); _pintarLista();
    });
    ov.querySelector("#mf-aplicar").addEventListener("click", () => {
        _cat = cat;
        _soloFav = ov.querySelector("#mf-fav").checked;
        _verArchivados = ov.querySelector("#mf-arch").checked;
        ov.remove(); _actualizarBarra(); _pintarLista();
    });
}

async function _cargar(silencioso = false) {
    try {
        if (_modoTodos) {
            _lista = await apiCuenta[silencioso ? "getSilent" : "get"]("/mensajes/recibidos-cadena") || [];
        } else if (_rid) {
            const ep = _tab === "papelera" ? "/mensajes/papelera" : `/mensajes/${_tab}`;
            _lista = await apiLocal(_rid)[silencioso ? "getSilent" : "get"](ep) || [];
        } else { _lista = []; }
        if (_vivo) _pintarLista();
    } catch (e) {
        if (!silencioso) {
            const l = document.getElementById("mj-lista");
            if (l) l.innerHTML = `<div class="muted centrado" style="padding:30px;">No se pudieron cargar los mensajes.<br>${esc(e.message)}</div>`;
        }
    }
}

function _filtrados() {
    if (_tab === "papelera") return _lista;   // la papelera no usa los filtros de categoría/fav/archivados
    return _lista.filter(m => {
        if (_cat && (m.categoria || "personal") !== _cat) return false;
        if (_soloFav && !m.favorito) return false;
        if (_tab === "recibidos" && !_modoTodos) {
            if (_verArchivados !== !!m.archivado) return false;
        }
        return true;
    });
}

function _pintarLista() {
    const l = document.getElementById("mj-lista");
    if (!l) return;
    const ms = _filtrados();
    if (!ms.length) {
        l.innerHTML = _tab === "papelera"
            ? `<div class="muted centrado" style="padding:30px;">La papelera está vacía.<br><span style="font-size:12px;">Los mensajes borrados se guardan acá 30 días.</span></div>`
            : `<div class="muted centrado" style="padding:30px;">Sin mensajes${_filtrosActivos() ? " con estos filtros" : ""}.</div>`;
        return;
    }
    // Gestos de swipe solo en las bandejas editables (no en papelera ni en la vista de cadena).
    const conSwipe = !_modoTodos && _tab !== "papelera";
    const aDer = ACCIONES[_accionDer()] || ACCIONES.responder;
    const aIzq = ACCIONES[_accionIzq()] || ACCIONES.eliminar;
    l.innerHTML = ms.map(m => {
        const cat = CATS[m.categoria || "personal"] || CATS.personal;
        const esEnv = (_tab === "enviados") || (_tab === "papelera" && m.lado === "enviado");
        const quien = esEnv ? `Para: ${esc(m.para_nombre_display || m.para_username || "")}`
                            : esc(m.de_nombre_display || m.de_username || "");
        const card = `<div class="mj-item card ${m.leido === false && _tab === "recibidos" ? "noleido" : ""}" data-id="${m.id}">
            <div class="mj-item-top">
                <span class="mj-cat">${cat.icono}</span>
                <b class="crece">${quien}</b>
                ${_tab !== "papelera" && m.favorito ? "⭐" : ""}${_tab !== "papelera" && m.archivado ? "📦" : ""}
                <span class="muted" style="font-size:12px;">${esc(haceCuanto(m.creado_en))}</span>
            </div>
            <div class="mj-asunto">${esc(m.asunto || "(sin asunto)")}</div>
            <div class="mj-preview muted">${esc((m.cuerpo || "").slice(0, 80))}</div>
            ${m.restaurante ? `<div class="mj-local muted">🏠 ${esc(m.restaurante)}</div>` : ""}
            ${m.solicitud_id && _tab !== "papelera" ? `<div class="mj-sol">📅 Solicitud de turno · ${esc(m.solicitud_estado || "")}</div>` : ""}
            ${_tab === "papelera" ? `<div class="mj-papelera-info">🗑 ${esc(m.lado === "enviado" ? "enviado" : "recibido")} · se borra en ${m.dias_restantes} día${m.dias_restantes === 1 ? "" : "s"}</div>` : ""}
        </div>`;
        if (!conSwipe) return `<div class="mj-wrap" data-id="${m.id}">${card}</div>`;
        return `<div class="mj-wrap con-swipe" data-id="${m.id}">
            <div class="mj-swipe-bg izq" style="background:${aIzq.color};">${aIzq.icono}<span>${esc(aIzq.label)}</span></div>
            <div class="mj-swipe-bg der" style="background:${aDer.color};"><span>${esc(aDer.label)}</span>${aDer.icono}</div>
            ${card}
        </div>`;
    }).join("");
    l.querySelectorAll(".mj-wrap").forEach(w => {
        const m = _lista.find(x => x.id === parseInt(w.dataset.id, 10));
        if (m) _attachGestos(w, m);
    });
}

// ── Gestos: tap (detalle) · long-press (preview) · swipe (acción) ──
function _attachGestos(wrap, m) {
    const card = wrap.querySelector(".mj-item");
    const conSwipe = wrap.classList.contains("con-swipe");
    const ladoM = (_tab === "enviados") || (_tab === "papelera" && m.lado === "enviado") ? "enviado" : "recibido";
    let x0 = 0, y0 = 0, dx = 0, modo = null;   // modo: null | 'swipe' | 'scroll'
    let lpTimer = null, lpDisparado = false;
    const UMBRAL = 90, MAX = 130;

    const limpiarLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
    const resetCard = (anim = true) => {
        card.style.transition = anim ? "transform .18s ease" : "none";
        card.style.transform = "translateX(0)";
    };

    card.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        x0 = e.clientX; y0 = e.clientY; dx = 0; modo = null; lpDisparado = false;
        card.style.transition = "none";
        limpiarLP();
        lpTimer = setTimeout(() => {   // long-press → preview
            if (modo === null) { lpDisparado = true; _previewMensaje(m, ladoM); }
        }, 430);
    });
    card.addEventListener("pointermove", (e) => {
        if (lpDisparado) return;
        const ax = e.clientX - x0, ay = e.clientY - y0;
        if (modo === null) {
            if (Math.abs(ax) > 10 && Math.abs(ax) > Math.abs(ay) * 1.3) { modo = "swipe"; limpiarLP(); }
            else if (Math.abs(ay) > 12) { modo = "scroll"; limpiarLP(); }
        }
        if (modo === "swipe") {
            if (!conSwipe) return;
            e.preventDefault();
            dx = Math.max(-MAX, Math.min(MAX, ax));
            card.style.transform = `translateX(${dx}px)`;
            wrap.classList.toggle("revela-der", dx > 0);
            wrap.classList.toggle("revela-izq", dx < 0);
        }
    });
    const soltar = () => {
        limpiarLP();
        if (lpDisparado) { lpDisparado = false; return; }
        if (modo === "swipe" && conSwipe && Math.abs(dx) >= UMBRAL) {
            const accion = dx > 0 ? _accionDer() : _accionIzq();
            resetCard(true);
            wrap.classList.remove("revela-der", "revela-izq");
            setTimeout(() => _ejecutarAccion(accion, m, ladoM), 60);
        } else if (modo === "swipe") {
            resetCard(true);
            wrap.classList.remove("revela-der", "revela-izq");
        } else if (modo === null) {
            _abrirDetalle(m);   // tap simple
        }
        modo = null;
    };
    card.addEventListener("pointerup", soltar);
    card.addEventListener("pointercancel", () => { limpiarLP(); resetCard(true); wrap.classList.remove("revela-der", "revela-izq"); modo = null; lpDisparado = false; });
}

// ── Long-press: preview flotante del mensaje (lista atenuada de fondo) ──
function _previewMensaje(m, ladoM) {
    const cerrar = () => { ov.remove(); document.removeEventListener("pointerup", cerrarUp); };
    const cerrarUp = () => cerrar();
    const ov = document.createElement("div");
    ov.className = "mj-preview-ov";
    const esEnv = ladoM === "enviado";
    ov.innerHTML = `<div class="mj-preview-card">
        <div class="mj-preview-head">
            <span class="mj-cat">${(CATS[m.categoria || "personal"] || CATS.personal).icono}</span>
            <b>${esc(esEnv ? "Para: " + (m.para_nombre_display || m.para_username || "") : (m.de_nombre_display || m.de_username || ""))}</b>
            <span class="muted" style="font-size:12px;margin-left:auto;">${esc(haceCuanto(m.creado_en))}</span>
        </div>
        <div class="mj-preview-asunto">${esc(m.asunto || "(sin asunto)")}</div>
        <div class="mj-preview-cuerpo">${esc((m.cuerpo || "").slice(0, 600))}${(m.cuerpo || "").length > 600 ? "…" : ""}</div>
        ${(m.adjuntos || []).length ? `<div class="muted" style="font-size:12.5px;margin-top:8px;">📎 ${m.adjuntos.length} adjunto(s)</div>` : ""}
    </div>`;
    document.body.appendChild(ov);
    // Se cierra al soltar el dedo (peek) o al tocar el fondo.
    document.addEventListener("pointerup", cerrarUp, { once: true });
    ov.addEventListener("click", cerrar);
}

// ── Ejecutor de acciones de swipe ─────────────────────────────
async function _ejecutarAccion(accion, m, ladoM) {
    if (accion === "eliminar") {
        try {
            await apiLocal(_rid).del(`/mensajes/${m.id}?lado=${ladoM}`);
            UI.toast("Movido a la papelera (30 días)", "info"); _cargar();
        } catch (e) { UI.toast(e.message, "error"); }
    } else if (accion === "responder") {
        // Responder al remitente (o, si es un enviado, al destinatario original).
        const destId = ladoM === "enviado" ? m.para_usuario_id : m.de_usuario_id;
        const destN  = ladoM === "enviado" ? (m.para_nombre_display || m.para_username) : (m.de_nombre_display || m.de_username);
        _componer({
            para: destId != null ? [{ id: destId, nombre: destN }] : [],
            asunto: (m.asunto || "").startsWith("Re:") ? m.asunto : "Re: " + (m.asunto || ""),
            cita: m.cuerpo,
        });
    } else if (accion === "reenviar") {
        const origen = m.de_nombre_display || m.de_username || "";
        _componer({
            asunto: (m.asunto || "").startsWith("Reenv:") ? m.asunto : "Reenv: " + (m.asunto || ""),
            cita: (origen ? `De: ${origen}\n` : "") + (m.cuerpo || ""),
        });
    } else if (accion === "carpeta") {
        _moverCarpeta(m);
    }
}

function _moverCarpeta(m) {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box"><div class="modal-head">📁 Mover a carpeta</div>
        <div class="modal-body">
            ${Object.entries(CATS).map(([k, c]) => `<button class="menu-it" data-cat="${k}">${c.icono} ${c.label}${(m.categoria || "personal") === k ? " ✓" : ""}</button>`).join("")}
        </div>
        <div class="modal-foot"><button class="btn-secundario">Cancelar</button></div></div>`;
    ov.addEventListener("click", async e => {
        if (e.target === ov || (e.target.tagName === "BUTTON" && e.target.textContent === "Cancelar")) { ov.remove(); return; }
        const k = e.target.dataset && e.target.dataset.cat;
        if (!k) return;
        ov.remove();
        try {
            await apiLocal(_rid).patch(`/mensajes/${m.id}`, { categoria: k });
            m.categoria = k; UI.toast(`Movido a ${CATS[k].label}`, "success"); _pintarLista();
        } catch (err) { UI.toast(err.message, "error"); }
    });
    document.body.appendChild(ov);
}

// ── Detalle ───────────────────────────────────────────────────
async function _abrirDetalle(m) {
    const soloLectura = _modoTodos;
    const enPapelera = _tab === "papelera";
    const ladoM = enPapelera ? (m.lado || "recibido") : (_tab === "enviados" ? "enviado" : "recibido");
    if (!soloLectura && !enPapelera && _tab === "recibidos" && m.leido === false) {
        apiLocal(_rid).patch(`/mensajes/${m.id}/leer`, {}).then(() => {
            m.leido = true; _pintarLista();
        }).catch(() => {});
    }
    const adjs = m.adjuntos || [];
    const mostrarDe = ladoM === "enviado" ? "Para" : "De";
    const mostrarQuien = ladoM === "enviado" ? (m.para_nombre_display || m.para_username) : (m.de_nombre_display || m.de_username);
    // Acciones secundarias (favorito/archivar/mover) → menú ⋮; solo en recibidos activos.
    const conMenu = !soloLectura && !enPapelera && _tab === "recibidos";
    // Acción embebida (aviso de bloqueo por 3 intentos): botón Reactivar con
    // re-confirmación por contraseña del gestor.
    let accion = null;
    try { accion = m.accion ? (typeof m.accion === "string" ? JSON.parse(m.accion) : m.accion) : null; } catch (_) {}
    const esReactivar = accion && ["reactivar_usuario", "reactivar_empleado"].includes(accion.tipo)
        && !soloLectura && !enPapelera;
    // Mensajes del SISTEMA (avisos automáticos): nadie lee esa casilla → no se
    // responden; se pueden REENVIAR a otra persona (consulta/confirmación).
    const esSistema = (m.de_username || "") === "sistema";

    // Vista a PANTALLA COMPLETA (no ventana flotante): encabezado + cuerpo legible
    // + pie con accesos directos (Responder / Eliminar). El resto va al menú ⋮.
    const ov = document.createElement("div");
    ov.className = "mj-detalle";
    ov.style.cssText = "position:fixed;inset:0;z-index:9000;background:var(--fondo);display:flex;flex-direction:column;";
    ov.innerHTML = `
        <div class="pantalla-header">
            <button class="hbtn" data-acc="cerrar">←</button>
            <h1 style="font-size:16.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.asunto || "(sin asunto)")}</h1>
            ${conMenu ? `<button class="hbtn" data-acc="menu">⋮</button>` : ""}
        </div>
        <div class="pantalla-body">
            <div class="muted" style="font-size:13.5px;">
                ${mostrarDe}: <b>${esc(mostrarQuien)}</b> · ${esc(haceCuanto(m.creado_en))}${m.restaurante ? ` · 🏠 ${esc(m.restaurante)}` : ""}
            </div>
            ${enPapelera ? `<div class="mj-papelera-info" style="margin-top:10px;">🗑 En la papelera · se borra definitivamente en ${m.dias_restantes} día${m.dias_restantes === 1 ? "" : "s"}</div>` : ""}
            <div style="font-size:15.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin-top:14px;color:var(--texto);">${esc(m.cuerpo || "")}</div>
            ${adjs.map(a => (a.tipo === "imagen" || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(a.url || ""))
                ? `<img src="${escAttr(a.url)}" data-full="${escAttr(a.url)}" style="max-width:100%;border-radius:10px;margin-top:12px;">`
                : `<button class="post-file" data-url="${escAttr(a.url)}" style="margin-top:10px;">📄 ${esc(a.nombre || "archivo")}</button>`).join("")}
            ${m.solicitud_id && !enPapelera ? `<button class="post-solicitud" data-sid="${m.solicitud_id}" style="margin-top:12px;">📅 Ver solicitud de turno ›</button>` : ""}
            ${esReactivar ? `<button class="btn-primario" data-acc="reactivar" style="width:100%;margin-top:16px;min-height:50px;">🔓 Reactivar usuario${accion.nombre ? ` — ${esc(accion.nombre)}` : ""}</button>` : ""}
        </div>
        <div class="pantalla-footer">
            ${enPapelera
                ? `<button class="btn-peligro" data-acc="def">🗑 Eliminar definitivo</button>
                   <button class="btn-primario" data-acc="restaurar">♻ Recuperar</button>`
                : `${!soloLectura ? `<button class="btn-peligro" data-acc="borrar">🗑 Eliminar</button>` : ""}
                   ${conMenu ? (esSistema
                        ? `<button class="btn-primario" data-acc="reenviar">↪ Reenviar</button>`
                        : `<button class="btn-primario" data-acc="responder">↩ Responder</button>`)
                             : `<button class="btn-secundario" data-acc="cerrar">Cerrar</button>`}`}
        </div>`;
    document.body.appendChild(ov);
    const cerrar = () => ov.remove();

    // Menú ⋮: favorito, archivar y mover a carpeta (las acciones que no son directas).
    const abrirMenu = () => {
        const mv = document.createElement("div");
        mv.className = "modal-overlay";
        mv.innerHTML = `<div class="modal-box"><div class="modal-body" style="display:flex;flex-direction:column;gap:6px;padding:14px;">
            <button class="btn-secundario" data-mn="fav" style="min-height:46px;">${m.favorito ? "⭐ Quitar de favoritos" : "☆ Marcar favorito"}</button>
            <button class="btn-secundario" data-mn="arch" style="min-height:46px;">${m.archivado ? "📤 Desarchivar" : "📦 Archivar"}</button>
            <div class="muted" style="font-size:12.5px;margin:6px 2px 0;">Mover a carpeta</div>
            ${Object.entries(CATS).map(([k, c]) => `<button class="btn-secundario" data-mn="cat:${k}" style="min-height:44px;${(m.categoria || "personal") === k ? "border-color:var(--primario);color:var(--primario);" : ""}">${c.icono} ${c.label}${(m.categoria || "personal") === k ? " ✓" : ""}</button>`).join("")}
        </div><div class="modal-foot"><button class="btn-secundario" data-mn="x">Cerrar</button></div></div>`;
        document.body.appendChild(mv);
        mv.addEventListener("click", async e => {
            if (e.target === mv) { mv.remove(); return; }
            const mn = e.target.dataset && e.target.dataset.mn;
            if (!mn || mn === "x") { mv.remove(); return; }
            try {
                if (mn === "fav") {
                    await apiLocal(_rid).patch(`/mensajes/${m.id}`, { favorito: !m.favorito }); m.favorito = !m.favorito;
                    mv.remove(); _pintarLista();
                } else if (mn === "arch") {
                    await apiLocal(_rid).patch(`/mensajes/${m.id}`, { archivado: !m.archivado }); m.archivado = !m.archivado;
                    mv.remove(); cerrar(); _pintarLista();
                } else if (mn.startsWith("cat:")) {
                    const c = mn.slice(4);
                    await apiLocal(_rid).patch(`/mensajes/${m.id}`, { categoria: c }); m.categoria = c;
                    mv.remove(); _pintarLista();
                }
            } catch (err) { UI.toast(err.message, "error"); }
        });
    };

    ov.addEventListener("click", async e => {
        if (e.target.dataset && e.target.dataset.url) { abrirArchivo(e.target.dataset.url); return; }
        if (e.target.dataset && e.target.dataset.full) { verImagen(e.target.dataset.full); return; }
        if (e.target.dataset && e.target.dataset.sid) { cerrar(); window._ir("solicitud/" + e.target.dataset.sid); return; }
        const acc = e.target.dataset && e.target.dataset.acc;
        if (!acc) return;
        if (acc === "cerrar") { cerrar(); return; }
        if (acc === "menu") { abrirMenu(); return; }
        if (acc === "reactivar") {
            const pass = await _pedirPassword(
                `Para reactivar a ${accion.nombre || "este usuario"}, confirmá con TU contraseña.`);
            if (!pass) return;
            try {
                const body = { password: pass };
                if (accion.tipo === "reactivar_usuario") body.usuario_id = accion.usuario_id;
                else body.empleado_id = accion.empleado_id;
                const r = await apiLocal(_rid).post("/auth/usuarios/reactivar-bloqueo", body);
                UI.toast((r && r.mensaje) || "Usuario reactivado ✔", "success", 4000);
            } catch (err) { UI.toast(err.message, "error"); }
            return;
        }
        if (acc === "restaurar") {
            try {
                await apiLocal(_rid).post(`/mensajes/${m.id}/restaurar?lado=${ladoM}`, {});
                cerrar(); UI.toast("Mensaje recuperado", "success"); _cargar();
            } catch (err) { UI.toast(err.message, "error"); }
        } else if (acc === "def") {
            if (!confirm("¿Eliminar este mensaje definitivamente? No se podrá recuperar.")) return;
            try {
                await apiLocal(_rid).del(`/mensajes/${m.id}/definitivo?lado=${ladoM}`);
                cerrar(); _cargar();
            } catch (err) { UI.toast(err.message, "error"); }
        } else if (acc === "borrar") {
            try {
                await apiLocal(_rid).del(`/mensajes/${m.id}?lado=${ladoM}`);
                cerrar(); UI.toast("Movido a la papelera (30 días)", "info"); _cargar();
            } catch (err) { UI.toast(err.message, "error"); }
        } else if (acc === "responder") {
            cerrar();
            _componer({
                para: [{ id: m.de_usuario_id, nombre: m.de_nombre_display || m.de_username }],
                asunto: (m.asunto || "").startsWith("Re:") ? m.asunto : "Re: " + (m.asunto || ""),
                cita: m.cuerpo,
            });
        } else if (acc === "reenviar") {
            // Reenvío (mensajes del sistema): destinatario a elegir + cita del original.
            cerrar();
            _componer({
                para: [],
                asunto: (m.asunto || "").startsWith("RV:") ? m.asunto : "RV: " + (m.asunto || ""),
                cita: m.cuerpo,
            });
        }
    });
}

// Pedir la contraseña del gestor (confirmación de una acción sensible).
function _pedirPassword(texto) {
    return new Promise((resolve) => {
        const ov = document.createElement("div");
        ov.className = "modal-overlay";
        ov.innerHTML = `<div class="modal-box">
            <div class="modal-head">🔑 Confirmar identidad</div>
            <div class="modal-body">
                <div class="muted" style="font-size:13.5px;">${esc(texto || "Confirmá con tu contraseña.")}</div>
                <label class="campo">Tu contraseña</label>
                <input id="pw-conf" type="password" autocomplete="current-password">
            </div>
            <div class="modal-foot">
                <button class="btn-secundario" data-x="1">Cancelar</button>
                <button class="btn-primario" id="pw-ok">Confirmar</button>
            </div>
        </div>`;
        document.body.appendChild(ov);
        const fin = (v) => { ov.remove(); resolve(v); };
        ov.addEventListener("click", e => {
            if (e.target === ov || (e.target.dataset && e.target.dataset.x)) fin(null);
        });
        ov.querySelector("#pw-ok").addEventListener("click", () => {
            const v = ov.querySelector("#pw-conf").value;
            if (v) fin(v);
        });
        ov.querySelector("#pw-conf").focus({ preventScroll: true });
    });
}

// ── Typeahead de destinatarios (campo de texto con filtro + chips) ──
function _taCss() {
    if (document.getElementById("ta-css")) return;
    const s = document.createElement("style");
    s.id = "ta-css";
    s.textContent = `
    .ta-lbl{font-size:12.5px;font-weight:700;color:var(--texto-suave);margin-bottom:4px;}
    .ta-box{position:relative;}
    .ta-field{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid var(--borde);border-radius:10px;padding:7px 8px;min-height:44px;background:#fff;}
    .ta-field:focus-within{border-color:var(--primario);}
    .ta-chip{display:inline-flex;align-items:center;gap:6px;background:var(--primario);color:#fff;border-radius:14px;padding:5px 10px;font-size:13px;font-weight:600;cursor:pointer;}
    .ta-chip b{font-weight:800;opacity:.9;}
    .ta-input{flex:1;min-width:120px;border:none;outline:none;background:transparent;font-size:15px;padding:4px 2px;color:var(--texto);}
    .ta-sug{display:none;margin-top:5px;border:1px solid var(--borde);border-radius:10px;overflow:hidden;max-height:216px;overflow-y:auto;background:#fff;box-shadow:var(--card-sombra);}
    .ta-sug.open{display:block;}
    .ta-op{display:block;width:100%;text-align:left;background:none;border:none;padding:11px 12px;font-size:14.5px;cursor:pointer;color:var(--texto);border-bottom:1px solid #f0f0f3;}
    .ta-op:last-child{border-bottom:none;}
    .ta-op:active{background:var(--fondo);}
    `;
    document.head.appendChild(s);
}
function _normTxt(s) { return (s == null ? "" : String(s)).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function _matchUsuario(u, q) {
    const n = _normTxt(displayName(u)), un = _normTxt(u.username);
    return n.startsWith(q) || un.startsWith(q) || n.split(/\s+/).some(w => w.startsWith(q));
}
// Campo con chips seleccionados + input que filtra usuarios a medida que se escribe.
// `sel` se muta en el lugar (push/splice); onChange recibe la misma referencia.
// Tocar un chip lo elimina; tocar una sugerencia lo agrega.
function _typeahead(box, sel, usuarios, onChange) {
    const pintar = () => {
        box.innerHTML = `
            <div class="ta-field">
                ${sel.map((p, i) => `<span class="ta-chip" data-i="${i}">${esc(p.nombre)}<b>✕</b></span>`).join("")}
                <input class="ta-input" placeholder="${sel.length ? "Agregar otro…" : "Escribí un nombre…"}" autocomplete="off" autocapitalize="off">
            </div>
            <div class="ta-sug"></div>`;
        const inp = box.querySelector(".ta-input");
        const sug = box.querySelector(".ta-sug");
        box.querySelectorAll(".ta-chip").forEach(c => c.addEventListener("click", () => {
            sel.splice(parseInt(c.dataset.i, 10), 1); onChange(sel); pintar();
        }));
        const filtrar = () => {
            const q = _normTxt(inp.value.trim());
            if (!q) { sug.className = "ta-sug"; sug.innerHTML = ""; return; }
            const ms = usuarios.filter(u => !sel.some(p => p.id === u.id) && _matchUsuario(u, q)).slice(0, 8);
            sug.innerHTML = ms.length
                ? ms.map(u => `<button type="button" class="ta-op" data-uid="${u.id}" data-n="${escAttr(displayName(u))}">${esc(displayName(u))}<span class="muted"> · ${esc(u.rol || "")}</span></button>`).join("")
                : `<div class="muted" style="padding:9px 12px;font-size:13px;">Sin coincidencias</div>`;
            sug.className = "ta-sug open";
        };
        inp.addEventListener("input", filtrar);
        inp.addEventListener("focus", filtrar);
        sug.addEventListener("click", e => {
            const b = e.target.closest("[data-uid]"); if (!b) return;
            sel.push({ id: parseInt(b.dataset.uid, 10), nombre: b.dataset.n });
            onChange(sel); pintar();
            const ni = box.querySelector(".ta-input"); if (ni) ni.focus({ preventScroll: true });
        });
    };
    pintar();
}

// ── Composer ──────────────────────────────────────────────────
async function _componer(pre = {}) {
    let usuarios = [];
    try { usuarios = await apiLocal(_rid).getSilent("/mensajes/usuarios") || []; } catch (_) {}
    let para = (pre.para || []).filter(p => p.id != null);
    let cc = [];
    let archivos = [];

    _taCss();
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
        <div class="modal-head">✉️ Nuevo mensaje</div>
        <div class="modal-body">
            <div class="ta-lbl">Para</div>
            <div id="cm-para-box" class="ta-box"></div>
            <div class="ta-lbl" style="margin-top:8px;">CC <span style="font-weight:400;color:var(--texto-suave);">(opcional)</span></div>
            <div id="cm-cc-box" class="ta-box"></div>
            <input id="cm-asunto" placeholder="Asunto" value="${escAttr(pre.asunto || "")}" style="margin-top:10px;">
            <textarea id="cm-cuerpo" rows="5" placeholder="Escribí tu mensaje…" style="margin-top:8px;">${pre.cita ? "\n\n———\n" + esc(pre.cita) : ""}</textarea>
            <button class="btn-secundario" id="cm-adj" style="margin-top:8px;min-height:42px;">📎 Adjuntar</button>
            <div id="cm-adjs" style="margin-top:6px;font-size:13px;"></div>
            <div id="cm-msg" style="color:var(--peligro);font-size:13px;font-weight:600;margin-top:8px;"></div>
        </div>
        <div class="modal-foot">
            <button class="btn-secundario" id="cm-cancelar">Cancelar</button>
            <button class="btn-primario" id="cm-enviar">Enviar</button>
        </div>
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    ov.querySelector("#cm-cancelar").addEventListener("click", () => ov.remove());

    // Destinatarios: campo de texto con filtro en vivo + chips (tocar chip = quitar).
    _typeahead(ov.querySelector("#cm-para-box"), para, usuarios, s => { para = s; });
    _typeahead(ov.querySelector("#cm-cc-box"), cc, usuarios, s => { cc = s; });
    ov.querySelector("#cm-adj").addEventListener("click", async () => {
        archivos = archivos.concat(await elegirArchivos({ multiple: true }));
        ov.querySelector("#cm-adjs").innerHTML = archivos.map(f => `<span class="chip" style="margin:2px;">${esc(f.name.slice(0, 24))}</span>`).join("");
    });

    ov.querySelector("#cm-enviar").addEventListener("click", async () => {
        const msg = ov.querySelector("#cm-msg");
        const asunto = ov.querySelector("#cm-asunto").value.trim();
        const cuerpo = ov.querySelector("#cm-cuerpo").value.trim();
        if (!para.length) { msg.textContent = "Elegí al menos un destinatario."; return; }
        if (!asunto && !cuerpo) { msg.textContent = "Escribí un asunto o un mensaje."; return; }
        const btn = ov.querySelector("#cm-enviar");
        btn.disabled = true; btn.textContent = "Enviando…";
        try {
            let adjuntos = [];
            if (archivos.length) {
                // JSON + base64 por el transporte NATIVO (multipart del webview
                // falla en iOS con "Load failed").
                adjuntos = await apiLocal(_rid).post("/mensajes/adjuntos-json",
                    { adjuntos: await filesAB64(archivos) }) || [];
            }
            await apiLocal(_rid).post("/mensajes/", {
                para_usuario_ids: para.map(p => p.id),
                cc_usuario_ids: cc.map(p => p.id),
                asunto, cuerpo, adjuntos,
            });
            ov.remove();
            UI.toast("Mensaje enviado", "success");
            if (_tab === "enviados") _cargar();
        } catch (e) {
            msg.textContent = e.message;
            btn.disabled = false; btn.textContent = "Enviar";
        }
    });
}
