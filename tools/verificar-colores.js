/* Arnés de verificación del codemod de tema.
 *
 *   node tools/verificar-colores.js --guardar base      (antes del codemod)
 *   node tools/verificar-colores.js --comparar base     (después)
 *   node tools/verificar-colores.js --comparar base --sin-tema
 *
 * QUÉ COMPARA Y POR QUÉ
 * ---------------------
 * Vuelca los ESTILOS COMPUTADOS de todos los elementos de cada página y los
 * compara. No compara píxeles a propósito: una captura de pantalla se rompe por
 * fuentes, antialiasing, animaciones y datos que cambian entre corridas, y
 * ninguna de esas cosas es lo que el codemod puede romper. Los estilos
 * computados detectan exactamente la clase de fallo que introduce un
 * reemplazo masivo de colores, y nada más.
 *
 * LA GARANTÍA
 * -----------
 * El codemod escribe `var(--token, #hexOriginal)` y los valores CLAROS de
 * css/tema.css son el hex exacto de antes. Por lo tanto, en modo claro el
 * resultado computado tiene que ser IDÉNTICO. Se corre dos veces:
 *
 *   1. --sin-tema  → sin css/tema.css. Prueba que TODOS los respaldos
 *                    `var(--x, #hex)` son correctos. Es el caso que ocurre de
 *                    verdad si la hoja da 404 en Pages.
 *   2. (normal)    → con css/tema.css y data-tema="claro". Prueba que todos los
 *                    valores claros de los tokens son correctos.
 *
 * Las dos con diff CERO cubren el 100 % del riesgo mecánico. Lo que NO cubren es
 * si el modo oscuro se ve bien: eso es caminata manual, no hay atajo.
 *
 * REQUISITOS
 *   npm i puppeteer-core     (usa el Chrome del sistema; no descarga navegador)
 *   Se puede pasar la ruta con  CHROME=... node tools/verificar-colores.js ...
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const RAIZ = path.resolve(__dirname, "..");
const SALIDA = path.join(__dirname, ".instantaneas");

const CHROMES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].filter(Boolean);

// Las ~10 propiedades donde vive el color. Volcar TODAS las propiedades
// computadas daría 300 por elemento y haría el diff ilegible sin agregar señal.
const PROPS = [
  "color", "background-color", "background-image",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "outline-color", "box-shadow", "text-shadow", "fill", "stroke", "caret-color",
];

// Sesión falsa: las páginas redirigen al login sin token. No se valida contra el
// backend — sólo tiene que existir y parsear, para que requireAuth() no expulse.
function tokenFalso(rol) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64({ alg: "HS256", typ: "JWT" }) + "." + b64({
    sub: "verificador", rol: rol || "admin", schema: "r_0000",
    exp: 4102444800,        // 2100-01-01: no expira durante la corrida
  }) + ".firma-de-mentira";
}

const USUARIO = {
  id: 1, username: "verificador", rol: "admin", nombre_display: "Verificador",
  modulos: null, pantalla_default: "dashboard",
};

// ⚠ Algunas páginas se expulsan solas si el rol no encaja. restaurantes.html
// hace `alert()` + redirect a index.html cuando el rol no es superadmin — y en
// headless el alert bloquea la navegación hasta el timeout. Sin este mapa esa
// página quedaría sin línea base, que es justo lo que la vuelve inverificable.
const ROL_POR_PAGINA = {
  "restaurantes.html":     "superadmin",
  "cadena.html":           "gerente_cadena",
  "cadena-personal.html":  "gerente_cadena",
};

// ⚠ Estas se visitan SIN sesión, o no se verifican nunca: index.html redirige al
// panel en cuanto hay token, así que con sesión el arnés fotografiaba
// dashboard.html bajo el nombre "index.html" — el login no se comprobaba y el
// diff mentía. El resto son páginas públicas que tampoco necesitan sesión.
const SIN_SESION = new Set([
  "index.html", "terminos.html", "privacidad.html", "restablecer.html", "reserva.html",
]);

// Distancia RGB entre dos valores computados, para la comparación con
// tolerancia. Si alguno no es un color parseable, devuelve Infinity y se
// reporta: no se puede afirmar que "no se movió" algo que no se sabe leer.
function rgbDe(v) {
  const m = String(v).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function distancia(a, b) {
  const A = rgbDe(a), B = rgbDe(b);
  if (!A || !B) return Infinity;
  return Math.sqrt(A.reduce((s, v, i) => s + (v - B[i]) ** 2, 0));
}

function servidor() {
  const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      const limpio = decodeURIComponent(req.url.split("?")[0]);
      const f = path.join(RAIZ, limpio === "/" ? "/index.html" : limpio);
      if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        rq.writeHead(404); return rq.end("no");
      }
      rq.writeHead(200, { "Content-Type": TIPOS[path.extname(f)] || "application/octet-stream" });
      rq.end(fs.readFileSync(f));
    });
    s.listen(0, "127.0.0.1", () => res(s));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const guardar  = args.includes("--guardar");
  const comparar = args.includes("--comparar");
  const sinTema  = args.includes("--sin-tema");
  const iTol = args.indexOf("--tolerancia");
  const TOL = iTol >= 0 ? Number(args[iTol + 1]) : 0;
  // ⚠ --sin-tema NO cambia la etiqueta: se compara contra la MISMA línea base.
  // El sentido de esa pasada es comprobar que con los respaldos solos el
  // resultado sea idéntico al original. Con etiqueta propia buscaría una base
  // inexistente, saltaría todas las páginas y daría un falso verde.
  const etiqueta = args[args.indexOf(guardar ? "--guardar" : "--comparar") + 1] || "base";
  if (!guardar && !comparar) {
    console.log("Usá --guardar <etiqueta> o --comparar <etiqueta>  [--sin-tema]");
    process.exit(2);
  }

  const chrome = CHROMES.find(c => fs.existsSync(c));
  if (!chrome) { console.error("No encuentro Chrome. Pasalo con CHROME=<ruta>"); process.exit(1); }

  const puppeteer = require("puppeteer-core");
  const srv = await servidor();
  const base = "http://127.0.0.1:" + srv.address().port;
  const nav = await puppeteer.launch({ executablePath: chrome, headless: "new",
                                       args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  fs.mkdirSync(SALIDA, { recursive: true });
  const dir = path.join(SALIDA, etiqueta);
  if (guardar) fs.mkdirSync(dir, { recursive: true });

  const paginas = fs.readdirSync(RAIZ).filter(f => f.endsWith(".html")).sort();
  let difieren = 0, revisadas = 0, totalMovidos = 0, maxGlobal = 0;
  const altas = [];

  for (const pag of paginas) {
    // ⚠ Un contexto NUEVO por página. Con uno solo, el localStorage se comparte
    // entre páginas del mismo origen: el token que deja dashboard.html seguía
    // vivo al llegar a index.html y el login redirigía igual, aunque acá no le
    // pusiéramos sesión. Ese fue el motivo real de que el login no se verificara.
    const ctxNav = await nav.createBrowserContext();
    const p = await ctxNav.newPage();
    // Las páginas hacen peticiones a Railway que acá no van a responder. Se
    // cortan para que la carga no dependa de la red ni tarde 20 s por timeout.
    await p.setRequestInterception(true);
    p.on("request", r => {
      const u = r.url();
      if (u.startsWith(base)) {
        // --sin-tema: se simula el 404 de la hoja de tokens.
        if (sinTema && u.includes("css/tema.css")) return r.respond({ status: 404, body: "" });
        return r.continue();
      }
      r.respond({ status: 200, contentType: "application/json", body: "{}" });
    });
    p.on("pageerror", () => {});
    p.on("console", () => {});
    // Sin esto, un alert() deja la navegación colgada hasta el timeout.
    p.on("dialog", d => d.dismiss().catch(() => {}));

    const rol = ROL_POR_PAGINA[pag] || "admin";
    const conSesion = !SIN_SESION.has(pag);
    await p.evaluateOnNewDocument((tok, usr, conSesion) => {
      if (conSesion) {
        localStorage.setItem("token", tok);
        localStorage.setItem("user", JSON.stringify(usr));
      }
      localStorage.setItem("tema::verificador", "claro");   // modo claro SIEMPRE
      localStorage.setItem("tema_ultimo", "claro");
    }, tokenFalso(rol), { ...USUARIO, rol }, conSesion);

    try {
      await p.goto(base + "/" + pag, { waitUntil: "domcontentloaded", timeout: 20000 });
      await new Promise(r => setTimeout(r, 400));   // que corran los scripts inline
    } catch (e) {
      console.log("  ! " + pag + " no cargó: " + e.message);
      await p.close(); await ctxNav.close(); continue;
    }

    // ⚠ Si la página redirigió, lo que sigue NO es la página que pedimos y el
    // diff estaría comparando otra cosa. Callarlo convertiría el arnés en una
    // mentira para esa página.
    const final = p.url().split("/").pop().split("?")[0] || "index.html";
    if (final !== pag) {
      console.log(`  ↪ ${pag} redirigió a ${final} — NO se verifica`);
      await p.close(); await ctxNav.close(); continue;
    }

    const datos = await p.evaluate((PROPS) => {
      const out = [];
      const todos = document.querySelectorAll("*");
      for (let i = 0; i < todos.length; i++) {
        const el = todos[i];
        const cs = getComputedStyle(el);
        const fila = {};
        let alguno = false;
        for (const pr of PROPS) {
          const v = cs.getPropertyValue(pr);
          // Sólo lo que aporta señal: los valores por defecto son ruido.
          if (v && v !== "none" && v !== "rgba(0, 0, 0, 0)" && v !== "auto") {
            fila[pr] = v; alguno = true;
          }
        }
        if (!alguno) continue;
        // Ruta estable: sin ids generados ni texto, para que el diff sea legible
        // y no cambie entre corridas por datos distintos.
        let ruta = el.tagName.toLowerCase();
        if (el.id) ruta += "#" + el.id;
        if (el.className && typeof el.className === "string") {
          ruta += "." + el.className.trim().split(/\s+/).join(".");
        }
        out.push({ i, ruta, ...fila });
      }
      return out;
    }, PROPS);

    const json = JSON.stringify(datos, null, 1);
    const archivo = path.join(dir, pag + ".json");
    revisadas++;

    if (guardar) {
      fs.writeFileSync(archivo, json);
    } else {
      // ⚠ Sin línea base no se puede afirmar nada: cuenta como fallo. Saltarla
      // en silencio convertía "0 diferencias" en "0 páginas comprobadas".
      if (!fs.existsSync(archivo)) {
        console.log("  ? " + pag + " SIN línea base — no se puede verificar");
        difieren++; await p.close(); await ctxNav.close(); continue;
      }
      // ⚠ La pasada CON tema.css no puede dar diff cero mientras el generador
      // consolide colores indistinguibles (#fafafa y #f8f9fa comparten token).
      // Exigir cero ahí obligaría a un token por cada hex distinto: ~195.
      // El criterio correcto para esa pasada es otro: que NINGÚN color se haya
      // movido más que imperceptiblemente. Con --tolerancia N se acepta una
      // distancia RGB < N y se sigue fallando ante cualquier salto mayor, que es
      // lo que de verdad significaría que el codemod mandó un color a otro lado.
      const a = JSON.parse(fs.readFileSync(archivo, "utf8")), b = datos;
      // ⚠ Se compara por RUTA, no por posición. Con índices, agregar UN elemento
      // al DOM —el botón del tema en el pie del menú— corría todo un lugar y el
      // arnés reportaba 25 páginas rotas cuando no había cambiado ni un color.
      // Los elementos que sólo están en un lado se informan aparte: son altas o
      // bajas legítimas, no fallos de color.
      const clave = (arr) => {
        const m = new Map(), n = {};
        for (const x of arr) {
          n[x.ruta] = (n[x.ruta] || 0) + 1;
          m.set(x.ruta + "#" + n[x.ruta], x);
        }
        return m;
      };
      const mA = clave(a), mB = clave(b);
      const excesos = [];
      let movidos = 0, maxDist = 0, soloA = 0, soloB = 0;
      for (const k of mA.keys()) if (!mB.has(k)) soloA++;
      for (const k of mB.keys()) if (!mA.has(k)) soloB++;
      for (const [k, x] of mA) {
        const y = mB.get(k);
        if (!y) continue;
        for (const pr of PROPS) {
          if (x[pr] === y[pr]) continue;
          const d = distancia(x[pr], y[pr]);
          if (d !== Infinity && d > maxDist) maxDist = d;
          if (d > TOL) {
            excesos.push([x.ruta, pr, x[pr] + " → " + y[pr] +
                          (d === Infinity ? "" : "  (dist " + d.toFixed(1) + ")")]);
          } else movidos++;
        }
      }
      // Altas y bajas del DOM: no son fallos de color, pero callarlas dejaría
      // pasar una página que perdió media interfaz sin que nadie se entere.
      if (soloA + soloB) altas.push([pag, soloB, soloA]);
      if (excesos.length) {
        difieren++;
        console.log("\n  ✗ " + pag + "  (" + excesos.length + " fuera de tolerancia)");
        excesos.slice(0, 5).forEach(e => console.log("      " + e[0] + "\n        " + e[1] + ": " + e[2]));
        if (excesos.length > 5) console.log("      … y más");
      } else if (movidos) {
        totalMovidos += movidos;
        if (maxDist > maxGlobal) maxGlobal = maxDist;
      }
    }
    await p.close();
    await ctxNav.close();
  }

  await nav.close();
  srv.close();

  console.log("\n" + (guardar ? "LÍNEA BASE guardada" : "COMPARACIÓN") + `  [${etiqueta}]`);
  console.log("  páginas: " + revisadas);
  if (comparar) {
    console.log("  páginas fuera de tolerancia: " + difieren);
    if (altas.length) {
      console.log("  paginas con altas/bajas de elementos (no es fallo de color):");
      altas.slice(0, 6).forEach(a => console.log("    " + a[0] + "  +" + a[1] + " / -" + a[2]));
      if (altas.length > 6) console.log("    ... y " + (altas.length - 6) + " mas");
    }
    if (TOL) console.log("  colores consolidados dentro de tolerancia: " + totalMovidos +
                         "  (movimiento máximo " + maxGlobal.toFixed(1) + ", límite " + TOL + ")");
    console.log(difieren ? "\n  ⚠ DIFF NO ES CERO — el codemod cambió algo que no debía."
                         : "\n  ✓ diff cero");
  }
  process.exit(comparar && difieren ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
