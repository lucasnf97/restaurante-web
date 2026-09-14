// @ts-check
// EL ARENERO — helpers comunes de las pruebas que SÍ escriben.
//
// Todo lo de esta carpeta corre contra `0000B` / "La Brasa Dorada", el único
// esquema donde el dueño autorizó escribir (2026-09-15). El resto de la suite
// sigue siendo de solo lectura.
//
// ⚠ SÓLO INSERT. La maqueta tiene un año sintético curado cuyo generador se
//   perdió: no se puede regenerar. Modificar o borrar una fila que ya estaba es
//   IRREVERSIBLE. Lo que estas pruebas crean, lo borran ellas mismas al
//   terminar; y por encima de eso hay una marca de agua (MAX(id) por tabla,
//   tomada antes de empezar) que permite revertir todo de una.
const base = require("../sesion");

const { expect, ARENERO, tokenDe } = base;

/** `test` ya apuntado al arenero. Usar SIEMPRE este, no el de `../sesion`. */
const test = base.test.extend({
  esquema: [ARENERO, { option: true }],
});

/**
 * Marca lo que crea una prueba, para que se reconozca de un vistazo en la base
 * y no se confunda con los datos de la maqueta. Lleva la hora: dos corridas no
 * chocan entre sí.
 */
const marca = (que) => `[e2e ${que} ${Date.now().toString(36)}]`;

/**
 * Llama a la API con la sesión de la página (mismo token, mismo esquema).
 * Devuelve `{ok, status, data}` en vez de tirar: una prueba que limpia lo que
 * creó necesita poder seguir aunque un paso falle.
 */
const api = (page, metodo, ep, cuerpo, tok) => page.evaluate(async ({ m, e, b, t }) => {
  const r = await fetch(window._API_URL + e, {
    method: m,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (t || localStorage.getItem("token")),
    },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  let data = null;
  try { data = await r.json(); } catch (x) { /* 204 y similares */ }
  return { ok: r.ok, status: r.status, data };
}, { m: metodo, e: ep, b: cuerpo, t: tok });

/**
 * La misma llamada pero COMO OTRO EMPLEADO del arenero.
 *
 * Sirve para dos cosas distintas y las dos hacen falta:
 *   · **probar permisos de verdad** — el backend lee rol y permisos de la fila
 *     de `usuarios`, no del token, así que un empleado sin permiso se lleva su
 *     403 real;
 *   · **limpiar** lo que una prueba dejó del lado del otro — un mensaje sólo se
 *     purga cuando los DOS lados lo vaciaron, y el remitente no puede tocar la
 *     bandeja del destinatario (404, y con razón).
 */
const apiComo = (page, username, metodo, ep, cuerpo) =>
  api(page, metodo, ep, cuerpo, tokenDe(username, ARENERO));

/** Abre una página del panel ya con la sesión del arenero. */
const ir = async (page, pagina) => {
  await page.goto(`/${pagina}`);
  await expect(page.locator("body")).toBeVisible();
};

module.exports = { test, expect, api, apiComo, ir, marca, ARENERO };
