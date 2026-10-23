// @ts-check
// EL LOGIN VA SIEMPRE EN INGLÉS (decisión del dueño, 2026-10-20) — también lo que
// llega del servidor.
//
// Reportado 2026-10-23: al pedir el reset, el aviso verde salía en castellano. El
// texto lo manda la API (`_RESET_GENERICO`, app/routers/auth.py) y la página lo
// pintaba tal cual, sin pasarlo por el diccionario.
//
// ⚠ La respuesta del servidor se SIMULA: la prueba no puede mandar correos de verdad.
//   Por eso el texto de abajo tiene que ser EXACTAMENTE el de la API — si allá cambia,
//   el diccionario deja de reconocerlo y esta prueba lo avisa.
const { test, expect } = require("@playwright/test");

const MENSAJE_API = "Si el correo corresponde a una cuenta con email cargado, " +
  "te enviamos un enlace para restablecer la contraseña. Revisá tu bandeja (y el spam).";

test("el aviso del reset sale en inglés aunque la API lo mande en castellano", async ({ page }) => {
  await page.route("**/auth/reset/solicitar", (r) => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ mensaje: MENSAJE_API }),
  }));
  await page.goto("/index.html");
  await page.evaluate(() => abrirReset());
  await page.fill("#reset-email", "alguien@prueba-e2e.invalid");
  await page.click("#reset-btn");
  const msg = page.locator("#reset-msg");
  await expect(msg).toContainText("If the email belongs to an account");
  await expect(msg).not.toContainText("Si el correo");
});
