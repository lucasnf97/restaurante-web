/* Audita el MODO OSCURO buscando los tres fallos que de verdad se ven.
 *
 *   node tools/auditar-oscuro.js
 *   node tools/auditar-oscuro.js --pagina stock.html --foto
 *
 * Por qué existe: el arnés de verificar-colores.js prueba que el modo CLARO no
 * cambió. No dice nada de si el oscuro se ve bien — eso, en el plan, era
 * "caminata manual por 33 páginas". Caminar 33 páginas a ojo garantiza que se
 * escapen cosas, así que esto automatiza lo que se puede medir:
 *
 *   1. ISLAS CLARAS — un elemento con fondo claro sobre la página oscura. Es el
 *      fallo más visible: el rectángulo blanco que grita "roto". Se ignoran los
 *      que están dentro de .hoja, que son claros A PROPÓSITO.
 *   2. CONTRASTE — texto por debajo de 4.5:1 contra su fondo real (WCAG AA).
 *      Se calcula contra el fondo EFECTIVO, subiendo por los ancestros hasta
 *      encontrar uno opaco: comparar contra un padre transparente da números
 *      lindos y falsos.
 *   3. BORDES INVISIBLES — bordes con menos de 1.3:1 contra su fondo. Sin ellos
 *      las tarjetas flotan sin contorno, que es como se ve un oscuro a medio
 *      hacer.
 *
 * Requiere puppeteer-core (usa el Chrome del sistema).
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const RAIZ = path.resolve(__dirname, "..");
const FOTOS = path.join(__dirname, ".fotos");

const CHROMES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].filter(Boolean);

const ROL_POR_PAGINA = {
  "restaurantes.html": "superadmin",
  "cadena.html": "gerente_cadena",
  "cadena-personal.html": "gerente_cadena",
};
const SIN_SESION = new Set(["index.html", "terminos.html", "privacidad.html",
                            "restablecer.html", "reserva.html"]);
// reserva.html tiene paleta propia y no se tematiza.
const EXCLUIR = new Set(["reserva.html"]);

function tokenFalso(rol) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64({ alg: "HS256", typ: "JWT" }) + "." +
         b64({ sub: "auditor", rol: rol || "admin", schema: "r_0000", exp: 4102444800 }) +
         ".firma-de-mentira";
}
const USUARIO = { id: 1, username: "auditor", rol: "admin",
                  nombre_display: "Auditor", modulos: null, pantalla_default: "dashboard" };

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

// Todo el análisis corre DENTRO de la página: hace falta el árbol vivo para
// resolver el fondo efectivo subiendo por los ancestros.
function analizar() {
  const rgb = v => {
    const m = String(v).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = c => {
    const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contraste = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };
  // ⚠ El fondo EFECTIVO: se sube hasta encontrar un ancestro opaco. Comparar
  // contra un padre transparente da contrastes altos y falsos.
  const fondoReal = el => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.6) return c;
      n = n.parentElement;
    }
    return rgb(getComputedStyle(document.documentElement).backgroundColor) || { r: 18, g: 19, b: 26, a: 1 };
  };
  const ruta = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.className && typeof el.className === "string") {
      const c = el.className.trim().split(/\s+/).slice(0, 3).join(".");
      if (c) s += "." + c;
    }
    return s;
  };
  const enHoja = el => !!el.closest(".hoja");
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  };

  const islas = [], bajoContraste = [], bordes = [];
  for (const el of document.querySelectorAll("*")) {
    if (!visible(el) || enHoja(el)) continue;
    const cs = getComputedStyle(el);

    // 1. Isla clara: fondo opaco y muy luminoso en una página oscura.
    const bg = rgb(cs.backgroundColor);
    if (bg && bg.a > 0.6 && lum(bg) > 0.6) {
      islas.push({ ruta: ruta(el), color: cs.backgroundColor,
                   area: Math.round(el.getBoundingClientRect().width *
                                    el.getBoundingClientRect().height) });
    }

    // 2. Contraste de texto: sólo elementos con texto propio.
    const texto = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (texto) {
      const fg = rgb(cs.color), fb = fondoReal(el);
      if (fg && fb && fg.a > 0.5) {
        const c = contraste(fg, fb);
        if (c < 4.5) bajoContraste.push({ ruta: ruta(el), contraste: +c.toFixed(2),
                                          color: cs.color, fondo: `rgb(${fb.r}, ${fb.g}, ${fb.b})`,
                                          muestra: el.textContent.trim().slice(0, 32) });
      }
    }

    // 3. Borde invisible.
    const bw = parseFloat(cs.borderTopWidth) || 0;
    if (bw > 0 && cs.borderTopStyle !== "none") {
      const bc = rgb(cs.borderTopColor), fb = fondoReal(el);
      if (bc && fb && bc.a > 0.4) {
        const c = contraste(bc, fb);
        if (c < 1.3) bordes.push({ ruta: ruta(el), contraste: +c.toFixed(2), color: cs.borderTopColor });
      }
    }
  }
  // Se agrupan por ruta: 40 celdas iguales son UN problema, no 40.
  const agrupar = (arr, clave) => {
    const m = {};
    for (const x of arr) {
      const k = x.ruta;
      if (!m[k]) m[k] = { ...x, n: 0 };
      m[k].n++;
      if (clave && x[clave] < m[k][clave]) m[k][clave] = x[clave];
    }
    return Object.values(m);
  };
  return {
    islas: agrupar(islas).sort((a, b) => b.area - a.area).slice(0, 8),
    bajoContraste: agrupar(bajoContraste, "contraste").sort((a, b) => a.contraste - b.contraste).slice(0, 8),
    bordes: agrupar(bordes, "contraste").slice(0, 5),
    totales: { islas: islas.length, contraste: bajoContraste.length, bordes: bordes.length },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const iP = args.indexOf("--pagina");
  const soloPagina = iP >= 0 ? args[iP + 1] : null;
  const foto = args.includes("--foto");

  const chrome = CHROMES.find(c => fs.existsSync(c));
  if (!chrome) { console.error("No encuentro Chrome. Pasalo con CHROME=<ruta>"); process.exit(1); }
  const puppeteer = require("puppeteer-core");
  const srv = await servidor();
  const base = "http://127.0.0.1:" + srv.address().port;
  const nav = await puppeteer.launch({ executablePath: chrome, headless: "new",
                                       args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  if (foto) fs.mkdirSync(FOTOS, { recursive: true });

  const paginas = (soloPagina ? [soloPagina]
                              : fs.readdirSync(RAIZ).filter(f => f.endsWith(".html")))
                  .filter(f => !EXCLUIR.has(f)).sort();
  const resumen = [];

  for (const pag of paginas) {
    const ctx = await nav.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    await p.setRequestInterception(true);
    p.on("request", r => r.url().startsWith(base) ? r.continue()
        : r.respond({ status: 200, contentType: "application/json", body: "{}" }));
    p.on("pageerror", () => {}); p.on("console", () => {});
    p.on("dialog", d => d.dismiss().catch(() => {}));

    const rol = ROL_POR_PAGINA[pag] || "admin";
    const conSesion = !SIN_SESION.has(pag);
    await p.evaluateOnNewDocument((tok, usr, con) => {
      if (con) { localStorage.setItem("token", tok); localStorage.setItem("user", JSON.stringify(usr)); }
      localStorage.setItem("tema::auditor", "oscuro");
      localStorage.setItem("tema_ultimo", "oscuro");
    }, tokenFalso(rol), { ...USUARIO, rol }, conSesion);

    try {
      await p.goto(base + "/" + pag, { waitUntil: "domcontentloaded", timeout: 20000 });
      await new Promise(r => setTimeout(r, 500));
    } catch (e) { await p.close(); await ctx.close(); continue; }

    const final = p.url().split("/").pop().split("?")[0] || "index.html";
    if (final !== pag) { await p.close(); await ctx.close(); continue; }

    const tema = await p.evaluate(() => document.documentElement.dataset.tema);
    if (tema !== "oscuro") {
      console.log(`  ! ${pag}: data-tema="${tema}" — no se aplicó el oscuro`);
      await p.close(); await ctx.close(); continue;
    }

    const r = await p.evaluate(analizar);
    resumen.push({ pag, ...r });
    if (foto) await p.screenshot({ path: path.join(FOTOS, pag.replace(".html", "") + ".png"),
                                   fullPage: false });
    await p.close(); await ctx.close();
  }

  await nav.close(); srv.close();

  // ── Informe ──────────────────────────────────────────────────────────────
  resumen.sort((a, b) => (b.totales.islas + b.totales.contraste) -
                         (a.totales.islas + a.totales.contraste));
  let tI = 0, tC = 0, tB = 0;
  console.log("MODO OSCURO — auditoría de " + resumen.length + " páginas\n");
  console.log("  " + "página".padEnd(26) + "islas  contraste  bordes");
  for (const r of resumen) {
    tI += r.totales.islas; tC += r.totales.contraste; tB += r.totales.bordes;
    const mal = r.totales.islas + r.totales.contraste + r.totales.bordes;
    console.log("  " + (mal ? "✗ " : "✓ ") + r.pag.padEnd(24) +
                String(r.totales.islas).padStart(4) + String(r.totales.contraste).padStart(10) +
                String(r.totales.bordes).padStart(8));
  }
  console.log("\n  TOTAL   islas claras: " + tI + "   texto bajo contraste: " + tC +
              "   bordes invisibles: " + tB);

  const peores = resumen.filter(r => r.totales.islas || r.totales.contraste).slice(0, 4);
  for (const r of peores) {
    console.log("\n── " + r.pag);
    r.islas.slice(0, 4).forEach(i =>
      console.log(`   isla   ${i.ruta}  ${i.color}  (${i.n}×, ${i.area}px²)`));
    r.bajoContraste.slice(0, 4).forEach(c =>
      console.log(`   texto  ${c.ruta}  ${c.contraste}:1  ${c.color} sobre ${c.fondo}  "${c.muestra}"`));
  }
  fs.writeFileSync(path.join(__dirname, "auditoria-oscuro.json"), JSON.stringify(resumen, null, 1));
  console.log("\n  -> tools/auditoria-oscuro.json" + (foto ? "  y tools/.fotos/" : ""));
}

main().catch(e => { console.error(e); process.exit(1); });
