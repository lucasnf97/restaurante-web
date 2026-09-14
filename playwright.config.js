// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/**
 * Pruebas end-to-end de la web, con Playwright.
 *
 *   npx playwright test                 todo
 *   npx playwright test stock           solo stock
 *   npx playwright test --headed        viendo el navegador
 *   npx playwright test --ui            modo interactivo (elegir y depurar)
 *   npx playwright show-report          el informe de la ultima corrida
 *
 * ANTES DE CORRER hay que tener la API local levantada en el 8000:
 *   cd ../restaurante-api
 *   ALLOWED_ORIGINS=http://127.0.0.1:5500 PYTHONUTF8=1 venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
 * (o doble clic en Escritorio\tema-oscuro\probar-tema.bat, que levanta las dos).
 * El servidor de la WEB lo levanta Playwright solo (ver `webServer` abajo).
 *
 * ⚠ DOS COSAS QUE NO SON OPCIONALES
 *
 * 1. `channel: "chrome"` usa el Chrome YA INSTALADO. Sin esto Playwright se
 *    descarga sus propios navegadores (~400 MB) la primera vez. El proyecto ya
 *    trabajaba asi con puppeteer-core.
 *
 * 2. La API local pega contra la base de PRODUCCION. Por eso estas pruebas son
 *    de SOLO LECTURA: miran filtros, ordenes, calculos en pantalla e impresion,
 *    y NO guardan nada. Si algun dia hace falta probar un guardado, que sea en
 *    un archivo aparte, marcado, y que revierta lo que toca.
 */
module.exports = defineConfig({
  testDir: "./e2e",
  // Sin paralelismo: todas las pruebas comparten la MISMA API local contra la
  // misma base. En paralelo se pisarian los datos que cada una espera leer.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://127.0.0.1:5500",
    channel: "chrome",
    viewport: { width: 1500, height: 900 },
    // Rastro y captura SOLO cuando algo falla: si no, cada corrida deja cientos
    // de megas de video que nadie mira.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],

  // Levanta el estatico de la web. `reuseExistingServer` para que no choque con
  // el que ya puede estar corriendo a mano en el 5500.
  webServer: {
    command: "python -m http.server 5500 --bind 127.0.0.1",
    url: "http://127.0.0.1:5500/index.html",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
