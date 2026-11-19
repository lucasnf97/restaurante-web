// ── FECHAS: helpers de calendario en hora LOCAL del dispositivo ──
// (las reglas "turnos con fecha >= hoy" y la ventana del resumen usan la
// fecha local, igual que la web)

const DIAS  = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun",
               "jul", "ago", "sep", "oct", "nov", "dic"];

export function hoyISO() { return aISO(new Date()); }

export function aISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function deISO(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
}

export function sumarDias(iso, n) {
    const d = deISO(iso);
    d.setDate(d.getDate() + n);
    return aISO(d);
}

// Lunes de la semana que contiene la fecha dada (lunes-domingo, como la web).
export function lunesDe(iso) {
    const d = deISO(iso);
    const off = (d.getDay() + 6) % 7;   // 0=lunes
    d.setDate(d.getDate() - off);
    return aISO(d);
}

// "Lun 14"
export function etiquetaDia(iso) {
    const d = deISO(iso);
    return `${DIAS[d.getDay()]} ${d.getDate()}`;
}

// "14–20 jul" / "28 jul – 3 ago"
export function etiquetaRango(desdeISO, hastaISO) {
    const a = deISO(desdeISO), b = deISO(hastaISO);
    if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MESES[a.getMonth()]}`;
    return `${a.getDate()} ${MESES[a.getMonth()]} – ${b.getDate()} ${MESES[b.getMonth()]}`;
}

// "hace 5 min" / "ayer" / "3 jul" — para feeds y mensajes.
export function haceCuanto(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return "";
    const seg = (Date.now() - d.getTime()) / 1000;
    if (seg < 60)        return "ahora";
    if (seg < 3600)      return `hace ${Math.floor(seg / 60)} min`;
    if (seg < 86400 && d.getDate() === new Date().getDate())
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (seg < 172800)    return "ayer";
    return `${d.getDate()} ${MESES[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`;
}

// "HH:MM" de un "HH:MM:SS" o Date-string.
export function hhmm(s) {
    if (!s) return "";
    return String(s).slice(0, 5);
}

// Duración neta en horas de un turno {franjas:[{inicio,fin}], break_mins}.
// Una franja con fin<=inicio cruza medianoche (+24 h).
export function horasTurno(franjas, breakMins = 0) {
    let mins = 0;
    for (const f of (franjas || [])) {
        if (!f.inicio || !f.fin) continue;
        const [hi, mi] = f.inicio.split(":").map(Number);
        const [hf, mf] = f.fin.split(":").map(Number);
        let d = (hf * 60 + mf) - (hi * 60 + mi);
        if (d <= 0) d += 1440;
        mins += d;
    }
    mins -= (breakMins || 0);
    return Math.max(0, mins) / 60;
}
