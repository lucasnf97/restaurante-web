// @ts-check
// CARGA DE FACTURAS EN CADENA. Acá se mete plata y stock en la base de un
// restaurante CONCRETO, así que lo que se prueba es la guarda que importa: que no
// se pueda cargar nada sin haber dicho a cuál va, y que el destino esté siempre a
// la vista. Una factura cargada en el local equivocado ensucia su stock y su
// facturación, y no se nota hasta que alguien cruza los números.
//
// ⚠ SOLO LECTURA: no se sube ningún archivo ni se registra ninguna factura.
const { test, expect, tokenCadena } = require("./sesion");

/** gid 3 = las maquetas (0000A, 0000B, 0001A). El gid va SIEMPRE con su usuario. */
const MAQUETAS = { gid: Number(process.env.E2E_GID || 3), user: process.env.E2E_USER || "Lucas" };

test.describe("Facturas en modo cadena", () => {
  test.use({ rol: "gerente_cadena" });

  // El modo se enciende con ?cadena=1 Y con sesión de cadena: `esGerenteCadena()`
  // mira `ger_token`, que es el token base de la cadena (no el activo).
  const abrir = async (page) => {
    await page.addInitScript((t) => { localStorage.setItem("ger_token", t); },
                             tokenCadena(MAQUETAS.gid, MAQUETAS.user));
    await page.goto("/facturas.html?cadena=1");
    await expect(page.locator("#cadena-barra")).toBeVisible();
  };

  test("sin restaurante elegido no deja cargar ni una factura", async ({ page }) => {
    await abrir(page);
    await expect(page.locator("#cadena-barra")).toContainText(/Elegí un restaurante/i);
    await expect(page.locator("#cadena-sel-destino")).toHaveValue("");

    // ⚠ LA prueba: soltar un archivo sin destino no encola NADA. Si esto se
    //   rompiera, la factura quedaría en la cola sin dueño y el primer destino
    //   que se eligiera después se la llevaría puesta.
    const encoladas = await page.evaluate(async () => {
      const f = new File([new Uint8Array([1, 2, 3])], "prueba-sin-destino.pdf", { type: "application/pdf" });
      // @ts-ignore  (funciones globales de la página)
      await agregarArchivos([f]);
      // @ts-ignore
      return _archivosFactura.length;
    });
    expect(encoladas, "encoló una factura sin haber elegido restaurante").toBe(0);
  });

  test("el selector ofrece los restaurantes de la cadena", async ({ page }) => {
    await abrir(page);
    // Más de 1 = el vacío ("— Elegí el restaurante —") + los locales reales.
    await expect.poll(() => page.locator("#cadena-sel-destino option").count(),
                      { message: "el selector debería listar los locales de la cadena" })
      .toBeGreaterThan(1);
  });

  test("las pestañas de un solo restaurante quedan ocultas", async ({ page }) => {
    await abrir(page);
    // Historial / Servicios / Proveedores son de UN local, y en modo cadena el
    // token activo es el de cadena, que no resuelve ningún esquema. Ocultas es
    // mejor que fallando: una pestaña que revienta parece un bug del sistema.
    for (const t of ["historial", "servicios", "proveedores"]) {
      await expect(page.locator(`#tab-${t}`)).toBeHidden();
    }
    await expect(page.locator("#tab-cargar")).toBeVisible();
  });

});

test.describe("La pantalla de siempre no cambia", () => {
  // La contracara, y la que más importa: el modo cadena es ADITIVO. Un gerente
  // normal (de UN restaurante) no ve ninguna barra de destino y sigue teniendo
  // todas sus pestañas. Si esto se rompe, se rompió la pantalla que se usa todos
  // los días para cargar facturas.
  test("un gerente de un solo restaurante no ve nada del modo cadena", async ({ page }) => {
    await page.goto("/facturas.html");
    await expect(page.locator("#tab-cargar")).toBeVisible();
    await expect(page.locator("#tab-historial")).toBeVisible();
    await expect(page.locator("#tab-proveedores")).toBeVisible();
    await expect(page.locator("#cadena-barra")).toBeHidden();
  });

  test("ni siquiera con ?cadena=1 (no es gerente de cadena)", async ({ page }) => {
    // El modo exige ?cadena=1 Y sesión de cadena. Con la URL sola no se enciende:
    // si no, cualquiera con el link se quedaría sin las pestañas de su local.
    await page.goto("/facturas.html?cadena=1");
    await expect(page.locator("#tab-historial")).toBeVisible();
    await expect(page.locator("#cadena-barra")).toBeHidden();
  });
});
