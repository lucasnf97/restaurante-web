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
//   nada, y:
//   · Si el baseline tuviera un campo password con un secreto guardado, la
//     prueba se SALTA (no corre): `PUT /datafono/config` conserva un password
//     sólo si viaja el sentinela `__GUARDADO__`, y el sentinela se resuelve
//     contra el config ACTUAL en ese momento (el de "simulado"), no contra el
//     original — restaurar "exacto" sería, en ese caso, un acto de fe. Hoy el
//     baseline de 0000B es `manual` (sin campos), así que esto no dispara.
//   · La limpieza (revocar el token + restaurar la config) corre ENTERA y
//     ANTES de afirmar nada: cada paso en su propio try/catch, para que un
//     fallo en uno no le impida correr al otro ni deje el link de 48h vivo.
const { test, expect, api, ir } = require("./_arenero");
const { token } = require("../sesion");

const CODIGO = "0000B";

/** Comparación estable de dos configs (JSON con las claves ordenadas). */
const canon = (o) => JSON.stringify(
  Object.keys(o || {}).sort().reduce((acc, k) => { acc[k] = o[k]; return acc; }, {})
);

test.describe("TPV externo — página standalone del link de config", () => {
  test.setTimeout(120_000);

  test("el integrador configura 'simulado' desde el link y cobra de prueba; un link roto avisa",
    async ({ page }) => {
      await ir(page, "dashboard.html");   // sesión del arenero + window._API_URL listos

      // ── Lo que había ANTES de tocar nada ──────────────────────────────
      const antes = await api(page, "GET", "/datafono/config");
      expect(antes.ok, `no se pudo leer la config actual de 0000B: ${antes.status}`).toBe(true);

      // ⚠ Si el proveedor base tiene un secreto guardado, restaurar "exacto"
      //   por PUT no es seguro (ver nota de arriba): mejor no correr que
      //   arriesgarse a pisarlo con el enmascarado.
      const catalogo = await api(page, "GET", "/datafono/proveedores");
      expect(catalogo.ok, `no se pudo leer el catálogo de proveedores: ${catalogo.status}`).toBe(true);
      const driverBase = (catalogo.data || []).find((d) => d.key === antes.data.proveedor);
      const camposPassword = ((driverBase && driverBase.campos) || []).filter((c) => c.tipo === "password");
      const baselineConSecreto = camposPassword.some((c) => !!(antes.data.config || {})[c.key]);
      test.skip(baselineConSecreto,
        `el proveedor base de 0000B ('${antes.data.proveedor}') tiene un secreto guardado ` +
        `(${camposPassword.map((c) => c.key).join(", ")}); no se corre para no arriesgar pisarlo ` +
        "con el enmascarado de PUT /datafono/config — ver task-12-fix-findings.md");

      // Segundo argumento != al esquema default: nunca toma el atajo de E2E_TOKEN.
      const saTok = token("superadmin", "__superadmin_sin_esquema__");

      const rlist = await api(page, "GET", "/restaurantes/?codigo=" + CODIGO, undefined, saTok);
      expect(rlist.ok, `el superadmin no pudo listar restaurantes: ${rlist.status}`).toBe(true);
      const rest = (rlist.data || []).find((r) => r.codigo === CODIGO);
      expect(rest, `no se encontró el restaurante ${CODIGO} en el listado`).toBeTruthy();
      const rid = rest.id;
      const nombreEsperado = rest.nombre;

      const crea = await api(page, "POST", `/restaurantes/${rid}/tpv-token`, undefined, saTok);
      // ⚠ El try empieza YA, justo tras crear el token: si el propio create
      //   reportó algo raro pero el token quedó insertado del lado del server,
      //   la limpieza de abajo tiene que correr igual.
      const url = crea.data && crea.data.url;
      const expiraEn = crea.data && crea.data.expira_en;

      try {
        expect(crea.ok, `no se pudo crear el link de config TPV: ${crea.status} ${JSON.stringify(crea.data)}`)
          .toBe(true);
        expect(url, "el alta no devolvió una url con el token").toContain("?t=");

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
        // ── Limpieza SIEMPRE completa, pase lo que pase arriba. Primero se
        //    revoca el token y se restaura la config —cada paso en su propio
        //    try/catch, para que uno no le impida correr al otro—, y RECIÉN
        //    DESPUÉS se afirma que salió bien. Así, una aserción de restore
        //    que lance a mitad de camino no deja el link de 48h sin revocar.
        let revocado = !expiraEn;   // sin token creado, no hay nada que revocar
        try {
          if (expiraEn) {
            await ir(page, "dashboard.html");
            const lista = await api(page, "GET", `/restaurantes/${rid}/tpv-tokens`, undefined, saTok);
            const fila = (lista.data || []).find((t) => t.expira_en === expiraEn && !t.revocado);
            if (fila) {
              const rev = await api(page, "DELETE", `/restaurantes/tpv-token/${fila.id}`, undefined, saTok);
              revocado = !!rev.ok;
            }
          }
        } catch (e) { /* se afirma abajo — no debe impedir el restore de la config */ }

        let restaurado = false;
        let postRestore = null;
        try {
          await ir(page, "dashboard.html");
          const put = await api(page, "PUT", "/datafono/config",
            { proveedor: antes.data.proveedor, config: antes.data.config });
          restaurado = !!put.ok;
          postRestore = await api(page, "GET", "/datafono/config");
        } catch (e) { /* se afirma abajo */ }

        // Recién ahora, con la limpieza YA hecha entera, afirmar que salió bien.
        expect(revocado, "no se pudo revocar el link creado (queda un link de 48h vivo)").toBe(true);
        expect(restaurado, "no se pudo restaurar la config original de 0000B").toBe(true);
        expect(postRestore && postRestore.ok, "no se pudo releer la config tras restaurar").toBe(true);
        expect((postRestore && postRestore.data && postRestore.data.proveedor) || null,
          "el proveedor no volvió a como estaba").toBe(antes.data.proveedor);
        expect(canon(postRestore && postRestore.data && postRestore.data.config),
          "el config no volvió a como estaba").toBe(canon(antes.data.config));

        // Confirmación visual por la propia página (la limpieza de arriba ya
        // corrió y ya se afirmó: esto es una comprobación extra, no cleanup).
        if (url) {
          await page.goto(url);
          await expect(page.locator("#card-invalido")).toBeVisible();
        }
      }
    });
});
