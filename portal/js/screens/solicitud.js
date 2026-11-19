// ── SOLICITUD — detalle + acciones (máquina de estados completa) ──
// intercambio: prop_receptor ↔ prop_solicitante → pend_confirmacion →
// aprobada/denegada (confirma un editor). oferta: disponible → asignada.
// abierto: abierta → asignada. Acciones según rol/estado; el conflicto de
// día (dos turnos el mismo día) se resuelve preguntando y reintentando con
// permitir_conflicto (fusiona franjas).

import { esc } from "../core/api.js";
import { getLocalActivo, apiLocal } from "../core/sesion.js";
import * as drawer from "../drawer.js";
import { etiquetaDia, hhmm, haceCuanto, hoyISO, lunesDe, sumarDias } from "../core/fechas.js";

let _vivo = false;
let _rid = null;
let _sid = null;
let _s = null;

const EST_LBL = {
    abierta: "Abierto — se aceptan postulaciones", disponible: "Disponible — se aceptan postulaciones",
    prop_receptor: "Esperando respuesta del compañero", prop_solicitante: "Contrapropuesta — esperando al creador",
    pend_confirmacion: "Aceptado — falta aprobación de un responsable",
    aprobada: "✅ Aprobada", asignada: "✅ Asignada", denegada: "Denegada",
    rechazada: "Rechazada", cancelada: "Cancelada",
};

export async function mount(el, params) {
    _vivo = true;
    _rid = getLocalActivo();
    _sid = parseInt(params, 10);
    el.innerHTML = `
    <div class="pantalla">
        <div class="pantalla-header">
            <button class="hbtn" onclick="_ir('horarios/solicitudes')">‹</button>
            <h1>Solicitud #${_sid}</h1>
        </div>
        <div class="pantalla-body" id="so-body">
            <div class="muted centrado" style="padding:30px;">Cargando…</div>
        </div>
    </div>`;
    await _cargar();
}

export function unmount() { _vivo = false; }

function _parseFranjas(x) {
    if (Array.isArray(x)) return x;
    try { return JSON.parse(x || "[]"); } catch { return []; }
}
function _fr(x) { return _parseFranjas(x).map(f => `${hhmm(f.inicio)}–${hhmm(f.fin)}`).join(" · "); }

async function _cargar() {
    const body = document.getElementById("so-body");
    try {
        _s = await apiLocal(_rid).get(`/horarios/solicitudes/${_sid}`);
    } catch (e) {
        if (body) body.innerHTML = `<div class="muted centrado" style="padding:30px;">${esc(e.message)}</div>`;
        return;
    }
    if (!_vivo || !body) return;
    const s = _s;
    const mi = s.mi_usuario_id;
    const soyCreador = s.creado_por === mi;
    const soyDestino = s.destino_usuario_id === mi;
    const activo = ["abierta", "disponible", "prop_receptor", "prop_solicitante", "pend_confirmacion"].includes(s.estado);
    const postulado = (s.postulantes || []).some(p => p.usuario_id === mi);

    const da = (s.turnos || []).filter(t => t.lado === "da");
    const recibe = (s.turnos || []).filter(t => t.lado === "recibe");
    const tituloTipo = s.tipo === "intercambio" ? "🔁 Intercambio de turnos"
        : s.tipo === "oferta" ? "📣 Oferta de turno" : "🟢 Turno abierto";

    // Botonera según estado/rol
    const botones = [];
    if (activo) {
        if (s.tipo === "intercambio") {
            const miTurnoResponder = (s.estado === "prop_receptor" && soyDestino) || (s.estado === "prop_solicitante" && soyCreador);
            if (miTurnoResponder) {
                botones.push(`<button class="btn-primario" data-acc="aceptar">✔ Aceptar</button>`);
                botones.push(`<button class="btn-secundario" data-acc="rechazar">✕ Rechazar</button>`);
            }
            if (s.estado === "pend_confirmacion" && s.puede_editar) {
                botones.push(`<button class="btn-ok" data-acc="confirmar">✅ Aprobar</button>`);
                botones.push(`<button class="btn-peligro" data-acc="denegar">Denegar</button>`);
            }
            if (soyCreador && ["prop_receptor", "prop_solicitante"].includes(s.estado)) {
                botones.push(`<button class="btn-ghost" data-acc="cancelar">Cancelar solicitud</button>`);
            }
        } else {
            if (!soyCreador && ["abierta", "disponible"].includes(s.estado)) {
                botones.push(postulado
                    ? `<button class="btn-secundario" data-acc="desistir">Desistir</button>`
                    : `<button class="btn-primario" data-acc="postular">✋ Postularme</button>`);
            }
            if (s.puede_editar && ["abierta", "disponible"].includes(s.estado)) {
                botones.push(`<button class="btn-ok" data-acc="asignar">👤 Asignar</button>`);
            }
            if (s.estado === "pend_confirmacion" && s.puede_editar) {
                botones.push(`<button class="btn-ok" data-acc="confirmar">✅ Aprobar</button>`);
                botones.push(`<button class="btn-peligro" data-acc="denegar">Denegar</button>`);
            }
            if (soyCreador && ["abierta", "disponible"].includes(s.estado)) {
                botones.push(`<button class="btn-ghost" data-acc="cancelar">Cancelar</button>`);
            }
        }
    }

    body.innerHTML = `
        <div class="card res-card">
            <div class="fila"><b class="crece" style="font-size:16px;">${tituloTipo}</b></div>
            <div class="hr-estado e-${s.estado}" style="display:inline-block;margin-top:6px;">${esc(EST_LBL[s.estado] || s.estado)}</div>
            <div class="muted" style="font-size:13px;margin-top:8px;">
                Creada por <b>${esc(s.creador_display || s.creador_username || "—")}</b>
                ${s.destino_username ? ` · para <b>${esc(s.destino_display || s.destino_username)}</b>` : ""}
            </div>
        </div>

        ${s.tipo === "intercambio" ? `
        <div class="card res-card">
            <div class="res-card-titulo">Turnos</div>
            <div style="font-size:14px;margin-top:6px;"><b>${soyCreador ? "Das" : `${esc(s.creador_display || "")} da`}:</b>
                ${da.length ? da.map(t => `<div class="so-turno">📤 ${esc(etiquetaDia(t.fecha))} · ${esc(_fr(t.franjas))}${t.rol ? ` · ${esc(t.rol)}` : ""}</div>`).join("") : "<div class='muted'>—</div>"}</div>
            <div style="font-size:14px;margin-top:10px;"><b>${soyCreador ? "Recibís" : "Pide"}:</b>
                ${recibe.length ? recibe.map(t => `<div class="so-turno">📥 ${esc(etiquetaDia(t.fecha))} · ${esc(_fr(t.franjas))}${t.rol ? ` · ${esc(t.rol)}` : ""}</div>`).join("") : "<div class='muted'>— (cesión)</div>"}</div>
        </div>` : `
        <div class="card res-card">
            <div class="res-card-titulo">Turno</div>
            <div class="so-turno" style="margin-top:6px;">${esc(etiquetaDia(s.origen_fecha || ""))} · ${esc(_fr(s.origen_franjas))}${s.origen_rol ? ` · ${esc(s.origen_rol)}` : ""}</div>
        </div>`}

        ${s.mi_conflicto ? `<div class="hr-aviso">⚠ Ya tenés un turno ese día: si esto se aprueba, se fusionan las franjas (turno doble).</div>` : ""}

        ${(s.postulantes || []).length ? `
        <div class="card res-card">
            <div class="res-card-titulo">Postulantes (${s.postulantes.length})</div>
            ${s.postulantes.map(p => `<div class="pf-local">${esc(p.nombre_display || p.username)} <span class="muted" style="font-size:12px;">· ${esc(haceCuanto(p.postulado_en))}</span></div>`).join("")}
        </div>` : ""}

        ${(s.eventos || []).length ? `
        <div class="card res-card">
            <div class="res-card-titulo">Historial</div>
            ${s.eventos.map(e => `<div class="pf-local" style="font-size:13px;">${esc(e.nombre_display || e.username || "")} — ${esc(e.accion)} <span class="muted" style="font-size:11.5px;">· ${esc(haceCuanto(e.creado_en))}</span></div>`).join("")}
        </div>` : ""}

        ${botones.length ? `<div class="so-botones">${botones.join("")}</div>` : ""}
    `;

    body.querySelectorAll("[data-acc]").forEach(b => b.addEventListener("click", () => _accion(b.dataset.acc)));
}

async function _accion(acc) {
    const post = (ruta, body = {}) => apiLocal(_rid).post(`/horarios/solicitudes/${_sid}/${ruta}`, body);
    try {
        if (acc === "postular") { await post("postular"); UI.toast("Te postulaste", "success"); }
        else if (acc === "desistir") { await post("desistir"); UI.toast("Postulación retirada", "success"); }
        else if (acc === "rechazar") {
            if (!confirm("¿Rechazar la propuesta?")) return;
            await post("rechazar"); UI.toast("Rechazada", "success");
        }
        else if (acc === "cancelar") {
            if (!confirm("¿Cancelar tu solicitud?")) return;
            await post("cancelar"); UI.toast("Cancelada", "success");
        }
        else if (acc === "aceptar" || acc === "confirmar") {
            await _conReintentoConflicto(acc);
        }
        else if (acc === "denegar") {
            if (!confirm("¿Denegar esta solicitud?")) return;
            await post("denegar"); UI.toast("Denegada", "success");
        }
        else if (acc === "asignar") { await _asignar(); return; }
        _cargar();
    } catch (e) { UI.toast(e.message, "error"); }
}

async function _conReintentoConflicto(ruta, extra = {}) {
    const post = (body) => apiLocal(_rid).post(`/horarios/solicitudes/${_sid}/${ruta}`, body);
    try {
        await post({ permitir_conflicto: false, ...extra });
        UI.toast(ruta === "confirmar" ? "Aprobada y aplicada" : "Aceptada — falta la aprobación", "success");
    } catch (e) {
        if (/conflicto|mismo d[ií]a/i.test(e.message || "")) {
            if (!confirm("Esa persona ya tiene un turno ese día. ¿Fusionar las franjas (turno doble)?")) return;
            await post({ permitir_conflicto: true, ...extra });
            UI.toast("Aplicada (turno doble)", "success");
        } else { throw e; }
    }
    _cargar();
}

async function _asignar() {
    // Modal inmediato con los postulantes; el resto del equipo se agrega cuando
    // llega el grid (no bloquear la apertura con una carga de red).
    const postulantes = _s.postulantes || [];
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box"><div class="modal-head">👤 Asignar a…</div>
        <div class="modal-body" id="as-body">
            ${postulantes.length ? `<b style="font-size:13px;">Postulantes</b>
                ${postulantes.map(p => `<button class="menu-it" data-uid="${p.usuario_id}">✋ ${esc(p.nombre_display || p.username)}</button>`).join("")}` : ""}
            <div id="as-equipo"><div class="muted" style="font-size:13px;padding:8px 2px;">Cargando el equipo…</div></div>
        </div>
        <div class="modal-foot"><button class="btn-secundario">Cerrar</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", async e => {
        if (e.target === ov || (e.target.tagName === "BUTTON" && e.target.textContent === "Cerrar")) { ov.remove(); return; }
        const btn = e.target.closest && e.target.closest("[data-uid]");
        const uid = btn && btn.dataset.uid;
        if (!uid) return;
        ov.remove();
        try {
            await _conReintentoConflicto("asignar", { usuario_id: parseInt(uid, 10) });
        } catch (err) { UI.toast(err.message, "error"); }
    });
    // Cargar el equipo completo en segundo plano
    try {
        const lunes = lunesDe(_s.origen_fecha || hoyISO());
        const grid = await apiLocal(_rid).getSilent(`/horarios-personal/grid?desde=${lunes}&hasta=${sumarDias(lunes, 6)}`);
        const empleados = ((grid && grid[0]) || {}).empleados || [];
        const cont = ov.querySelector("#as-equipo");
        if (cont) cont.innerHTML = `<b style="font-size:13px;">Todo el equipo</b>` +
            empleados.filter(e => !postulantes.some(p => p.usuario_id === e.usuario_id))
                .map(e => `<button class="menu-it" data-uid="${e.usuario_id}">${esc(e.nombre || e.username)} <span class="muted" style="font-size:12px;">· ${esc(e.rol || "")}</span></button>`).join("");
    } catch (_) {}
}
