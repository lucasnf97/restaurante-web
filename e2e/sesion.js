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

/**
 * EL ARENERO — `0000B` / "La Brasa Dorada" (permiso del dueño, 2026-09-15).
 *
 * Es el ÚNICO esquema donde las pruebas pueden ESCRIBIR. Todo lo demás sigue
 * siendo de solo lectura: la API local pega contra la base de producción y en
 * los locales de verdad una prueba que escribe mueve plata real.
 *
 * ⚠ Reglas del arenero, que no son burocracia:
 *   · **Sólo INSERT.** La maqueta tiene un año sintético curado (ventas, nómina,
 *     compras) con una narrativa de tendencias, y **su generador se perdió**: no
 *     se puede regenerar. Modificar o borrar una fila existente es irreversible.
 *   · Lo que se inserta queda por encima de la marca de agua tomada antes de
 *     empezar (MAX(id) por tabla), así que se puede revertir EXACTO.
 *   · Las pruebas que escriben viven en `e2e/arenero/` y se declaran con
 *     `test.use({ esquema: ARENERO })`. Fuera de esa carpeta, no se escribe.
 */
const ARENERO = process.env.E2E_SCHEMA_ARENERO || "r_0000b";

/**
 * Claims por tipo de cuenta. ⚠ NO alcanza con cambiar el `rol` en localStorage:
 * la API mira los CLAIMS DEL TOKEN, así que un token de gerente contra
 * /restaurantes o /gerentes se lleva un 403 -bien devuelto- y parece un bug de
 * la página cuando es de la prueba.
 *   · gerente         → schema del inquilino;
 *   · superadmin      → sin schema (no vive en ningún inquilino);
 *   · gerente_cadena  → `gid`, el id en public.gerentes.
 * Los ids se pueden cambiar por entorno: E2E_GID.
 */
const CLAIMS = (esquema) => ({
  gerente:        { sub: USUARIO, rol: "gerente", schema: esquema },
  superadmin:     { sub: process.env.E2E_SUPERADMIN || "admin", rol: "superadmin" },
  gerente_cadena: { sub: USUARIO, rol: "gerente_cadena",
                    gid: Number(process.env.E2E_GID || 3) },
});

function token(rol = "gerente", esquema = ESQUEMA) {
  // ⚠ E2E_TOKEN pisa TODO, incluido el esquema: si está puesto, una prueba de
  //   arenero escribiría donde diga ese token. Sólo se respeta para el esquema
  //   por defecto; para cualquier otro se firma uno propio.
  if (process.env.E2E_TOKEN && esquema === ESQUEMA) return process.env.E2E_TOKEN;
  const secreto = leerEnv("SECRET_KEY");
  if (!secreto) {
    throw new Error(
      "No hay con qué firmar la sesión de prueba.\n" +
      "  Poné E2E_TOKEN en el entorno, o dejá que se lea SECRET_KEY de\n" +
      `  ${path.join(RAIZ_API, ".env")}`);
  }
  const claims = CLAIMS(esquema)[rol];
  if (!claims) throw new Error(`Rol desconocido en las pruebas: ${rol}`);
  return firmar(claims, secreto);
}

/**
 * Firma un token para CUALQUIER usuario del esquema.
 *
 * ⚠ El backend resuelve **rol y permisos desde la fila de `usuarios`**, no del
 *   token (`auth.py::get_current_user`): el claim sólo dice QUIÉN es. Por eso
 *   esto alcanza para probar permisos de verdad —un usuario con `ver_stock` y
 *   sin `gestion_stock` se lleva un 403 aunque el token se firme acá— y por eso
 *   NO se manda ningún `rol` en el claim: los únicos que el backend mira son
 *   `admin` con `admin_override`, `empleado_cadena` y `gerente_cadena`, que son
 *   cuentas sintéticas sin fila propia.
 */
/**
 * Token de GERENTE DE CADENA para un `gid` y su usuario.
 * ⚠ El backend exige que los DOS coincidan (`SELECT ... WHERE id = :g AND
 *   username = :u`): cambiarle el `gid` a un token ajeno no sirve para saltar de
 *   cadena. Por eso hay que pasar el usuario que de verdad corresponde a ese gid.
 */
function tokenCadena(gid, username) {
  const secreto = leerEnv("SECRET_KEY");
  if (!secreto) throw new Error("No hay SECRET_KEY para firmar la sesión de prueba.");
  return firmar({ sub: username, rol: "gerente_cadena", gid: Number(gid) }, secreto);
}

function tokenDe(sub, esquema = ESQUEMA) {
  const secreto = leerEnv("SECRET_KEY");
  if (!secreto) throw new Error("No hay SECRET_KEY para firmar la sesión de prueba.");
  return firmar({ sub, schema: esquema }, secreto);
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
  rol: ["gerente", { option: true }],
  /** Esquema contra el que corre. `ARENERO` para las pruebas que escriben. */
  esquema: [ESQUEMA, { option: true }],

  page: async ({ page, tema, rol, esquema }, usar) => {
    const tok = token(rol, esquema);
    const usuario = { ...USUARIO_LS, rol };
    await page.addInitScript(({ t, u, tm }) => {
      localStorage.setItem("token", t);
      localStorage.setItem("user", JSON.stringify(u));
      localStorage.setItem(`tema::${u.username}`, tm);
      localStorage.setItem("tema_ultimo", tm);
    }, { t: tok, u: usuario, tm: tema });

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

module.exports = { test, expect: base.expect, token, tokenDe, tokenCadena,
                   ESQUEMA, ARENERO, USUARIO };
