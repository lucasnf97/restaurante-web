// ── SESIÓN: cuenta del empleado + tokens por local ────────────
// El login por email da un token de CUENTA (rol empleado_cadena, sin schema):
// sirve para los agregados /empleado/*. Para operar EN un local (muro,
// mensajes, horarios, documentos de grupo) se "entra" con
// POST /empleado/entrar/{rid} → token de LOCAL con el rol/permisos reales.
// Los tokens de local viven SOLO en memoria (expiran a las 8 h): ante 401 se
// re-entra con el token de cuenta y se reintenta el request UNA vez.

import * as config from "./config.js";
import { apiFetch, apiCuenta, _sesionExpirada } from "./api.js";

let _tokensLocal = new Map();   // rid -> { token, user, ts }
const _MAX_EDAD_MS = 7.5 * 60 * 60 * 1000;   // re-entrar proactivo antes de las 8 h

// ── Restaurantes del empleado ─────────────────────────────────
export async function getRestaurantes({ refrescar = false } = {}) {
    let lista = config.get("restaurantes");
    if (!lista || refrescar) {
        lista = await apiCuenta.get("/empleado/mis-restaurantes");
        lista = (lista || []).filter(r => r.activo !== false);
        await config.set("restaurantes", lista);
    }
    return lista || [];
}

export function restaurantesCache() { return config.get("restaurantes") || []; }

export function nombreLocal(rid) {
    const r = restaurantesCache().find(x => x.restaurante_id === rid);
    return r ? (r.restaurante || r.codigo) : "";
}

// ── Local activo (global de la app; con 1 solo local es transparente) ──
export function getLocalActivo() {
    const lista = restaurantesCache();
    const guardado = config.get("local_activo");
    if (guardado && lista.some(r => r.restaurante_id === guardado)) return guardado;
    return lista.length ? lista[0].restaurante_id : null;
}
export async function setLocalActivo(rid) {
    await config.set("local_activo", rid);
}

// ── Tokens de local ───────────────────────────────────────────
async function _entrar(rid) {
    const data = await apiFetch(`/empleado/entrar/${rid}`, {
        method: "POST", body: "{}", sinLogout: true,
    });   // 401 acá = token de cuenta muerto → lo maneja el caller
    const { access_token, token_type, ...user } = data;
    const entry = { token: access_token, user, ts: Date.now() };
    _tokensLocal.set(rid, entry);
    return entry;
}

export async function getTokenLocal(rid) {
    const e = _tokensLocal.get(rid);
    if (e && (Date.now() - e.ts) < _MAX_EDAD_MS) return e.token;
    try {
        return (await _entrar(rid)).token;
    } catch (err) {
        if (err.status === 401) { await _sesionExpirada(); }
        throw err;
    }
}

export async function getUserLocal(rid) {
    await getTokenLocal(rid);
    const e = _tokensLocal.get(rid);
    return e ? e.user : null;
}

export function invalidarLocal(rid) { _tokensLocal.delete(rid); }

// Permiso en un local (admin/gerente del local siempre pasan). Requiere haber
// entrado antes (getUserLocal); si no, false.
export function hasPermisoLocal(rid, perm) {
    const e = _tokensLocal.get(rid);
    const u = e && e.user;
    if (!u) return false;
    if (u.rol === "admin" || u.rol === "gerente") return true;
    return !!u[perm];
}

// ── Requests en contexto de LOCAL, con re-entrada ante 401 ────
// apiLocal(rid).get/post/... — si el token de local venció (401), re-entra y
// reintenta UNA vez (seguro incluso para POST: el 401 se rechaza antes de
// procesar nada). Si /entrar da 401, la cuenta murió → logout global.
async function _reqLocal(rid, endpoint, options = {}) {
    const token = await getTokenLocal(rid);
    try {
        return await apiFetch(endpoint, { ...options, token, sinLogout: true });
    } catch (err) {
        if (err.status !== 401) throw err;
        invalidarLocal(rid);
        const token2 = await getTokenLocal(rid);   // 401 acá → logout global
        return apiFetch(endpoint, { ...options, token: token2, sinLogout: true });
    }
}

export function apiLocal(rid) {
    return {
        get:       (e)    => _reqLocal(rid, e),
        getSilent: (e)    => _reqLocal(rid, e, { silent: true }),
        post:      (e, b) => _reqLocal(rid, e, { method: "POST",  body: JSON.stringify(b ?? {}) }),
        put:       (e, b) => _reqLocal(rid, e, { method: "PUT",   body: JSON.stringify(b ?? {}) }),
        patch:     (e, b) => _reqLocal(rid, e, { method: "PATCH", body: JSON.stringify(b ?? {}) }),
        del:       (e)    => _reqLocal(rid, e, { method: "DELETE" }),
        // multipart: SIEMPRE fetch del webview con FormData (CapacitorHttp no
        // arma multipart). El origin https://localhost está en ALLOWED_ORIGINS.
        form:      (e, formData, method = "POST") => _formLocal(rid, e, formData, method),
    };
}

async function _formLocal(rid, endpoint, formData, method) {
    const { API_URL } = await import("./api.js");
    const token = await getTokenLocal(rid);
    const hacer = async (tok) => {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method, body: formData,
            headers: { "Authorization": `Bearer ${tok}` },   // sin Content-Type: el browser pone el boundary
        });
        if (!res.ok) {
            let detail = "Error en la API";
            try { const j = await res.json(); detail = (j && j.detail) || detail; } catch (_) {}
            const err = new Error(typeof detail === "string" ? detail : "Error en la API");
            err.status = res.status;
            throw err;
        }
        return res.status === 204 ? null : res.json();
    };
    try {
        return await hacer(token);
    } catch (err) {
        if (err.status !== 401) throw err;
        invalidarLocal(rid);
        return hacer(await getTokenLocal(rid));
    }
}

// ── Logout total ──────────────────────────────────────────────
export async function logout() {
    _tokensLocal = new Map();
    await config.limpiarSesion();
}
