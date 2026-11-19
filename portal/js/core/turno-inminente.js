// ── SALTO AUTOMÁTICO A FICHAR ─────────────────────────────────
//
// Si abrís la app cerca de la hora de un turno asignado y todavía no fichaste, se va sola a la
// pantalla de Fichar. La idea es que no haya que buscar nada: abrís, apoyás y listo.
//
// ⚠ Se resuelve AL ABRIR LA APP y no con una notificación push a propósito. Una notificación
// necesita un plugin nativo, permisos que la gente niega, y programarla de nuevo cada vez que
// cambia el cuadrante. Esto no necesita nada de eso y cubre el caso real: el que llega al
// trabajo saca el móvil.
import { apiCuenta } from "./api.js";

//: Cuánto antes del turno se ofrece fichar.
const ANTES_MIN = 10;
//: Y hasta cuánto después. Llegar 20 min tarde y que la app ya no te ofrezca fichar sería
//: justo cuando más falta hace.
const DESPUES_MIN = 45;

function _hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * ¿Hay un turno asignado que empiece dentro de la ventana? Devuelve el turno o null.
 * Nunca lanza: esto corre en el arranque y un fallo acá no puede impedir entrar a la app.
 */
export async function turnoInminente() {
    try {
        const hoy = _hoyISO();
        const turnos = await apiCuenta.getSilent(`/empleado/horarios?desde=${hoy}&hasta=${hoy}`) || [];
        const ahora = new Date();
        for (const t of turnos) {
            for (const f of (t.franjas || [])) {
                const [h, m] = String(f.inicio || "").split(":").map(Number);
                if (isNaN(h)) continue;
                const inicio = new Date(ahora);
                inicio.setHours(h, m || 0, 0, 0);
                const diffMin = (inicio - ahora) / 60000;
                if (diffMin <= ANTES_MIN && diffMin >= -DESPUES_MIN) {
                    return { fecha: t.fecha, inicio: f.inicio, restaurante_id: t.restaurante_id };
                }
            }
        }
    } catch (e) { /* sin red, sin horarios: se entra normal */ }
    return null;
}

/**
 * Decide si al abrir hay que ir a Fichar. Sólo si hay turno inminente Y no está fichado ya.
 * ⚠ Una vez por arranque: si saltara en cada navegación, no se podría salir de la pantalla.
 */
let _yaSalto = false;

export async function debeIrAFichar() {
    if (_yaSalto) return false;
    _yaSalto = true;
    const t = await turnoInminente();
    if (!t) return false;
    try {
        // Si ya está fichado no molesta. Se usa el agregado de cuenta para no tener que
        // resolver antes en qué local está.
        const est = await apiCuenta.getSilent("/empleado/fichaje-estado");
        if (est && est.fichado) return false;
    } catch (e) { /* si no se puede saber, se ofrece igual: fichar de más no rompe nada */ }
    return true;
}
