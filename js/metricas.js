/**
 * metricas.js — cómo se LEEN las métricas. Una sola definición para las dos pantallas.
 *
 * El cálculo vive en el backend (`/metricas/*`), que a su vez no calcula nada nuevo:
 * invoca los mismos endpoints que ya son la fuente de verdad. Este archivo es la otra
 * mitad de esa regla — que Facturación del mes y el tablero de cadena no puedan
 * pintar el mismo número de dos maneras distintas.
 *
 * ⚠ Todo vive dentro de una IIFE y sólo se expone `window.Metricas`. Un `const` suelto
 *   arriba de un archivo clásico crea un global léxico que choca con los de api.js o
 *   sidebar.js y mata la página entera en el parse, sin un error que lo explique.
 */
(function () {
    "use strict";
    if (window.Metricas) return;

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    /**
     * Un importe.
     * @param simbolo  opcional. Sin pasarlo se usa `fmtDinero` (la moneda del local
     *   en el que estamos). En la pantalla de CADENA cada local puede tener la suya
     *   —se vende en Suecia y Dinamarca—, así que ahí se pasa el símbolo de cada
     *   fila, y `null` significa "sin símbolo" para lo que no tiene una sola moneda.
     */
    function dinero(n, dec, simbolo) {
        if (n == null) return "—";
        var d = (dec == null) ? 2 : dec;
        if (simbolo === undefined) {
            return (typeof fmtDinero === "function") ? fmtDinero(n, d) : num(n, d);
        }
        var txt = num(n, d);
        return simbolo ? (simbolo + " " + txt) : txt;
    }

    function num(n, dec) {
        if (n == null) return "—";
        return Number(n).toLocaleString("es-AR", {
            minimumFractionDigits: dec == null ? 0 : dec,
            maximumFractionDigits: dec == null ? 0 : dec,
        });
    }

    /** Un porcentaje. `null` se muestra como raya: no hay base de ventas sobre la
     *  que calcularlo, y un "0 %" ahí sería mentira. */
    function pct(v, dec) {
        if (v == null) return "—";
        return num(v, dec == null ? 1 : dec) + " %";
    }

    function horas(v) {
        if (v == null) return "—";
        return num(v, 1) + " h";
    }

    // ── Los KPIs, en el orden en que se leen ──────────────────────────────────
    // `sentido` dice qué significa que el número SUBA, y es lo único que decide el
    // color: en un gasto, subir es malo; en las ventas, bueno; en las horas, ni una
    // cosa ni la otra — más horas pueden ser más trabajo o menos eficiencia, y el
    // tablero no tiene cómo saberlo, así que no opina.
    var KPIS = [
        { key: "ventas", pct: null, label: "Ventas", icon: "💰", sentido: "mas_mejor" },
        { key: "coste_personal", pct: "pct_personal", label: "Coste de personal", icon: "👥", sentido: "menos_mejor" },
        { key: "coste_insumos", pct: "pct_insumos", label: "Coste de insumos", icon: "📦", sentido: "menos_mejor" },
        { key: "gastos_fijos", pct: "pct_fijos", label: "Gastos fijos", icon: "🧾", sentido: "menos_mejor" },
        { key: "gastos_totales", pct: "pct_gastos_totales", label: "Gastos totales", icon: "📉", sentido: "menos_mejor" },
        { key: "resultado", pct: "pct_resultado", label: "Resultado", icon: "⚖️", sentido: "mas_mejor" },
        { key: "horas_trabajadas", pct: null, label: "Horas trabajadas", icon: "⏱️", sentido: "neutro", formato: "horas" },
    ];

    function valorTxt(kpi, bloque, simbolo) {
        if (!bloque) return "—";
        var v = bloque[kpi.key];
        return kpi.formato === "horas" ? horas(v) : dinero(v, 2, simbolo);
    }

    // ── Variaciones ───────────────────────────────────────────────────────────

    /** Variación de un IMPORTE: llega {abs, pct}. */
    function varImporte(v, formato, simbolo) {
        if (!v) return null;
        var signo = v.abs > 0 ? "+" : (v.abs < 0 ? "−" : "");
        var txtAbs = formato === "horas" ? horas(Math.abs(v.abs))
                                         : dinero(Math.abs(v.abs), 2, simbolo);
        var txtPct = v.pct == null ? "" : " (" + signo + num(Math.abs(v.pct), 1) + " %)";
        return { texto: signo + txtAbs + txtPct, delta: v.abs };
    }

    /**
     * Variación de un RATIO, en PUNTOS porcentuales.
     * ⚠ Un coste que pasa del 30 % al 33 % no subió "un 3 %": subió 3 PUNTOS, que en
     *   términos relativos es un 10 %. Por eso lleva la unidad "pp" escrita y nunca
     *   el signo de porcentaje.
     */
    function varRatio(v) {
        if (v == null) return null;
        var signo = v > 0 ? "+" : (v < 0 ? "−" : "");
        return { texto: signo + num(Math.abs(v), 1) + " pp", delta: v };
    }

    /** Verde / rojo / neutro según lo que ese KPI quiera que pase. */
    function claseDelta(delta, sentido) {
        if (delta == null || Math.abs(delta) < 0.005) return "mx-igual";
        if (sentido === "neutro") return "mx-neutro";
        var bueno = (sentido === "mas_mejor") ? delta > 0 : delta < 0;
        return bueno ? "mx-bien" : "mx-mal";
    }

    function flechaDelta(delta) {
        if (delta == null || Math.abs(delta) < 0.005) return "→";
        return delta > 0 ? "▲" : "▼";
    }

    /** Una línea "vs <período>: +1.234 € (+19,6 %)" lista para insertar. */
    function lineaComparacion(etiqueta, variacion, sentido) {
        if (!variacion) {
            return '<div class="mx-cmp mx-igual"><span class="mx-cmp-lbl">' + esc(etiqueta) +
                '</span><span class="mx-cmp-val">sin datos</span></div>';
        }
        return '<div class="mx-cmp ' + claseDelta(variacion.delta, sentido) + '">' +
            '<span class="mx-cmp-lbl">' + esc(etiqueta) + '</span>' +
            '<span class="mx-cmp-val">' + flechaDelta(variacion.delta) + " " +
            esc(variacion.texto) + "</span></div>";
    }

    // ── Previsión ─────────────────────────────────────────────────────────────

    var FLECHA = { sube: "↗", baja: "↘", estable: "→", sin_datos: "·" };
    var CONFIANZA_TXT = { alta: "Alta", media: "Media", baja: "Baja" };

    /**
     * La explicación de un día, armada CON LOS MISMOS NÚMEROS con los que se calculó.
     * No hay ninguna frase que no salga de un dato que viaja en la respuesta: si
     * mañana cambian los pesos o los umbrales en el backend, el texto cambia solo.
     */
    function explicarDia(d, meta) {
        var n = d.nombre.toLowerCase();
        var partes = [];

        if (d.motivo === "cerrado") {
            partes.push("En las últimas " + meta.ventana.semanas_historia +
                " semanas el local no abrió ningún " + n + ".");
            return partes.join(" ");
        }
        if (d.motivo === "sin_datos") {
            if (!meta.ventana.hay_patron) {
                partes.push("En las últimas " + meta.ventana.semanas_historia +
                    " semanas hubo ventas en " + meta.ventana.dias_con_venta +
                    " días, y hacen falta al menos " + meta.ventana.minimo_dias +
                    " para leer un patrón de trabajo.");
            }
            partes.push("No hay datos suficientes para prever este " + n + ".");
            return partes.join(" ");
        }

        if (d.muestras && d.muestras.length) {
            partes.push("Los últimos " + d.muestras.length + " " + n + "s facturaron " +
                d.muestras.map(function (v) { return dinero(v, 0); }).join(" y ") +
                (d.muestras.length > 1 ? " (media " + dinero(d.base_reciente, 0) + ")" : "") + ".");
        }
        if (d.muestras_descartadas) {
            partes.push("Se descartó " + d.muestras_descartadas + " " + n +
                (d.muestras_descartadas > 1 ? "s sin venta" : " sin venta") +
                " por tratarse de un cierre excepcional.");
        }
        if (d.motivo === "mezcla" || d.motivo === "solo_anio_pasado") {
            var f = meta.factor_anual;
            partes.push("El mismo " + n + " del año pasado facturó " + dinero(d.anio_pasado, 0) +
                "; el local factura un " + num(Math.abs(f.pct), 1) + " % " +
                (f.pct >= 0 ? "más" : "menos") + " por día de servicio que entonces, así que " +
                "equivale a " + dinero(d.anio_pasado_ajustado, 0) + " de hoy.");
        }
        if (d.motivo === "mezcla") {
            partes.push("La previsión pesa lo reciente al " + Math.round(meta.pesos.reciente * 100) +
                " % y el año pasado al " + Math.round(meta.pesos.anio_pasado * 100) + " %.");
        } else if (d.motivo === "solo_reciente") {
            partes.push("No hay dato del mismo " + n + " del año pasado, así que la previsión es esa media.");
        } else if (d.motivo === "solo_anio_pasado") {
            partes.push("No hay " + n + "s recientes con venta, así que la previsión sale sólo de ahí.");
        }
        if (d.tendencia === "sube" || d.tendencia === "baja") {
            partes.push("Viene " + (d.tendencia === "sube" ? "subiendo" : "bajando") + ": el último fue un " +
                num(Math.abs(d.cambio_pct), 1) + " % " + (d.tendencia === "sube" ? "mejor" : "peor") +
                " que el anterior.");
        }
        partes.push("Confianza " + CONFIANZA_TXT[d.confianza].toLowerCase() + ": " + d.confianza_porque + ".");
        return partes.join(" ");
    }

    // ── Estilos (una sola copia, inyectada al usarse) ─────────────────────────

    var CSS = [
        ".mx-sel{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0 16px;}",
        ".mx-tabs{display:inline-flex;border:1.5px solid var(--bd-2,#e0e0e0);border-radius:8px;overflow:hidden;}",
        ".mx-tabs button{background:var(--sup,#fff);color:var(--tx-7,#666);border:none;padding:7px 16px;",
        "  cursor:pointer;font-size:13px;font-weight:600;}",
        ".mx-tabs button.on{background:var(--ac,#4f46e5);color:var(--tx-inv,#fff);}",
        ".mx-nav{display:inline-flex;align-items:center;gap:8px;}",
        ".mx-nav button{background:var(--sup,#fff);border:1.5px solid var(--bd-2,#e0e0e0);border-radius:8px;",
        "  width:32px;height:32px;cursor:pointer;font-size:16px;color:var(--tx-7,#666);line-height:1;}",
        ".mx-nav button:disabled{opacity:.4;cursor:default;}",
        ".mx-nav span{min-width:150px;text-align:center;font-weight:700;font-size:15px;color:var(--tx,#222);}",
        ".mx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;}",
        ".mx-card{background:var(--sup,#fff);border:1px solid var(--bd-2,#e8e8e8);border-radius:12px;",
        "  padding:14px 16px;box-shadow:0 1px 3px var(--sh-1,rgba(0,0,0,.06));display:flex;flex-direction:column;gap:2px;}",
        ".mx-card-top{display:flex;align-items:center;gap:7px;}",
        ".mx-card-lbl{font-size:12px;font-weight:700;color:var(--tx-7,#666);text-transform:uppercase;letter-spacing:.4px;}",
        ".mx-card-val{font-size:25px;font-weight:800;color:var(--tx,#222);line-height:1.15;margin-top:4px;",
        "  font-variant-numeric:tabular-nums;}",
        ".mx-card-val.neg{color:var(--pel-tx-2,#dc2626);}",
        ".mx-card-pct{display:inline-block;align-self:flex-start;margin-top:4px;font-size:12px;font-weight:700;",
        "  padding:2px 8px;border-radius:999px;background:var(--sup-3,#f3f4f6);color:var(--tx-7,#555);}",
        ".mx-card-cmps{margin-top:9px;border-top:1px dashed var(--bd-2,#e8e8e8);padding-top:7px;display:flex;",
        "  flex-direction:column;gap:3px;}",
        ".mx-cmp{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;font-variant-numeric:tabular-nums;}",
        ".mx-cmp-lbl{color:var(--tx-9,#888);}",
        ".mx-cmp-val{font-weight:700;}",
        ".mx-bien .mx-cmp-val{color:var(--ok-tx,#15803d);}",
        ".mx-mal .mx-cmp-val{color:var(--pel-tx-2,#dc2626);}",
        ".mx-neutro .mx-cmp-val,.mx-igual .mx-cmp-val{color:var(--tx-9,#888);}",
        ".mx-aviso{font-size:12px;color:var(--tx-9,#888);margin:6px 0 0;}",
        ".mx-vacio{padding:22px;text-align:center;color:var(--tx-9,#888);font-size:14px;}",
        // Previsión
        ".mx-prev{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px;}",
        ".mx-dia{background:var(--sup,#fff);border:1px solid var(--bd-2,#e8e8e8);border-radius:10px;padding:11px 12px;}",
        ".mx-dia.cerrado{background:var(--sup-3,#f3f4f6);}",
        ".mx-dia-nom{font-size:12px;font-weight:700;color:var(--tx-7,#666);display:flex;justify-content:space-between;}",
        ".mx-dia-val{font-size:19px;font-weight:800;color:var(--tx,#222);margin-top:3px;font-variant-numeric:tabular-nums;}",
        ".mx-dia-sub{font-size:11px;color:var(--tx-9,#888);margin-top:2px;}",
        ".mx-conf{display:inline-block;margin-top:6px;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;}",
        ".mx-conf.alta{background:var(--ok-sf,#dcfce7);color:var(--ok-tx,#15803d);}",
        ".mx-conf.media{background:var(--av-sf,#fef3c7);color:var(--av-tx,#a16207);}",
        ".mx-conf.baja{background:var(--pel-sf,#fee2e2);color:var(--pel-tx-2,#dc2626);}",
        ".mx-dia-exp{font-size:11px;color:var(--tx-9,#888);margin-top:7px;line-height:1.45;}",
        // Gráficos. Van sobre `.hoja` (fondo claro a propósito, como un documento
        // sobre un escritorio oscuro): Chart.js no hereda el tema del documento.
        ".mx-charts{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-top:14px;}",
        ".mx-chart-card{border-radius:12px;padding:14px 16px;}",
        ".mx-chart-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;",
        "  color:var(--tx-7,#666);margin-bottom:8px;}",
        "@media (max-width:860px){.mx-charts{grid-template-columns:1fr;}}",
        // Tabla comparativa de cadena
        ".mx-tabla{width:100%;border-collapse:collapse;font-size:13px;}",
        ".mx-tabla th{text-align:right;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.4px;",
        "  color:var(--tx-7,#666);border-bottom:2px solid var(--bd-2,#e8e8e8);cursor:pointer;white-space:nowrap;}",
        ".mx-tabla th:first-child,.mx-tabla td:first-child{text-align:left;}",
        ".mx-tabla th.orden::after{content:' ▾';}",
        ".mx-tabla th.orden.asc::after{content:' ▴';}",
        ".mx-tabla td{text-align:right;padding:9px 10px;border-bottom:1px solid var(--bd-2,#f0f0f0);",
        "  font-variant-numeric:tabular-nums;}",
        ".mx-tabla tfoot td{font-weight:800;border-top:2px solid var(--bd-2,#e8e8e8);border-bottom:none;",
        "  background:var(--sup-2,#fafafa);}",
        ".mx-tabla .sub{display:block;font-size:11px;color:var(--tx-9,#888);font-weight:600;}",
        ".mx-tabla tr.err td{color:var(--pel-tx-2,#dc2626);font-style:italic;}",
        "@media (max-width:640px){.mx-nav span{min-width:110px;font-size:13px;}",
        "  .mx-card-val{font-size:21px;}.mx-tabla{font-size:12px;}}",
    ].join("\n");

    function inyectarEstilos() {
        if (document.getElementById("mx-estilos")) return;
        var s = document.createElement("style");
        s.id = "mx-estilos";
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    // ── Tarjeta de KPI ────────────────────────────────────────────────────────

    /**
     * @param kpi      una entrada de KPIS
     * @param datos    respuesta de /metricas/* (con `actual` y, si se pidieron, las
     *                 comparaciones). Mientras no lleguen, la tarjeta ya muestra el
     *                 valor: las comparaciones se rellenan después.
     */
    function tarjeta(kpi, datos, simbolo) {
        var a = datos.actual || {};
        var v = a[kpi.key];
        var p = kpi.pct ? a[kpi.pct] : null;
        var neg = (kpi.key === "resultado" && v != null && v < 0);

        var cmps = "";
        if (datos.vs_anterior || datos.vs_anio_pasado) {
            var lineas = [];
            var usarPct = !!kpi.pct;
            // En un ratio la comparación se expresa en puntos; en un importe, en % y
            // en valor. Se muestran las dos cosas cuando el KPI tiene ratio.
            if (datos.vs_anterior) {
                lineas.push(lineaComparacion(datos.periodo.label_anterior,
                    varImporte(datos.vs_anterior[kpi.key], kpi.formato, simbolo), kpi.sentido));
                if (usarPct) {
                    lineas.push(lineaComparacion("· en puntos",
                        varRatio(datos.vs_anterior[kpi.pct]), kpi.sentido));
                }
            }
            if (datos.vs_anio_pasado && !datos.periodo.comparadores_iguales) {
                lineas.push(lineaComparacion(datos.periodo.label_anio_pasado,
                    varImporte(datos.vs_anio_pasado[kpi.key], kpi.formato, simbolo), kpi.sentido));
            }
            cmps = '<div class="mx-card-cmps">' + lineas.join("") + "</div>";
        }

        return '<div class="mx-card" data-kpi="' + esc(kpi.key) + '">' +
            '<div class="mx-card-top"><span>' + kpi.icon + "</span>" +
            '<span class="mx-card-lbl">' + esc(kpi.label) + "</span></div>" +
            '<div class="mx-card-val' + (neg ? " neg" : "") + '">' +
            esc(valorTxt(kpi, a, simbolo)) + "</div>" +
            (kpi.pct ? '<span class="mx-card-pct">' + esc(pct(p)) + " de ventas</span>" : "") +
            cmps + "</div>";
    }

    /** @param simbolo  la moneda del ámbito. Sin pasarlo, la del local actual. */
    function grilla(datos, simbolo) {
        if (!datos || !datos.actual || !datos.actual.hay_datos) {
            return '<div class="mx-vacio">Datos insuficientes para este período.</div>';
        }
        return '<div class="mx-grid">' +
            KPIS.map(function (k) { return tarjeta(k, datos, simbolo); }).join("") + "</div>";
    }

    // Paleta categorica validada (misma que estadisticas-personal.html: orden FIJO,
    // nunca se cicla). Se comparte desde aca para que los graficos de las dos
    // pantallas de metricas no diverjan en colores.
    var PALETA = ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a", "#eb6834",
                  "#4a3aa7", "#e34948"];
    var GRIS = "#9ca3af";

    /** Color de tema para lo que se pinta DENTRO de un canvas: Chart.js no hereda CSS. */
    function tcol(token, respaldo) {
        return (window.Tema && window.Tema.color) ? window.Tema.color(token, respaldo) : respaldo;
    }

    /** Crea un grafico destruyendo el anterior POR CANVAS (no por la variable donde
     *  lo guardamos): si el canvas se reemplaza, la referencia vieja queda huerfana. */
    function grafico(idCanvas, cfg) {
        var el = document.getElementById(idCanvas);
        if (!el || !window.Chart) return null;
        try { Chart.getChart(el) && Chart.getChart(el).destroy(); } catch (e) { }
        return new Chart(el, cfg);
    }

    window.Metricas = {
        KPIS: KPIS, PALETA: PALETA, GRIS: GRIS,
        tcol: tcol, grafico: grafico,
        esc: esc, dinero: dinero, num: num, pct: pct, horas: horas,
        varImporte: varImporte, varRatio: varRatio,
        claseDelta: claseDelta, flechaDelta: flechaDelta,
        lineaComparacion: lineaComparacion,
        valorTxt: valorTxt,
        tarjeta: tarjeta, grilla: grilla,
        explicarDia: explicarDia,
        FLECHA: FLECHA, CONFIANZA_TXT: CONFIANZA_TXT,
        inyectarEstilos: inyectarEstilos,
    };
})();
