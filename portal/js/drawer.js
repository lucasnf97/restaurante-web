// ── drawer.js — menú hamburguesa persistente ──────────────────
// Vive en #drawer-root (fuera de #app): sobrevive a los cambios de pantalla.
// Mismo look que el sidebar de la web: panel #1a1a2e, links #a5b4fc,
// activo #4f46e5. API: init, abrir, cerrar, marcarActiva, setSesion,
// setBadgeMensajes, headerConMenu (helper para el header de cada pantalla).

import * as config from "./core/config.js";
import { esc, displayName, apiCuenta, esGerente } from "./core/api.js";

const _ITEMS = [
    { ruta: "resumen",     icono: "🏠", label: "Inicio" },
    { ruta: "fichar",      icono: "🕐", label: "Fichar" },
    { ruta: "horarios",    icono: "📅", label: "Horarios" },
    { ruta: "mensajes",    icono: "💬", label: "Mensajes" },
    { ruta: "muro",        icono: "📣", label: "Muro" },
    { ruta: "documentos",  icono: "📁", label: "Documentos" },
    // Gateado: aparece si el usuario tiene facturación/estadísticas O stock en algún local.
    { ruta: "facturacion", icono: "📊", label: "Análisis", gate: "acceso_estadisticas,ver_stock,gestion_stock" },
    { ruta: "perfil",      icono: "👤", label: "Mi perfil" },
];

let _abierto = false;
let _badgeTimer = null;

export function init() {
    const root = document.getElementById("drawer-root");
    root.innerHTML = `
        <div class="drawer-ov" id="drawer-ov"></div>
        <nav class="drawer" id="drawer">
            <div class="drawer-head">
                <div class="drawer-brand">🍽️ Portal del Empleado</div>
                <div class="drawer-user" id="drawer-user"></div>
            </div>
            <div class="drawer-links">
                ${_ITEMS.map(i => `
                    <button class="drawer-link" data-ruta="${i.ruta}" ${i.gate ? `data-gate="${i.gate}" style="display:none;"` : ""} onclick="_ir('${i.ruta}')">
                        <span class="dl-icono">${i.icono}</span>${i.label}
                        <span class="dl-badge" id="dl-badge-${i.ruta}" style="display:none;"></span>
                    </button>`).join("")}
            </div>
            <button class="drawer-salir" id="drawer-salir">Cerrar sesión</button>
        </nav>`;
    window._drawerAbrir = abrir;   // para los onclick inline de los headers
    root.querySelector("#drawer-ov").addEventListener("click", cerrar);
    root.querySelector("#drawer-salir").addEventListener("click", async () => {
        const { logout } = await import("./core/sesion.js");
        const sse = await import("./core/sse.js");
        sse.cerrar();
        await logout();
        setSesion(false);
        window._ir("login");
    });
    setSesion(!!config.getToken());
}

export function abrir() {
    if (!config.getToken()) return;
    _abierto = true;
    document.getElementById("drawer").classList.add("abierto");
    document.getElementById("drawer-ov").classList.add("abierto");
    _pintarUsuario();
}

// Devuelve true si estaba abierto (para el manejo del back).
export function cerrar() {
    const estaba = _abierto;
    _abierto = false;
    const d = document.getElementById("drawer");
    if (d) {
        d.classList.remove("abierto");
        document.getElementById("drawer-ov").classList.remove("abierto");
    }
    return estaba;
}

export function marcarActiva(ruta) {
    document.querySelectorAll(".drawer-link").forEach(b => {
        b.classList.toggle("activa", b.dataset.ruta === ruta);
    });
}

function _pintarUsuario() {
    const el = document.getElementById("drawer-user");
    if (el) el.textContent = displayName(config.getUser());
}

// ── Badge de mensajes no leídos (agregado de la cuenta) ───────
async function _refrescarBadge() {
    if (!config.getToken() || esGerente()) return;   // agregado de cuenta: solo empleados
    try {
        const r = await apiCuenta.getSilent("/empleado/mensajes/no-leidos");
        setBadgeMensajes((r && r.count) || 0);
    } catch (_) {}
}

export function setBadgeMensajes(n) {
    const b = document.getElementById("dl-badge-mensajes");
    if (!b) return;
    b.textContent = n > 99 ? "99+" : String(n);
    b.style.display = n > 0 ? "" : "none";
}

export function setSesion(activa) {
    if (activa) {
        _pintarUsuario();
        _refrescarBadge();
        refrescarGates();
        if (!_badgeTimer) _badgeTimer = setInterval(_refrescarBadge, 60000);
    } else {
        cerrar();
        refrescarGates();
        if (_badgeTimer) { clearInterval(_badgeTimer); _badgeTimer = null; }
    }
}

// Muestra/oculta los ítems gateados según los permisos por local (Análisis, etc.).
// ⚠ SIN sesión no toca la API: pedir /empleado/mis-restaurantes sin token da 401,
// que dispara _sesionExpirada → setSesion(false) → acá de nuevo = loop infinito
// de errores en el login (pasó en el build del 13/07).
export async function refrescarGates() {
    let rests = [];
    if (config.getToken()) {
        try { const { getRestaurantes } = await import("./core/sesion.js"); rests = await getRestaurantes(); } catch { rests = []; }
    }
    document.querySelectorAll(".drawer-link[data-gate]").forEach(btn => {
        const perms = btn.dataset.gate.split(",");   // OR entre permisos
        btn.style.display = rests.some(r => r.permisos && perms.some(p => r.permisos[p])) ? "" : "none";
    });
}

// ── Header estándar de pantalla con botón ☰ ──────────────────
// extraHtml se inserta a la derecha del título (chips, botones).
export function headerConMenu(titulo, extraHtml = "") {
    return `<div class="pantalla-header">
        <button class="hbtn" onclick="_drawerAbrir()" aria-label="Menú">☰</button>
        <h1>${esc(titulo)}</h1>${extraHtml}
    </div>`;
}
