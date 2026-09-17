// @ts-check
// TPV EXTERNO — la página standalone que abre el integrador, fuera de la web
// (la sirve la propia API en `/tpv-config.html?t=<token>`). El backend ya está
// cubierto entero por `restaurante-api/verificar_tpv_e2e.py`; lo único que
// agrega esta prueba es ejercitar la página REAL en un navegador: elegir y
// guardar el proveedor "simulado", que el gateo liviano de /config/sistema lo
// vea, cobrar de prueba desde ahí, y que un link roto avise en vez de romperse
// en blanco.
//
// ⚠ Token de SUPERADMIN: no es un token del arenero (vive fuera de cualquier
//   inquilino) y se firma aparte con un esquema-señuelo para esquivar el atajo
//   de E2E_TOKEN de `../sesion.js` (que sólo pisa el token cuando el esquema
//   pedido es el default — acá NO lo es, así que siempre firma uno propio).
//
// ⚠ 0000B no se puede regenerar: se captura el proveedor/config ANTES de tocar
//   nada y se restaura EXACTO en el `finally`, y el link que esta prueba crea
//   se revoca al terminar (y se confirma por la propia página, no por la API).
const { test, expect, api, ir } = require("./_arenero");
const { token } = require("../sesion");

const CODIGO = "0000B";

test.describe("TPV externo — página standalone del link de config", () => {
  test.setTimeout(120_000);

  test("el integrador configura 'simulado' desde el link y cobra de prueba; un link roto avisa",
    async ({ page }) => {
      await ir(page, "dashboard.html");   // sesión del arenero + window._API_URL listos

      // ── Lo que había ANTES de tocar nada ──────────────────────────────
      const antes = await api(page, "GET", "/datafono/config");
      expect(antes.ok, `no se pudo leer la config actual de 0000B: ${antes.status}`).toBe(true);

      // Segundo argumento != al esquema default: nunca toma el atajo de E2E_TOKEN.
      const saTok = token("superadmin", "__superadmin_sin_esquema__");

      const rlist = await api(page, "GET", "/restaurantes/?codigo=" + CODIGO, undefined, saTok);
      expect(rlist.ok, `el superadmin no pudo listar restaurantes: ${rlist.status}`).toBe(true);
      const rest = (rlist.data || []).find((r) => r.codigo === CODIGO);
      expect(rest, `no se encontró el restaurante ${CODIGO} en el listado`).toBeTruthy();
      const rid = rest.id;
      const nombreEsperado = rest.nombre;

      const crea = await api(page, "POST", `/restaurantes/${rid}/tpv-token`, undefined, saTok);
      expect(crea.ok, `no se pudo crear el link de config TPV: ${crea.status} ${JSON.stringify(crea.data)}`)
        .toBe(true);
      const url = crea.data.url;
      const expiraEn = crea.data.expira_en;
      expect(url, "el alta no devolvió una url con el token").toContain("?t=");

      try {
        // ── La página standalone renderiza: nombre, selector, vencimiento ──
        await page.goto(url);
        await expect(page.locator("#card-invalido")).toBeHidden();
        await expect(page.locator("#card-form-wrap")).toBeVisible();
        await expect(page.locator("#restaurante-box .nombre")).toContainText(nombreEsperado);
        await expect(page.locator("#restaurante-box .vence")).toContainText(/\d{2}\/\d{2}\/\d{4}/);
        expect(await page.locator("#sel-proveedor option").count(),
          "el selector de proveedor no trae opciones").toBeGreaterThan(0);

        // ── Guardar 'simulado' (demora corta para no alargar la prueba) ──
        await page.selectOption("#sel-proveedor", "simulado");
        await expect(page.locator("#c-demora_seg")).toBeVisible();
        await page.fill("#c-demora_seg", "2");
        await page.selectOption("#c-resultado", "aprobar");
        await page.click("#btn-guardar");
        await expect(page.locator("#log")).toHaveText("✓ Guardado");

        // ── El gateo liviano de /config/sistema tiene que ver el cambio ──
        await ir(page, "dashboard.html");
        await expect.poll(async () => {
          const r = await api(page, "GET", "/config/sistema");
          return r.data && r.data.pago_tarjeta && r.data.pago_tarjeta.estado;
        }, { timeout: 15_000 }).toBe("integrado");

        // ── Cobro de prueba: el simulado aprueba solo, a los pocos segundos ──
        await page.goto(url);
        await expect(page.locator("#btn-probar")).toBeVisible();
        await page.click("#btn-probar");
        await expect.poll(() => page.locator("#log").textContent(), {
          timeout: 30_000, intervals: [1000],
        }).toContain("Aprobado");

        // ── Link inválido: mensaje de aviso, nunca el formulario ──
        const origen = new URL(url).origin;
        await page.goto(origen + "/tpv-config.html?t=deadbeefbad");
        await expect(page.locator("#card-invalido")).toBeVisible();
        await expect(page.locator("#card-form-wrap")).toBeHidden();
      } finally {
        // Restaurar EXACTO el proveedor/config de 0000B.
        await ir(page, "dashboard.html");
        const restaurar = await api(page, "PUT", "/datafono/config",
          { proveedor: antes.data.proveedor, config: antes.data.config });
        expect(restaurar.ok, `no se pudo restaurar la config original: ${restaurar.status}`)
          .toBe(true);
        const post = await api(page, "GET", "/datafono/config");
        expect(post.data && post.data.proveedor, "el proveedor no volvió a como estaba")
          .toBe(antes.data.proveedor);

        // Revocar el link que esta prueba creó, y confirmarlo por la MISMA
        // página (no por la API): es lo que de verdad le pasaría al integrador.
        const lista = await api(page, "GET", `/restaurantes/${rid}/tpv-tokens`, undefined, saTok);
        const fila = (lista.data || []).find((t) => t.expira_en === expiraEn && !t.revocado);
        if (fila) {
          const rev = await api(page, "DELETE", `/restaurantes/tpv-token/${fila.id}`, undefined, saTok);
          expect(rev.ok, `no se pudo revocar el link: ${rev.status}`).toBe(true);
          await page.goto(url);
          await expect(page.locator("#card-invalido")).toBeVisible();
        }
      }
    });
});
