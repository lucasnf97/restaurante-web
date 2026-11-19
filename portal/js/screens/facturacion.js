// ── ANÁLISIS — facturación + control de stock (SOLO LECTURA) ──────────────
// Gateada por local: sección Facturación con "acceso_estadisticas", sección Stock
// con "ver_stock"/"gestion_stock". El ítem del menú aparece si tiene alguno en algún
// local. Reutiliza /reportes/* y /stock/* con el token de local. El objetivo (meta)
// se configura en la web; acá solo se lee (/reportes/metas).

import { esc } from "../core/api.js";
import { getRestaurantes, getLocalActivo, setLocalActivo, apiLocal } from "../core/sesion.js";
import * as drawer from "../drawer.js";

let _vivo = false;
let _rid = null;
let _seccion = "fact";     // "fact" | "stock"
let _tab = "hoy";          // solapa del resumen de facturación
let _stab = "total";       // solapa de stock
let _moneda = "$";
let _locales = [];
let _resumen = null, _mes = null, _mesPrev = null, _dia = null, _metas = {};
let _insumos = [];         // stock + producción combinados (con .tipo)

function _permLocal(rid) {
    const p = (_locales.find(x => x.restaurante_id === rid) || {}).permisos || {};
    return { fact: !!p.acceso_estadisticas, stock: !!(p.ver_stock || p.gestion_stock) };
}

export async function mount(el, params) {
    _vivo = true; _tab = "hoy"; _stab = "total";
    const todos = await getRestaurantes();
    _locales = todos.filter(r => { const p = r.permisos || {}; return p.acceso_estadisticas || p.ver_stock || p.gestion_stock; });
    if (!_locales.length) {
        el.innerHTML = `<div class="pantalla">${drawer.headerConMenu("Análisis")}
            <div class="pantalla-body"><div class="muted centrado" style="padding:34px;">No tenés acceso a facturación ni stock en ningún local.</div></div></div>`;
        return;
    }
    _rid = _locales.some(r => r.restaurante_id === getLocalActivo()) ? getLocalActivo() : _locales[0].restaurante_id;
    const perm = _permLocal(_rid);
    _seccion = perm.fact ? "fact" : "stock";

    el.innerHTML = `
    <div class="pantalla">
        ${drawer.headerConMenu("Análisis")}
        ${_locales.length > 1 ? `<div class="chips" id="fc-locales">${_locales.map(r =>
            `<button class="chip ${r.restaurante_id === _rid ? "activa" : ""}" data-rid="${r.restaurante_id}">${esc(r.restaurante || r.codigo)}</button>`).join("")}</div>` : ""}
        <div class="pantalla-body" id="fc-body">
            <div class="muted centrado" style="padding:34px;">Cargando…</div>
        </div>
    </div>`;

    el.querySelectorAll("#fc-locales .chip").forEach(ch => ch.addEventListener("click", async () => {
        _rid = parseInt(ch.dataset.rid, 10);
        await setLocalActivo(_rid);
        el.querySelectorAll("#fc-locales .chip").forEach(c => c.classList.toggle("activa", c === ch));
        const p = _permLocal(_rid);
        _seccion = (_seccion === "fact" && !p.fact) ? "stock" : (_seccion === "stock" && !p.stock) ? "fact" : _seccion;
        _tab = "hoy"; _stab = "total";
        await _cargar();
    }));

    await _cargar();
}

export function onResume() { if (_vivo) _cargar(true); }
export function unmount() { _vivo = false; }

async function _cargar(silencioso = false) {
    const body = document.getElementById("fc-body");
    if (!body) return;
    if (!silencioso) body.innerHTML = `<div class="muted centrado" style="padding:34px;">Cargando…</div>`;
    const perm = _permLocal(_rid);
    if (_seccion === "fact" && !perm.fact) _seccion = "stock";
    if (_seccion === "stock" && !perm.stock) _seccion = "fact";
    const now = new Date();
    const curM = now.getMonth() + 1, curY = now.getFullYear();
    const pm = curM === 1 ? 12 : curM - 1, py = curM === 1 ? curY - 1 : curY;
    const api = apiLocal(_rid);
    try {
        const jobs = [];
        if (perm.fact) jobs.push((async () => {
            const [resumen, mes, mesPrev, dia, metas, cfg] = await Promise.all([
                api.get("/reportes/resumen-periodos"),
                api.get("/reportes/facturacion-mes"),
                api.getSilent(`/reportes/facturacion-mes?year=${py}&month=${pm}`).catch(() => null),
                api.get("/reportes/progreso-dia"),
                api.getSilent("/reportes/metas").catch(() => ({})),
                api.getSilent("/config/sistema").catch(() => ({})),
            ]);
            _resumen = resumen; _mes = mes; _mesPrev = mesPrev; _dia = dia; _metas = metas || {};
            _moneda = (cfg && cfg.moneda_simbolo) || "$";
        })());
        if (perm.stock) jobs.push((async () => {
            const [st, pr] = await Promise.all([
                api.get("/stock/insumos"),
                api.getSilent("/stock/insumos-produccion").catch(() => []),
            ]);
            _insumos = [...(st || []).map(i => ({ ...i, tipo: "stock" })),
                        ...(pr || []).map(i => ({ ...i, tipo: "prod" }))];
        })());
        await Promise.all(jobs);
        if (!_vivo) return;
        _pintar();
    } catch (e) {
        if (body && !silencioso) body.innerHTML = `<div class="muted centrado" style="padding:34px;">No se pudo cargar.<br>${esc(e.message)}</div>`;
    }
}

function _pintar() {
    const body = document.getElementById("fc-body");
    if (!body) return;
    const perm = _permLocal(_rid);
    const secTabs = (perm.fact && perm.stock) ? `
        <div class="mj-tabs" id="fc-sectabs">
            <button class="mj-tab ${_seccion === "fact" ? "activa" : ""}" data-sec="fact">Facturación</button>
            <button class="mj-tab ${_seccion === "stock" ? "activa" : ""}" data-sec="stock">Stock</button>
        </div>` : "";
    const cont = _seccion === "fact"
        ? (_resumenHTML() + _mesHTML() + _progresoMesHTML() + _progresoDiaHTML())
        : _stockHTML();
    body.innerHTML = secTabs + cont;
    body.querySelectorAll("#fc-sectabs .mj-tab").forEach(t => t.addEventListener("click", () => { _seccion = t.dataset.sec; _pintar(); }));
    body.querySelectorAll("#fc-restabs .mj-tab").forEach(t => t.addEventListener("click", () => { _tab = t.dataset.t; _pintar(); }));
    body.querySelectorAll(".fc-scard").forEach(c => c.addEventListener("click", () => { _stab = c.dataset.s; _pintar(); }));
}

// ── Formato ───────────────────────────────────────────────────
function _fmt(n) { return _moneda + " " + Math.round(Number(n) || 0).toLocaleString("es-AR"); }
function _fmtC(n) {
    n = Number(n) || 0; const a = Math.abs(n);
    if (a >= 1e6) return _moneda + " " + (Math.round(n / 1e5) / 10).toLocaleString("es-AR") + "M";
    if (a >= 1e3) return _moneda + " " + (Math.round(n / 100) / 10).toLocaleString("es-AR") + "k";
    return _fmt(n);
}
function _num(n) { return (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString("es-AR"); }
function _fechaHora(ts) {
    if (!ts) return "—";
    const d = new Date(ts); if (isNaN(d)) return "—";
    const p = x => String(x).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── Anillo de progreso circular ──────────────────────────────
function _ring({ valor, barMax, markers, centroVal, centroSub, color }) {
    const S = 176, SW = 14, R = (S - SW) / 2 - 2, C = S / 2, circ = 2 * Math.PI * R;
    const pct = barMax > 0 ? Math.min(Math.max(valor / barMax, 0), 1) : 0;
    const off = circ * (1 - pct);
    const dots = markers.map(m => {
        const p = barMax > 0 ? Math.min(Math.max(m.val / barMax, 0), 1) : 0;
        const ang = p * 2 * Math.PI - Math.PI / 2;
        return `<circle cx="${(C + R * Math.cos(ang)).toFixed(1)}" cy="${(C + R * Math.sin(ang)).toFixed(1)}" r="6" fill="${m.color}" stroke="#fff" stroke-width="2.5"/>`;
    }).join("");
    return `
    <div class="fc-ring">
        <svg viewBox="0 0 ${S} ${S}" class="fc-ring-svg" width="${S}" height="${S}">
            <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#e9ebf0" stroke-width="${SW}"/>
            <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${color}" stroke-width="${SW}"
                    stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
                    transform="rotate(-90 ${C} ${C})"/>
            ${dots}
        </svg>
        <div class="fc-ring-center">
            <div class="fc-ring-val">${centroVal}</div>
            <div class="fc-ring-sub muted">${centroSub}</div>
        </div>
    </div>`;
}
function _legend(markers) {
    return `<div class="fc-legend">${markers.map(m =>
        `<div class="fc-legend-item"><span class="fc-dot" style="background:${m.color};"></span>${m.name}: <b>${m.fmt}</b></div>`).join("")}</div>`;
}
function _breakEvenMes(d) {
    return (d.costo_insumos_facturados || 0) + (d.costo_servicios_facturados || 0)
        + (d.costo_bienes_facturados || 0) + (d.refunds || 0) + (d.salarios || 0);
}

// ── Facturación: resumen (4 solapas) ─────────────────────────
function _resumenHTML() {
    const R = _resumen || {};
    const p = R[_tab] || {};
    const meta = R.meta || {};
    const sub = { hoy: meta.fecha_hoy || "", semana: meta.num_semana ? `Semana ${meta.num_semana}` : "",
        mes: `${meta.nombre_mes || ""} ${meta.anio || ""}`.trim(), anio: String(meta.anio || "") }[_tab] || "";
    const tabs = [["hoy", "Hoy"], ["semana", "Semana"], ["mes", "Mes"], ["anio", "Año"]];
    return `
    <div class="card res-card">
        <div class="mj-tabs" id="fc-restabs">
            ${tabs.map(([k, l]) => `<button class="mj-tab ${_tab === k ? "activa" : ""}" data-t="${k}">${l}</button>`).join("")}
        </div>
        <div class="fc-total">${_fmt(p.total)}</div>
        <div class="muted centrado" style="font-size:12.5px;">${esc(sub)}${p.total_neto != null ? ` · neto ${_fmt(p.total_neto)}` : ""}</div>
        <div class="fc-grid3">
            <div class="fc-mini"><b>${_num(p.mesas)}</b><span>Mesas</span></div>
            <div class="fc-mini"><b>${_fmtC(p.promedio_mesa)}</b><span>Prom./mesa</span></div>
            <div class="fc-mini"><b>${_num(p.comensales)}</b><span>Comensales</span></div>
        </div>
    </div>`;
}

function _mesHTML() {
    const d = _mes || {};
    // Rediseño 2026-07 — MISMAS agrupaciones que la web (analisis-mes/estadisticas):
    // Ventas netas · Salarios con cargas (gris = estimado) · Materia prima ·
    // Gastos corrientes · Gastos extraordinarios (+ bienes) · Resultado · Stock
    // (la merma NO resta: va en el detalle del stock). Fallback a claves legacy.
    const now = new Date();
    const parcial = (d.year === now.getFullYear() && d.month === now.getMonth() + 1) ? " (parcial)" : "";
    const vn        = (d.ventas_neto != null ? d.ventas_neto : d.ventas) || 0;
    const aprobado  = d.salarios_aprobado === true;
    const salTotal  = d.salarios_total != null ? d.salarios_total : (d.salarios || 0);
    const materia   = d.materia_prima != null ? d.materia_prima : (d.costo_insumos_facturados || 0);
    const corr      = d.gastos_corrientes || 0;
    const extra     = d.gastos_extraordinarios != null ? d.gastos_extraordinarios
                      : ((d.costo_servicios_facturados || 0) + (d.costo_bienes_facturados || 0));
    const mermaTot  = d.merma_total != null ? d.merma_total : (d.desechos || 0);
    const resultado = d.resultado != null ? d.resultado : (d.balance || 0);
    const pct = v => vn > 0 ? `${(v / vn * 100).toFixed(1)}% de ventas` : "";
    const filas = [
        ["💰", "Ventas del mes", _fmt(vn),
            d.ventas_neto != null
                ? `${_fmt(d.ventas)} con impuesto${(d.refunds || 0) > 0 ? ` · refunds ${_fmtC(d.refunds)}` : ""}`
                : "", ""],
        ["👥", aprobado ? "Salarios" : "Salarios (estimado)", _fmt(salTotal),
            [d.cargas_sociales != null ? (aprobado ? "sueldos + cargas sociales" : "fichajes sin aprobar") : "",
             pct(salTotal)].filter(Boolean).join(" · "),
            aprobado ? "" : "color:#9ca3af;"],
        ["📦", "Materia prima / insumos", _fmt(materia),
            [(d.servicios_en_insumos || 0) > 0 ? `incl. ${_fmtC(d.servicios_en_insumos)} de servicios` : "",
             pct(materia)].filter(Boolean).join(" · "), ""],
        ["🏠", "Gastos corrientes", _fmt(corr), pct(corr), ""],
        ["⚡", "Gastos extraordinarios", _fmt(extra),
            [(d.costo_bienes_facturados || 0) > 0 ? `incl. ${_fmtC(d.costo_bienes_facturados)} de bienes de uso` : "",
             pct(extra)].filter(Boolean).join(" · "), ""],
    ];
    return `
    <div class="card res-card">
        <div class="res-card-titulo">Facturación del mes</div>
        ${filas.map(([ic, lbl, val, sub, estilo]) => `
            <div class="fc-row"><span class="fc-row-ic">${ic}</span>
                <span class="fc-row-lbl">${lbl}${sub ? `<span class="muted"> · ${sub}</span>` : ""}</span>
                <span class="fc-row-val"${estilo ? ` style="${estilo}"` : ""}>${val}</span></div>`).join("")}
        <div class="fc-row fc-balance"><span class="fc-row-ic">⚖️</span>
            <span class="fc-row-lbl">Resultado${parcial}<span class="muted" style="display:block;font-weight:400;font-size:11px;">ventas netas − refunds − salarios − materia − corrientes − extraord.</span></span>
            <span class="fc-row-val ${resultado >= 0 ? "pos" : "neg"}">${_fmt(resultado)}</span></div>
        <div class="fc-row"><span class="fc-row-ic">🏗️</span>
            <span class="fc-row-lbl">Monto acumulado de stock<span class="muted"> · ${d.stock_es_cierre ? "al cierre del mes" : "valor actual"}${mermaTot > 0 ? ` · merma ${_fmtC(mermaTot)}` : ""}</span></span>
            <span class="fc-row-val">${_fmt(d.monto_acumulado_stock)}</span></div>
    </div>`;
}

function _progresoMesHTML() {
    const d = _mes || {};
    const ventas = d.ventas || 0;
    const breakEven = _breakEvenMes(d);
    const ventasPrev = (_mesPrev && _mesPrev.ventas) || 0;
    const meta = (_metas && _metas.mensual > 0) ? _metas.mensual : null;
    let barMax = meta ? meta / 0.9 : Math.max(breakEven, ventasPrev, ventas) * 1.2;
    if (!(barMax > 0)) barMax = 1000;
    const objetivo = meta != null ? meta : barMax * 0.9;
    const markers = [
        breakEven > 0 ? { val: breakEven, color: "#dc2626", name: "Break-even", fmt: _fmt(breakEven) } : null,
        ventasPrev > 0 ? { val: ventasPrev, color: "#2563eb", name: "Mes anterior", fmt: _fmt(ventasPrev) } : null,
        objetivo > 0 ? { val: objetivo, color: "#7c3aed", name: "Objetivo", fmt: _fmt(objetivo) } : null,
    ].filter(Boolean);
    const pctObj = objetivo > 0 ? Math.round(ventas / objetivo * 100) : 0;
    return `
    <div class="card res-card">
        <div class="res-card-titulo">Progreso del mes</div>
        ${_ring({ valor: ventas, barMax, markers, color: "#16a34a",
            centroVal: _fmtC(ventas), centroSub: objetivo > 0 ? `${pctObj}% del objetivo` : "ventas" })}
        ${_legend(markers)}
    </div>`;
}

function _progresoDiaHTML() {
    const d = _dia || {};
    const now = new Date();
    const diasMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const beMes = _breakEvenMes(_mes || {});
    const beDia = beMes > 0 ? beMes / diasMes : 0;
    const diasAnt = d.dias_mes_anterior || 1;
    const promFactAnt = (d.facturacion_mes_anterior || 0) / diasAnt;
    const promMesasAnt = (d.mesas_mes_anterior || 0) / diasAnt;
    const ticketPromAnt = d.mesas_mes_anterior > 0 ? d.facturacion_mes_anterior / d.mesas_mes_anterior : 0;
    const beTickets = (beDia > 0 && ticketPromAnt > 0) ? beDia / ticketPromAnt : 0;
    const metaMensual = (_metas && _metas.mensual > 0) ? _metas.mensual : null;
    const metaFactDia = (_metas && _metas.diaria_fact > 0) ? _metas.diaria_fact : (metaMensual ? metaMensual / diasMes : 0);
    const metaTicketsDia = (_metas && _metas.diaria_tickets > 0) ? _metas.diaria_tickets : 0;
    const factHoy = d.facturacion_hoy || 0, ticketsHoy = d.mesas_hoy || 0;
    const ticketProm = ticketsHoy > 0 ? factHoy / ticketsHoy : 0;

    const mk1 = [
        beDia > 0 ? { val: beDia, color: "#dc2626", name: "Break-even día", fmt: _fmt(beDia) } : null,
        promFactAnt > 0 ? { val: promFactAnt, color: "#2563eb", name: "Prom. día mes ant.", fmt: _fmt(promFactAnt) } : null,
        metaFactDia > 0 ? { val: metaFactDia, color: "#7c3aed", name: "Objetivo diario", fmt: _fmt(metaFactDia) } : null,
    ].filter(Boolean);
    const barMax1 = Math.max(factHoy, ...mk1.map(m => m.val), 1) * 1.3;
    const mk2 = [
        beTickets > 0 ? { val: beTickets, color: "#dc2626", name: "Break-even día", fmt: _num(beTickets) } : null,
        promMesasAnt > 0 ? { val: promMesasAnt, color: "#2563eb", name: "Prom. día mes ant.", fmt: _num(promMesasAnt) } : null,
        metaTicketsDia > 0 ? { val: metaTicketsDia, color: "#7c3aed", name: "Objetivo diario", fmt: _num(metaTicketsDia) } : null,
    ].filter(Boolean);
    const barMax2 = Math.max(ticketsHoy, ...mk2.map(m => m.val), 1) * 1.3;

    return `
    <div class="card res-card">
        <div class="res-card-titulo">Progreso del día</div>
        <div class="fc-daystats">
            <div class="fc-daystat"><b>${_fmt(factHoy)}</b><span>💰 Facturación hoy</span></div>
            <div class="fc-daystat"><b>${_num(ticketsHoy)}</b><span>🎫 Tickets hoy</span></div>
            <div class="fc-daystat"><b>${ticketsHoy > 0 ? _fmtC(ticketProm) : "—"}</b><span>📊 Ticket prom.</span></div>
        </div>
        <div class="fc-ring-block">
            <div class="fc-ring-title">💰 Facturación del día</div>
            ${_ring({ valor: factHoy, barMax: barMax1, markers: mk1, color: "#16a34a",
                centroVal: _fmtC(factHoy), centroSub: metaFactDia > 0 ? `${Math.round(factHoy / metaFactDia * 100)}% obj.` : "" })}
            ${_legend(mk1)}
        </div>
        <div class="fc-ring-block">
            <div class="fc-ring-title">🎫 Tickets del día</div>
            ${_ring({ valor: ticketsHoy, barMax: barMax2, markers: mk2, color: "#0891b2",
                centroVal: _num(ticketsHoy), centroSub: metaTicketsDia > 0 ? `${Math.round(ticketsHoy / metaTicketsDia * 100)}% obj.` : "" })}
            ${_legend(mk2)}
        </div>
    </div>`;
}

// ── Stock: 4 solapas (Total / Advertencia / Agotados / OK) + lista ──
function _clasif(i) { return i.estado || (i.agotado ? "agotado" : i.en_advertencia ? "advertencia" : "ok"); }
function _stockHTML() {
    const ins = _insumos;
    const grupos = {
        total: ins,
        advertencia: ins.filter(i => _clasif(i) === "advertencia"),
        agotado: ins.filter(i => _clasif(i) === "agotado"),
        ok: ins.filter(i => _clasif(i) === "ok"),
    };
    const split = arr => `${arr.filter(i => i.tipo === "stock").length} stock · ${arr.filter(i => i.tipo === "prod").length} prod`;
    const cards = [
        ["total", "Total insumos", "#4b5563"],
        ["advertencia", "En advertencia", "#ca8a04"],
        ["agotado", "Agotados", "#dc2626"],
        ["ok", "OK", "#16a34a"],
    ];
    const lista = grupos[_stab] || [];
    const badge = st => {
        const c = st === "agotado" ? ["#fee2e2", "#b91c1c", "Agotado"]
            : st === "advertencia" ? ["#fef3c7", "#92400e", "Advertencia"] : ["#dcfce7", "#166534", "OK"];
        return `<span class="fc-ins-badge" style="background:${c[0]};color:${c[1]};">${c[2]}</span>`;
    };
    return `
    <div class="fc-stockgrid">
        ${cards.map(([k, lbl, color]) => `
            <button class="fc-scard ${_stab === k ? "activa" : ""}" data-s="${k}" style="border-color:${_stab === k ? color : "transparent"};">
                <div class="fc-scard-lbl">${lbl}</div>
                <div class="fc-scard-n" style="color:${color};">${grupos[k].length}</div>
                <div class="fc-scard-sub">${split(grupos[k])}</div>
            </button>`).join("")}
    </div>
    <div class="card res-card">
        <div class="res-card-titulo">${cards.find(c => c[0] === _stab)[1]} (${lista.length})</div>
        ${lista.length ? lista.map(i => {
            const st = _clasif(i);
            const desde = (st === "advertencia" || st === "agotado") && i.estado_desde ? ` · desde ${_fechaHora(i.estado_desde)}` : "";
            return `<div class="fc-ins">
                <div class="crece"><b>${esc(i.nombre)}</b>
                    <div class="muted" style="font-size:12px;">${_num(i.cantidad_actual)} ${esc(i.unidad || "")}${i.tipo === "prod" ? " · producción" : ""}${desde}</div>
                </div>
                ${badge(st)}
            </div>`;
        }).join("") : `<div class="muted centrado" style="padding:20px;">Sin insumos en este estado.</div>`}
    </div>`;
}
