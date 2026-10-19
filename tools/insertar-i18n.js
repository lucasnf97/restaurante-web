/* Inserta <script src="js/i18n.js"> en cada página de gestión, ANTES del primer
 * <script src="js/…">: el menú (sidebar.js) se arma ni bien carga y tiene que salir
 * ya traducido.
 *
 *   node tools/insertar-i18n.js            (reporte, no escribe)
 *   node tools/insertar-i18n.js --escribir
 *
 * Las páginas públicas (QR, take away, reservas, legales, restablecer) quedan fuera:
 * tienen su propio selector de idioma y sus textos.
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const TAG = '<script src="js/i18n.js"></script>';
const escribir = process.argv.includes("--escribir");

let insertadas = 0, ya = 0, sin = 0;
for (const f of fs.readdirSync(RAIZ).filter(x => x.endsWith(".html")).sort()) {
  const ruta = path.join(RAIZ, f);
  const t = fs.readFileSync(ruta, "utf8");
  if (!/src="js\/(sidebar|api)\.js/.test(t)) { sin++; continue; }   // página pública
  if (t.includes(TAG)) { ya++; continue; }
  const i = t.search(/<script src="js\//);
  if (i < 0) { console.log("  ? " + f + " (sin <script src=js/…>)"); continue; }
  const ini = t.lastIndexOf("\n", i) + 1;
  const sangria = t.slice(ini, i);
  const nuevo = t.slice(0, ini) + sangria + TAG + "\n" + t.slice(ini);
  if (escribir) fs.writeFileSync(ruta, nuevo);
  console.log("  + " + f);
  insertadas++;
}
console.log(`${insertadas} insertadas, ${ya} ya tenían, ${sin} públicas (fuera)` + (escribir ? "" : "  — sin escribir (usar --escribir)"));
