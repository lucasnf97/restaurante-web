/**
 * moneda.js — Utilitario global de divisa del sistema
 *
 * Carga la configuración de divisa desde la API al iniciar y la
 * expone como window.SISTEMA_MONEDA para cualquier página que lo incluya.
 *
 * Uso:
 *   <script src="js/moneda.js"></script>   (después de api.js)
 *
 * API pública:
 *   window.SISTEMA_MONEDA  → { codigo, simbolo, nombre, tasas }
 *   formatMonto(n)         → "€ 1.234,50"
 *   getTasaCambio(codigo)  → { codigo, nombre, tasa } | null
 *   convertirASistema(monto, codigoForeign) → número | null
 */

// Valores por defecto hasta que llegue la respuesta de la API
window.SISTEMA_MONEDA = {
    codigo:       'EUR',
    simbolo:      '€',
    nombre:       'Euro',
    tasas:        [],   // [{ codigo:'GBP', nombre:'Libra esterlina', tasa:0.87 }, …]
    impuesto_pct: 0,    // % IVA/VAT local (ej: 25 para Dinamarca)
};

// ── Carga desde API ───────────────────────────────────────────────
async function cargarMonedaSistema() {
    // Primero restaurar cache para no flashear el valor por defecto
    try {
        const cached = JSON.parse(localStorage.getItem('sistema_moneda') || 'null');
        if (cached && cached.codigo) window.SISTEMA_MONEDA = cached;
    } catch {}

    try {
        const cfg = await apiFetch('/config/sistema');
        window.SISTEMA_MONEDA = {
            codigo:       cfg.moneda_codigo  || 'EUR',
            simbolo:      cfg.moneda_simbolo || '€',
            nombre:       cfg.moneda_nombre  || 'Euro',
            tasas:        cfg.tasas_cambio   || [],
            impuesto_pct: parseFloat(cfg.impuesto_pct || 0),
        };
        localStorage.setItem('sistema_moneda', JSON.stringify(window.SISTEMA_MONEDA));
    } catch (e) {
        // Sin conexión: se usa el cache ya restaurado arriba
        console.warn('[moneda.js] No se pudo cargar config de moneda:', e);
    }
}

// ── Helpers públicos ──────────────────────────────────────────────

/**
 * Devuelve la tasa configurada para una divisa extranjera, o null si no existe.
 * La tasa expresa: 1 [sistema] = tasa [extranjero].
 */
function getTasaCambio(codigoForeign) {
    if (!codigoForeign) return null;
    return window.SISTEMA_MONEDA.tasas.find(
        t => t.codigo.toUpperCase() === codigoForeign.toUpperCase()
    ) || null;
}

/**
 * Convierte un monto en divisa extranjera a la divisa del sistema.
 * Devuelve null si no hay tasa configurada.
 * Ejemplo: convertirASistema(87, 'GBP') con sistema=EUR y tasa 1EUR=0.87GBP → 100 EUR
 */
function convertirASistema(monto, codigoForeign) {
    if (!codigoForeign) return monto;
    if (codigoForeign.toUpperCase() === window.SISTEMA_MONEDA.codigo.toUpperCase()) {
        return monto; // misma divisa
    }
    const tasa = getTasaCambio(codigoForeign);
    if (!tasa || !tasa.tasa) return null;
    return monto / tasa.tasa;
}

/**
 * Formatea un número con el símbolo de la divisa del sistema.
 * Ejemplo: formatMonto(1234.5) → "€ 1.234,50"
 */
function formatMonto(n, opciones = {}) {
    const simbolo = opciones.simbolo || window.SISTEMA_MONEDA.simbolo;
    const valor   = parseFloat(n || 0);
    const formatted = valor.toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return `${simbolo} ${formatted}`;
}

/**
 * Devuelve el símbolo/acrónimo de la divisa del sistema (ej: "€", "$", "DKK").
 * Helper global para reemplazar el "$" fijo en cualquier página.
 */
function simboloMoneda() {
    return (window.SISTEMA_MONEDA && window.SISTEMA_MONEDA.simbolo) || '$';
}
window.simboloMoneda = simboloMoneda;

/**
 * Formatea un monto con el símbolo del sistema y N decimales (default 2).
 * fmtDinero(1234.5)        → "€ 1.234,50"
 * fmtDinero(1234.5, 0)     → "€ 1.235"
 */
function fmtDinero(n, decimales = 2) {
    const valor = parseFloat(n || 0);
    const formatted = valor.toLocaleString('es-AR', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
    });
    return `${simboloMoneda()} ${formatted}`;
}
window.fmtDinero  = fmtDinero;
window.formatMonto = formatMonto;

/**
 * Calcula el precio sin impuestos dado el precio con impuestos.
 * Fórmula: sinIVA = conIVA * (1 - pct/100)
 * Ejemplo: 200 kr con 25% → 200 * 0.75 = 150 kr s/IVA
 */
function precioSinIVA(conIVA, pct) {
    const p = (pct !== undefined && pct !== null) ? pct : window.SISTEMA_MONEDA.impuesto_pct;
    if (!p || p <= 0) return conIVA;
    return Math.round(conIVA * (1 - p / 100) * 10000) / 10000;
}

/**
 * Calcula el precio con impuestos dado el precio sin impuestos.
 * Fórmula: conIVA = sinIVA / (1 - pct/100)
 * Ejemplo: 150 kr s/IVA con 25% → 150 / 0.75 = 200 kr c/IVA
 */
function precioConIVA(sinIVA, pct) {
    const p = (pct !== undefined && pct !== null) ? pct : window.SISTEMA_MONEDA.impuesto_pct;
    if (!p || p <= 0) return sinIVA;
    const factor = 1 - p / 100;
    if (factor <= 0) return sinIVA;
    return Math.round(sinIVA / factor * 10000) / 10000;
}

// Inicializar en cuanto el script se carga (requiere que api.js ya esté cargado)
if (typeof apiFetch === 'function') {
    cargarMonedaSistema();
} else {
    // api.js todavía no cargó → esperar al DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof apiFetch === 'function') cargarMonedaSistema();
    });
}
