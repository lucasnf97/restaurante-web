// ── RESUMEN — pantalla de inicio ──────────────────────────────
// EMPLEADO: agregados de la CUENTA (/empleado/*) — próximo turno + strip de
// 7 días, muro, mensajes. GERENTE: no tiene esos agregados → widgets por
// LOCAL con token de local: facturación de HOY (chips para cambiar de local
// dentro del widget) + mensajes agregados de todos sus locales.
// SSE no aplica acá → polling suave con la pantalla visible + on-resume.

import * as config from "../core/config.js";
import { apiCuenta, esc, displayName, esGerente } from "../core/api.js";
import { getRestaurantes, getLocalActivo, setLocalActivo, apiLocal } from "../core/sesion.js";
import * as drawer from "../drawer.js";
import { hoyISO, aISO, deISO, sumarDias, etiquetaDia, hhmm, haceCuanto } from "../core/fechas.js";

let _vivo = false;
let _pollTimer = null;

// ── Estado del Inicio del gerente ─────────────────────────────
let _gerLocales = [];        // locales del gerente (para los chips del widget)
let _gerRid = null;          // local seleccionado en el widget de facturación
const _gerMoneda = {};       // símbolo de moneda por local (cache de /config/sistema)

export async function mount(el) {
    _vivo = true;
    const u = config.getUser();
    el.innerHTML = `
    <div class="pantalla">
        ${drawer.headerConMenu("Inicio")}
        <div class="pantalla-body" id="res-body">
            <div class="res-hola">Hola, <b>${esc((displayName(u) || "").split(" ")[0] || "")}</b> 👋</div>
            <div class="card res-card" id="res-turnos"><div class="muted">Cargando horarios…</div></div>
            <div class="card res-card" id="res-muro"><div class="muted">Cargando muro…</div></div>
            <div class="card res-card" id="res-mensajes"><div class="muted">Cargando mensajes…</div></div>
        </div>
    </div>`;
    // (Los recuadros de acceso rápido se ELIMINARON — decisión del dueño 2026-07-25:
    // el título de cada widget ya navega y el menú ☰ está a un gesto.)

    getRestaurantes({ refrescar: true }).catch(() => {});   // refresh silencioso del cache
    if (esGerente()) {
        // El gerente no tiene los agregados de cuenta (/empleado/*): sus widgets van
        // por LOCAL (token de local lazy). Facturación de HOY primero, mensajes después.
        ["res-turnos", "res-muro"].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
        const msj = document.getElementById("res-mensajes");
        if (msj) msj.insertAdjacentHTML("beforebegin",
            `<div class="card res-card" id="res-fact"><div class="muted">Cargando facturación…</div></div>`);
        const todos = await getRestaurantes().catch(() => []);
        _gerLocales = todos.filter(r => (r.permisos || {}).acceso_estadisticas);
        if (!_gerLocales.length) _gerLocales = todos;   // gerente = permisos plenos en sus locales
        _gerRid = _gerLocales.some(r => r.restaurante_id === getLocalActivo())
            ? getLocalActivo() : ((_gerLocales[0] || {}).restaurante_id ?? null);
        _cargarGer();
        _pollTimer = setInterval(() => { if (_vivo && !document.hidden) _cargarGer(true); }, 120000);
        return;
    }
    _cargar();
    _pollTimer = setInterval(() => { if (_vivo && !document.hidden) _cargar(true); }, 120000);
}

export function onResume() { if (_vivo) (esGerente() ? _cargarGer(true) : _cargar(true)); }

export function unmount() {
    _vivo = false;
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function _cargar(silencioso = false) {
    _cargarTurnos(silencioso);
    _cargarMensajes(silencioso);
    _cargarMuro(silencioso);
}

// ── Turnos: ventana ayer + hoy + 5 (idéntica al widget del dashboard) ──
async function _cargarTurnos(silencioso) {
    const cont = document.getElementById("res-turnos");
    if (!cont) return;
    try {
        const desde = sumarDias(hoyISO(), -1), hasta = sumarDias(hoyISO(), 5);
        const turnos = await apiCuenta[silencioso ? "getSilent" : "get"](
            `/empleado/horarios?desde=${desde}&hasta=${hasta}`) || [];
        if (!_vivo || !document.getElementById("res-turnos")) return;
        const porDia = {};
        for (const t of turnos) porDia[String(t.fecha).slice(0, 10)] = t;

        // Próximo turno (hoy en adelante)
        let proximo = null;
        for (let i = 0; i <= 5 && !proximo; i++) {
            const f = sumarDias(hoyISO(), i);
            if (porDia[f]) proximo = { fecha: f, ...porDia[f] };
        }
        const fr = t => (t.franjas || []).map(f => `${hhmm(f.inicio)}–${hhmm(f.fin)}`).join(" · ");

        let html = `<div class="res-card-titulo" onclick="_ir('horarios')">📅 Mis horarios <span class="res-ver">ver todo ›</span></div>`;
        html += proximo
            ? `<div class="res-proximo"><span class="res-prox-dia">${proximo.fecha === hoyISO() ? "HOY" : esc(etiquetaDia(proximo.fecha))}</span>
                 <b>${esc(fr(proximo))}</b>${proximo.restaurante ? `<span class="muted"> · ${esc(proximo.restaurante)}</span>` : ""}</div>`
            : `<div class="muted" style="margin:8px 0;">Sin turnos en los próximos días.</div>`;
        html += `<div class="res-strip">`;
        for (let i = -1; i <= 5; i++) {
            const f = sumarDias(hoyISO(), i);
            const t = porDia[f];
            html += `<div class="res-dia ${f === hoyISO() ? "hoy" : ""} ${t ? "con" : ""}">
                <div class="res-dia-lbl">${esc(etiquetaDia(f))}</div>
                <div class="res-dia-fr">${t ? (t.franjas || []).map(x => `<div>${hhmm(x.inicio)}<br>${hhmm(x.fin)}</div>`).join("") : "<span class='muted'>—</span>"}</div>
            </div>`;
        }
        html += `</div>`;
        cont.innerHTML = html;
    } catch (e) {
        if (cont && !silencioso) cont.innerHTML = `<div class="muted">No se pudieron cargar los horarios.</div>`;
    }
}

async function _cargarMensajes(silencioso) {
    const cont = document.getElementById("res-mensajes");
    if (!cont) return;
    try {
        const [nl, lista] = await Promise.all([
            apiCuenta.getSilent("/empleado/mensajes/no-leidos").catch(() => null),
            apiCuenta[silencioso ? "getSilent" : "get"]("/empleado/mensajes"),
        ]);
        if (!_vivo || !document.getElementById("res-mensajes")) return;
        const n = (nl && nl.count) || 0;
        drawer.setBadgeMensajes(n);

        const ultimos = (lista || []).slice(0, 3);
        let html = `<div class="res-card-titulo" onclick="_ir('mensajes')">💬 Mensajes ${n ? `<span class="res-pill">${n} sin leer</span>` : ""} <span class="res-ver">ver todo ›</span></div>`;
        html += ultimos.length ? ultimos.map(m => `
            <div class="res-item ${m.leido === false ? "noleido" : ""}" onclick="_ir('mensajes')">
                <div class="res-item-t">${esc(m.asunto || "(sin asunto)")}</div>
                <div class="res-item-s muted">${esc(m.de_nombre_display || m.de_username || "")}${m.restaurante ? " · " + esc(m.restaurante) : ""} · ${esc(haceCuanto(m.creado_en))}</div>
            </div>`).join("")
            : `<div class="muted" style="margin-top:8px;">Sin mensajes.</div>`;
        cont.innerHTML = html;
    } catch (e) {
        if (cont && !silencioso) cont.innerHTML = `<div class="muted">No se pudieron cargar los mensajes.</div>`;
    }
}

// ══ Inicio del GERENTE — widgets por local ════════════════════

async function _cargarGer(silencioso = false) {
    _cargarGerFact(silencioso);
    _cargarGerMensajes(silencioso);
}

// ── Facturación de HOY (mismos datos que "Progreso del día" de Análisis,
//    en compacto) con chips para cambiar de local dentro del widget ──
async function _cargarGerFact(silencioso) {
    const cont = document.getElementById("res-fact");
    if (!cont) return;
    if (!_gerRid) { cont.innerHTML = `<div class="muted">Sin locales asignados.</div>`; return; }
    try {
        const api = apiLocal(_gerRid);
        const sinMoneda = _gerMoneda[_gerRid] === undefined;
        const [dia, metas, cfg] = await Promise.all([
            api[silencioso ? "getSilent" : "get"]("/reportes/progreso-dia"),
            api.getSilent("/reportes/metas").catch(() => ({})),
            sinMoneda ? api.getSilent("/config/sistema").catch(() => null) : Promise.resolve(null),
        ]);
        if (sinMoneda) _gerMoneda[_gerRid] = (cfg && cfg.moneda_simbolo) || "$";
        if (!_vivo || !document.getElementById("res-fact")) return;
        cont.innerHTML = _factShell(_factCuerpo(dia || {}, metas || {}));
        _bindFactChips(cont);
    } catch (e) {
        if (!cont || silencioso || !_vivo) return;
        // Los chips quedan igual: si un local falla se puede cambiar a otro.
        cont.innerHTML = _factShell(`<div class="muted" style="margin-top:8px;">No se pudo cargar la facturación.</div>`);
        _bindFactChips(cont);
    }
}

function _factShell(cuerpo) {
    const chips = _gerLocales.length > 1
        ? `<div class="chips" id="res-fact-locales" style="padding:8px 0 2px;">${_gerLocales.map(r =>
            `<button class="chip ${r.restaurante_id === _gerRid ? "activa" : ""}" data-rid="${r.restaurante_id}">${esc(r.restaurante || r.codigo)}</button>`).join("")}</div>`
        : "";
    return `<div class="res-card-titulo" onclick="_ir('facturacion')">💰 Facturación de hoy <span class="res-ver">ver más ›</span></div>${chips}${cuerpo}`;
}

function _factCuerpo(d, metas) {
    const mon = _gerMoneda[_gerRid] || "$";
    const fmt = n => mon + " " + Math.round(Number(n) || 0).toLocaleString("es-AR");
    const fact = d.facturacion_hoy || 0, tickets = d.mesas_hoy || 0;
    const prom = tickets > 0 ? fact / tickets : 0;
    const now = new Date();
    const diasMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const objetivo = (metas.diaria_fact > 0) ? metas.diaria_fact
        : (metas.mensual > 0 ? metas.mensual / diasMes : 0);
    const diasAnt = d.dias_mes_anterior || 1;
    const promAnt = (d.facturacion_mes_anterior || 0) / diasAnt;
    let barra = "";
    if (objetivo > 0) {
        const pct = Math.round(fact / objetivo * 100);
        const color = pct >= 100 ? "#16a34a" : "#4f46e5";
        barra = `<div style="margin-top:10px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--texto-suave,#6b7280);margin-bottom:4px;">
                <span>Objetivo diario</span><b style="color:${color};">${pct}%</b></div>
            <div style="height:8px;border-radius:4px;background:#e9ebf0;overflow:hidden;">
                <div style="height:100%;width:${Math.min(pct, 100)}%;border-radius:4px;background:${color};"></div></div>
        </div>`;
    }
    return `
        <div class="fc-total" style="font-size:28px;margin:8px 0 0;">${fmt(fact)}</div>
        <div class="muted centrado" style="font-size:12px;">facturación de hoy${promAnt > 0 ? ` · prom. día mes ant. ${fmt(promAnt)}` : ""}</div>
        <div class="fc-daystats" style="margin-top:10px;margin-bottom:0;">
            <div class="fc-daystat"><b>${(Number(tickets) || 0).toLocaleString("es-AR")}</b><span>🎫 Tickets</span></div>
            <div class="fc-daystat"><b>${tickets > 0 ? fmt(prom) : "—"}</b><span>📊 Ticket prom.</span></div>
            <div class="fc-daystat"><b>${objetivo > 0 ? fmt(objetivo) : "—"}</b><span>🎯 Obj. diario</span></div>
        </div>
        ${barra}`;
}

function _bindFactChips(cont) {
    cont.querySelectorAll("#res-fact-locales .chip").forEach(ch => ch.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        _gerRid = parseInt(ch.dataset.rid, 10);
        setLocalActivo(_gerRid);   // "ver más" y el resto de las pantallas abren en este local
        cont.querySelectorAll("#res-fact-locales .chip").forEach(c => c.classList.toggle("activa", c === ch));
        _cargarGerFact(false);
    }));
}

// ── Mensajes del gerente: agregado de TODOS sus locales (recibidos activos) ──
async function _cargarGerMensajes(silencioso) {
    const cont = document.getElementById("res-mensajes");
    if (!cont) return;
    try {
        const locales = await getRestaurantes();
        const porLocal = await Promise.all(locales.map(async r => {
            try {
                const lista = await apiLocal(r.restaurante_id).getSilent("/mensajes/recibidos") || [];
                return lista.filter(m => !m.archivado)
                    .map(m => ({ ...m, restaurante: locales.length > 1 ? (r.restaurante || r.codigo) : "" }));
            } catch { return []; }
        }));
        if (!_vivo || !document.getElementById("res-mensajes")) return;
        const todos = porLocal.flat().sort((a, b) => new Date(b.creado_en || 0) - new Date(a.creado_en || 0));
        const n = todos.filter(m => m.leido === false).length;
        drawer.setBadgeMensajes(n);

        const ultimos = todos.slice(0, 3);
        let html = `<div class="res-card-titulo" onclick="_ir('mensajes')">💬 Mensajes ${n ? `<span class="res-pill">${n} sin leer</span>` : ""} <span class="res-ver">ver todo ›</span></div>`;
        html += ultimos.length ? ultimos.map(m => `
            <div class="res-item ${m.leido === false ? "noleido" : ""}" onclick="_ir('mensajes')">
                <div class="res-item-t">${esc(m.asunto || "(sin asunto)")}</div>
                <div class="res-item-s muted">${esc(m.de_nombre_display || m.de_username || "")}${m.restaurante ? " · " + esc(m.restaurante) : ""} · ${esc(haceCuanto(m.creado_en))}</div>
            </div>`).join("")
            : `<div class="muted" style="margin-top:8px;">Sin mensajes.</div>`;
        cont.innerHTML = html;
    } catch (e) {
        if (cont && !silencioso) cont.innerHTML = `<div class="muted">No se pudieron cargar los mensajes.</div>`;
    }
}

async function _cargarMuro(silencioso) {
    const cont = document.getElementById("res-muro");
    if (!cont) return;
    try {
        const r = await apiCuenta[silencioso ? "getSilent" : "get"]("/empleado/social?limit=3");
        if (!_vivo || !document.getElementById("res-muro")) return;
        const posts = (r && (r.posts || r)) || [];
        let html = `<div class="res-card-titulo" onclick="_ir('muro')">📣 Muro <span class="res-ver">ver todo ›</span></div>`;
        html += posts.length ? posts.slice(0, 3).map(p => `
            <div class="res-item" onclick="_ir('muro')">
                <div class="res-item-t">${p.prioritaria ? "🚨 " : ""}${esc(displayName(p))}${p.restaurante ? `<span class="muted"> · ${esc(p.restaurante)}</span>` : ""}</div>
                <div class="res-item-s">${esc((p.contenido || "").slice(0, 90))}${(p.contenido || "").length > 90 ? "…" : ""}</div>
                <div class="res-item-s muted">${esc(haceCuanto(p.creado_en))}</div>
            </div>`).join("")
            : `<div class="muted" style="margin-top:8px;">Sin publicaciones todavía.</div>`;
        cont.innerHTML = html;
    } catch (e) {
        if (cont && !silencioso) cont.innerHTML = `<div class="muted">No se pudo cargar el muro.</div>`;
    }
}
