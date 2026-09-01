/* Genera el mapa de tokens del codemod y los valores CLAROS de css/tema.css a
 * partir de los colores que realmente usa el repo.
 *
 *   node tools/generar-tokens.js
 *
 * POR QUÉ EXISTE
 * --------------
 * El primer intento consolidó a ojo varios grises parecidos en un token
 * (#6b7280, #9ca3af y #d1d5db en uno solo). Medido después: 49 de esas
 * consolidaciones cambiaban el modo claro de forma PERCEPTIBLE. El encargo era
 * agregar un modo oscuro, no rediseñar el claro.
 *
 * LA REGLA
 * --------
 * Dos colores comparten token SÓLO si son perceptualmente indistinguibles
 * (distancia RGB < UMBRAL). Todo lo demás recibe token propio. Consecuencia
 * buscada: el valor claro de cada token ES el hex exacto que reemplaza, así que
 * el modo claro queda byte a byte igual y la verificación de diff cero vuelve a
 * ser posible en las DOS pasadas.
 *
 * El costo es más tokens (~55 en vez de 37). Es el costo correcto: cada uno
 * recibe un valor oscuro pensado, en vez de que cinco colores distintos caigan
 * en el mismo y se pierdan las jerarquías que el diseño ya tenía.
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const UMBRAL = 12;          // distancia RGB por debajo de la cual el ojo no separa

const hex2rgb = h => {
  h = h.replace("#", "").toLowerCase();
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const dist = (a, b) => {
  const A = hex2rgb(a), B = hex2rgb(b);
  return Math.sqrt(A.reduce((s, v, i) => s + (v - B[i]) ** 2, 0));
};
const lum = h => { const [r, g, b] = hex2rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

// ── Contraste WCAG y ajuste de luminosidad ────────────────────────────────
// Necesario para acunar tokens de los HUERFANOS (ver mas abajo): un color de
// texto que en claro se lee perfecto sobre blanco es ILEGIBLE sobre una
// superficie oscura, y hay que subirle la luminosidad SIN cambiarle el tono.
const relLum = h => {
  const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const [r, g, b] = hex2rgb(h);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contraste = (a, b) => {
  const L1 = relLum(a), L2 = relLum(b);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
};
const rgb2hsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, sat, l];
};
const hsl2hex = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let p = [0, 0, 0];
  if (h < 60) p = [c, x, 0]; else if (h < 120) p = [x, c, 0]; else if (h < 180) p = [0, c, x];
  else if (h < 240) p = [0, x, c]; else if (h < 300) p = [x, 0, c]; else p = [c, 0, x];
  return "#" + p.map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
};
// Sube la luminosidad conservando tono y saturacion hasta alcanzar `objetivo`
// de contraste contra `fondo`. Si ni el blanco alcanza, devuelve lo mas claro.
const aclararHasta = (hex, fondo, objetivo) => {
  const [h, sat] = rgb2hsl(hex2rgb(hex));
  if (contraste(hex, fondo) >= objetivo) return hex;
  let mejor = hex;
  for (let l = 0.30; l <= 0.95; l += 0.01) {
    const cand = hsl2hex(h, sat, l);
    mejor = cand;
    if (contraste(cand, fondo) >= objetivo) return cand;
  }
  return mejor;
};
// Oscurece un fondo TENIDO claro conservando su tono: un chip lila claro pasa a
// un lila oscuro, no a gris.
const oscurecerTinte = hex => {
  const [h, sat] = rgb2hsl(hex2rgb(hex));
  return hsl2hex(h, Math.min(sat, 0.45), 0.20);
};

// Superficie oscura de REFERENCIA. Es la mas CLARA de las tres habituales
// (#12131a pagina, #1b1d26 tarjeta, #242732 relleno): si el texto contrasta
// contra esta, contrasta contra las otras dos tambien.
const REF_OSCURA = "#242732";

// ── Semillas: los colores de referencia con su papel y su valor OSCURO ──────
// El valor claro NO se escribe acá: es el hex de la semilla. Sólo se decide qué
// significa cada uno y a qué se convierte en oscuro.
const SEMILLAS = [
  // clase, hex de hoy, nombre del token, valor oscuro, para qué es
  ["bg", "#f0f2f5", "sup-app",   "#12131a", "fondo de página"],
  ["bg", "#fff",     "sup",       "#1b1d26", "tarjeta, tabla, modal"],
  ["bg", "#f8f9fa",  "sup-2",     "#22242f", "relleno sutil (th, filas)"],
  ["bg", "#f3f4f6",  "sup-3",     "#242732", "relleno sutil 2"],
  ["bg", "#f0f0f0",  "sup-4",     "#2a2d39", "hover, embutido"],
  ["bg", "#1a1a2e",  "sup-inv",   "#14151f", "navbar y sidebar"],
  ["bg", "#16213e",  "sup-inv-2", "#1b1d2b", "navbar secundaria"],
  ["bg", "#eef2ff",  "ac-sf",     "rgba(99,102,241,.16)", "fondo teñido de acento"],
  ["bg", "#ede9fe",  "ac-sf-2",   "rgba(124,58,237,.18)", "fondo teñido violeta"],
  ["bg", "#fee2e2",  "pel-sf",    "rgba(239,68,68,.16)",  "fondo teñido de peligro"],
  ["bg", "#dcfce7",  "ok-sf",     "rgba(34,197,94,.16)",  "fondo teñido de éxito"],
  ["bg", "#fef3c7",  "av-sf",     "rgba(245,158,11,.16)", "fondo teñido de aviso"],
  ["bg", "#4f46e5",  "ac",        "#6164ec", "acento sólido"],
  ["bg", "#dc2626",  "pel",       "#ef4444", "peligro sólido"],
  ["bg", "#16a34a",  "ok",        "#22c55e", "éxito sólido"],
  ["bg", "#f59e0b",  "av",        "#f59e0b", "aviso sólido"],

  // ⚠ Cada gris de texto conserva SU token: #6b7280 y #9ca3af se ven distintos
  // y el diseño ya los usaba para jerarquías distintas.
  ["fg", "#1a1a2e",  "tx",        "#e8e9f0", "texto principal"],
  ["fg", "#374151",  "tx-2",      "#c3c7d4", "texto secundario"],
  ["fg", "#6b7280",  "tx-3",      "#a2a7b6", "texto terciario (gray-500)"],
  ["fg", "#9ca3af",  "tx-4",      "#868b9c", "texto apagado (gray-400)"],
  ["fg", "#888",     "tx-5",      "#878c9c", "texto apagado legacy"],
  ["fg", "#d1d5db",  "tx-6",      "#898d9d", "texto de vacío / marcador"],
  ["fg", "#666",     "tx-7",      "#b0b5c4", "texto medio legacy"],
  ["fg", "#fff",     "tx-inv",    "#fff",    "sobre acento u oscuro: NO invierte"],
  ["fg", "#4f46e5",  "tx-ac",     "#a5b4fc", "texto de acento"],
  ["fg", "#7c3aed",  "tx-ac-2",   "#c4b5fd", "texto violeta"],
  ["fg", "#a5b4fc",  "nav-tx",    "#a5b4fc", "texto sobre la barra oscura"],
  ["fg", "#b91c1c",  "pel-tx",    "#fca5a5", "texto de peligro"],
  ["fg", "#15803d",  "ok-tx",     "#6ee7a0", "texto de éxito"],
  ["fg", "#92400e",  "av-tx",     "#fcd34d", "texto de aviso"],

  ["bd", "#e5e7eb",  "bd",        "#3e414f", "borde general"],
  ["bd", "#e0e0e0",  "bd-2",      "#3b3f4e", "borde alternativo"],
  ["bd", "#d1d5db",  "bd-3",      "#3c4052", "borde de campo"],
  ["bd", "#f0f0f0",  "bd-4",      "#3f414d", "separador de fila"],
  ["bd", "#e2e8f0",  "bd-5",      "#3f424f", "borde slate"],
  ["bd", "#c7d2fe",  "ac-bd",     "rgba(129,140,248,.42)", "borde de acento"],
  ["bd", "#4f46e5",  "ac",        "#6366f1", "borde de acento fuerte"],
  ["bd", "#dc2626",  "pel",       "#ef4444", "borde de peligro"],
  ["bd", "#16a34a",  "ok",        "#22c55e", "borde de éxito"],

  // ── Segunda tanda: salieron del informe de "sueltos". Cada uno tiene papel
  //    propio y una distancia > 12 al más cercano, así que token propio.
  ["fg", "#dc2626",  "pel-tx-2",  "#f87171", "texto de peligro fuerte"],
  ["fg", "#16a34a",  "ok-tx-2",   "#4ade80", "texto de éxito fuerte"],
  ["fg", "#166534",  "ok-tx-3",   "#86efac", "texto de éxito oscuro"],
  ["fg", "#94a3b8",  "tx-8",      "#878c9e", "texto apagado slate"],
  ["fg", "#64748b",  "tx-9",      "#98a0b3", "texto medio slate"],
  ["fg", "#444",     "tx-10",     "#bfc4d1", "texto fuerte legacy"],
  ["fg", "#555",     "tx-11",     "#b6bbc9", "texto medio legacy 2"],
  ["fg", "#aaa",     "tx-12",     "#878b9c", "texto de vacío legacy"],
  ["fg", "#1f2937",  "tx-13",     "#dcdfe9", "texto principal slate"],
  ["fg", "#f59e0b",  "av-tx-2",   "#fbbf24", "texto de aviso fuerte"],
  ["bg", "#4338ca",  "ac-h",      "#656ec3", "acento en hover"],
  ["bg", "#fef2f2",  "pel-sf-2",  "rgba(239,68,68,.10)", "fondo de peligro suave"],
  ["bg", "#f0fdf4",  "ok-sf-2",   "rgba(34,197,94,.10)", "fondo de éxito suave"],
  ["bd", "#c4b5fd",  "ac-bd-2",   "rgba(167,139,250,.40)", "borde violeta"],
  ["bd", "#fecaca",  "pel-bd",    "rgba(239,68,68,.38)", "borde de peligro"],
  ["bd", "#bbf7d0",  "ok-bd",     "rgba(34,197,94,.38)", "borde de éxito"],
  ["bd", "#fde68a",  "av-bd",     "rgba(245,158,11,.38)", "borde de aviso"],
  ["bd", "#d7dbe3",  "bd-6",      "#3d404e", "borde gris azulado"],

  // ⚠ Grises que sólo estaban mapeados como BORDE y en varias páginas se usan
  //    como FONDO (pestañas de restaurantes.html, interruptores de
  //    configuracion.html). Es el mismo fallo que tenía el esqueleto de carga:
  //    sin entrada en la tabla de fondos quedaban literales y en oscuro salían
  //    como rectángulos claros.
  ["bg", "#e5e7eb",  "sup-5",     "#2e3140", "relleno gris medio (pestañas)"],
  ["bg", "#d1d5db",  "sup-6",     "#3c4052", "control apagado (interruptores)"],
];

// ── Recolectar los colores que el repo usa de verdad, por clase ─────────────
const PROP_CLASE = [
  [/^(background|background-color)$/i, "bg"],
  [/^(color|fill|caret-color)$/i, "fg"],
  [/^(border|border-top|border-right|border-bottom|border-left|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|outline|outline-color|column-rule|column-rule-color|text-decoration-color)$/i, "bd"],
];
const RE_COLOR = /#[0-9a-f]{3,8}\b|\bwhite\b/gi;
const norm = v => {
  const s = v.trim().toLowerCase();
  if (s === "white") return "#fff";
  if (/^#[0-9a-f]{6}$/.test(s)) {           // #aabbcc -> #abc si se puede
    const [a, b, c, d, e, f] = s.slice(1);
    if (a === b && c === d && e === f) return "#" + a + c + e;
  }
  return s;
};

const cuenta = { bg: {}, fg: {}, bd: {} };
const objetivos = [
  ...fs.readdirSync(RAIZ).filter(f => f.endsWith(".html") && f !== "reserva.html"),
  "js/api.js", "js/sidebar.js", "js/notificaciones.js",
];
for (const rel of objetivos) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) continue;
  const t = fs.readFileSync(abs, "utf8");
  for (const m of t.matchAll(/([-a-zA-Z]+)\s*:\s*([^;{}"']+)/g)) {
    let c = null;
    for (const [re, k] of PROP_CLASE) if (re.test(m[1])) { c = k; break; }
    if (!c) continue;
    for (const col of m[2].match(RE_COLOR) || []) {
      const n = norm(col);
      cuenta[c][n] = (cuenta[c][n] || 0) + 1;
    }
  }
}

// ── Asignar cada color a la semilla más cercana de SU clase ────────────────
const mapa = { bg: {}, fg: {}, bd: {}, sh: {} };
const tokens = new Map();      // nombre -> {claro, oscuro, para}
const huerfanos = { bg: [], fg: [], bd: [] };

for (const [clase, hex, nombre, oscuro, para] of SEMILLAS) {
  if (!tokens.has(nombre)) tokens.set(nombre, { claro: hex, oscuro, para });
  mapa[clase][norm(hex)] = "--" + nombre;
}

for (const clase of ["bg", "fg", "bd"]) {
  const semillas = SEMILLAS.filter(s => s[0] === clase);
  for (const [color, n] of Object.entries(cuenta[clase])) {
    if (mapa[clase][color]) continue;
    if (!/^#[0-9a-f]{3,6}$/.test(color)) continue;      // rgba(), gradientes: fuera
    let mejor = null, mejorD = Infinity;
    for (const s of semillas) {
      const d = dist(color, s[1]);
      if (d < mejorD) { mejorD = d; mejor = s; }
    }
    // ⚠ La regla: sólo se consolida lo perceptualmente indistinguible.
    if (mejor && mejorD < UMBRAL) {
      mapa[clase][color] = "--" + mejor[2];
    } else {
      huerfanos[clase].push([color, n, mejor ? mejor[2] : "-", Math.round(mejorD)]);
    }
  }
}

// ── Huerfanos: token propio con valor oscuro CALCULADO ─────────────────────
// ⚠ Antes se descartaban, y esa era la causa de "las letras grises no se leen":
// un color como #333 (13 usos en tablas) no cae cerca de ninguna semilla, se
// quedaba sin token, el codemod no lo tocaba y terminaba siendo #333 sobre
// #1b1d26 -> contraste 1.33, invisible. Medido en las 31 paginas: 1.034 textos
// ilegibles, y 611 de ellos eran ese unico color.
//
// El valor CLARO sigue siendo el hex exacto de hoy (el modo claro no se mueve).
// Solo se decide el oscuro, y por regla, no a ojo:
//   fg  -> se aclara conservando el tono hasta REPRODUCIR el contraste que ese
//          color tenia en claro sobre blanco. Apuntar solo a 4.5:1 no alcanza:
//          #333 es texto PRINCIPAL (12.6:1 sobre blanco) y con 4.5 quedaba en
//          un gris medio, que es exactamente de lo que se quejo el dueno. Se
//          acota a [4.5, 13] para que nada quede ilegible ni deslumbre.
//   bd  -> se aclara hasta 1.6:1 (un borde solo tiene que VERSE).
//   bg  -> si es un tinte claro (luminancia alta) se oscurece conservando el
//          tono; si es un color saturado de estado (verde, rojo) se deja igual,
//          porque en oscuro sigue funcionando y cambiarlo rompe el significado.
const OBJ_BD = 1.6;
const objetivoFg = color => Math.min(13, Math.max(4.5, contraste(color, "#fff")));
for (const clase of ["fg", "bd", "bg"]) {
  // Orden estable por hex: los nombres generados no bailan entre corridas.
  const lista = huerfanos[clase].slice().sort((a, b) => a[0].localeCompare(b[0]));
  let i = 0;
  for (const [color, n] of lista) {
    i++;
    const nombre = clase + "-a" + i;
    let oscuro;
    if (clase === "bg") {
      oscuro = relLum(color) > 0.55 ? oscurecerTinte(color) : color;
    } else {
      oscuro = aclararHasta(color, REF_OSCURA,
                            clase === "fg" ? objetivoFg(color) : OBJ_BD);
    }
    tokens.set(nombre, { claro: color, oscuro,
      para: "auto (" + n + " usos" + (clase === "bg" && oscuro === color ? ", se deja igual" : "") + ")" });
    mapa[clase][color] = "--" + nombre;
  }
}

// Sombras: por valor completo.
mapa.sh = {
  "02px8pxrgba(0,0,0,0.06)": "--sh-1", "02px8pxrgba(0,0,0,.06)": "--sh-1",
  "08px24pxrgba(0,0,0,.22)": "--sh-2", "08px24pxrgba(0,0,0,0.22)": "--sh-2",
  "018px60pxrgba(0,0,0,.35)": "--sh-3", "018px60pxrgba(0,0,0,0.35)": "--sh-3",
};
tokens.set("sh-1", { claro: "0 2px 8px rgba(0,0,0,0.06)", oscuro: "0 2px 8px rgba(0,0,0,.5)", para: "tarjeta" });
tokens.set("sh-2", { claro: "0 8px 24px rgba(0,0,0,.22)", oscuro: "0 8px 24px rgba(0,0,0,.6)", para: "flotante" });
tokens.set("sh-3", { claro: "0 18px 60px rgba(0,0,0,.35)", oscuro: "0 18px 60px rgba(0,0,0,.7)", para: "modal" });
tokens.set("scrim", { claro: "rgba(0,0,0,.35)", oscuro: "rgba(0,0,0,.6)", para: "velo del modal" });
tokens.set("on-ac", { claro: "#fff", oscuro: "#fff", para: "texto sobre acento" });
tokens.set("nav-hov", { claro: "rgba(99,102,241,.18)", oscuro: "rgba(129,140,248,.22)", para: "hover del menú" });
tokens.set("hoja", { claro: "#fff", oscuro: "#fff", para: "islas que quedan claras" });
tokens.set("hoja-tx", { claro: "#16171e", oscuro: "#16171e", para: "texto de la hoja" });
tokens.set("hoja-tx-2", { claro: "#666", oscuro: "#666", para: "texto secundario de la hoja" });

fs.writeFileSync(path.join(__dirname, "tokens-mapa.json"),
  JSON.stringify({ umbral: UMBRAL, mapa, tokens: Object.fromEntries(tokens) }, null, 2));

// ── Informe ────────────────────────────────────────────────────────────────
let cubiertas = 0, sueltas = 0;
for (const c of ["bg", "fg", "bd"]) {
  for (const [col, n] of Object.entries(cuenta[c])) {
    if (mapa[c][col]) cubiertas += n; else sueltas += n;
  }
}
console.log("Tokens generados: " + tokens.size);
console.log("Umbral de consolidación: distancia RGB < " + UMBRAL + " (imperceptible)");
console.log("");
console.log("  ocurrencias cubiertas : " + cubiertas);
console.log("  ocurrencias sueltas   : " + sueltas +
            "  (" + (sueltas * 100 / (cubiertas + sueltas)).toFixed(1) + "%)");
console.log("\n  Colores sueltos más frecuentes (cola larga, quedan literales):");
const todos = [].concat(...["bg", "fg", "bd"].map(c => huerfanos[c].map(h => [c, ...h])));
todos.sort((a, b) => b[2] - a[2]).slice(0, 12)
  .forEach(([c, col, n, cerca, d]) => console.log(
    `    ${String(n).padStart(4)}  ${c}  ${col.padEnd(9)} (lo más cercano: --${cerca}, dist ${d})`));
console.log("\n  -> tools/tokens-mapa.json");

// ── Emitir css/tema.css ────────────────────────────────────────────────────
// Se GENERA y no se escribe a mano: así el valor claro de cada token es, por
// construcción, el hex exacto que reemplaza. Es lo único que hace posible exigir
// diff cero también en la pasada con tema.css cargado.
{
  const orden = [...tokens.entries()];
  const linea = (n, v) => `  --${n}:${" ".repeat(Math.max(1, 13 - n.length))}${v};`;
  let out = `/* ══════════════════════════════════════════════════════════════════════════
   TEMA — claro / oscuro, por usuario

   ⚠ ARCHIVO GENERADO por tools/generar-tokens.js. No editar a mano: se pisa.
     Para cambiar un color, tocá la tabla SEMILLAS de ese script y volvé a
     correrlo. Y subí el ?v= de tools/insertar-tema.js.

   Los valores CLAROS son el hex EXACTO que hoy tienen las páginas: por eso el
   modo claro queda byte a byte igual y el arnés puede exigir diff cero.
   Dos colores comparten token SÓLO si son indistinguibles (distancia RGB < ${UMBRAL}).
   Un intento anterior consolidó a ojo y cambió 49 colores del modo claro de
   forma perceptible — el encargo era agregar un oscuro, no rediseñar el claro.

   ⚠ Sin @media prefers-color-scheme a propósito: el "modo navegador" se resuelve
     en JS a claro/oscuro concreto, así que data-tema siempre tiene un valor y
     hay un solo camino de código.
   ══════════════════════════════════════════════════════════════════════════ */

:root,
:root[data-tema="claro"] {
  color-scheme: light;
`;
  for (const [n, d] of orden) out += linea(n, d.claro) + (d.para ? `   /* ${d.para} */` : "") + "\n";
  out += `}\n\n:root[data-tema="oscuro"] {\n  color-scheme: dark;\n`;
  for (const [n, d] of orden) out += linea(n, d.oscuro) + "\n";
  out += "}\n";

  out += `
/* ── La hoja ──────────────────────────────────────────────────────────────
   Islas que NO se portan a oscuro: comprobantes y tickets en iframe, gráficos,
   editor de texto, canvas de reservas. En vez de dejar un rectángulo blanco
   suelto que parece un fallo, se enmarcan como un documento sobre un escritorio.
   ⚠ color-scheme:light es obligatorio en los iframes: sin eso Chrome puede
     aplicar su heurística de inversión y arruinar un comprobante.           */
.hoja { background: var(--hoja); color: var(--hoja-tx); border: 1px solid var(--bd);
        border-radius: 10px; box-shadow: var(--sh-1); color-scheme: light; }
.hoja iframe { color-scheme: light; background: #fff; }

/* ⚠ SIN BACKTICKS en estos comentarios: todo este bloque vive dentro de un
   template literal y un backtick lo cierra a la mitad.

   Las islas concretas, enmarcadas sin tocar el marcado de seis páginas — así
   cubre también lo que se inserta dinámicamente (el visor de comprobantes y los
   gráficos que se arman por JS).

   ⚠ Los CANVAS no heredan CSS para lo que dibujan por dentro: Chart.js y el
   timeline de reservas pintan con colores fijos en JavaScript. Portarlos a
   oscuro es reescribir su lógica de color, y se decidió dejarlos claros. El
   fondo blanco del CSS es lo que hace que ese dibujo se lea. */
:root[data-tema="oscuro"] iframe,
:root[data-tema="oscuro"] .chart-box,
:root[data-tema="oscuro"] .grid-outer,
:root[data-tema="oscuro"] canvas[id$="-canvas"]:not(#grid-canvas):not(#canvas-time):not(#camara-canvas),
:root[data-tema="oscuro"] #quill-toolbar,
:root[data-tema="oscuro"] #quill-editor,
:root[data-tema="oscuro"] .ql-toolbar,
:root[data-tema="oscuro"] .ql-container {
  background: var(--hoja);
  color: var(--hoja-tx);
  border-color: var(--bd);
  color-scheme: light;
}
/* ⚠ El redondeo va sólo en el contenedor de reservas y en los gráficos: un
   iframe de ticket con esquinas redondeadas recorta el comprobante. */
:root[data-tema="oscuro"] .chart-box,
:root[data-tema="oscuro"] .grid-outer { border-radius: 10px; padding: 6px; }

/* El editor de texto: lo que se escribe ahí se guarda con colores propios, así
   que una descripción escrita en claro quedaría negro sobre oscuro. Por eso el
   contenido del usuario se muestra SIEMPRE sobre hoja clara. */
:root[data-tema="oscuro"] .ql-editor { color: var(--hoja-tx); }
:root[data-tema="oscuro"] .ql-editor.ql-blank::before { color: #9ca3af; }
:root[data-tema="oscuro"] .ql-stroke { stroke: #444; }
:root[data-tema="oscuro"] .ql-fill { fill: #444; }
:root[data-tema="oscuro"] .ql-picker-label { color: #444; }

/* ⚠ NO hay regla para el logo del cliente. Lo sube el restaurante y puede traer
   fondo blanco, pero vive en la barra superior, que es OSCURA en los dos temas:
   su contexto no cambia, así que darle un chip sólo en oscuro lo haría verse
   distinto entre temas sin motivo. Si algún día ese logo va a una superficie
   clara, ahí sí hará falta.                                                  */
.marca-oscuro { display: none; }
:root[data-tema="oscuro"] .marca-claro  { display: none; }
:root[data-tema="oscuro"] .marca-oscuro { display: inline; }

/* ── IMPRESIÓN ────────────────────────────────────────────────────────────
   El papel es blanco. Redeclarar TODOS los tokens con sus valores claros
   resuelve de una vez los @media print de las páginas y cualquier impresión.
   ⚠ El selector repite [data-tema="oscuro"] para igualar especificidad y ganar
     por orden de aparición; con :root a secas perdería. Va AL FINAL por eso.  */
@media print {
  :root,
  :root[data-tema="claro"],
  :root[data-tema="oscuro"] {
    color-scheme: light;
`;
  for (const [n, d] of orden) {
    const v = n.startsWith("sh-") ? "none" : (n === "scrim" ? "transparent" : d.claro);
    out += "  " + linea(n, v) + "\n";
  }
  out += "  }\n}\n";

  fs.writeFileSync(path.join(RAIZ, "css", "tema.css"), out, "utf8");
  console.log("  -> css/tema.css  (" + orden.length + " tokens, GENERADO)");
}
