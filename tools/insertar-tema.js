/* Inserta en el <head> de cada página el fragmento anti-parpadeo + el <link> a
 * css/tema.css.
 *
 *   node tools/insertar-tema.js            (reporte, no escribe)
 *   node tools/insertar-tema.js --escribir
 *
 * Por qué en el <head> y no inyectado desde JS: todos los <script src> están al
 * final del <body>. Como es una app multipágina donde cada clic es una
 * navegación completa, inyectar el tema desde JS produciría el fogonazo blanco
 * EN CADA CLIC. Un <link> en el <head> es render-blocking: los tokens están
 * resueltos antes del primer pintado.
 *
 * ⚠ El fragmento repite la lógica de identidad de js/tema.js (`_sub`). Si una
 *   cambia y la otra no, el tema pre-pintado y el post-carga difieren y vuelve
 *   el parpadeo. Están anotadas cruzadas a propósito.
 *
 * ⚠ Al cambiar css/tema.css hay que subir VERSION acá y volver a correr esto:
 *   GitHub Pages cachea agresivo y el repo no versiona ningún otro asset.
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const VERSION = 1;
const MARCA = "tema-boot";       // para reconocer lo ya insertado

// reserva.html queda fuera: es la página pública para comensales y tiene su
// propia paleta (vino y oro), ajena al panel.
const EXCLUIR = new Set(["reserva.html"]);

const SNIPPET =
  `<script id="${MARCA}">try{var s=localStorage.getItem('token'),k='@anon';` +
  `if(s){var p=JSON.parse(atob(s.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));` +
  `k=(p.admin_override||p.rol==='superadmin')?'@super':(p.sub||'@anon');}` +
  `var t=localStorage.getItem('tema::'+k)||localStorage.getItem('tema_ultimo')||'auto';` +
  `document.documentElement.dataset.tema=(t==='auto')` +
  `?(matchMedia('(prefers-color-scheme:dark)').matches?'oscuro':'claro'):t;}catch(e){}</script>`;

const LINK = `<link rel="stylesheet" href="css/tema.css?v=${VERSION}">`;

const escribir = process.argv.includes("--escribir");
const paginas = fs.readdirSync(RAIZ)
  .filter(f => f.endsWith(".html") && !EXCLUIR.has(f))
  .sort();

let insertadas = 0, actualizadas = 0, saltadas = 0, fallos = 0;

for (const f of paginas) {
  const ruta = path.join(RAIZ, f);
  let t = fs.readFileSync(ruta, "utf8");

  // Ya insertado: sólo se refresca el ?v= si cambió.
  if (t.includes(`id="${MARCA}"`)) {
    const nuevo = t.replace(/<link rel="stylesheet" href="css\/tema\.css\?v=\d+">/,
                            LINK);
    if (nuevo !== t) {
      if (escribir) fs.writeFileSync(ruta, nuevo);
      console.log(`  ~ ${f}  (versión de tema.css actualizada)`);
      actualizadas++;
    } else {
      saltadas++;
    }
    continue;
  }

  // Punto de inserción: justo después de </title>, que existe en las 34 páginas
  // y siempre está dentro del <head>. Insertar antes de <style> sería
  // equivalente, pero hay páginas con más de un <style>.
  const m = t.match(/([ \t]*)<\/title>\s*\r?\n/i);
  if (!m) {
    console.log(`  ✗ ${f}  SIN </title> — hay que hacerlo a mano`);
    fallos++;
    continue;
  }
  const sangria = m[1] || "";
  const bloque = `${m[0]}${sangria}${SNIPPET}\n${sangria}${LINK}\n`;
  const nuevo = t.replace(m[0], bloque);

  if (escribir) fs.writeFileSync(ruta, nuevo);
  console.log(`  + ${f}`);
  insertadas++;
}

console.log(`\n${escribir ? "ESCRITO" : "SIMULACIÓN (usá --escribir)"}`);
console.log(`  insertadas: ${insertadas}  actualizadas: ${actualizadas}` +
            `  ya estaban: ${saltadas}  fallos: ${fallos}`);
console.log(`  excluidas:  ${[...EXCLUIR].join(", ")}`);
process.exit(fallos ? 1 : 0);
