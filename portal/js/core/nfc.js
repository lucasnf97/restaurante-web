// ── LECTURA NFC ───────────────────────────────────────────────
//
// Devuelve el UID del tag que se apoyó. Hay TRES caminos y se elige el primero que exista,
// porque ninguno funciona en todas partes:
//
//   1. PLUGIN NATIVO de Capacitor (`window.Capacitor.Plugins.NFC`). Es el único que anda en
//      iPhone: leer NFC en iOS obliga a pasar por Core NFC y muestra una hoja del sistema
//      ("Ready to Scan"). Hay que instalarlo con npm y recompilar; mientras no esté, este
//      camino simplemente no aparece.
//   2. WEB NFC (`NDEFReader`). Sólo Chrome/Android. En iOS **no existe** y no va a existir:
//      Safari no lo implementa. Dentro del WebView de Capacitor en Android suele estar, pero
//      depende de la versión del WebView, así que se prueba y si falla se cae al siguiente.
//   3. MANUAL, sólo si está activado a mano. Sirve para probar el circuito completo sin tags
//      ni plugin. ⚠ NO se activa solo nunca: si alguien pudiera tipear el UID, el tag dejaría
//      de probar presencia y toda la función sería teatro.
//
// El UID se devuelve en hex; el backend lo normaliza igual, así que no importa el formato.

const _cap = () => (window.Capacitor && window.Capacitor.Plugins) || {};

/** ¿Este teléfono puede leer un tag por alguna de las vías reales? */
export function disponible() {
    if (_cap().NFC) return true;
    if (typeof window.NDEFReader === "function") return true;
    return _manualActivado();
}

/** Modo manual: sólo para desarrollo. Se activa en la consola con
 *  `localStorage.setItem("nfc_manual", "1")` y NUNCA por defecto. */
function _manualActivado() {
    try { return localStorage.getItem("nfc_manual") === "1"; } catch (e) { return false; }
}

/** Cómo se va a leer, para poder decirlo en pantalla si hace falta diagnosticar. */
export function metodo() {
    if (_cap().NFC) return "nativo";
    if (typeof window.NDEFReader === "function") return "web";
    if (_manualActivado()) return "manual";
    return "ninguno";
}

/**
 * Espera a que se apoye un tag y devuelve su UID (string) o null si se canceló.
 * Lanza Error con un mensaje legible si algo falla.
 */
export async function leerUID({ timeoutMs = 25000 } = {}) {
    const plugin = _cap().NFC;
    if (plugin) return await _leerNativo(plugin, timeoutMs);
    if (typeof window.NDEFReader === "function") return await _leerWeb(timeoutMs);
    if (_manualActivado()) {
        const v = window.prompt("MODO PRUEBA — escribí el UID del tag (hex):", "04A2B3C4D5E680");
        return v ? v.trim() : null;
    }
    throw new Error("Este teléfono no puede leer NFC.");
}

async function _leerNativo(plugin, timeoutMs) {
    // La forma exacta depende del plugin que se instale; se aceptan las respuestas más comunes
    // para no atarse a uno solo antes de haberlo elegido.
    const r = await Promise.race([
        plugin.scan ? plugin.scan() : plugin.read(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("No se detectó ningún tag.")), timeoutMs)),
    ]);
    const uid = r && (r.id || r.uid || r.serialNumber || (r.tag && (r.tag.id || r.tag.uid)));
    if (!uid) throw new Error("Se leyó el tag pero no trajo identificador.");
    return Array.isArray(uid) ? uid.map(b => b.toString(16).padStart(2, "0")).join("") : String(uid);
}

async function _leerWeb(timeoutMs) {
    const lector = new window.NDEFReader();
    // ⚠ AbortController: sin esto el lector sigue escuchando después de salir de la pantalla y
    // el móvil vibra con cualquier tag que pase cerca, incluso fuera de la app.
    const ctrl = new AbortController();
    try {
        await lector.scan({ signal: ctrl.signal });
    } catch (e) {
        ctrl.abort();
        if (e && e.name === "NotAllowedError") {
            throw new Error("Hace falta dar permiso de NFC. Volvé a intentarlo y aceptá el aviso.");
        }
        throw new Error("No se pudo activar el lector NFC. Revisá que esté encendido en los ajustes.");
    }
    return await new Promise((resolve, reject) => {
        const fin = setTimeout(() => { ctrl.abort(); reject(new Error("No se detectó ningún tag.")); }, timeoutMs);
        lector.onreading = ev => {
            clearTimeout(fin);
            ctrl.abort();
            // `serialNumber` es el UID del chip, que es justo lo que identifica al punto.
            resolve(ev && ev.serialNumber ? String(ev.serialNumber) : null);
        };
        lector.onreadingerror = () => {
            clearTimeout(fin);
            ctrl.abort();
            reject(new Error("El tag se leyó mal. Volvé a apoyar el móvil, más quieto."));
        };
    });
}
