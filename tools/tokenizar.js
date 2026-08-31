/* Codemod: convierte los colores literales en tokens de tema.
 *
 *   node tools/tokenizar.js              → reporte (NO escribe) + tools/tokenizar-reporte.csv
 *   node tools/tokenizar.js --escribir
 *
 * LA IDEA CENTRAL
 * ---------------
 * No se mapean COLORES, se mapean DECLARACIONES. El mismo #9ca3af es texto
 * apagado en `color:` y borde en `border-color:`; en oscuro esos dos se invierten
 * distinto. Por eso cada propiedad se clasifica en bg / fg / bd / sh y se busca
 * en una tabla propia. Sin eso no hay forma de desambiguar sin leer cada caso.
 *
 * SIEMPRE se escribe `var(--token, #hexOriginal)`. El respaldo no es paranoia:
 * si css/tema.css diera 404 en Pages, la web se ve como hoy en vez de quedar
 * blanco sobre blanco. Y es lo que permite verificar con diff cero.
 *
 * NO es un build step: se corre una vez y se commitea el resultado.
 * No se puede usar PostCSS: el CSS vive dentro de <style> en HTML, dentro de
 * template literals con ${} y en atributos style=. Un parser de CSS se ahoga.
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const CSV = path.join(__dirname, "tokenizar-reporte.csv");

// ── Regiones que NO se tocan ────────────────────────────────────────────────
// reserva.html es la página pública para comensales y tiene su propia paleta
// (vino y oro), ajena al panel.
const ARCHIVOS_EXCLUIDOS = new Set(["reserva.html"]);

// ⚠ Selectores donde un fondo blanco es blanco A PROPÓSITO porque vive DENTRO de
// una barra oscura. Invertirlos los rompería. Se saltan y se listan.
const SOBRE_OSCURO = /(navbar|sidebar|notif-head|notif-bubble|ui-toast|ui-overlay-box|\bcp-|btn-primary|btn-danger|btn-success|\.badge|tema-)/i;

// ── Tablas por clase de propiedad ───────────────────────────────────────────
const norm = v => v.trim().toLowerCase().replace(/\s+/g, "");

const MAPA = {
  bg: {
    "#f0f2f5": "--sup-app", "#f4f5fb": "--sup-app",
    "white": "--sup", "#fff": "--sup", "#ffffff": "--sup",
    "#f8f9fa": "--sup-2", "#fafafa": "--sup-2", "#f9fafb": "--sup-2",
    "#f3f4f6": "--sup-2", "#f8fafc": "--sup-2",
    "#f0f0f0": "--sup-3", "#f1f5f9": "--sup-3",
    "#1a1a2e": "--sup-inv", "#16213e": "--sup-inv-2",
    "#4f46e5": "--ac", "#4338ca": "--ac-h",
    "#eef2ff": "--ac-sf", "#ede9fe": "--ac-sf", "#f5f3ff": "--ac-sf",
    "#faf5ff": "--ac-sf", "#eff6ff": "--ac-sf", "#e0e7ff": "--ac-sf",
    "#6366f1": "--ac", "#22c55e": "--ok", "#ef4444": "--pel",
    "#dc2626": "--pel", "#fee2e2": "--pel-sf", "#fef2f2": "--pel-sf",
    "#16a34a": "--ok", "#dcfce7": "--ok-sf", "#f0fdf4": "--ok-sf",
    "#f59e0b": "--av", "#fef3c7": "--av-sf",
  },
  fg: {
    "#1a1a2e": "--tx", "#111827": "--tx", "#1f2937": "--tx", "#333": "--tx",
    "#222": "--tx", "#1e293b": "--tx",
    "#374151": "--tx-2", "#4b5563": "--tx-2", "#555": "--tx-2",
    "#666": "--tx-2", "#444": "--tx-2",
    "#9ca3af": "--tx-3", "#6b7280": "--tx-3", "#888": "--tx-3",
    "#999": "--tx-3", "#94a3b8": "--tx-3", "#64748b": "--tx-3",
    // Grises claros usados como texto de vacío/marcador (.tbl-empty, .nota-empty,
    // .asig-none): verificado que están sobre superficie CLARA, no sobre la barra.
    "#aaa": "--tx-3", "#d1d5db": "--tx-3", "#cbd5e1": "--tx-3", "#bbb": "--tx-3",
    "#475569": "--tx-2", "#334155": "--tx-2",
    // ⚠ NO se invierte: la mayoría de estos son texto sobre navbar o botón.
    "white": "--tx-inv", "#fff": "--tx-inv", "#ffffff": "--tx-inv",
    "#4f46e5": "--tx-acc", "#6366f1": "--tx-acc",
    // Toda la familia violeta se usa como acento de texto.
    "#4338ca": "--tx-acc", "#3730a3": "--tx-acc",
    "#7c3aed": "--tx-acc", "#6d28d9": "--tx-acc", "#5b21b6": "--tx-acc",
    "#a5b4fc": "--nav-tx", "#c4b5fd": "--nav-tx",
    "#dc2626": "--pel-tx", "#b91c1c": "--pel-tx",
    "#16a34a": "--ok-tx", "#15803d": "--ok-tx", "#166534": "--ok-tx",
    "#92400e": "--av-tx", "#b45309": "--av-tx", "#d97706": "--av-tx",
    "#a16207": "--av-tx", "#854d0e": "--av-tx",
  },
  bd: {
    "#e5e7eb": "--bd", "#e0e0e0": "--bd", "#eee": "--bd",
    "#ddd": "--bd", "#e2e8f0": "--bd",
    "#d1d5db": "--bd-2", "#cbd5e1": "--bd-2", "#ccc": "--bd-2", "#9ca3af": "--bd-2",
    "#f0f0f0": "--bd-3", "#f3f4f6": "--bd-3",
    "#4f46e5": "--ac", "#6366f1": "--ac",
    "#c4b5fd": "--ac-bd", "#c7d2fe": "--ac-bd", "#a5b4fc": "--ac-bd",
    "#d7dbe3": "--bd", "#eef0f3": "--bd-3", "#f1f5f9": "--bd-3",
    "#dc2626": "--pel", "#16a34a": "--ok", "#f59e0b": "--av",
  },
  // Las sombras se matchean por VALOR COMPLETO, no por el color de adentro:
  // el token lleva también el desplazamiento y el desenfoque.
  sh: {
    "02px8pxrgba(0,0,0,0.06)": "--sh-1",
    "02px8pxrgba(0,0,0,.06)": "--sh-1",
    "08px24pxrgba(0,0,0,.22)": "--sh-2",
    "08px24pxrgba(0,0,0,0.22)": "--sh-2",
    "018px60pxrgba(0,0,0,.35)": "--sh-3",
    "018px60pxrgba(0,0,0,0.35)": "--sh-3",
  },
};

const PROP_CLASE = [
  [/^(background|background-color)$/i, "bg"],
  [/^(color|fill|caret-color|-webkit-text-fill-color)$/i, "fg"],
  [/^(border|border-top|border-right|border-bottom|border-left|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|outline|outline-color|column-rule|column-rule-color|text-decoration-color)$/i, "bd"],
  [/^(box-shadow|text-shadow)$/i, "sh"],
];
function clase(prop) {
  for (const [re, c] of PROP_CLASE) if (re.test(prop)) return c;
  return null;
}

const RE_COLOR = /#[0-9a-f]{3,8}\b|\bwhite\b|\bblack\b/gi;

// ── Reporte ────────────────────────────────────────────────────────────────
const filas = [];
let convertidas = 0, saltadas = 0;
function anotar(arch, region, sel, prop, valor, token, decision) {
  filas.push([arch, region, (sel || "").slice(0, 60), prop, valor, token || "", decision]);
  if (decision === "convertido") convertidas++; else saltadas++;
}

// ── Núcleo: convertir una declaración ──────────────────────────────────────
function convertirDecl(arch, region, sel, prop, valor) {
  const c = clase(prop);
  if (!c) { return null; }
  if (valor.includes("var(--")) return null;              // idempotente

  // Sombras: valor completo.
  if (c === "sh") {
    const tok = MAPA.sh[norm(valor)];
    if (!tok) { anotar(arch, region, sel, prop, valor.trim(), "", "sin-mapa"); return null; }
    anotar(arch, region, sel, prop, valor.trim(), tok, "convertido");
    return `var(${tok}, ${valor.trim()})`;
  }

  // ⚠ Sobre barra oscura, un fondo o un texto blanco es intencional.
  if (SOBRE_OSCURO.test(sel || "") && (c === "bg" || c === "fg")) {
    const hay = (valor.match(RE_COLOR) || []).length;
    if (hay) anotar(arch, region, sel, prop, valor.trim(), "", "sobre-oscuro");
    return null;
  }

  let cambio = false;
  const nuevo = valor.replace(RE_COLOR, m => {
    const tok = MAPA[c][norm(m)];
    if (!tok) { anotar(arch, region, sel, prop, m, "", "sin-mapa"); return m; }
    anotar(arch, region, sel, prop, m, tok, "convertido");
    cambio = true;
    return `var(${tok}, ${m})`;
  });
  return cambio ? nuevo : null;
}

// ── Segmentación ───────────────────────────────────────────────────────────
// Un template literal que arma un DOCUMENTO ENTERO es una ventana de impresión
// (los 7 window.open y 3 document.write). Deben quedar CLAROS: se saltan.
function esRegionImpresion(txt) {
  return /<!doctype|<html[\s>]|@media\s+print/i.test(txt);
}

function selectorDe(texto, pos) {
  // Hacia atrás hasta la última "{" y desde ahí hasta el "}" o ";" anterior.
  const llave = texto.lastIndexOf("{", pos);
  if (llave < 0) return "";
  const corte = Math.max(texto.lastIndexOf("}", llave), texto.lastIndexOf(";", llave),
                         texto.lastIndexOf("*/", llave));
  return texto.slice(corte + 1, llave).replace(/\s+/g, " ").trim();
}

function procesarCSS(arch, region, css) {
  return css.replace(/([-a-zA-Z]+)\s*:\s*([^;{}]+)/g, (todo, prop, valor, off) => {
    const sel = selectorDe(css, off);
    const nuevo = convertirDecl(arch, region, sel, prop, valor);
    return nuevo === null ? todo : `${prop}: ${nuevo}`;
  });
}

function procesarArchivo(arch, texto) {
  let out = texto;

  // 1. Bloques <style> — incluye el de ventas-estadisticas.html:721, que vive
  //    dentro de un template literal: el marcador sobre texto crudo lo captura.
  out = out.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (todo, attrs, css) => {
    if (esRegionImpresion(css)) {
      anotar(arch, "<style>", "", "(bloque)", "@media print / documento", "", "impresion");
      return todo;
    }
    return `<style${attrs}>${procesarCSS(arch, "<style>", css)}</style>`;
  });

  // 2. Atributos style="..." — del markup estático y de los template literals.
  //    ⚠ Sin selector no se puede saber si un blanco es "superficie" o "sobre
  //    oscuro". Por eso acá se usa un mapa RECORTADO: se saltan los ambiguos.
  out = out.replace(/style\s*=\s*"([^"]*)"/g, (todo, decls) => {
    if (!RE_COLOR.test(decls)) return todo;
    RE_COLOR.lastIndex = 0;
    const nuevo = decls.replace(/([-a-zA-Z]+)\s*:\s*([^;"]+)/g, (d, prop, valor) => {
      const c = clase(prop);
      if (!c) return d;
      const amb = /(white|#fff|#ffffff|#1a1a2e)/i.test(valor);
      if (amb && (c === "bg" || c === "fg")) {
        anotar(arch, "style=", "(sin selector)", prop, valor.trim(), "", "ambiguo-sin-selector");
        return d;
      }
      const n = convertirDecl(arch, "style=", "", prop, valor);
      return n === null ? d : `${prop}: ${n}`;
    });
    return `style="${nuevo}"`;
  });

  return out;
}

// ── Ejecución ──────────────────────────────────────────────────────────────
const escribir = process.argv.includes("--escribir");
const objetivos = [
  ...fs.readdirSync(RAIZ).filter(f => f.endsWith(".html") && !ARCHIVOS_EXCLUIDOS.has(f))
      .map(f => ({ rel: f, abs: path.join(RAIZ, f) })),
  ...["api.js", "sidebar.js", "notificaciones.js"].map(f =>
      ({ rel: "js/" + f, abs: path.join(RAIZ, "js", f) })),
].filter(o => fs.existsSync(o.abs));

let tocados = 0;
for (const o of objetivos) {
  const antes = fs.readFileSync(o.abs, "utf8");
  const despues = procesarArchivo(o.rel, antes);
  if (despues !== antes) {
    tocados++;
    if (escribir) fs.writeFileSync(o.abs, despues);
  }
}

// CSV para revisar ANTES de escribir. De acá sale también la lista literal de
// cadenas que hay que cubrir a mano en la fase siguiente.
const esc = s => `"${String(s).replace(/"/g, '""')}"`;
fs.writeFileSync(CSV,
  "archivo,region,selector,propiedad,valor,token,decision\n" +
  filas.map(f => f.map(esc).join(",")).join("\n"), "utf8");

const porDecision = {};
for (const f of filas) porDecision[f[6]] = (porDecision[f[6]] || 0) + 1;

console.log(escribir ? "ESCRITO\n" : "SIMULACIÓN — no se escribió nada (usá --escribir)\n");
console.log(`  archivos analizados : ${objetivos.length}`);
console.log(`  archivos que cambian: ${tocados}`);
console.log(`  declaraciones vistas: ${filas.length}`);
console.log("");
for (const [d, n] of Object.entries(porDecision).sort((a, b) => b[1] - a[1])) {
  const pct = (n * 100 / filas.length).toFixed(1);
  console.log(`  ${d.padEnd(22)} ${String(n).padStart(5)}  ${pct.padStart(5)}%`);
}
console.log(`\n  reporte: ${path.relative(RAIZ, CSV)}`);
