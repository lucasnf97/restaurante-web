// ── CONFIG: persistencia de la app del empleado ───────────────
// Capa única de configuración persistida. En la app nativa usa el plugin
// Preferences (sobrevive limpiezas del webview); en browser (modo dev) usa
// localStorage con el mismo shape, prefijo "emp_".
//
// Claves:
//   token_cuenta / user_cuenta → sesión de CUENTA (login por email, sin schema)
//   restaurantes               → cache de GET /empleado/mis-restaurantes
//   local_activo               → restaurante_id elegido para las pantallas por-local

let _cache = {};   // copia en memoria (lecturas síncronas post-cargar())

const _KEYS = ["token_cuenta", "user_cuenta", "restaurantes", "local_activo",
               "msg_swipe_der", "msg_swipe_izq"];

export function esNativo() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function _prefs() {
    return (esNativo() && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
}

export async function cargar() {
    const p = _prefs();
    for (const k of _KEYS) {
        let v = null;
        if (p) v = (await p.get({ key: k })).value;
        else   v = localStorage.getItem("emp_" + k);
        if (v !== null && v !== undefined) {
            try { _cache[k] = JSON.parse(v); } catch { _cache[k] = v; }
        }
    }
    return _cache;
}

export function get(k) { return _cache[k]; }

export async function set(k, v) {
    _cache[k] = v;
    const s = (typeof v === "string") ? v : JSON.stringify(v);
    const p = _prefs();
    if (p) await p.set({ key: k, value: s });
    else   localStorage.setItem("emp_" + k, s);
}

export async function borrar(k) {
    delete _cache[k];
    const p = _prefs();
    if (p) await p.remove({ key: k });
    else   localStorage.removeItem("emp_" + k);
}

// ── Sesión de cuenta ──────────────────────────────────────────
export function getToken() { return _cache.token_cuenta || null; }
export function getUser()  { return _cache.user_cuenta || null; }
export async function setSesion(token, user) {
    await set("token_cuenta", token);
    await set("user_cuenta", user);
}
export async function limpiarSesion() {
    for (const k of _KEYS) await borrar(k);
}
