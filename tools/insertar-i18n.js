/* Inserta en cada página de gestión, ANTES del primer <script src="js/…">:
 *   <script src="js/i18n.js"></script>             el motor (menú y barra salen traducidos)
 *   <script src="js/i18n/comun.js"></script>       el diccionario común
 *   <script src="js/i18n/<página>.js"></script>    el de la página, si existe
 *
 *   node tools/insertar-i18n.js            (reporte, no escribe)
 *   node tools/insertar-i18n.js --escribir
 *
 * Es idempotente: se puede volver a correr cada vez que se crea el diccionario de una página.
 * Las páginas públicas (QR, take away, reservas, legales, restablecer) quedan fuera: tienen
 * su propio selector de idioma y sus textos.
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const escribir = process.argv.includes("--escribir");
const tag = (src) => `<script src="${src}"></script>`;

let cambiadas = 0, iguales = 0, publicas = 0;
for (const f of fs.readdirSync(RAIZ).filter(x => x.endsWith(".html")).sort()) {
  const ruta = path.join(RAIZ, f);
  const t = fs.readFileSync(ruta, "utf8");
  if (!/src="js\/(sidebar|api)\.js/.test(t)) { publicas++; continue; }
  const quiero = ["js/i18n.js", "js/i18n/comun.js"];
  const dic = "js/i18n/" + f.replace(/\.html$/, ".js");
  if (fs.existsSync(path.join(RAIZ, dic))) quiero.push(dic);
  // Saca lo que hubiera de i18n y lo vuelve a poner completo antes del primer script de js/.
  let limpio = t.replace(/^[ \t]*<script src="js\/i18n(\/[\w-]+)?\.js"><\/script>\r?\n/gm, "");
  const i = limpio.search(/<script src="js\//);
  if (i < 0) { console.log("  ? " + f + " (sin <script src=js/…>)"); continue; }
  const ini = limpio.lastIndexOf("\n", i) + 1;
  const sangria = limpio.slice(ini, i);
  const nuevo = limpio.slice(0, ini) + quiero.map(s => sangria + tag(s) + "\n").join("") + limpio.slice(ini);
  if (nuevo === t) { iguales++; continue; }
  if (escribir) fs.writeFileSync(ruta, nuevo);
  console.log("  ~ " + f + "  (" + quiero.slice(1).join(", ") + ")");
  cambiadas++;
}
console.log(`${cambiadas} cambiadas, ${iguales} ya estaban, ${publicas} públicas (fuera)` + (escribir ? "" : "  — sin escribir (usar --escribir)"));
