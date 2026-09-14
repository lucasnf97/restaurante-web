// @ts-check
// Estadísticas de Ventas: rentabilidad por producto, consumo de insumos y
// demanda. Es la pantalla con la que se decide qué plato empujar y cuál sacar
// de la carta, así que lo que se prueba es que los números se sostengan entre
// sí y que la clasificación diga lo que dice que dice.
//
// ⚠ SOLO LECTURA. Se cambian filtros y órdenes —que es todo lo que hace esta
//   pantalla— y se leen los resultados. No escribe nada.
const { test, expect } = require("./sesion");

/** Abre la pantalla y espera a que la rentabilidad esté cargada. */
const irAVentas = async (page) => {
  await page.goto("/ventas-estadisticas.html");
  await expect.poll(() => page.evaluate(() =>
    (typeof _rentProds !== "undefined" && _rentProds) ? _rentProds.length : -1),
    { timeout: 40_000 }).toBeGreaterThanOrEqual(0);
};

const productos = (page) => page.evaluate(() => _rentProds);

/**
 * Abre el rango a dos años para atrás. El filtro arranca en los últimos días y
 * un restaurante sin ventas esta semana deja la pantalla vacía: probar ahí es no
 * probar nada, y las pruebas se saltean sin que nadie lo note.
 */
const irAVentasConDatos = async (page) => {
  await irAVentas(page);
  if ((await productos(page)).length) return true;
  // ⚠ Centinela en null y esperar a que deje de serlo. Con `length >= 0` la
  //   espera se cumple al instante —un array vacío ya la satisface— y se lee la
  //   tabla antes de que llegue la respuesta: las pruebas se salteaban con datos
  //   de sobra en la base.
  await page.evaluate(() => {
    const hoy = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-` +
                       `${String(d.getDate()).padStart(2, "0")}`;
    document.getElementById("rent-desde").value = iso(new Date(hoy.getFullYear() - 2, 0, 1));
    document.getElementById("rent-hasta").value = iso(hoy);
    _rentProds = null;
    cargarRentProductos();
  });
  await expect.poll(() => page.evaluate(() => (_rentProds ? 1 : 0)),
    { timeout: 60_000 }).toBe(1);
  return (await productos(page)).length > 0;
};

test.describe("Rentabilidad por producto", () => {
  test("cada producto con receta tiene margen = ingresos − costo", async ({ page }) => {
    test.skip(!(await irAVentasConDatos(page)), "no hay ventas en dos años");
    const prods = await productos(page);

    for (const p of prods) {
      // El neto sale del bruto menos el impuesto: si esto se corre, todo el
      // food-cost de la carta queda mal por el mismo factor.
      expect(p.ingresos_neto, `neto de ${p.nombre}`)
        .toBeCloseTo(p.ingresos_inc - p.iva, 1);
      if (!p.tiene_receta) continue;
      expect(p.margen_total, `margen de ${p.nombre}`)
        .toBeCloseTo(p.ingresos_neto - p.costo_total, 1);
      expect(p.costo_total, `costo de ${p.nombre}`)
        .toBeCloseTo(p.costo_unit * p.unidades, 0);
    }
  });

  test("los KPI salen de las filas que están abajo", async ({ page }) => {
    test.skip(!(await irAVentasConDatos(page)), "no hay ventas en dos años");
    const r = await page.evaluate(async () => {
      const desde = document.getElementById("rent-desde").value;
      const hasta = document.getElementById("rent-hasta").value;
      const inc = document.getElementById("rent-incluir-combos").checked;
      const d = await api.get(
        `/ventas/rentabilidad?desde=${desde}&hasta=${hasta}&incluir_combos=${inc}`);
      return { resumen: d.resumen, prods: d.productos };
    });
    test.skip(!r.prods.length, "el período no tiene ventas");

    const conReceta = r.prods.filter((p) => p.tiene_receta);
    const suma = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

    // ⚠ La ganancia bruta sólo cuenta lo que TIENE receta: un plato sin receta
    //   cargada no aporta costo, y si entrara al total la ganancia saldría
    //   inflada por el precio entero de ese plato.
    expect(r.resumen.ingresos_neto).toBeCloseTo(suma(r.prods, (p) => p.ingresos_neto), 1);
    expect(r.resumen.cogs).toBeCloseTo(suma(conReceta, (p) => p.costo_total), 1);
    expect(r.resumen.ganancia_bruta)
      .toBeCloseTo(suma(conReceta, (p) => p.ingresos_neto) - r.resumen.cogs, 1);
  });

  test("la clasificación del menú es la que dicen los promedios", async ({ page }) => {
    test.skip(!(await irAVentasConDatos(page)), "no hay ventas en dos años");
    const prods = await productos(page);
    const conReceta = prods.filter((p) => p.tiene_receta);
    test.skip(conReceta.length < 2, "no hay productos con receta suficientes");

    // Estrella / caballo / puzzle / perro salen de comparar contra el PROMEDIO
    // de los productos con receta. Es lo que el dueño usa para decidir qué sacar
    // de la carta: una etiqueta mal puesta saca el plato equivocado.
    const prom = (f) => conReceta.reduce((s, p) => s + f(p), 0) / conReceta.length;
    const avgU = prom((p) => p.unidades);
    const avgM = prom((p) => p.margen_unit);

    for (const p of conReceta) {
      const pop = p.unidades >= avgU;
      const mar = p.margen_unit >= avgM;
      const esperada = pop && mar ? "estrella" : pop ? "caballo" : mar ? "puzzle" : "perro";
      expect(p.clasificacion, `${p.nombre} (${p.unidades} u, margen ${p.margen_unit})`)
        .toBe(esperada);
    }
  });
});

test.describe("Ordenar la tabla", () => {
  // ⚠ Un orden que pierde filas es de los errores más caros de esta pantalla:
  //   el producto que falta parece que no se vendió.

  const COLUMNAS = ["nombre", "categoria", "unidades", "ingresos_neto",
                    "costo_total", "margen_total", "food_cost_pct", "clasificacion"];

  test("ordenar por cualquier columna no pierde ni duplica productos",
    async ({ page }) => {
      test.skip(!(await irAVentasConDatos(page)), "no hay ventas en dos años");
      const prods = await productos(page);
      test.skip(prods.length < 2, "hacen falta al menos dos productos");
      const esperadas = prods.length;

      for (const col of COLUMNAS) {
        for (const paso of [1, 2]) {            // clic y contra-clic: asc y desc
          const n = await page.evaluate((c) => {
            sortRentDet(c);
            return document.querySelectorAll("#rent-detalle tr").length;
          }, col);
          expect(n, `${col} (clic ${paso}) cambió la cantidad de filas`).toBe(esperadas);
        }
      }
    });

  test("ordenar por ingresos ordena de verdad, en los dos sentidos",
    async ({ page }) => {
      test.skip(!(await irAVentasConDatos(page)), "no hay ventas en dos años");
      test.skip((await productos(page)).length < 2, "hacen falta al menos dos productos");

      const valores = async () => page.evaluate(() =>
        Array.from(document.querySelectorAll("#rent-detalle tr"))
          .map((tr) => tr.children[3] ? tr.children[3].textContent.trim() : "")
          .map((t) => parseFloat(t.replace(/[^\d,-]/g, "").replace(",", ".")))
          .filter((n) => !isNaN(n)));

      await page.evaluate(() => { _rentDetSort = { col: null, dir: "desc" }; sortRentDet("ingresos_neto"); });
      const desc = await valores();
      await page.evaluate(() => sortRentDet("ingresos_neto"));
      const asc = await valores();

      expect(desc.length).toBeGreaterThan(1);
      expect([...desc].sort((a, b) => b - a), "el descendente no está ordenado").toEqual(desc);
      expect([...asc].sort((a, b) => a - b), "el ascendente no está ordenado").toEqual(asc);
      // Y es el mismo conjunto dado vuelta, no otro.
      expect([...asc].sort((a, b) => a - b)).toEqual([...desc].sort((a, b) => a - b));
    });
});

test.describe("Dos consultas en vuelo", () => {
  // ⚠ Quien cambia el rango de fechas y enseguida lo corrige deja dos consultas
  //   viajando. Pasaban dos cosas: el gráfico reventaba con "Canvas is already
  //   in use" —la segunda carga liberaba el lienzo ANTES de que la primera
  //   montara el suyo— y, si la vieja contestaba última, pintaba sus números
  //   con las fechas de la nueva a la vista.

  test("gana la última, y el gráfico no se pisa", async ({ page }) => {
    test.skip(!(await irAVentasConDatos(page)), "no hay ventas en dos años");

    const r = await page.evaluate(async () => {
      const orig = api.get;
      let lenta = true;
      api.get = async (ep) => {
        if (/\/ventas\/rentabilidad\?/.test(ep) && lenta) {
          lenta = false;
          await new Promise((res) => setTimeout(res, 1200));      // la VIEJA, lenta
          const d = await orig(ep);
          // Se le cambia el nombre del primer producto para reconocerla.
          if (d.productos && d.productos[0]) d.productos[0].nombre = "VIEJA";
          return d;
        }
        return orig(ep);
      };
      const vieja = cargarRentProductos();     // arranca y se cuelga
      const nueva = cargarRentProductos();     // contesta enseguida
      await nueva;
      await vieja;                             // llega tarde
      api.get = orig;
      return {
        nombres: _rentProds.map((p) => p.nombre),
        tabla: document.getElementById("rent-detalle").innerText,
      };
    });

    expect(r.nombres, "la respuesta vieja pisó a la nueva").not.toContain("VIEJA");
    expect(r.tabla).not.toContain("VIEJA");
    // Si el lienzo quedara ocupado, `sesion.js` haría fallar la prueba por el
    // error de JavaScript que tira Chart.js.
  });
});

test.describe("Clasificación de la demanda", () => {
  test("cada tramo cae donde dicen los umbrales", async ({ page }) => {
    await irAVentas(page);

    const r = await page.evaluate(() => {
      const guardado = demUmbrales;
      demUmbrales = { alta: 25, baja: -20, caida: -40 };
      const f = (v) => reclasificar({ datos_suficientes: true, variacion_ajustada: v });
      const out = {
        muyArriba: f(80), justoArriba: f(25.1), enElBorde: f(25), normal: f(0),
        floja: f(-25), justoEnCaida: f(-40), hundida: f(-70),
        sinDatos: reclasificar({ datos_suficientes: false, variacion_ajustada: 999 }),
        sinValor: reclasificar({ datos_suficientes: true, variacion_ajustada: null }),
      };
      demUmbrales = guardado;
      return out;
    });

    expect(r.muyArriba).toBe("alta");
    expect(r.justoArriba).toBe("alta");
    expect(r.enElBorde, "el umbral exacto no es 'alta': es el borde de abajo").toBe("normal");
    expect(r.normal).toBe("normal");
    expect(r.floja).toBe("baja");
    expect(r.justoEnCaida).toBe("caida");
    expect(r.hundida).toBe("caida");
    // Sin datos NO se clasifica: inventar una tendencia con dos ventas es peor
    // que decir que no se sabe.
    expect(r.sinDatos).toBe("observacion");
    expect(r.sinValor).toBe("observacion");
  });

  test("los tramos cubren toda la recta y no se pisan", async ({ page }) => {
    await irAVentas(page);
    const huecos = await page.evaluate(() => {
      const guardado = demUmbrales;
      demUmbrales = { alta: 25, baja: -20, caida: -40 };
      const malos = [];
      for (let v = -200; v <= 200; v += 0.5) {
        const c = reclasificar({ datos_suficientes: true, variacion_ajustada: v });
        if (!["alta", "normal", "baja", "caida"].includes(c)) malos.push(`${v} → ${c}`);
      }
      demUmbrales = guardado;
      return malos.slice(0, 5);
    });
    expect(huecos, "hay variaciones que no caen en ningún tramo").toEqual([]);
  });
});

test.describe("El período que se consulta", () => {
  test("arranca con un rango válido y el filtro lo respeta", async ({ page }) => {
    await irAVentas(page);
    const r = await page.evaluate(() => ({
      desde: document.getElementById("rent-desde").value,
      hasta: document.getElementById("rent-hasta").value,
    }));
    expect(r.desde, "sin fecha de inicio").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.hasta, "sin fecha de fin").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.desde <= r.hasta, `el rango va al revés: ${r.desde} → ${r.hasta}`).toBe(true);
  });
});
