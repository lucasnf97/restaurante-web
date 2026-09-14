// @ts-check
// Facturación y Estadísticas: la pantalla donde el dueño mira el mes cerrado.
// Lo que se prueba es que los números CUADREN entre sí — que el detalle sume lo
// que dice la tarjeta— y que el resultado del mes salga de sus partes.
//
// ⚠ SOLO LECTURA. Se abren los detalles y se leen. No se guarda una meta, no se
//   registra un gasto y no se toca una factura.
const { test, expect } = require("./sesion");

/** Abre la pantalla y espera a que el mes esté cargado. */
const irAFacturacion = async (page) => {
  await page.goto("/estadisticas.html");
  await expect.poll(() => page.evaluate(() =>
    (typeof datosMes !== "undefined" && datosMes) ? 1 : 0),
    { timeout: 30_000 }).toBe(1);
};

/**
 * Retrocede mes a mes hasta que `condicion` se cumpla. La pantalla abre en el mes
 * en curso, que a mitad de mes puede estar vacío: probar ahí es no probar nada.
 * Devuelve false si no encuentra ninguno en dos años.
 */
const retrocederHasta = async (page, condicion) => {
  for (let i = 0; i < 24; i++) {
    if (await page.evaluate(condicion)) return true;
    await page.evaluate(() => { datosMes = null; cambiarMes(-1); });
    await expect.poll(() => page.evaluate(() => (datosMes ? 1 : 0)),
      { timeout: 30_000 }).toBe(1);
  }
  return false;
};

const HAY_SALARIOS = () => ((datosMes || {}).salarios_total ||
                            (datosMes || {}).salarios || 0) !== 0;

/**
 * Un mes en el que ADEMÁS cerró un período con ajuste. Es el único caso en que el
 * detalle por empleado NO suma solo la tarjeta y hace falta la línea aparte; sin
 * buscarlo, la prueba del cuadre pasa sin haber ejercido lo que dice probar.
 */
// ⚠ Autocontenido: el predicado viaja al navegador serializado y ahí no existe
//   nada de este archivo, ni siquiera la función de al lado.
const HAY_AJUSTE = () => ((datosMes || {}).salarios_ajuste_periodo || 0) !== 0;

const irAMesConSalarios = (page) => retrocederHasta(page, HAY_SALARIOS);

/** Número de un texto con símbolo de moneda y separadores de miles. */
const aNumero = (t) => {
  const s = String(t).replace(/[^\d.,-]/g, "");
  // El formato es 1.234,56 (punto de miles, coma decimal).
  return parseFloat(s.replace(/\./g, "").replace(",", "."));
};

/** Abre un detalle y devuelve el texto de su tabla, ya cargada. */
const abrir = async (page, tipo) => {
  await page.evaluate((t) => abrirDetalle(t), tipo);
  const cuerpo = page.locator("#detalle-body");
  await expect(cuerpo).toBeVisible();
  await expect(cuerpo).not.toContainText(/^\s*Cargando/i, { timeout: 30_000 });
  return cuerpo;
};

test.describe("El mes cuadra consigo mismo", () => {
  test("el detalle de salarios suma lo que dice la tarjeta", async ({ page }) => {
    await irAFacturacion(page);
    // Se busca primero un mes donde HAYA cerrado un período con ajuste: es el
    // único caso en que el detalle por empleado no suma solo el total y la línea
    // aparte hace falta. Si no hay ninguno, sirve cualquiera con salarios.
    if (!(await retrocederHasta(page, HAY_AJUSTE))) {
      await irAFacturacion(page);
      test.skip(!(await irAMesConSalarios(page)), "ningún mes reciente tiene salarios");
    }
    const d = await page.evaluate(() => datosMes);
    const esperado = d.salarios_total != null ? d.salarios_total : (d.salarios || 0);

    const cuerpo = await abrir(page, "salarios");
    const filas = await cuerpo.locator("tr.det-total td.num").allInnerTexts();
    test.skip(!filas.length, "el mes no tiene detalle por empleado");

    // ⚠ El detalle se arma con la nómina del MES CALENDARIO, y la tarjeta con el
    //   informe, que además imputa a este mes los ajustes de un período que
    //   cerró acá. Esas horas no están en ninguna fila de empleado: por eso hay
    //   una línea propia "Ajuste de nómina cerrada". Si alguien la saca, el
    //   detalle deja de sumar lo que anuncia la tarjeta y nadie lo nota hasta
    //   que un contador pide que le expliquen la diferencia.
    const costoTotal = aNumero(filas[filas.length - 1]);
    expect(costoTotal, "el detalle por empleado no suma el total del mes")
      .toBeCloseTo(esperado, 0);
  });

  test("el costo laboral del detalle es el de la nómina más el ajuste",
    async ({ page }) => {
      await irAFacturacion(page);
      await irAMesConSalarios(page);
      const r = await page.evaluate(async () => {
        const d = datosMes;
        const sd = await apiFetch(
          `/salarios/resumen?year=${anioActual}&month=${mesActual}`);
        return {
          bruto: d.salarios, cargos: d.salarios_cargos,
          ajuste: d.salarios_ajuste_periodo || 0,
          nomina: sd.total_salarios,
        };
      });
      // Es la misma igualdad que fija salarios.spec.js, pero acá se comprueba
      // con el ajuste EXPLÍCITO en vez de saltear los meses donde lo hay.
      expect(r.bruto - r.cargos, "informe ≠ nómina + ajuste del período")
        .toBeCloseTo(r.nomina + r.ajuste, 1);
    });

  test("el resultado del mes es la venta menos sus costos", async ({ page }) => {
    await irAFacturacion(page);
    await irAMesConSalarios(page);
    const d = await page.evaluate(() => datosMes);

    // Si esto se despega, el dueño está mirando una ganancia que no existe.
    const costos = (d.costo_insumos_facturados || 0) + (d.costo_servicios_facturados || 0)
                 + (d.costo_bienes_facturados || 0) + (d.refunds || 0)
                 + (d.salarios_total != null ? d.salarios_total : (d.salarios || 0))
                 + (d.ajuste_facturas || 0);
    expect(typeof d.resultado, "el informe no trae resultado").toBe("number");
    expect(d.resultado).toBeCloseTo((d.ventas_neto != null ? d.ventas_neto : d.ventas) - costos, 0);
  });
});

test("cada tarjeta del mes abre un detalle con datos", async ({ page }) => {
  // Barrido barato: cada detalle es una consulta distinta y cualquiera puede
  // romperse sola. Que abra y no quede en blanco ya descarta lo más común.
  //
  // ⚠ Las tarjetas se leen del DOM, no de una lista escrita acá. Con una lista a
  //   mano se termina probando lo que ya no existe: así apareció una rama
  //   'insumos' que pintaba "undefined" y que ninguna tarjeta abre.
  await irAFacturacion(page);
  await irAMesConSalarios(page);

  const tipos = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#billing-cards .bill-card"))
      .map((c) => Array.from(c.classList).find((x) => x !== "bill-card"))
      .filter(Boolean));
  expect(tipos.length, "la pantalla no pintó ninguna tarjeta").toBeGreaterThan(3);

  const malos = [];
  for (const tipo of tipos) {
    const cuerpo = await abrir(page, tipo);
    const txt = (await cuerpo.innerText()).trim();
    if (txt.length <= 10) malos.push(`${tipo}: quedó vacío`);
    if (/undefined|NaN/i.test(txt)) malos.push(`${tipo}: ${txt.slice(0, 120)}`);
    await page.evaluate(() => cerrarDetalle());
  }
  expect(malos).toEqual([]);
});
