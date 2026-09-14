// @ts-check
// Sesión para las pruebas: una página que YA entró, con el tema fijado.
//
// ⚠ EL TOKEN SE FIRMA EN MEMORIA, no se guarda en ningún archivo. Sale de
//   E2E_TOKEN si está en el entorno, y si no se firma con la SECRET_KEY del
//   .env de la API (que ya está fuera de git). Nunca se escribe a disco ni se
//   imprime: una clave en un .txt es exactamente lo que el dueño pidió evitar.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const base = require("@playwright/test");

const RAIZ_API = path.resolve(__dirname, "..", "..", "restaurante-api");

function leerEnv(clave) {
  try {
    const txt = fs.readFileSync(path.join(RAIZ_API, ".env"), "utf8");
    for (const linea of txt.split(/\r?\n/)) {
      if (linea.startsWith(clave + "=")) return linea.slice(clave.length + 1).trim();
    }
  } catch (e) { /* sin .env: se cae al mensaje de abajo */ }
  return null;
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Firma un JWT HS256 con los claims que espera la API (ver app/tenancy.py). */
function firmar(claims, secreto) {
  const cab = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const cuerpo = b64url(JSON.stringify({ ...claims, exp: 4102444800 }));  // 2100
  const firma = crypto.createHmac("sha256", secreto).update(`${cab}.${cuerpo}`).digest();
  return `${cab}.${cuerpo}.${b64url(firma)}`;
}

/** Datos del restaurante de pruebas. Se puede apuntar a otro por entorno. */
const ESQUEMA = process.env.E2E_SCHEMA || "r_0000";
const USUARIO = process.env.E2E_USER || "Lucas";

function token() {
  if (process.env.E2E_TOKEN) return process.env.E2E_TOKEN;
  const secreto = leerEnv("SECRET_KEY");
  if (!secreto) {
    throw new Error(
      "No hay con qué firmar la sesión de prueba.\n" +
      "  Poné E2E_TOKEN en el entorno, o dejá que se lea SECRET_KEY de\n" +
      `  ${path.join(RAIZ_API, ".env")}`);
  }
  return firmar({ sub: USUARIO, rol: "gerente", schema: ESQUEMA }, secreto);
}

const USUARIO_LS = {
  id: 1, username: USUARIO, rol: "gerente", nombre_display: USUARIO,
  modulos: null, pantalla_default: "dashboard",
};

/**
 * `test` con dos extras:
 *   · `page` ya trae sesión iniciada y tema fijado (oscuro por defecto);
 *   · falla si la página tira un error de JavaScript. Un `<script>` roto deja la
 *     pantalla en blanco y, sin esto, la prueba lo tomaría por "no encontré el
 *     botón" en vez de por lo que es.
 */
const test = base.test.extend({
  tema: ["oscuro", { option: true }],

  page: async ({ page, tema }, usar) => {
    const tok = token();
    await page.addInitScript(({ t, u, tm }) => {
      localStorage.setItem("token", t);
      localStorage.setItem("user", JSON.stringify(u));
      localStorage.setItem(`tema::${u.username}`, tm);
      localStorage.setItem("tema_ultimo", tm);
    }, { t: tok, u: USUARIO_LS, tm: tema });

    const errores = [];
    page.on("pageerror", (e) => errores.push(String(e)));
    // Los alert() bloquean el navegador hasta que alguien conteste.
    page.on("dialog", (d) => d.dismiss().catch(() => {}));

    await usar(page);

    if (errores.length) {
      throw new Error("La página tiró errores de JavaScript:\n  " + errores.join("\n  "));
    }
  },
});

module.exports = { test, expect: base.expect, ESQUEMA, USUARIO };
