// @ts-check
// Caja e historial. Es la pantalla donde un error cuesta dinero, así que lo que
// se prueba es la LÓGICA: el estado y sus botones, el filtrado del historial y
// la cuenta de un refund.
//
// ⚠ SOLO LECTURA, y acá importa más que en ningún lado: NO se abre ni se cierra
//   la caja, NO se confirma un refund y NO se reimprime nada. Abrir la caja del
//   restaurante desde una prueba sería un desastre en pleno servicio. Lo que
//   toca plata se verifica sobre las funciones de cálculo y sobre los guardas
//   de la pantalla, sin llegar nunca al botón que escribe.
const { test, expect } = require("./sesion");

const irACaja = async (page) => {
  await page.goto("/caja.html");
  await expect(page.locator("#estado-pill")).toHaveText(/ABIERTA|CERRADA/);
};

test.describe("Estado de caja", () => {
  test("los botones de abrir y cerrar son coherentes con el estado", async ({ page }) => {
    await irACaja(page);

    const abierta = await page.locator("#estado-pill").innerText()
      .then((t) => /ABIERTA/.test(t));
    const btnAbrir = page.locator("#btn-abrir");
    const btnCerrar = page.locator("#btn-cerrar");

    // La invariante que importa: NUNCA los dos habilitados. Si se pudiera abrir
    // una caja ya abierta quedarían dos aperturas vivas y el arqueo del turno
    // dejaría de cuadrar.
    if (abierta) {
      await expect(btnAbrir).toBeDisabled();
      await expect(btnCerrar).toBeEnabled();
    } else {
      await expect(btnAbrir).toBeEnabled();
      await expect(btnCerrar).toBeDisabled();
    }

    // Y el detalle acompaña al estado, no queda con el del estado anterior.
    await expect(page.locator("#estado-detalle"))
      .toHaveText(abierta ? /Abierta por:/ : /Último cierre:|Sin cierres registrados/);
  });

  test("el resumen de hoy muestra números, no el placeholder", async ({ page }) => {
    await irACaja(page);
    await expect(page.locator("#stat-pedidos")).toHaveText(/^\d+$/);
    await expect(page.locator("#stat-total")).toHaveText(/[\d.,]+$/);
  });
});

test.describe("Historial de cierres", () => {
  const filas = (page) => page.locator("#tabla-body tr");

  const esperarHistorial = async (page) => {
    await expect(page.locator("#tabla-body .ui-skel")).toHaveCount(0);
    await expect(filas(page).first()).toBeVisible();
  };

  test("arranca filtrado por hoy y se puede ampliar el rango", async ({ page }) => {
    await irACaja(page);
    await esperarHistorial(page);

    // Por defecto el filtro es el día de hoy (init() lo pone).
    const hoy = new Date();
    const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-` +
                `${String(hoy.getDate()).padStart(2, "0")}`;
    await expect(page.locator("#filtro-desde")).toHaveValue(iso);

    // Ampliar el rango no puede DEVOLVER MENOS cierres que el rango chico.
    const deHoy = await filas(page).count();
    await page.fill("#filtro-desde", "2020-01-01");
    await expect.poll(() => filas(page).count()).toBeGreaterThanOrEqual(deHoy);
  });

  test("buscar por ID trae ese cierre, y uno inexistente lo dice", async ({ page }) => {
    await irACaja(page);
    await page.fill("#filtro-desde", "2020-01-01");
    await esperarHistorial(page);

    const primerId = (await filas(page).first().locator("td").first().innerText())
      .replace(/[^\d]/g, "");
    test.skip(!primerId, "no hay cierres en la base de prueba");

    await page.fill("#filtro-cierre-id", primerId);
    await expect.poll(async () => {
      const ids = await page.locator("#tabla-body tr td:first-child").allInnerTexts();
      return ids.map((t) => t.replace(/[^\d]/g, ""));
    }).toEqual([primerId]);

    // ⚠ Escribiendo, SIN salir del campo: es lo que hace una persona que teclea
    //   el número y se queda mirando. Antes el campo sólo tenía `onchange` y no
    //   pasaba nada; peor, seguían a la vista los cierres de la búsqueda
    //   anterior, que se leen como si fueran la respuesta.
    await page.fill("#filtro-cierre-id", "");
    await page.click("#filtro-cierre-id");
    await page.keyboard.type("99999999");
    // 30 s: la API local paga un viaje a Railway por consulta y con la suite
    // entera en marcha se pasa del margen por defecto. No es lentitud de la
    // pantalla, es el banco de pruebas.
    await expect(page.locator("#tabla-body"))
      .toContainText(/no encontrado/i, { timeout: 30_000 });
  });

  test("gana la última búsqueda, no la que conteste última", async ({ page }) => {
    await irACaja(page);
    await esperarHistorial(page);

    // ⚠ Con la búsqueda en vivo puede haber varias consultas en vuelo: quien
    //   escribe "330" con pausas dispara una por el 3, otra por el 33 y otra por
    //   el 330. Si la del 3 tarda más, llega después y pisa el resultado del
    //   330: se vería un cierre que no es el pedido, con el campo diciendo otra
    //   cosa. Acá se fuerza justo ese orden.
    const resultado = await page.evaluate(async () => {
      const orig = api.get;
      api.get = async (ep) => {
        if (/\/caja\/cierres\/1$/.test(ep)) {              // la vieja, LENTA
          await new Promise((r) => setTimeout(r, 1200));
          return { cierre: { id: 1, abierto_por: "VIEJA", ts_apertura: null,
                             cerrado_por: "VIEJA", ts_cierre: null, total: 1 } };
        }
        if (/\/caja\/cierres\/2$/.test(ep)) {              // la nueva, rápida
          return { cierre: { id: 2, abierto_por: "NUEVA", ts_apertura: null,
                             cerrado_por: "NUEVA", ts_cierre: null, total: 2 } };
        }
        return orig(ep);
      };
      document.getElementById("filtro-cierre-id").value = "1";
      const vieja = cargarCierres();                        // arranca y se cuelga
      document.getElementById("filtro-cierre-id").value = "2";
      await cargarCierres();                                // contesta enseguida
      await vieja;                                          // llega tarde
      api.get = orig;
      return document.getElementById("tabla-body").innerText;
    });

    expect(resultado, "la respuesta vieja pisó a la nueva").toContain("NUEVA");
    expect(resultado).not.toContain("VIEJA");
  });
});

test.describe("Refund", () => {
  // ⚠ Se prueban las funciones de cálculo y los guardas, NUNCA el confirmar.
  //   Un refund confirmado mueve plata de verdad y deja rastro contable.

  test("el total aplica cantidad, precio y descuento", async ({ page }) => {
    await irACaja(page);

    const casos = [
      { items: [{ cantidad: 2, precio_unit: 10, descuento_pct: 0 }], esperado: 20 },
      { items: [{ cantidad: 1, precio_unit: 100, descuento_pct: 25 }], esperado: 75 },
      { items: [{ cantidad: 3, precio_unit: 7.5, descuento_pct: 10 }], esperado: 20.25 },
      { items: [{ cantidad: 2, precio_unit: 10, descuento_pct: 0 },
                { cantidad: 1, precio_unit: 50, descuento_pct: 50 }], esperado: 45 },
      { items: [], esperado: 0 },
    ];

    for (const { items, esperado } of casos) {
      const total = await page.evaluate((its) => {
        revRefundItems = its;
        return revRefundActualizarTotal();
      }, items);
      expect(total, `items: ${JSON.stringify(items)}`).toBeCloseTo(esperado, 2);
    }
  });

  test("sin motivo no se puede confirmar", async ({ page }) => {
    await irACaja(page);

    // El motivo es obligatorio por diseño: un refund sin explicación deja un
    // agujero en la caja que después nadie puede reconstruir.
    const sinMotivo = await page.evaluate(() => {
      document.getElementById("refund-motivo").value = "   ";
      const ok = revRefundValidar();
      return { ok: !!ok, deshabilitado: document.getElementById("btn-refund-confirmar").disabled };
    });
    expect(sinMotivo.ok).toBe(false);
    expect(sinMotivo.deshabilitado).toBe(true);

    const conMotivo = await page.evaluate(() => {
      document.getElementById("refund-motivo").value = "Plato devuelto: llegó frío";
      const ok = revRefundValidar();
      return { ok: !!ok, deshabilitado: document.getElementById("btn-refund-confirmar").disabled };
    });
    expect(conMotivo.ok).toBe(true);
    expect(conMotivo.deshabilitado).toBe(false);
  });
});
