// ── API: adaptador HTTP dual (CapacitorHttp nativo / fetch browser) ──
// Portado de restaurante-pos/www/js/core/api.js con dos diferencias:
//  1. SIN headers de terminal: acá solo viaja Authorization (el token de
//     CUENTA por defecto, o el token de LOCAL que pase sesion.js en
//     options.token). El schema viaja adentro del JWT.
//  2. Los errores HTTP llevan err.status para que sesion.js distinga el 401
//     de un token de local vencido (re-entra y reintenta) del de cuenta.

import * as config from "./config.js";

export const API_URL = "https://restaurante-backend-production-459b.up.railway.app";

const _TIMEOUT_MS = 20000;
// Solo métodos idempotentes se reintentan.
const _RETRY_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Escape XSS (idéntico a la web) ───────────────────────────
export function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function escAttr(s) {
    return esc(s).replace(/`/g, "&#96;").replace(/\//g, "&#47;");
}

// ── Display name ─────────────────────────────────────────────
export function displayName(x) {
    if (!x) return "";
    return x.nombre_display
        || [x.nombre, x.apellido].filter(Boolean).join(" ")
        || x.username || "";
}

// ── Transporte: CapacitorHttp (nativo) o fetch (browser) ─────
async function _transporte(url, { method, headers, body }) {
    const http = config.esNativo()
        && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    if (http) {
        // ⚠ iOS: CapacitorHttp con Content-Type application/json y SIN data falla
        // (intenta serializar un body inexistente) — rompía todos los DELETE.
        // Android es tolerante, por eso solo se veía en iPhone/iPad.
        const hdrs = { ...headers };
        if (body === undefined || body === null) delete hdrs["Content-Type"];
        const opts = { url, method, headers: hdrs, connectTimeout: 8000, readTimeout: _TIMEOUT_MS };
        if (body !== undefined && body !== null) {
            if (hdrs["Content-Type"] === "application/x-www-form-urlencoded") {
                opts.data = body;
            } else {
                opts.data = (typeof body === "string") ? JSON.parse(body) : body;
            }
        }
        const res = await http.request(opts);
        return {
            status: res.status,
            ok: res.status >= 200 && res.status < 300,
            headers: res.headers || {},
            json: async () => (typeof res.data === "string" && res.data
                ? JSON.parse(res.data) : res.data),
        };
    }
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), _TIMEOUT_MS);
    try {
        const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
        return {
            status: res.status, ok: res.ok,
            headers: res.headers,
            json: () => res.status === 204 ? Promise.resolve(null) : res.json(),
        };
    } finally { clearTimeout(timer); }
}

// Callback global de sesión de CUENTA expirada (main.js: logout → #login).
let _onSesionExpirada = null;
export function onSesionExpirada(fn) { _onSesionExpirada = fn; }
export async function _sesionExpirada() {
    await config.limpiarSesion();
    if (_onSesionExpirada) _onSesionExpirada();
}

// ── apiFetch ──────────────────────────────────────────────────
// options: { method, body, headers, token (override), silent, sinLogout }
// Por defecto autentica con el token de CUENTA. Un 401 (sin sinLogout) cierra
// la sesión de cuenta. sesion.js pasa token de local + sinLogout y maneja el
// 401 él mismo (err.status).
export async function apiFetch(endpoint, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    // Content-Type solo si HAY body (un DELETE/GET con json-sin-body rompe
    // CapacitorHttp en iOS); options.headers siempre gana.
    const headers = {
        ...(options.body != null ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
    };
    const tok = options.token || config.getToken();
    if (tok && !("Authorization" in headers)) headers["Authorization"] = `Bearer ${tok}`;
    for (const k of Object.keys(headers)) if (headers[k] === "" || headers[k] == null) delete headers[k];

    const reintentable = _RETRY_METHODS.has(method);
    const maxIntentos  = reintentable ? 3 : 1;

    if (window.UI && !options.silent) window.UI._reqStart();
    try {
        let ultimoError = null;
        for (let intento = 0; intento < maxIntentos; intento++) {
            let res;
            try {
                res = await _transporte(`${API_URL}${endpoint}`, { method, headers, body: options.body });
            } catch (e) {
                ultimoError = (e && e.name === "AbortError")
                    ? new Error("La solicitud tardó demasiado. Reintentá.")
                    : new Error("Sin conexión con el servidor.");
                if (reintentable && intento < maxIntentos - 1) {
                    await _sleep(400 * Math.pow(2, intento));
                    continue;
                }
                throw ultimoError;
            }

            if (res.status === 401 && !options.sinLogout) {
                await _sesionExpirada();
                const err = new Error("Sesión expirada.");
                err.status = 401;
                throw err;
            }

            if (res.status === 429) {
                const ra = parseInt((res.headers && (res.headers["Retry-After"] || res.headers["retry-after"]
                    || (res.headers.get && res.headers.get("Retry-After")))) || "10", 10) || 10;
                if (method === "GET" && intento < maxIntentos - 1) {
                    await _sleep(ra * 1000);
                    continue;
                }
                const err = new Error(`Demasiadas solicitudes. Esperá ${ra}s y reintentá.`);
                err.status = 429;
                throw err;
            }

            if (reintentable && [500, 502, 503, 504].includes(res.status) && intento < maxIntentos - 1) {
                await _sleep(700 * Math.pow(2, intento));
                continue;
            }

            if (!res.ok) {
                let detail = "Error en la API";
                let datos = null;
                try {
                    const err = await res.json();
                    if (err && err.detail) {
                        if (Array.isArray(err.detail)) {
                            detail = err.detail.map(d => d.msg || d).join(" · ");
                        } else if (typeof err.detail === "object") {
                            // ⚠ El backend puede mandar un detalle ESTRUCTURADO (p. ej. el 409
                            //   de fichar fuera de horario, que trae `codigo` y a qué hora
                            //   empieza el turno). Sin esto se perdía: `new Error(objeto)`
                            //   deja el mensaje en "[object Object]" y la pantalla no puede
                            //   ofrecer la salida que el backend está proponiendo.
                            datos = err.detail;
                            detail = err.detail.mensaje || err.detail.detail || "Error en la API";
                        } else {
                            detail = err.detail;
                        }
                    }
                } catch (_) {}
                const err = new Error(detail);
                err.status = res.status;
                err.datos = datos;
                throw err;
            }
            if (res.status === 204) return null;
            return res.json();
        }
        throw ultimoError || new Error("Error en la API");
    } finally {
        if (window.UI && !options.silent) window.UI._reqEnd();
    }
}

// Multipart en contexto de CUENTA: SIEMPRE fetch del webview + FormData (CapacitorHttp
// no arma multipart). Usa el token de cuenta; el origin https://localhost está permitido.
async function _formCuenta(endpoint, formData, method = "POST") {
    const token = config.getToken();
    const res = await fetch(`${API_URL}${endpoint}`, {
        method, body: formData,
        headers: token ? { "Authorization": `Bearer ${token}` } : {},   // sin Content-Type: boundary automático
    });
    if (!res.ok) {
        let detail = "Error en la API";
        try { const j = await res.json(); detail = (j && j.detail) || detail; } catch (_) {}
        const err = new Error(typeof detail === "string" ? detail : "Error en la API");
        err.status = res.status;
        throw err;
    }
    return res.status === 204 ? null : res.json();
}

// ── Shorthands con token de CUENTA (agregados /empleado/*) ────
export const apiCuenta = {
    get:       (e)       => apiFetch(e),
    getSilent: (e)       => apiFetch(e, { silent: true }),
    post:      (e, b)    => apiFetch(e, { method: "POST",  body: JSON.stringify(b ?? {}) }),
    patch:     (e, b)    => apiFetch(e, { method: "PATCH", body: JSON.stringify(b ?? {}) }),
    put:       (e, b)    => apiFetch(e, { method: "PUT",   body: JSON.stringify(b ?? {}) }),
    del:       (e)       => apiFetch(e, { method: "DELETE" }),
    form:      (e, fd, m) => _formCuenta(e, fd, m),
};

// ── Login por email (empleado o gerente) ──────────────────────
// form-urlencoded SIN código → el backend resuelve por email: gerente_cadena o
// empleado_cadena. Los emails son únicos globalmente (gerente = un usuario más),
// así que no hay ambigüedad; ambos roles pueden usar la app.
export async function loginCuenta(email, password) {
    const form = new URLSearchParams();
    form.append("username", email);
    form.append("password", password);
    const data = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        sinLogout: true,
    });
    // La app la usan EMPLEADOS y GERENTES de cadena (el gerente es "un usuario más":
    // entra a sus locales con permisos plenos para responder mensajes, asignar horarios…).
    if (data.rol !== "empleado_cadena" && data.rol !== "gerente_cadena") {
        throw new Error("Esta cuenta no puede usar la app. Ingresá con tu email de empleado o de gerente.");
    }
    const { access_token, token_type, ...userFields } = data;
    await config.setSesion(access_token, userFields);
    return data;
}

// ¿La sesión actual es de un gerente de cadena? (algunos agregados son solo de empleado)
// ── URL SEGURA (XSS por href) ─────────────────────────────────
// esc()/escAttr() escapan HTML pero NO el ESQUEMA: href="javascript:…" pasa intacto y
// ejecuta JS con el token a mano. Devuelve una URL http(s) segura, o "" si el esquema
// no es seguro (el llamador muestra el texto sin link).
export function urlSegura(u) {
    const s = String(u == null ? "" : u).trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "";   // javascript:, data:, vbscript:…
    return "https://" + s;                            // sin esquema → https
}

export function esGerente() {
    const u = config.getUser();
    return !!(u && u.rol === "gerente_cadena");
}

// ── Keep-warm ─────────────────────────────────────────────────
setInterval(() => {
    if (!config.getToken()) return;
    _transporte(`${API_URL}/`, { method: "GET", headers: {} }).catch(() => {});
}, 210000);
