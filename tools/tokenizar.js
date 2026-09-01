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
// ⚠ `\.badge` a secas era demasiado ancho: atrapaba las insignias de
// configuracion.html, que viven sobre tarjeta CLARA, y las dejaba sin
// tokenizar. Sólo las de la barra y el menú están sobre fondo oscuro.
const SOBRE_OSCURO = /(navbar|sidebar|notif-head|notif-bubble|ui-toast|ui-overlay-box|\bcp-|btn-primary|btn-danger|btn-success|mensajes-badge|tema-)/i;

// ── Tablas por clase de propiedad ───────────────────────────────────────────
// ⚠ Tiene que normalizar IGUAL que tools/generar-tokens.js o las claves no se
// encuentran: `white` y `#ffffff` son el mismo color que `#fff`, y el mapa se
// genera con la forma corta. Ese desajuste costó 14 puntos de cobertura.
const norm = v => {
  const s = v.trim().toLowerCase().replace(/\s+/g, "");
  if (s === "white") return "#fff";
  if (/^#[0-9a-f]{6}$/.test(s)) {
    const [a, b, c, d, e, f] = s.slice(1);
    if (a === b && c === d && e === f) return "#" + a + c + e;
  }
  return s;
};

// ⚠ El mapa NO se escribe acá: lo genera tools/generar-tokens.js desde los
// colores que el repo usa de verdad, con la regla de que dos colores comparten
// token sólo si son indistinguibles. Tenerlo a mano fue el primer intento y
// consolidó 49 colores que en modo claro se veían distintos.
const MAPA_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, "tokens-mapa.json"), "utf8"));
const MAPA = MAPA_JSON.mapa;

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

// Devuelve los rangos [ini,fin) de los bloques @media print, emparejando llaves.
// ⚠ Hace falta porque saltar el <style> ENTERO cuando contiene una regla de
// impresión dejaba páginas completas sin tokenizar: a stock.html y reservas.html
// les costó ~180 reglas cada una, y en pantalla se veían íntegramente en claro.
function rangosImpresion(css) {
  const rangos = [];
  const re = /@media[^{]*\bprint\b[^{]*\{/gi;
  let m;
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length, prof = 1;
    while (i < css.length && prof > 0) {
      if (css[i] === "{") prof++;
      else if (css[i] === "}") prof--;
      i++;
    }
    rangos.push([m.index, i]);
  }
  return rangos;
}

function procesarCSS(arch, region, css) {
  const impr = rangosImpresion(css);
  const enImpresion = off => impr.some(([a, b]) => off >= a && off < b);
  return css.replace(/([-a-zA-Z]+)\s*:\s*([^;{}]+)/g, (todo, prop, valor, off) => {
    // El papel es blanco: lo de dentro de @media print se deja literal.
    if (enImpresion(off)) return todo;
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
    // ⚠ NO se saltea el bloque entero por contener un @media print: eso dejaba
    // stock.html y reservas.html íntegramente en modo claro, que era el fallo
    // más visible de todo el trabajo. procesarCSS respeta los rangos de
    // impresión por dentro.
    return `<style${attrs}>${procesarCSS(arch, "<style>", css)}</style>`;
  });

  // 1b. CSS dentro de template literals — así lo declaran js/api.js (`const css =`),
  //     js/sidebar.js y js/notificaciones.js (`style.textContent =`). Esos tres
  //     cubren 24-29 páginas cada uno, o sea que son el mayor retorno por línea
  //     tocada; buscando sólo los marcadores <style> se quedaban casi enteros
  //     sin tokenizar (notificaciones.js tenía UN token de 37 declaraciones).
  out = out.replace(/((?:const\s+\w+|[\w.]+)\s*(?:=|\+=)\s*)`([\s\S]*?)`/g, (todo, pre, cuerpo) => {
    // ⚠ Sólo si PARECE CSS: hay muchos template literals que arman HTML o texto
    // (`${_idx+1}/${_cola.length}`) y tocarlos sería estropear datos.
    const decls = (cuerpo.match(/\{[^{}]*:[^{}]*;/g) || []).length;
    if (decls < 3) return todo;
    if (esRegionImpresion(cuerpo)) {
      anotar(arch, "template CSS", "", "(bloque)", "@media print / documento", "", "impresion");
      return todo;
    }
    return pre + "`" + procesarCSS(arch, "template CSS", cuerpo) + "`";
  });

  // 2. Atributos style="..." — del markup estático y de los template literals.
  //    ⚠ Un atributo no trae selector, así que antes se saltaban TODOS los
  //    blancos y navys por ambiguos (111 casos): no se podía distinguir una
  //    superficie de una chapita blanca sobre una barra oscura. Resultado
  //    visible: la tarjeta de "Cargar nueva factura" seguía BLANCA en modo
  //    oscuro. La ambigüedad se resuelve con el TAG que envuelve al atributo,
  //    que sí trae class/id: si ese tag (o el trozo de markup inmediatamente
  //    anterior) huele a barra oscura, se sigue saltando; si no, se convierte.
  out = out.replace(/style\s*=\s*"([^"]*)"/g, (todo, decls, off, str) => {
    if (!RE_COLOR.test(decls)) return todo;
    RE_COLOR.lastIndex = 0;
    const ini = str.lastIndexOf("<", off);
    const fin = str.indexOf(">", off + todo.length);
    const tag = ini >= 0 ? str.slice(ini, fin > 0 ? fin + 1 : off + todo.length) : "";
    // Ventana previa: cubre el caso del div sin clase DENTRO de una barra.
    const previo = str.slice(Math.max(0, (ini >= 0 ? ini : off) - 400), ini >= 0 ? ini : off);
    const enOscuro = SOBRE_OSCURO.test(tag) || SOBRE_OSCURO.test(previo);
    const nuevo = decls.replace(/([-a-zA-Z]+)\s*:\s*([^;"]+)/g, (d, prop, valor) => {
      const c = clase(prop);
      if (!c) return d;
      const amb = /(white|#fff|#ffffff|#1a1a2e)/i.test(valor);
      if (amb && (c === "bg" || c === "fg") && enOscuro) {
        anotar(arch, "style=", "(tag sobre oscuro)", prop, valor.trim(), "", "sobre-oscuro");
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
