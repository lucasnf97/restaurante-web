// @ts-check
// Switcher de restaurante en el navbar (gerente de cadena, B-brief 2026-09-21).
// La marca del navbar (.navbar-brand) se vuelve un botón con desplegable SOLO
// cuando hay sesión de cadena (ger_token en localStorage); un gerente de UN
// restaurante (sin ger_token) ve la marca estática de siempre.
//
// ⚠ SOLO LECTURA: abrir el menú dispara un GET a /cadena/restaurantes (mismo
//   patrón que cadena.spec.js), nunca un POST /cadena/entrar — elegir un
//   restaurante real escribiría token en localStorage, así que ESO se prueba a
//   mano, no acá. Este archivo NO se corrió (necesita la API local + SECRET_KEY
//   del .env de restaurante-api, ver e2e/sesion.js) — lo corre el controller o
//   el dueño con ese entorno disponible.
const { test, expect, token } = require("./sesion");

test.describe("Switcher de restaurante en el navbar", () => {
  test("gerente de cadena (ger_token presente): la marca abre un menú con Panel general", async ({ page }) => {
    // El fixture de sesion.js ya deja "token"/"user" = un gerente de UN
    // restaurante (rol por defecto "gerente"), que es la sesión real de
    // dashboard.html. Lo que lo convierte en gerente DE CADENA es tener,
    // ADEMÁS, su propia cuenta de cadena guardada aparte — exactamente lo que
    // deja entrarRestauranteGer() después de entrar desde cadena.html. Se
    // agrega con addInitScript (corre en cada navegación) sin tocar
    // sesion.js, que nadie más necesita.
    await page.addInitScript((t) => {
      localStorage.setItem("ger_token", t);
      localStorage.setItem("ger_user", JSON.stringify({ rol: "gerente_cadena" }));
    }, token("gerente_cadena"));

    await page.goto("/dashboard.html");
    const brand = page.locator(".navbar-brand");
    await expect(brand).toHaveClass(/ger-switcher/);

    await brand.click();
    const menu = page.locator("#ger-switcher-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator("#ger-switcher-panel")).toHaveText(/Panel general/);

    // Cierra con Escape (no clickeamos ningún restaurante: eso escribiría token).
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("gerente de UN restaurante (sin ger_token): la marca queda estática, sin menú", async ({ page }) => {
    await page.goto("/dashboard.html");
    const brand = page.locator(".navbar-brand");
    await expect(brand).not.toHaveClass(/ger-switcher/);

    await brand.click({ force: true });
    await expect(page.locator("#ger-switcher-menu")).toHaveCount(0);
  });
});
