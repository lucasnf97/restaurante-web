// ── main.js — bootstrap + router por hash ─────────────────────
// Cada pantalla es un módulo { mount(el, params), unmount() }. El router
// desmonta la actual antes de montar la nueva. El drawer (hamburguesa) y el
// gate de prioritarias viven FUERA del router (persisten entre pantallas).
// Rutas: #login, #resumen, #muro, #mensajes, #documentos, #horarios,
//        #solicitud/<id>, #perfil

import "./core/ui.js";
import * as config from "./core/config.js";
import { onSesionExpirada } from "./core/api.js";
import * as sse from "./core/sse.js";
import * as drawer from "./drawer.js";
import * as prioritarias from "./prioritarias.js";
import { swipeBack, cerrarModalSuperior } from "./core/gestos.js";
import { debeIrAFichar } from "./core/turno-inminente.js";

const _pantallas = {
    login:      () => import("./screens/login.js"),
    resumen:    () => import("./screens/resumen.js"),
    muro:       () => import("./screens/muro.js"),
    mensajes:   () => import("./screens/mensajes.js"),
    documentos: () => import("./screens/documentos.js"),
    facturacion:() => import("./screens/facturacion.js"),
    horarios:   () => import("./screens/horarios.js"),
    fichar:     () => import("./screens/fichar.js"),
    solicitud:  () => import("./screens/solicitud.js"),
    perfil:     () => import("./screens/perfil.js"),
};

// Pantallas raíz (el back minimiza; el edge-swipe abre el drawer).
const _RAIZ = new Set(["resumen", "login"]);

let _actual = null;
let _actualNombre = null;

export function ir(ruta) {
    if (location.hash === "#" + ruta) { _navegar(); return; }
    location.hash = "#" + ruta;
}
window._ir = ir;

async function _navegar() {
    const hash = (location.hash || "#").slice(1);
    const [nombre, ...resto] = hash.split("/");
    const params = resto.join("/");

    // Gates: sin sesión de cuenta → login; con sesión, login → resumen.
    let destino = nombre;
    if (!config.getToken()) destino = "login";
    else if (!destino || destino === "login" || !_pantallas[destino]) destino = "resumen";

    // ⚠ Sólo cuando se entra al resumen SIN pedir nada: si saltara desde cualquier pantalla,
    // no se podría navegar a otra cosa durante la ventana del turno.
    if (destino === "resumen" && (!nombre || nombre === "resumen" || nombre === "login")) {
        try {
            if (await debeIrAFichar()) { location.hash = "#fichar"; return; }
        } catch (e) { /* nunca puede impedir entrar a la app */ }
    }

    if (destino !== nombre) { location.hash = "#" + destino; return; }

    if (_actual && _actual.unmount) {
        try { _actual.unmount(); } catch (e) { console.error(e); }
    }

    drawer.cerrar();
    drawer.marcarActiva(destino);

    const el = document.getElementById("app");
    el.innerHTML = "";
    try {
        const mod = await _pantallas[destino]();
        _actual = mod;
        _actualNombre = destino;
        await mod.mount(el, params);
    } catch (e) {
        console.error("Error montando pantalla", destino, e);
        el.innerHTML = `<div class="boot-splash"><div class="boot-logo">⚠️</div>
            <div class="boot-txt">Error al cargar la pantalla.<br>${(e && e.message) || e}</div>
            <button class="btn-primario" onclick="location.reload()">Recargar</button></div>`;
    }
}

// ── "Volver" unificado (back del sistema / swipe) ─────────────
function _volver() {
    if (prioritarias.visible()) return true;      // gate: no se puede escapar
    if (drawer.cerrar()) return true;
    if (cerrarModalSuperior()) return true;
    if (_actualNombre === "solicitud") { ir("horarios"); return true; }
    if (!_RAIZ.has(_actualNombre)) { ir("resumen"); return true; }
    return false;   // resumen/login → minimizar
}

// Volver del segundo plano: en segundo plano el sistema corta la conexión en vivo.
function _alVolver() {
    sse.reconectar();
    prioritarias.checkear();                      // volver del background re-chequea
    if (_actual && _actual.onResume) { try { _actual.onResume(); } catch (e) {} }
}

// ── Integración nativa (Capacitor) ────────────────────────────
function _integrarNativo() {
    if (!config.esNativo()) return;
    const App = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App) return;
    App.addListener("backButton", () => {
        if (!_volver()) (App.minimizeApp ? App.minimizeApp() : App.exitApp());
    });
    App.addListener("resume", _alVolver);
}

// ── Integración web / PWA (2026-11-19) ────────────────────────
// Instalada desde el navegador ("Agregar a inicio") no hay plugin App: el equivalente del
// "resume" es volver a estar visible. El service worker (sw.js) sólo en el navegador y en
// contexto seguro (https o localhost); dentro de la app nativa nunca.
function _integrarWeb() {
    if (config.esNativo()) return;
    let oculta = false;
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") { oculta = true; return; }
        if (oculta) { oculta = false; _alVolver(); }
    });
    if ("serviceWorker" in navigator && window.isSecureContext) {
        navigator.serviceWorker.register("sw.js").catch(() => {});
    }
}

// ── Bootstrap ─────────────────────────────────────────────────
(async function () {
    await config.cargar();

    drawer.init();

    onSesionExpirada(() => {
        sse.cerrar();
        drawer.setSesion(false);
        ir("login");
        if (window.UI) UI.toast("Sesión expirada. Volvé a ingresar.", "warning");
    });

    _integrarNativo();
    _integrarWeb();
    // Edge-swipe: en pantallas raíz abre el drawer; en el resto, "volver".
    swipeBack(() => {
        if (_RAIZ.has(_actualNombre) && _actualNombre !== "login") drawer.abrir();
        else _volver();
    });
    window.addEventListener("hashchange", _navegar);

    if (config.getToken()) {
        drawer.setSesion(true);
        prioritarias.checkear();                  // gate al arrancar con sesión
    }
    _navegar();
})();
