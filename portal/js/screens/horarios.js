// ── HORARIOS — rediseño móvil de la grilla (paridad de funciones) ──
// UNA llamada semanal a /horarios-personal/grid (token de local) alimenta 3
// pestañas: MI SEMANA (7 cards verticales; modo selección para OFERTAR o
// INTERCAMBIAR turnos propios publicados y futuros), EQUIPO (día por día,
// todos los publicados; editor: hoja de turno para agendar/editar/eliminar,
// publicar semana y crear turnos abiertos) y SOLICITUDES (bandeja → detalle).
// Los turnos abiertos del día aparecen en Equipo con "Postularme".

import { esc, escAttr } from "../core/api.js";
import { getRestaurantes, getLocalActivo, setLocalActivo, apiLocal, getUserLocal, hasPermisoLocal } from "../core/sesion.js";
import * as drawer from "../drawer.js";
import { hoyISO, sumarDias, lunesDe, etiquetaDia, etiquetaRango, hhmm, horasTurno } from "../core/fechas.js";

let _vivo = false;
let _rid = null;
let _lunes = null;
let _empleados = [];        // grid de la semana
let _solics = [];           // solicitudes (todas las visibles)
let _miUid = null;
let _esEditor = false;
let _tab = "mi";            // mi | equipo | solicitudes
let _diaSel = null;         // día activo de Equipo (ISO)
let _selActiva = false;     // modo selección en Mis horarios
let _sel = new Set();       // horario_ids propios seleccionados
let _holdFired = false;     // evita que el click posterior al long-press deshaga la selección

const EST_LBL = {
    abierta: "Abierto", disponible: "Disponible", prop_receptor: "Esperando respuesta",
    prop_solicitante: "Contrapropuesta", pend_confirmacion: "Esperando aprobación",
    aprobada: "Aprobada", asignada: "Asignada", denegada: "Denegada",
    rechazada: "Rechazada", cancelada: "Cancelada",
};
const EST_ACTIVOS = ["abierta", "disponible", "prop_receptor", "prop_solicitante", "pend_confirmacion"];

// Etiquetas de rol (idénticas a la web); el resto se capitaliza.
const ROL_LABELS = { gerente: "Gerencia", empleado: "Personal", bartender: "Bartender", cocinero: "Cocina", camarero: "Sala" };
function _rolLabel(r) { return ROL_LABELS[r] || (r ? r.charAt(0).toUpperCase() + r.slice(1) : "Sin rol"); }
let _rolesCat = [];   // catálogo de roles del local (GET /roles), para el desplegable del turno
// Roles que EXISTEN en el local: los de los empleados (principal + secundarios) + el catálogo.
function _rolesDeLocal() {
    const set = new Set();
    for (const e of _empleados) { if (e.rol) set.add(e.rol); (e.roles_secundarios || []).forEach(r => r && set.add(r)); }
    _rolesCat.forEach(r => r && set.add(r));
    const orden = ["gerente", "empleado", "bartender", "cocinero", "camarero"];
    return [...orden.filter(r => set.has(r)), ...[...set].filter(r => !orden.includes(r)).sort()];
}
// Alarma de ROL faltante (idéntica a la web): asignar un turno con un rol que el
// empleado NO tiene exige AGREGÁRSELO primero (rol secundario → permisos +
// documentación + capacitaciones del puesto). El PATCH pide gestión de usuarios
// (el gerente la tiene; un editor solo-agenda no → se le avisa y no rompe).
async function _validarRolTurno(emp, rolTurno) {
    if (emp.rol === rolTurno || (emp.roles_secundarios || []).includes(rolTurno)) return true;
    const ok = confirm(
        `⚠ ${emp.nombre || emp.username} no tiene el rol "${_rolLabel(rolTurno)}".\n\n` +
        `Para asignarle este turno primero hay que AGREGARLE ese rol: le da los permisos, ` +
        `la documentación y las capacitaciones del puesto.\n\n¿Agregárselo AHORA y guardar el turno?`);
    if (!ok) return false;
    try {
        await apiLocal(_rid).patch(`/auth/usuarios/${emp.usuario_id}`, {
            roles_secundarios: [...(emp.roles_secundarios || []), rolTurno],
        });
        emp.roles_secundarios = [...(emp.roles_secundarios || []), rolTurno];
        UI.toast(`Rol "${_rolLabel(rolTurno)}" agregado a ${emp.nombre || emp.username}`, "success");
        return true;
    } catch (_) {
        UI.toast("No se pudo agregar el rol. Pedile a un gerente que lo asigne desde Usuarios.", "error", 5000);
        return false;
    }
}

export async function mount(el, params) {
    _vivo = true;
    _lunes = lunesDe(hoyISO());
    _tab = params === "solicitudes" ? "solicitudes" : "mi";
    _diaSel = hoyISO();
    _selActiva = false; _sel = new Set();
    const locales = await getRestaurantes();
    _rid = getLocalActivo();

    el.innerHTML = `
    <div class="pantalla">
        ${drawer.headerConMenu("Horarios")}
        ${locales.length > 1 ? `<div class="chips" id="hr-locales">${locales.map(r =>
            `<button class="chip ${r.restaurante_id === _rid ? "activa" : ""}" data-rid="${r.restaurante_id}">${esc(r.restaurante || r.codigo)}</button>`).join("")}</div>` : ""}
        <div class="hr-semana">
            <button class="hbtn" id="hr-prev">‹</button>
            <b id="hr-rango"></b>
            <button class="hbtn" id="hr-next">›</button>
            <button class="chip" id="hr-hoy">Hoy</button>
        </div>
        <div class="mj-tabs">
            <button class="mj-tab ${_tab === "mi" ? "activa" : ""}" data-t="mi">Mis horarios</button>
            <button class="mj-tab ${_tab === "equipo" ? "activa" : ""}" data-t="equipo">Equipo</button>
            <button class="mj-tab ${_tab === "solicitudes" ? "activa" : ""}" data-t="solicitudes">Solicitudes<span id="hr-sol-badge" class="dl-badge" style="display:none;margin-left:6px;"></span></button>
        </div>
        <div class="pantalla-body" id="hr-body">
            <div id="hr-cont"><div class="muted centrado" style="padding:30px;">Cargando…</div></div>
        </div>
        <div id="hr-selbar" class="hr-selbar" style="display:none;"></div>
        <div id="hr-editorbar" class="hr-editorbar" style="display:none;"></div>
    </div>`;

    el.querySelectorAll("#hr-locales .chip").forEach(ch => ch.addEventListener("click", async () => {
        _rid = parseInt(ch.dataset.rid, 10);
        await setLocalActivo(_rid);
        el.querySelectorAll("#hr-locales .chip").forEach(c => c.classList.toggle("activa", c === ch));
        _cancelarSeleccion();
        await _init();
    }));
    el.querySelector("#hr-prev").addEventListener("click", () => { _lunes = sumarDias(_lunes, -7); _cargar(); });
    el.querySelector("#hr-next").addEventListener("click", () => { _lunes = sumarDias(_lunes, 7); _cargar(); });
    el.querySelector("#hr-hoy").addEventListener("click", () => { _lunes = lunesDe(hoyISO()); _diaSel = hoyISO(); _cargar(); });
    el.querySelectorAll(".mj-tab").forEach(t => t.addEventListener("click", () => {
        _tab = t.dataset.t;
        el.querySelectorAll(".mj-tab").forEach(x => x.classList.toggle("activa", x === t));
        _cancelarSeleccion();
        _pintar();
    }));

    await _init();
}

export function onResume() { if (_vivo) _cargar(true); }
export function unmount() { _vivo = false; }

async function _init() {
    if (!_rid) {
        document.getElementById("hr-cont").innerHTML = `<div class="muted centrado" style="padding:30px;">No tenés locales asignados.</div>`;
        return;
    }
    const u = await getUserLocal(_rid);
    _miUid = u ? u.id : null;
    _esEditor = hasPermisoLocal(_rid, "edicion_agenda");
    // Catálogo de roles para el desplegable del turno (solo el editor lo usa).
    _rolesCat = [];
    if (_esEditor) {
        try { _rolesCat = ((await apiLocal(_rid).getSilent("/roles")) || []).map(r => r.nombre).filter(Boolean); }
        catch (_) { _rolesCat = []; }
    }
    await _cargar();
}

function _hasta() { return sumarDias(_lunes, 6); }

async function _cargar(silencioso = false) {
    document.getElementById("hr-rango").textContent = etiquetaRango(_lunes, _hasta());
    // Un solo grid que cubre la semana (Equipo) Y la ventana móvil de "Mis
    // horarios" (ayer+hoy+5), así ambas pestañas leen del mismo _empleados.
    const dm = _diasMios();
    const desde = _lunes < dm[0] ? _lunes : dm[0];
    const hasta = _hasta() > dm[6] ? _hasta() : dm[6];
    try {
        const [grid, solics] = await Promise.all([
            apiLocal(_rid)[silencioso ? "getSilent" : "get"](`/horarios-personal/grid?desde=${desde}&hasta=${hasta}`),
            apiLocal(_rid).getSilent(`/horarios/solicitudes`).catch(() => []),
        ]);
        if (!_vivo) return;
        _empleados = ((grid && grid[0]) || {}).empleados || [];
        _solics = solics || [];
        const activas = _solics.filter(s => EST_ACTIVOS.includes(s.estado)).length;
        const b = document.getElementById("hr-sol-badge");
        if (b) { b.textContent = activas; b.style.display = activas ? "" : "none"; }
        _pintar();
    } catch (e) {
        const c = document.getElementById("hr-cont");
        if (c && !silencioso) c.innerHTML = `<div class="muted centrado" style="padding:30px;">No se pudieron cargar los horarios.<br>${esc(e.message)}</div>`;
    }
}

function _pintar() {
    // La barra de semana (‹ › rango Hoy) solo aplica a Equipo/Solicitudes; "Mis
    // horarios" es una ventana móvil fija (ayer+hoy+5), sin navegación de semana.
    const nav = document.querySelector(".hr-semana");
    if (nav) nav.style.display = _tab === "mi" ? "none" : "";
    _pintarEditorBar();
    if (_tab === "mi") _pintarMiSemana();
    else if (_tab === "equipo") _pintarEquipo();
    else _pintarSolicitudes();
}

function _dias() { return Array.from({ length: 7 }, (_, i) => sumarDias(_lunes, i)); }
// Ventana de "Mis horarios": ayer + hoy + próximos 5 (igual que el widget del dashboard)
function _diasMios() { const h = hoyISO(); return Array.from({ length: 7 }, (_, i) => sumarDias(h, i - 1)); }

// Long-press: entra en modo selección con ese turno marcado. Cancela ante scroll.
function _attachHold(el, onHold) {
    let timer = null, sx = 0, sy = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener("pointerdown", e => {
        sx = e.clientX; sy = e.clientY;
        timer = setTimeout(() => { timer = null; if (navigator.vibrate) navigator.vibrate(25); onHold(); }, 420);
    });
    el.addEventListener("pointermove", e => {
        if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel();
    });
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", cancel);
}
function _mi() { return _empleados.find(e => e.usuario_id === _miUid); }
function _franjasTxt(t) { return (t.franjas || []).map(f => `${hhmm(f.inicio)}–${hhmm(f.fin)}`).join(" · "); }

// Solicitudes activas que tocan una fecha en la que participo
function _solicDeFecha(fecha) {
    return _solics.filter(s => EST_ACTIVOS.includes(s.estado)
        && (s.creado_por === _miUid || s.destino_usuario_id === _miUid)
        && ((s.turnos || []).some(t => t.fecha === fecha) || s.origen_fecha === fecha || s.destino_fecha === fecha));
}

// Turnos abiertos (sin asignar) de una fecha
function _abiertosDe(fecha) {
    return _solics.filter(s => s.tipo === "abierto" && s.estado === "abierta" && s.origen_fecha === fecha);
}

// horario_ids ya ofrecidos/intercambiados (lado 'da' de una solicitud ACTIVA): quedan
// bloqueados para una nueva oferta/intercambio hasta que ese se defina o se cancele.
function _comprometidos() {
    const s = new Set();
    for (const sol of _solics) {
        if (!EST_ACTIVOS.includes(sol.estado)) continue;
        for (const t of (sol.turnos || [])) {
            if (t.lado === "da" && t.horario_id) s.add(t.horario_id);
        }
    }
    return s;
}

// ── MIS HORARIOS (ventana móvil ayer+hoy+5) ───────────────────
function _pintarMiSemana() {
    const cont = document.getElementById("hr-cont");
    const yo = _mi();
    const hoy = hoyISO();
    cont.innerHTML = `
        ${_selActiva
            ? `<div class="hr-aviso">Tocá tus turnos <b>publicados y futuros</b> para sumarlos o quitarlos, y abajo elegí qué hacer con ellos.</div>`
            : `<div class="muted centrado" style="font-size:12.5px;margin-bottom:10px;">Tocá un turno tuyo (publicado y futuro) para ofrecerlo o intercambiarlo.</div>`}
        ${(() => { const comp = _comprometidos(); return _diasMios().map(f => {
            const t = yo && yo.dias ? yo.dias[f] : null;
            const marcas = _solicDeFecha(f);
            const eleg = t && t.publicado && f >= hoy && !comp.has(t.id);
            return `<div class="hr-dia card ${f === hoy ? "hoy" : ""} ${f < hoy ? "pasado" : ""} ${_selActiva && eleg ? "elegible" : ""} ${t && _sel.has(t.id) ? "sel" : ""}"
                        data-f="${f}" ${t ? `data-hid="${t.id}"` : ""} ${eleg ? 'data-eleg="1"' : ""}>
                <div class="hr-dia-col">
                    <div class="hr-dia-lbl ${f === hoy ? "hoy" : ""}">${esc(etiquetaDia(f))}</div>
                    ${f === hoy ? '<div class="hr-hoy-pill">HOY</div>' : (f < hoy ? '<div class="hr-ayer-pill">AYER</div>' : "")}
                </div>
                <div class="crece">
                    ${t ? `<div class="hr-franjas">${esc(_franjasTxt(t))}</div>
                           <div class="muted" style="font-size:12.5px;">${esc(t.rol_turno || (yo ? yo.rol : "") || "")}${t.break_mins ? ` · break ${t.break_mins}'` : ""} · ${horasTurno(t.franjas, t.break_mins).toFixed(1)} h</div>`
                        : `<div class="muted">Libre</div>`}
                    ${t && !t.publicado ? `<span class="hr-borrador">Borrador</span>` : ""}
                    ${marcas.map(s => `<button class="hr-marca" data-sid="${s.id}">${s.tipo === "intercambio" ? "🔁" : s.tipo === "oferta" ? "📣" : "🟢"} ${esc(EST_LBL[s.estado] || s.estado)}</button>`).join("")}
                </div>
                ${_selActiva && eleg ? `<div class="hr-check">${_sel.has(t.id) ? "☑" : "☐"}</div>` : ""}
            </div>`;
        }).join(""); })()}`;
    cont.querySelectorAll(".hr-dia").forEach(d => {
        d.addEventListener("click", (e) => {
            if (_holdFired) { _holdFired = false; return; }   // no deshacer lo recién seleccionado
            if (e.target.dataset && e.target.dataset.sid) { window._ir("solicitud/" + e.target.dataset.sid); return; }
            if (!d.dataset.eleg) return;
            // En modo selección (long-press) el tap suma/quita; si no, el tap abre
            // el menú de acciones de ESE turno (ofrecer / intercambiar) — descubrible.
            if (_selActiva) { _toggleSel(parseInt(d.dataset.hid, 10)); return; }
            _accionesTurno(parseInt(d.dataset.hid, 10), d.dataset.f);
        });
        if (d.dataset.eleg) _attachHold(d, () => {
            _holdFired = true; setTimeout(() => { _holdFired = false; }, 500);
            if (!_selActiva) { _selActiva = true; _sel = new Set(); }
            _sel.add(parseInt(d.dataset.hid, 10));
            _pintar(); _pintarSelBar();
        });
    });
    _pintarSelBar();
}

function _toggleSel(hid) {
    if (_sel.has(hid)) _sel.delete(hid); else _sel.add(hid);
    _pintar(); _pintarSelBar();
}

function _cancelarSeleccion() {
    _selActiva = false; _sel = new Set();
    const bar = document.getElementById("hr-selbar");
    if (bar) bar.style.display = "none";
}

function _pintarSelBar() {
    const bar = document.getElementById("hr-selbar");
    if (!bar) return;
    if (!_selActiva || _tab !== "mi") { bar.style.display = "none"; return; }
    bar.style.display = "";
    bar.innerHTML = `
        <button class="btn-secundario" id="sb-cancelar">✕</button>
        <button class="btn-primario" id="sb-ofertar" ${!_sel.size ? "disabled" : ""}>📣 Ofertar (${_sel.size})</button>
        <button class="btn-primario" id="sb-ix" ${!_sel.size ? "disabled" : ""}>🔁 Intercambiar</button>`;
    bar.querySelector("#sb-cancelar").addEventListener("click", () => { _cancelarSeleccion(); _pintar(); });
    bar.querySelector("#sb-ofertar").addEventListener("click", _ofertarSel);
    bar.querySelector("#sb-ix").addEventListener("click", _intercambiarSel);
}

function _ofertarSel() {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
        <div class="modal-head">📣 Ofertar ${_sel.size} turno(s)</div>
        <div class="modal-body">
            <div style="font-size:14px;">Tus compañeros van a poder postularse para tomarlos. Un responsable asigna al elegido.</div>
            <label class="cp-check" style="margin-top:10px;"><input type="checkbox" id="of-muro" checked> Publicar también en el muro</label>
        </div>
        <div class="modal-foot">
            <button class="btn-secundario" id="of-cancelar">Cancelar</button>
            <button class="btn-primario" id="of-ok">Ofertar</button>
        </div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    ov.querySelector("#of-cancelar").addEventListener("click", () => ov.remove());
    ov.querySelector("#of-ok").addEventListener("click", async () => {
        try {
            const r = await apiLocal(_rid).post("/horarios/solicitudes/oferta", {
                horario_ids: [..._sel], publicar_muro: ov.querySelector("#of-muro").checked,
            });
            ov.remove();
            UI.toast(`Oferta creada (${(r && r.creados) || _sel.size} turno/s)`, "success");
            _cancelarSeleccion();
            _cargar();
        } catch (e) { UI.toast(e.message, "error"); }
    });
}

function _intercambiarSel() {
    const hoy = hoyISO();
    const rHasta = _diasMios()[6];   // límite de la ventana ayer+hoy+5
    const tieneTurnos = e => Object.entries(e.dias || {}).some(([f, t]) => t && t.publicado && f >= hoy && f <= rHasta);
    // Cualquier compañero es un destino válido: si tiene turnos publicados podemos
    // intercambiar; si no tiene, la solicitud es una CESIÓN (le doy mis turnos sin
    // recibir nada). Ordenamos primero a los que tienen turnos (intercambio posible).
    const otros = _empleados.filter(e => e.usuario_id !== _miUid)
        .sort((a, b) => (tieneTurnos(b) ? 1 : 0) - (tieneTurnos(a) ? 1 : 0)
            || (a.nombre || a.username || "").localeCompare(b.nombre || b.username || ""));
    let paso = 1, destino = null, recibe = new Set();
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });

    const render = () => {
        if (paso === 1) {
            ov.innerHTML = `<div class="modal-box"><div class="modal-head">🔁 Intercambiar / ceder — ¿con quién?</div>
                <div class="modal-body">${otros.length ? otros.map(e => `
                    <button class="menu-it" data-uid="${e.usuario_id}">${esc(e.nombre || e.username)}
                        <span class="muted" style="font-size:12px;">· ${esc(e.rol || "")}${tieneTurnos(e) ? "" : " · sin turnos (cesión)"}</span></button>`).join("")
                    : "<div class='muted'>No hay otros compañeros en este local.</div>"}</div>
                <div class="modal-foot"><button class="btn-secundario" id="ix-cerrar">Cancelar</button></div></div>`;
            ov.querySelector("#ix-cerrar").addEventListener("click", () => ov.remove());
            ov.querySelectorAll("[data-uid]").forEach(b => b.addEventListener("click", () => {
                destino = otros.find(e => e.usuario_id === parseInt(b.dataset.uid, 10));
                paso = 2; render();
            }));
        } else if (paso === 2) {
            const turnos = Object.entries(destino.dias || {})
                .filter(([f, t]) => t && t.publicado && f >= hoy && f <= rHasta)
                .sort(([a], [b]) => a.localeCompare(b));
            ov.innerHTML = `<div class="modal-box"><div class="modal-head">${turnos.length
                    ? `¿Qué turnos de ${esc(destino.nombre || destino.username)} querés recibir?`
                    : `Ceder turnos a ${esc(destino.nombre || destino.username)}`}</div>
                <div class="modal-body">
                    ${turnos.length
                        ? `<div class="muted" style="font-size:13px;">Opcional: sin elegir nada, le CEDÉS tus turnos.</div>
                           ${turnos.map(([f, t]) => `<label class="cp-check"><input type="checkbox" data-hid="${t.id}" ${recibe.has(t.id) ? "checked" : ""}>
                                ${esc(etiquetaDia(f))} · ${esc(_franjasTxt(t))}</label>`).join("")}`
                        : `<div class="muted" style="font-size:13.5px;">No tiene turnos publicados para darte a cambio. Le vas a <b>ceder</b> tus turnos seleccionados: si acepta y un responsable lo aprueba, pasan a su agenda.</div>`}
                </div>
                <div class="modal-foot">
                    <button class="btn-secundario" id="ix-atras">‹ Atrás</button>
                    <button class="btn-primario" id="ix-sig">Siguiente ›</button>
                </div></div>`;
            ov.querySelector("#ix-atras").addEventListener("click", () => { paso = 1; render(); });
            ov.querySelector("#ix-sig").addEventListener("click", () => {
                recibe = new Set([...ov.querySelectorAll("[data-hid]")].filter(c => c.checked).map(c => parseInt(c.dataset.hid, 10)));
                paso = 3; render();
            });
        } else {
            const yo = _mi();
            const misTxt = [..._sel].map(hid => {
                const [f, t] = Object.entries(yo.dias || {}).find(([, t]) => t && t.id === hid) || [];
                return f ? `${etiquetaDia(f)} ${_franjasTxt(t)}` : `#${hid}`;
            }).join(" · ");
            const susTxt = [...recibe].map(hid => {
                const [f, t] = Object.entries(destino.dias || {}).find(([, t]) => t && t.id === hid) || [];
                return f ? `${etiquetaDia(f)} ${_franjasTxt(t)}` : `#${hid}`;
            }).join(" · ") || "(nada — cesión)";
            ov.innerHTML = `<div class="modal-box"><div class="modal-head">Confirmar intercambio</div>
                <div class="modal-body" style="font-size:14px;">
                    <div><b>Le das:</b> ${esc(misTxt)}</div>
                    <div style="margin-top:8px;"><b>Recibís:</b> ${esc(susTxt)}</div>
                    <div class="muted" style="font-size:12.5px;margin-top:10px;">${esc(destino.nombre || destino.username)} tiene que aceptar y un responsable lo aprueba.</div>
                </div>
                <div class="modal-foot">
                    <button class="btn-secundario" id="ix-atras">‹ Atrás</button>
                    <button class="btn-primario" id="ix-enviar">Proponer</button>
                </div></div>`;
            ov.querySelector("#ix-atras").addEventListener("click", () => { paso = 2; render(); });
            ov.querySelector("#ix-enviar").addEventListener("click", async () => {
                try {
                    await apiLocal(_rid).post("/horarios/solicitudes", {
                        destino_usuario_id: destino.usuario_id, da: [..._sel], recibe: [...recibe],
                    });
                    ov.remove();
                    UI.toast("Intercambio propuesto", "success");
                    _cancelarSeleccion();
                    _cargar();
                } catch (e) { UI.toast(e.message, "error"); }
            });
        }
    };
    render();
}

// Menú de acciones de UN turno (al tocarlo en Mis horarios): ofrecer o intercambiar.
// Reusa _ofertarSel / _intercambiarSel dejando ese único turno como selección.
function _accionesTurno(hid, fecha) {
    const yo = _mi();
    const t = yo && yo.dias ? yo.dias[fecha] : null;
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
        <div class="modal-head">${esc(etiquetaDia(fecha))}${t ? " · " + esc(_franjasTxt(t)) : ""}</div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:8px;">
            <div class="muted" style="font-size:13.5px;">¿Qué querés hacer con este turno?</div>
            <button class="btn-primario" id="at-of" style="min-height:50px;">📣 Ofrecerlo <span style="font-weight:400;">· que un compañero se postule</span></button>
            <button class="btn-primario" id="at-ix" style="min-height:50px;">🔁 Intercambiar / ceder <span style="font-weight:400;">· elegís con quién</span></button>
        </div>
        <div class="modal-foot"><button class="btn-secundario" id="at-x">Cancelar</button></div>
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    ov.querySelector("#at-x").addEventListener("click", () => ov.remove());
    ov.querySelector("#at-of").addEventListener("click", () => { _sel = new Set([hid]); ov.remove(); _ofertarSel(); });
    ov.querySelector("#at-ix").addEventListener("click", () => { _sel = new Set([hid]); ov.remove(); _intercambiarSel(); });
}

// ── EQUIPO ────────────────────────────────────────────────────
function _pintarEquipo() {
    const cont = document.getElementById("hr-cont");
    if (!_dias().includes(_diaSel)) _diaSel = _lunes;
    const hoy = hoyISO();
    const delDia = _empleados
        .map(e => ({ e, t: (e.dias || {})[_diaSel] }))
        .filter(x => x.t)
        .sort((a, b) => ((a.t.franjas[0] || {}).inicio || "").localeCompare((b.t.franjas[0] || {}).inicio || ""));
    const libres = _empleados.filter(e => !(e.dias || {})[_diaSel]);
    const abiertos = _abiertosDe(_diaSel);

    cont.innerHTML = `
        <div class="hr-strip">${_dias().map(f => {
            const n = _empleados.filter(e => (e.dias || {})[f]).length;
            return `<button class="hr-strip-dia ${f === _diaSel ? "activa" : ""} ${f === hoy ? "hoy" : ""}" data-f="${f}">
                ${esc(etiquetaDia(f))}<span class="hr-strip-n">${n || "·"}</span></button>`;
        }).join("")}</div>
        ${abiertos.length ? `<div class="hr-abiertos">${abiertos.map(s => `
            <div class="hr-abierto card">
                <div class="crece"><b>🟢 Turno abierto</b> · ${esc((JSON.parse(s.origen_franjas || "[]")).map(f => `${hhmm(f.inicio)}–${hhmm(f.fin)}`).join(" · "))}
                    ${s.origen_rol ? `<span class="muted">· ${esc(s.origen_rol)}</span>` : ""}
                    <div class="muted" style="font-size:12px;">${s.n_postulantes || 0} postulante(s)</div></div>
                <button class="btn-primario" data-sid="${s.id}" style="min-height:42px;">${s.postulado ? "Ver" : "✋ Postularme"}</button>
            </div>`).join("")}</div>` : ""}
        <div id="hr-equipo-lista">
            ${delDia.map(({ e, t }) => `
                <div class="hr-emp card ${!t.publicado ? "borrador" : ""}" ${_esEditor ? `data-uid="${e.usuario_id}" data-f="${_diaSel}"` : ""}>
                    <div class="post-avatar" style="width:36px;height:36px;font-size:12px;">${esc(e.iniciales || (e.nombre || e.username || "?").slice(0, 2).toUpperCase())}</div>
                    <div class="crece">
                        <b>${esc(e.nombre || e.username)}${e.usuario_id === _miUid ? " (yo)" : ""}</b>
                        <div class="muted" style="font-size:12.5px;">${esc(t.rol_turno || e.rol || "")}${!t.publicado ? " · BORRADOR" : ""}</div>
                    </div>
                    <div class="hr-emp-horas">${esc(_franjasTxt(t))}</div>
                </div>`).join("") || `<div class="muted centrado" style="padding:20px;">Nadie trabaja este día.</div>`}
            ${libres.length ? `<details class="hr-libres"><summary>Libres (${libres.length})</summary>
                ${libres.map(e => `<div class="hr-emp card libre" ${_esEditor ? `data-uid="${e.usuario_id}" data-f="${_diaSel}"` : ""}>
                    <div class="post-avatar" style="width:36px;height:36px;font-size:12px;background:#9ca3af;">${esc(e.iniciales || (e.nombre || e.username || "?").slice(0, 2).toUpperCase())}</div>
                    <div class="crece"><b>${esc(e.nombre || e.username)}</b><div class="muted" style="font-size:12.5px;">${esc(e.rol || "")}</div></div>
                    ${_esEditor ? `<span class="muted">＋</span>` : ""}
                </div>`).join("")}</details>` : ""}
        </div>`;

    cont.querySelectorAll(".hr-strip-dia").forEach(b => b.addEventListener("click", () => {
        _diaSel = b.dataset.f;
        _pintarEquipo();
    }));
    cont.querySelectorAll(".hr-abierto button").forEach(b => b.addEventListener("click", () => window._ir("solicitud/" + b.dataset.sid)));
    if (_esEditor) {
        cont.querySelectorAll(".hr-emp[data-uid]").forEach(c => c.addEventListener("click", () => {
            const uid = parseInt(c.dataset.uid, 10);
            const emp = _empleados.find(e => e.usuario_id === uid);
            _hojaTurno(emp, c.dataset.f);
        }));
    }
}

function _pintarEditorBar() {
    const bar = document.getElementById("hr-editorbar");
    if (!bar) return;
    if (!_esEditor || _tab !== "equipo") { bar.style.display = "none"; return; }
    bar.style.display = "";
    bar.innerHTML = `
        <button class="btn-secundario" id="eb-abierto">🟢 Turno abierto</button>
        <button class="btn-primario" id="eb-publicar">📤 Publicar semana</button>`;
    bar.querySelector("#eb-publicar").addEventListener("click", async () => {
        if (!confirm(`¿Publicar todos los turnos de la semana ${etiquetaRango(_lunes, _hasta())}? El personal los verá y podrá pedir intercambios.`)) return;
        try {
            const r = await apiLocal(_rid).post("/horarios-personal/publicar", { desde: _lunes, hasta: _hasta() });
            UI.toast(`${(r && r.publicados) || 0} turno(s) publicados`, "success");
            _cargar();
        } catch (e) { UI.toast(e.message, "error"); }
    });
    bar.querySelector("#eb-abierto").addEventListener("click", _crearAbierto);
}

// Hoja de turno del editor (upsert/eliminar)
function _hojaTurno(emp, fecha) {
    const t = (emp.dias || {})[fecha] || null;
    let franjas = (t && t.franjas && t.franjas.length) ? JSON.parse(JSON.stringify(t.franjas)) : [{ inicio: "09:00", fin: "17:00" }];
    let rolSel = (t && t.rol_turno) || "";   // se conserva entre re-renders (agregar/quitar franja)
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });

    const render = () => {
        ov.innerHTML = `<div class="modal-box">
            <div class="modal-head">${t ? "✏️ Editar turno" : "＋ Nuevo turno"} — ${esc(emp.nombre || emp.username)}</div>
            <div class="modal-body">
                <div class="muted" style="font-size:13px;">${esc(etiquetaDia(fecha))} · ${fecha}</div>
                ${franjas.map((f, i) => `
                    <div class="fila" style="margin-top:10px;">
                        <input type="time" value="${escAttr(hhmm(f.inicio))}" data-i="${i}" data-k="inicio" style="flex:1;">
                        <span>→</span>
                        <input type="time" value="${escAttr(hhmm(f.fin))}" data-i="${i}" data-k="fin" style="flex:1;">
                        ${franjas.length > 1 ? `<button class="btn-ghost" data-quitar="${i}" style="min-height:42px;min-width:42px;">✕</button>` : ""}
                    </div>`).join("")}
                <button class="btn-ghost" id="ht-mas" style="margin-top:6px;">＋ Agregar franja</button>
                <label class="campo">Rol del turno</label>
                <select id="ht-rol">
                    <option value="">(rol del empleado: ${esc(_rolLabel(emp.rol))})</option>
                    ${(() => {
                        const roles = _rolesDeLocal();
                        if (rolSel && !roles.includes(rolSel)) roles.unshift(rolSel);
                        return roles.map(r => `<option value="${escAttr(r)}" ${r === rolSel ? "selected" : ""}>${esc(_rolLabel(r))}</option>`).join("");
                    })()}
                </select>
                <label class="campo">Descanso (minutos)</label>
                <input id="ht-break" type="number" min="0" step="5" value="${(t && t.break_mins) || 0}">
                ${t && t.publicado ? `<div class="hr-aviso" style="margin-top:10px;">⚠ Editar un turno publicado lo vuelve a BORRADOR (re-publicá la semana).</div>` : ""}
            </div>
            <div class="modal-foot" style="flex-wrap:wrap;">
                ${t ? `<button class="btn-peligro" id="ht-borrar" style="flex:0 0 auto;min-width:60px;">🗑</button>` : ""}
                <button class="btn-secundario" id="ht-cancelar">Cancelar</button>
                <button class="btn-primario" id="ht-guardar">Guardar</button>
            </div></div>`;
        ov.querySelectorAll("input[type=time]").forEach(inp => inp.addEventListener("change", () => {
            franjas[parseInt(inp.dataset.i, 10)][inp.dataset.k] = inp.value;
        }));
        ov.querySelectorAll("[data-quitar]").forEach(b => b.addEventListener("click", () => {
            franjas.splice(parseInt(b.dataset.quitar, 10), 1); render();
        }));
        ov.querySelector("#ht-mas").addEventListener("click", () => { franjas.push({ inicio: "18:00", fin: "22:00" }); render(); });
        ov.querySelector("#ht-rol").addEventListener("change", e => { rolSel = e.target.value; });
        ov.querySelector("#ht-cancelar").addEventListener("click", () => ov.remove());
        const del = ov.querySelector("#ht-borrar");
        if (del) del.addEventListener("click", async () => {
            if (!confirm("¿Eliminar este turno?")) return;
            try {
                await apiLocal(_rid).del(`/horarios-personal/${t.id}`);
                ov.remove(); UI.toast("Turno eliminado", "success"); _cargar();
            } catch (e) { UI.toast(e.message, "error"); }
        });
        ov.querySelector("#ht-guardar").addEventListener("click", async () => {
            const fs = franjas.filter(f => f.inicio && f.fin);
            if (!fs.length) { UI.toast("Poné al menos una franja", "error"); return; }
            const rolTurno = ov.querySelector("#ht-rol").value || null;
            // Si el rol no lo tiene el empleado: alarma + alta como rol secundario (como la web).
            if (rolTurno && !(await _validarRolTurno(emp, rolTurno))) return;
            try {
                await apiLocal(_rid).post("/horarios-personal", {
                    usuario_id: emp.usuario_id, fecha,
                    franjas: fs.map(f => ({ inicio: hhmm(f.inicio), fin: hhmm(f.fin) })),
                    rol_turno: rolTurno,
                    break_mins: parseInt(ov.querySelector("#ht-break").value, 10) || 0,
                });
                ov.remove(); UI.toast("Turno guardado (borrador)", "success"); _cargar();
            } catch (e) { UI.toast(e.message, "error"); }
        });
    };
    render();
}

function _crearAbierto() {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-box">
        <div class="modal-head">🟢 Nuevo turno abierto</div>
        <div class="modal-body">
            <label class="campo">Fecha</label>
            <input id="ab-fecha" type="date" value="${_diaSel || hoyISO()}" min="${hoyISO()}">
            <div class="fila" style="margin-top:10px;">
                <input id="ab-ini" type="time" value="18:00" style="flex:1;">
                <span>→</span>
                <input id="ab-fin" type="time" value="23:00" style="flex:1;">
            </div>
            <label class="campo">Rol (opcional)</label>
            <select id="ab-rol">
                <option value="">(sin rol)</option>
                ${_rolesDeLocal().map(r => `<option value="${escAttr(r)}">${esc(_rolLabel(r))}</option>`).join("")}
            </select>
            <label class="cp-check" style="margin-top:10px;"><input type="checkbox" id="ab-muro" checked> Publicar en el muro</label>
        </div>
        <div class="modal-foot">
            <button class="btn-secundario" id="ab-cancelar">Cancelar</button>
            <button class="btn-primario" id="ab-ok">Crear</button>
        </div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    ov.querySelector("#ab-cancelar").addEventListener("click", () => ov.remove());
    ov.querySelector("#ab-ok").addEventListener("click", async () => {
        try {
            await apiLocal(_rid).post("/horarios/solicitudes/abierto", {
                fecha: ov.querySelector("#ab-fecha").value,
                franjas: [{ inicio: ov.querySelector("#ab-ini").value, fin: ov.querySelector("#ab-fin").value }],
                rol_turno: ov.querySelector("#ab-rol").value || null,
                publicar_muro: ov.querySelector("#ab-muro").checked,
            });
            ov.remove(); UI.toast("Turno abierto creado — el personal puede postularse", "success"); _cargar();
        } catch (e) { UI.toast(e.message, "error"); }
    });
}

// ── SOLICITUDES ───────────────────────────────────────────────
function _pintarSolicitudes() {
    const cont = document.getElementById("hr-cont");
    const orden = [..._solics].sort((a, b) =>
        (EST_ACTIVOS.includes(b.estado) ? 1 : 0) - (EST_ACTIVOS.includes(a.estado) ? 1 : 0));
    cont.innerHTML = orden.length ? orden.map(s => {
        const icono = s.tipo === "intercambio" ? "🔁" : s.tipo === "oferta" ? "📣" : "🟢";
        const fechas = [...new Set([...(s.turnos || []).map(t => t.fecha), s.origen_fecha, s.destino_fecha].filter(Boolean))]
            .sort().map(etiquetaDia).join(" · ");
        return `<div class="hr-sol card ${EST_ACTIVOS.includes(s.estado) ? "" : "cerrada"}" data-sid="${s.id}">
            <div class="fila">
                <b class="crece">${icono} ${s.tipo === "intercambio" ? "Intercambio" : s.tipo === "oferta" ? "Oferta de turno" : "Turno abierto"}</b>
                <span class="hr-estado e-${s.estado}">${esc(EST_LBL[s.estado] || s.estado)}</span>
            </div>
            <div class="muted" style="font-size:13px;margin-top:4px;">${esc(fechas || "")}</div>
            <div class="muted" style="font-size:12.5px;margin-top:2px;">
                ${s.n_postulantes ? `${s.n_postulantes} postulante(s) · ` : ""}${s.postulado ? "✓ Postulado · " : ""}#${s.id}
            </div>
        </div>`;
    }).join("") : `<div class="muted centrado" style="padding:30px;">Sin solicitudes.</div>`;
    cont.querySelectorAll(".hr-sol").forEach(c => c.addEventListener("click", () => window._ir("solicitud/" + c.dataset.sid)));
}
