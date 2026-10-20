/* Saca los textos visibles de una página (HTML + su JavaScript) que todavía no están en
 * los diccionarios, para traducirlos.
 *
 *   node tools/extraer-i18n.js stock.html            → lista pendiente (JSON en stdout)
 *   node tools/extraer-i18n.js stock.html --todo     → todos, incluidos los ya traducidos
 *   node tools/extraer-i18n.js js/api.js             → también sirve para un .js suelto
 *
 * Las plantillas de JS (`Hola ${nombre}`) salen como frases con datos ("Hola {0}"): el motor
 * (js/i18n.js) las reconoce cuando ya están armadas en la pantalla. Es un barrido de texto,
 * no un parser: puede traer algo de ruido (se ignora al traducir) y se le puede escapar una
 * frase armada con "+" (se agrega a mano).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const RAIZ = path.resolve(__dirname, "..");

// Lo que ve una página: el diccionario base, el común y el de esa página (no los de otras).
function diccionarios(pagina) {
  const todo = {};
  const base = fs.readFileSync(path.join(RAIZ, "js/i18n.js"), "utf8");
  const ini = base.indexOf("var D = {"), fin = base.indexOf("\n    };", ini);
  Object.assign(todo, vm.runInNewContext("(" + base.slice(ini + 8, fin + 6) + ")"));
  const dir = path.join(RAIZ, "js/i18n");
  const propio = path.basename(pagina || "", ".html") + ".js";
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(x => x === "comun.js" || x === propio)) {
    vm.runInNewContext(fs.readFileSync(path.join(dir, f), "utf8"), { I18N: { agregar: o => Object.assign(todo, o) } });
  }
  return todo;
}

const ES = /[a-záéíóúñ]{2,}/i;
const CODIGO = /(^[\w.$-]+$(?<![A-ZÁÉÍÓÚ].*)|\.html|\.js\b|https?:|\bvar\(|rgba?\(|#[0-9a-f]{3,6}\b|=>|&&|\|\||===|!==|\bfunction\b|\breturn\b|\bconst\b|\blet\b|document\.|window\.|\bpx\b|;\s*$|^[\w-]+\s*:\s*[\w#(-]|^\s*[.#][\w-]+|\b(api|fetch)\b)/i;

function candidato(t) {
  t = t.replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 400) return null;
  if (!ES.test(t)) return null;
  if (CODIGO.test(t)) return null;
  // Lista de clases CSS / identificadores: palabras sueltas en minúscula con guiones o _.
  if (/^[a-z0-9_-]+(\s+[a-z0-9_-]+)*$/.test(t) && /[-_]/.test(t)) return null;
  if (/^[a-z_]+$/.test(t)) return null;            // identificador suelto ('pendiente', 'ok')
  if (/\/\/|\{\d+\}\/|\/[\w{}-]+\/|^\/[\w/-]+$/.test(t)) return null;   // comentarios y rutas
  if (/^[A-Z0-9_]+$/.test(t)) return null;                              // siglas / constantes
  if (/^[a-z]+[A-Z]\w*$/.test(t) || /^[A-Z][a-z]+[A-Z]\w*$/.test(t)) return null;   // camelCase
  if (/^[a-z]{2}-[A-Z]{2}$/.test(t) || /^(Segoe UI|Enter|Escape|Bearer \{0\})$/.test(t)) return null;
  if (/^[^a-záéíóúñ]*$/i.test(t.replace(/\{\d+\}/g, ""))) return null;
  if (/^[\w.+-]+\/[\w.+-]+$/.test(t) || /^\d+(px|em|rem|%)$/.test(t) || /^@media|^\w+\[|^&\w+=|^url\(/.test(t)) return null;
  if (/^(Authorization|Content-Type|DOMContentLoaded|Accept)$/.test(t)) return null;
  if (/^@\w+$|::$|prefers-color-scheme|^(badge|tab)-\{0\}$/.test(t)) return null;   // arranque del tema, clases
  return t;
}

// Divide un texto (que puede traer HTML) en los trozos que serían nodos de texto.
function trozos(txt) {
  return txt.replace(/<!--[\s\S]*?-->/g, " ").split(/<[^>]*>/).map(x => x.replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
}

// Placeholders renumerados desde 0 dentro de cada trozo.
function renumerar(t) {
  let n = 0;
  return t.replace(/\u0000/g, () => "{" + (n++) + "}");
}

function delJS(js, out) {
  let i = 0;
  const L = js.length;
  while (i < L) {
    const c = js[i];
    if (c === "/" && js[i + 1] === "/") { i = js.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && js[i + 1] === "*") { i = js.indexOf("*/", i + 2); if (i < 0) break; i += 2; continue; }
    // Expresión regular literal (/…/flags): se salta entera. Puede empezar donde no hay un
    // valor antes (después de ( , = : [ ! & | ? { } ; o de return/typeof).
    if (c === "/") {
      let k = i - 1; while (k >= 0 && /\s/.test(js[k])) k--;
      const prev = k >= 0 ? js[k] : "";
      const palabra = js.slice(Math.max(0, k - 6), k + 1);
      if (!prev || "(,=:[!&|?{};+-*%<>~^".includes(prev) || /(return|typeof)$/.test(palabra)) {
        let j = i + 1, clase = false;
        while (j < L && js[j] !== "\n") {
          if (js[j] === "\\") { j += 2; continue; }
          if (js[j] === "[") clase = true; else if (js[j] === "]") clase = false;
          else if (js[j] === "/" && !clase) break;
          j++;
        }
        i = j + 1; while (i < L && /[a-z]/i.test(js[i])) i++;
        continue;
      }
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < L && js[j] !== c) { if (js[j] === "\\") { s += js[j + 1] === "n" ? "\n" : js[j + 1]; j += 2; continue; } if (js[j] === "\n") break; s += js[j]; j++; }
      for (const tz of trozos(s)) { const k = candidato(tz); if (k) out.add(k); }
      i = j + 1; continue;
    }
    if (c === "`") {
      let j = i + 1, s = "";
      while (j < L && js[j] !== "`") {
        if (js[j] === "\\") { s += js[j + 1] === "n" ? "\n" : js[j + 1]; j += 2; continue; }
        if (js[j] === "$" && js[j + 1] === "{") {
          // ${...} balanceado (puede tener plantillas adentro): su contenido se analiza aparte.
          let d = 1, k = j + 2;
          while (k < L && d > 0) { if (js[k] === "{") d++; else if (js[k] === "}") d--; k++; }
          delJS(js.slice(j + 2, k - 1), out);
          s += "\u0000"; j = k; continue;
        }
        s += js[j]; j++;
      }
      for (const tz of trozos(s)) {
        const k = candidato(renumerar(tz));
        if (k && k.replace(/\{\d+\}/g, "").trim()) out.add(k);
      }
      i = j + 1; continue;
    }
    i++;
  }
}

function extraer(archivo) {
  const src = fs.readFileSync(path.join(RAIZ, archivo), "utf8");
  const out = new Set();
  if (archivo.endsWith(".js")) { delJS(src, out); return out; }
  const scripts = [];
  let html = src.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, js) => { scripts.push(js); return " "; })
                .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  for (const m of html.matchAll(/\b(?:placeholder|title|aria-label)="([^"]+)"/g)) { const k = candidato(m[1]); if (k) out.add(k); }
  for (const m of html.matchAll(/<title>([^<]+)<\/title>/g)) { const k = candidato(m[1]); if (k) out.add(k); }
  for (const tz of trozos(html.replace(/<head>[\s\S]*?<\/head>/i, " "))) { const k = candidato(tz); if (k) out.add(k); }
  for (const js of scripts) delJS(js, out);
  return out;
}

const args = process.argv.slice(2);
const todo = args.includes("--todo");
const res = {};
// Lo que el motor ya resuelve: exacto, sin el emoji/símbolo del principio, por patrón
// ("{0} visitas") o como comienzo de un patrón ("Error al guardar:" ← "Error al guardar: {0}").
// Los patrones se prueban con los mismos límites que el motor (_compilar/_patron en
// js/i18n.js): con poco texto fijo, datos de hasta 25 letras; "{0} de {1}" sólo con números.
// Sin eso, "{0} de {1}" daba por traducida cualquier frase con un " de " en el medio.
function cubierto(dic) {
  const pats = Object.keys(dic).filter(k => k.includes("{")).map(k => {
    const fijo = k.replace(/\{\w+\}/g, "").replace(/\s+/g, "").length;
    return { re: new RegExp("^" + k.split(/(\{\w+\})/).map(p => /^\{\w+\}$/.test(p) ? "([\\s\\S]*?)" :
               p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("") + "$"),
             maxDato: fijo < 10 ? 25 : 400,
             numeros: fijo <= 3 && /^\{\w+\}/.test(k) && /\{\w+\}$/.test(k) };
  });
  const encaja = t => pats.some(p => {
    const m = p.re.exec(t);
    // En el código los datos son {0}, {1}… (sin dígitos reales): un patrón "de números"
    // sólo cubre si el dato también es un hueco.
    return m && m.slice(1).every(d => d.length <= p.maxDato && (!p.numeros || /\d|^\{\d+\}$/.test(d)));
  });
  const uno = t => t in dic || encaja(t) || (t + " {0}") in dic || (t + "{0}") in dic;
  return k => {
    const sin = k.replace(/^[^A-Za-zÀ-ÿ¿¡0-9"'(]+/, "");
    return uno(k) || (sin && uno(sin));
  };
}
for (const a of args.filter(x => !x.startsWith("--"))) {
  const dic = diccionarios(a), cub = cubierto(dic);
  res[a] = [...extraer(a)].filter(k => todo || !cub(k)).sort();
}
console.log(JSON.stringify(res, null, 1));
