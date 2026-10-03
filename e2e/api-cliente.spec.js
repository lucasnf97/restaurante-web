// @ts-check
// EL CLIENTE HTTP COMPARTIDO (`js/api.js`).
//
// Lo que se protege acá es el TECHO DE TIEMPO, que es invisible hasta que muerde:
// `apiFetch` aborta cualquier request a los 20 s y, si el método es idempotente, lo
// reintenta 3 veces. Un endpoint más lento que eso NO PUEDE TERMINAR NUNCA desde el
// navegador — y como quien llama suele repintar la pantalla en su `catch`, el síntoma
// no se parece a un timeout, se parece a "la pantalla dejó de funcionar". Pasó de
// verdad con /metricas/cadena?comparar=1 el 2026-09-27.
//
// ⚠ SOLO LECTURA, y además estas pruebas NO tocan la API real: interceptan la ruta con
//   `page.route` y responden ellas. Así se puede medir el corte sin depender de que algo
//   del backend tarde lo que a la prueba le conviene.
const { test, expect } = require("./sesion");

/**
 * El override se prueba HACIA ABAJO (1 s sobre una respuesta de 2,5 s) en vez de hacia
 * arriba (25 s sobre el techo de 20 s). Prueba exactamente lo mismo —que `opts.timeout`
 * se lee y manda— pero tarda segundos en vez de minutos, y no deja la suite rehén de un
 * temporizador largo.
 */
async function conRespuestaLenta(page, ms) {
  await page.route("**/__prueba_lenta", async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

/** Llama por el cliente real de la página. ⚠ `api` va PELADO: es un global LÉXICO. */
const llamar = (page, opts) => page.evaluate(async (o) => {
  const t0 = Date.now();
  try {
    await api.get("/__prueba_lenta", o || undefined);
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e.message || e) };
  }
}, opts);

test.describe("Cliente HTTP compartido", () => {

  test("opts.timeout CORTA antes que el techo por defecto", async ({ page }) => {
    await page.goto("/dashboard.html");
    await conRespuestaLenta(page, 2500);

    const r = await llamar(page, { timeout: 800 });

    // Sin el arreglo, `timeout` se ignora, rigen los 20 s y la respuesta de 2,5 s llega
    // bien: `ok` sería true y esto fallaría. Con el arreglo corta a los 800 ms.
    expect(r.ok, `no corto: respondio en ${r.ms} ms (opts.timeout se esta ignorando)`)
      .toBe(false);
    expect(r.error).toContain("tardó demasiado");
    // ⚠ El margen de arriba NO es decorativo: el método es idempotente, así que tras
    //   abortar REINTENTA 3 veces con backoff (0,4 s y 0,8 s). 3x800 + 1200 ≈ 3,6 s.
    expect(r.ms, `tardo ${r.ms} ms: eso es mas que los 3 intentos de 800 ms + backoff`)
      .toBeLessThan(6000);
  });

  test("un opts.timeout holgado deja pasar la respuesta lenta", async ({ page }) => {
    await page.goto("/dashboard.html");
    await conRespuestaLenta(page, 2500);

    const r = await llamar(page, { timeout: 15000 });

    expect(r.ok, `corto cuando no debia: ${r.error}`).toBe(true);
    expect(r.ms).toBeGreaterThan(2000);
  });

  test("sin opts.timeout sigue rigiendo el techo por defecto", async ({ page }) => {
    await page.goto("/dashboard.html");
    await conRespuestaLenta(page, 1200);

    // 1,2 s está muy por debajo de los 20 s: tiene que pasar. Esto es la red de
    // seguridad de que el cambio es ADITIVO y no le movió el techo a las otras 33
    // pantallas, que es el riesgo real de tocar un archivo compartido.
    const r = await llamar(page, null);
    expect(r.ok, `rompio el comportamiento por defecto: ${r.error}`).toBe(true);
  });

  test("un timeout invalido no deja el request SIN corte", async ({ page }) => {
    await page.goto("/dashboard.html");
    await conRespuestaLenta(page, 1200);

    // `timeout: 0` o basura tienen que caer al default, no desactivar el corte: un
    // request sin corte deja la barra de carga eterna, que es lo que el techo evita.
    for (const malo of [0, -5, "ya", null]) {
      const r = await llamar(page, { timeout: malo });
      expect(r.ok, `con timeout ${JSON.stringify(malo)} fallo: ${r.error}`).toBe(true);
    }
  });
});
