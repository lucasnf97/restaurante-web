// ── SSE: conexión compartida de eventos en tiempo real ────────
// UNA EventSource para toda la app (se abre post-login, se cierra en logout).
// Las pantallas se suscriben en mount y se desuscriben en unmount.
// El server publica señales coarse {"tipo":"pos"|"reservas"} — sin datos:
// el cliente refresca lo suyo al recibirlas. Además manda un latido
// {"tipo":"ping"} cada ~20s (sólo para detectar vida — no dispara refresh).
//
// EventSource corre en el webview (no puede ir por CapacitorHttp) → el origin
// https://localhost debe estar en ALLOWED_ORIGINS del backend.
//
// ⚠ iOS/WKWebView: la conexión SSE puede quedar "zombie" (el OS la suspende, o
// la mata la NAT del celular, o hay un salto wifi↔celular) SIN disparar onerror.
// Sin señal de vida, los eventos dejaban de llegar y sólo actualizaba el poll de
// respaldo (lento). Por eso: (1) el server manda un latido detectable, (2) un
// watchdog reconecta si no llega nada en ~50s, (3) al volver a foreground se
// revisa y reconecta. En simulador/Mac no se reproduce (red estable) — es
// exclusivo de dispositivos reales.

import { API_URL } from "./api.js";
import * as config from "./config.js";

let _es = null;
let _subs = [];        // [{tipos: Set|null, cb}]
let _cerrado = true;
let _lastMsg = 0;      // epoch ms del último dato recibido (evento o latido)
let _watchdog = null;
const _STALE_MS = 50000;   // ~2.5 latidos (20s c/u) sin señal → conexión muerta

function _abrir() {
    const tok = config.getToken();
    if (!tok || !window.EventSource) return;
    _es = new EventSource(`${API_URL}/eventos/stream?token=${encodeURIComponent(tok)}`);
    _lastMsg = Date.now();
    _es.onopen = () => { _lastMsg = Date.now(); };
    _es.onmessage = (ev) => {
        _lastMsg = Date.now();               // cualquier dato = la conexión vive
        let tipo;
        try { tipo = JSON.parse(ev.data).tipo; } catch { return; }
        if (tipo === "ping") return;         // latido: sólo marca vida, no refresca
        for (const s of _subs) {
            if (!s.tipos || s.tipos.has(tipo)) {
                try { s.cb(tipo); } catch (e) { console.error(e); }
            }
        }
    };
    // EventSource reintenta solo ante caída detectada; el watchdog cubre la
    // "zombie" (readyState OPEN pero sin datos) que iOS no reporta.
    _es.onerror = () => {};
}

export function conectar() {
    if (_es || !config.getToken() || !window.EventSource) return;
    _cerrado = false;
    _abrir();
    if (!_watchdog) _watchdog = setInterval(_vigilar, 15000);
}

// Cada 15s: si la conexión está cerrada o no llegó nada en _STALE_MS, reciclarla.
function _vigilar() {
    if (_cerrado || !config.getToken()) return;
    const muerta = !_es || _es.readyState === 2 /*CLOSED*/
        || (Date.now() - _lastMsg > _STALE_MS);
    if (muerta) reconectar();
}

export function cerrar() {
    _cerrado = true;
    if (_watchdog) { clearInterval(_watchdog); _watchdog = null; }
    if (_es) { _es.close(); _es = null; }
}

// Reconexión forzada (watchdog, vuelta a foreground, o resume de Capacitor).
// Emite un "pos" sintético: mientras estuvo muerta pudimos perder eventos, así
// que la pantalla se pone al día enseguida.
export function reconectar() {
    if (_es) { _es.close(); _es = null; }
    if (_cerrado || !config.getToken()) return;
    _abrir();
    for (const s of _subs) {
        if (!s.tipos || s.tipos.has("pos")) {
            try { s.cb("pos"); } catch (e) { console.error(e); }
        }
    }
}

// Al volver a primer plano, iOS/WKWebView suele traer una conexión ya muerta:
// revisar y reconectar sin esperar al watchdog (respuesta inmediata al usuario).
if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || _cerrado) return;
        if (!_es || _es.readyState !== 1 /*OPEN*/ || Date.now() - _lastMsg > _STALE_MS) {
            reconectar();
        }
    });
}

// Suscribirse a tipos ("pos", ["pos","reservas"], o null = todos).
// Devuelve una función para desuscribirse (llamarla en unmount).
export function on(tipos, cb) {
    const t = tipos ? new Set(Array.isArray(tipos) ? tipos : [tipos]) : null;
    const sub = { tipos: t, cb };
    _subs.push(sub);
    return () => { _subs = _subs.filter(s => s !== sub); };
}
