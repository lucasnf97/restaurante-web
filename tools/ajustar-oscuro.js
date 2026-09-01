/* Corrige los valores OSCUROS de los tokens para que cumplan contraste.
 *
 *   node tools/ajustar-oscuro.js            → reporte
 *   node tools/ajustar-oscuro.js --escribir → reescribe las semillas de generar-tokens.js
 *
 * Por qué no se hace a ojo: la auditoría encontró 154 textos por debajo de
 * 4.5:1, y 43 de ellos eran UN token (#7d8294 sobre #1b1d26 = 4.39:1). Elegir
 * "un gris un poco más claro" a ojo deja algunos justo del otro lado del umbral
 * y hay que volver a medir. Acá se calcula el valor mínimo que cumple.
 *
 * Qué exige:
 *   - texto  → 4.5:1 contra la superficie donde vive (WCAG AA)
 *   - bordes → 1.6:1, que es lo que hace falta para VER el contorno de una
 *              tarjeta. Con menos, las tarjetas flotan sin borde y es como se ve
 *              un modo oscuro a medio hacer.
 * Se preserva el tono: sólo se sube la luminosidad, así el gris azulado sigue
 * siendo un gris azulado.
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const SEMILLAS_JS = path.join(__dirname, "generar-tokens.js");

// Las superficies oscuras contra las que se mide. La mayoría del texto vive
// sobre la tarjeta (--sup); el fondo de página es más oscuro y por eso más
// permisivo, así que medir contra la tarjeta es el caso exigente.
const SUP = "#1b1d26";        // --sup oscuro
// Fondos que la auditoría encontró llevando texto blanco encima. Es el botón
// primario y su hover; el resto de los fondos de color se usan con texto oscuro
// o en insignias chicas, y oscurecerlos los ensuciaba sin motivo.
const CON_TEXTO_BLANCO = new Set(["ac", "ac-h"]);

const SUP_2 = "#22242f";      // --sup-2 oscuro (el más claro: peor caso)

const hex2rgb = h => {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const rgb2hex = ([r, g, b]) => "#" + [r, g, b]
  .map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
const lum = c => {
  const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contraste = (a, b) => {
  const L1 = lum(a), L2 = lum(b), hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
};

// Sube la luminosidad conservando el tono, hasta alcanzar el objetivo.
function aclararHasta(hex, fondoHex, objetivo) {
  let c = hex2rgb(hex);
  const f = hex2rgb(fondoHex);
  if (contraste(c, f) >= objetivo) return hex;
  for (let i = 0; i < 120; i++) {
    // Se acerca al blanco un 2% por paso: conserva la relación entre canales.
    c = c.map(v => v + (255 - v) * 0.02);
    if (contraste(c.map(Math.round), f) >= objetivo) break;
  }
  return rgb2hex(c);
}

// Baja la luminosidad conservando el tono, para que el texto que va ENCIMA
// (siempre blanco en este sistema) alcance el contraste pedido.
function oscurecerHasta(hex, textoHex, objetivo) {
  let c = hex2rgb(hex);
  const t = hex2rgb(textoHex);
  if (contraste(c, t) >= objetivo) return hex;
  for (let i = 0; i < 120; i++) {
    c = c.map(v => v * 0.98);
    if (contraste(c.map(Math.round), t) >= objetivo) break;
  }
  return rgb2hex(c);
}

const src = fs.readFileSync(SEMILLAS_JS, "utf8");
const ini = src.indexOf("const SEMILLAS = [");
const fin = src.indexOf("];", ini) + 2;
const bloque = src.slice(ini, fin);

const RE = /\["(bg|fg|bd)",\s*"(#[0-9a-fA-F]{3,6})",\s*"([\w-]+)",\s*"([^"]+)",\s*"([^"]*)"\]/g;
const cambios = [];
let nuevo = bloque.replace(RE, (todo, clase, claro, nombre, oscuro, para) => {
  if (!oscuro.startsWith("#")) return todo;           // rgba(): se deja
  // El texto sobre acento/oscuro no se mide contra la tarjeta.
  if (nombre === "tx-inv" || nombre === "on-ac" || nombre === "nav-tx") return todo;
  if (nombre.startsWith("sup") || nombre === "hoja" || nombre === "hoja-tx") return todo;

  // ⚠ Un token de FONDO no se mide como texto. Aclarar --ac lo vuelve legible
  // como texto pero empeora el BLANCO que va encima, que es el botón primario.
  // Por eso los `bg` se miden al revés: contra el blanco que llevan escrito, y
  // se OSCURECEN si hace falta. Confundir las dos cosas fue mi primer intento y
  // dejó 27 botones con texto ilegible.
  if (clase === "bg") {
    // ⚠ Sólo los que la auditoría probó que llevan texto BLANCO encima. Oscurecer
    // todos los fondos a ciegas dejaba el verde de éxito y el ámbar de aviso
    // apagados y sucios, sin que ningún caso real lo justificara: esas insignias
    // se usan con texto oscuro o son muy chicas. Que decida la medición, no yo.
    if (!CON_TEXTO_BLANCO.has(nombre)) return todo;
    const corr = oscurecerHasta(oscuro, "#ffffff", 4.5);
    if (corr.toLowerCase() === oscuro.toLowerCase()) return todo;
    const a = contraste(hex2rgb(oscuro), [255, 255, 255]);
    const b = contraste(hex2rgb(corr), [255, 255, 255]);
    cambios.push([nombre, oscuro, corr, a.toFixed(2), b.toFixed(2), "fondo"]);
    return todo.replace('"' + oscuro + '"', '"' + corr + '"');
  }

  const esBorde = clase === "bd";
  const objetivo = esBorde ? 1.6 : 4.5;
  const fondo = esBorde ? SUP : SUP_2;               // bordes contra la tarjeta; texto contra la superficie más clara
  const corregido = aclararHasta(oscuro, fondo, objetivo);
  if (corregido.toLowerCase() === oscuro.toLowerCase()) return todo;

  const antes = contraste(hex2rgb(oscuro), hex2rgb(fondo));
  const desp = contraste(hex2rgb(corregido), hex2rgb(fondo));
  cambios.push([nombre, oscuro, corregido, antes.toFixed(2), desp.toFixed(2), esBorde ? "borde" : "texto"]);
  return todo.replace('"' + oscuro + '"', '"' + corregido + '"');
});

console.log("Objetivo: texto 4.5:1 (sobre " + SUP_2 + ")   bordes 1.6:1 (sobre " + SUP + ")\n");
if (!cambios.length) console.log("  Nada que corregir.");
for (const [n, a, b, ca, cb, tipo] of cambios) {
  console.log(`  ${tipo.padEnd(6)} --${n.padEnd(10)} ${a} → ${b}   ${ca}:1 → ${cb}:1`);
}
console.log("\n  tokens corregidos: " + cambios.length);

if (process.argv.includes("--escribir")) {
  fs.writeFileSync(SEMILLAS_JS, src.slice(0, ini) + nuevo + src.slice(fin));
  console.log("  -> generar-tokens.js actualizado (correr generar-tokens.js para regenerar tema.css)");
} else {
  console.log("  (simulación — usá --escribir)");
}
