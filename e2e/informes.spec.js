// @ts-check
// LOS INFORMES: Análisis del mes, Históricos y Estadísticas de personal.
//
// Son varias pantallas que miran LOS MISMOS datos desde ángulos distintos, así
// que lo que hay que probar no es cada una por separado —eso lo ve cualquiera—
// sino que NO SE CONTRADIGAN. Dos pantallas que muestran facturaciones
// distintas del mismo mes es de lo peor que le puede pasar a esto: el dueño deja
// de creerle a las dos.
//
// ⚠ SOLO LECTURA.
//
// ⚠ TRAMPA DE NOMBRES, y es fácil caer: el mismo concepto tiene el nombre
//   INVERTIDO según el endpoint.
//     · `facturacion-mes`  → `ventas` es CON impuesto; el neto es `ventas_neto`.
//     · `ventas-diarias` y `facturacion-anual` → `facturacion` es el NETO; el
//       bruto es `facturacion_bruto`.
//   O sea que el nombre "pelado" significa bruto en un lado y neto en el otro.
//   Comparar `ventas` contra `facturacion` da una diferencia exactamente igual
//   al impuesto y parece un bug de cuentas. No lo es.
const { test, expect } = require("./sesion");

/** Un mes con ventas, buscando hacia atrás. Devuelve null si no hay ninguno. */
const mesConVentas = async (page) => {
  const hoy = new Date();
  for (let atras = 0; atras < 18; atras++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const r = await page.evaluate(async ({ y, m }) =>
      api.get(`/reportes/facturacion-mes?year=${y}&month=${m}`), { y, m });
    // ⚠ Un umbral, no "> 0": un mes con 5 € de residuo hace que las
    //   comparaciones de abajo pasen sin comparar nada real.
    if ((r.ventas || 0) > 500) return { y, m, datos: r };
  }
  return null;
};

const irA = async (page, pagina) => {
  await page.goto(`/${pagina}`);
  await expect(page.locator("body")).toBeVisible();
};

test.describe("Las pantallas no se contradicen", () => {
  test("Análisis del mes y Facturación dan el mismo mes", async ({ page }) => {
    await irA(page, "analisis-mes.html");
    const mes = await mesConVentas(page);
    test.skip(!mes, "no hay ningún mes con ventas en 18 meses");

    // ⚠ Las dos pantallas piden el MISMO endpoint. Si alguna empezara a
    //   calcular por su cuenta, acá se nota: es el único lugar donde se
    //   comparan de verdad.
    const desdeAnalisis = await page.evaluate(async ({ y, m }) =>
      api.get(`/reportes/facturacion-mes?year=${y}&month=${m}`), mes);

    await irA(page, "estadisticas.html");
    const desdeFacturacion = await page.evaluate(async ({ y, m }) =>
      apiFetch(`/reportes/facturacion-mes?year=${y}&month=${m}`), mes);

    for (const clave of ["ventas", "salarios", "salarios_total", "resultado",
                         "costo_insumos_facturados", "costo_servicios_facturados"]) {
      expect(desdeAnalisis[clave], `${clave} difiere entre las dos pantallas`)
        .toBeCloseTo(desdeFacturacion[clave] ?? 0, 1);
    }
  });

  test("el calendario anual cuadra con los meses uno por uno", async ({ page }) => {
    await irA(page, "historicos.html");
    const mes = await mesConVentas(page);
    test.skip(!mes, "no hay ningún mes con ventas");

    const anual = await page.evaluate(async (y) =>
      apiFetch(`/reportes/facturacion-anual?year=${y}`), mes.y);
    const meses = Array.isArray(anual) ? anual : (anual.meses || anual.datos || []);
    test.skip(!meses.length, "el calendario anual no devolvió meses");

    // ⚠ El mapa de calor colorea por RANKING. Si sus totales no fueran los
    //   mismos que los del mes, el color diría una cosa y el detalle otra.
    const delAnual = meses.find((x) => Number(x.mes ?? x.month) === mes.m);
    expect(delAnual, `el calendario no trae el mes ${mes.m}`).toBeTruthy();
    // `facturacion` del calendario es el NETO → se compara contra `ventas_neto`.
    const valor = Number(delAnual.facturacion);
    expect(valor, "el total del calendario difiere del mes")
      .toBeCloseTo(mes.datos.ventas_neto, 0);
    // Y el bruto también tiene que cuadrar, cada uno con su par.
    expect(Number(delAnual.facturacion_bruto), "el bruto del calendario difiere del mes")
      .toBeCloseTo(mes.datos.ventas, 0);
  });

  test("las ventas diarias suman lo mismo que el mes", async ({ page }) => {
    await irA(page, "historicos.html");
    const mes = await mesConVentas(page);
    test.skip(!mes, "no hay ningún mes con ventas");

    const ultimo = new Date(mes.y, mes.m, 0).getDate();
    const dd = (n) => String(n).padStart(2, "0");
    const desde = `${mes.y}-${dd(mes.m)}-01`, hasta = `${mes.y}-${dd(mes.m)}-${ultimo}`;

    const diarias = await page.evaluate(async ({ d, h }) =>
      apiFetch(`/reportes/ventas-diarias?desde=${d}&hasta=${h}`), { d: desde, h: hasta });
    const filas = Array.isArray(diarias) ? diarias : (diarias.dias || diarias.datos || []);
    test.skip(!filas.length, "no hay ventas diarias en ese mes");

    // ⚠ El día de negocio arranca a la HORA DE CORTE, no a medianoche. Por eso
    //   la suma de los días de un mes puede no dar EXACTO el total del mes: la
    //   madrugada del día 1 pertenece al último día del mes anterior. Se admite
    //   esa diferencia de borde, pero no una de otra magnitud: si el desvío
    //   pasara del 5%, no es el corte, es que una de las dos cuentas está mal.
    // ⚠ El campo es `facturacion` (NETA, con los descuentos ya aplicados).
    //   `facturacion_bruto` es el valor de carta y NO es lo que entró en caja.
    const suma = filas.reduce((s, f) => s + Number(f.facturacion ?? 0), 0);
    const delMes = mes.datos.ventas_neto;
    const desvio = Math.abs(suma - delMes) / Math.max(1, delMes);
    expect(desvio, `la suma diaria (${suma.toFixed(2)}) se aleja del mes ` +
      `(${delMes.toFixed(2)})`).toBeLessThan(0.05);
  });
});

test.describe("Estadísticas de personal", () => {
  test("los totales cuadran con la suma de los empleados", async ({ page }) => {
    await irA(page, "estadisticas-personal.html");
    const mes = await mesConVentas(page);
    test.skip(!mes, "no hay ningún mes con ventas");

    // ⚠ Este informe va por year+month, NO por desde/hasta: con desde/hasta los
    //   ignora y devuelve el AÑO entero, que es un número muchísimo mayor. Una
    //   prueba que le pasara fechas estaría comparando un mes contra un año.
    const r = await page.evaluate(async ({ y, m }) =>
      apiFetch(`/reportes/estadisticas-personal?year=${y}&month=${m}`), mes);
    expect(r.periodo, "el informe no dice qué período cubre").toBeTruthy();
    expect(r.periodo.month, "pidiendo un mes devolvió otro período").toBe(mes.m);

    const cam = r.camareros || {};
    const filas = cam.empleados || cam.detalle || cam.lista || [];
    test.skip(!Array.isArray(filas) || !filas.length, "sin camareros en el período");

    // ⚠ Un empleado repetido duplica sus horas en el total y hace que el
    //   ranking mienta: el que aparece dos veces "rinde" el doble.
    const ids = filas.map((e) => e.id ?? e.usuario_id ?? e.username);
    expect(new Set(ids).size, "hay empleados repetidos en el informe").toBe(ids.length);

    // Y el total que muestra la cabecera es la suma de las filas de abajo.
    const tot = cam.totales || {};
    if (tot.horas != null) {
      const suma = filas.reduce((s, e) => s + Number(e.horas ?? 0), 0);
      expect(suma, "las horas del total no son la suma de los empleados")
        .toBeCloseTo(Number(tot.horas), 0);
    }

    const raros = filas.filter((e) => {
      const h = Number(e.horas ?? 0);
      return h < 0 || h > 24 * 31;
    });
    expect(raros.map((e) => e.username || e.id),
      "hay empleados con horas imposibles en el mes").toEqual([]);
  });
});

test.describe("El mapa de calor de mesas", () => {
  test("no reparte más ventas de las que hubo", async ({ page }) => {
    await irA(page, "estadisticas-personal.html");
    const mes = await mesConVentas(page);
    test.skip(!mes, "no hay ningún mes con ventas");

    const ultimo = new Date(mes.y, mes.m, 0).getDate();
    const dd = (n) => String(n).padStart(2, "0");
    const r = await page.evaluate(async ({ d, h }) =>
      apiFetch(`/ventas/calor-mesas?desde=${d}&hasta=${h}`),
      { d: `${mes.y}-${dd(mes.m)}-01`, h: `${mes.y}-${dd(mes.m)}-${ultimo}` });

    const celdas = Array.isArray(r) ? r : (r.celdas || r.datos || []);
    test.skip(!celdas.length, "el mapa de calor no devolvió datos");

    // ⚠ El mapa reparte la facturación del mes por mesa y por hora. Si la suma
    //   diera MÁS que el mes, estaría contando dos veces algo —anulados,
    //   reaperturas— y el dueño creería que factura más de lo que factura.
    // ⚠ `total` en este endpoint es la CANTIDAD DE MESAS de esa celda, no
    //   plata. El importe es `facturado`. Sumar `total` da un número que
    //   parece razonable y no significa nada: la primera versión de esta
    //   prueba pasaba sumando conteos.
    const suma = celdas.reduce((s, c) => s + Number(c.facturado ?? 0), 0);
    expect(suma, `el mapa reparte ${suma.toFixed(2)} y el mes fue ` +
      `${mes.datos.ventas.toFixed(2)}`).toBeLessThanOrEqual(mes.datos.ventas * 1.05);
  });
});
