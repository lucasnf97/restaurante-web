// @ts-check
// Facturas y gastos. Acá lo que se prueba es lo que decide PLATA: a qué mes va
// una factura, cómo se reparte el impuesto por línea, cómo suman los totales, y
// que dos proveedores que son el mismo no se dupliquen.
//
// ⚠ SOLO LECTURA. Se abre el modal de carga manual y se manipulan sus campos
//   para leer lo que calcula, pero NUNCA se confirma ni se guarda un borrador.
//   Una factura registrada por una prueba ensucia la contabilidad del mes.
const { test, expect } = require("./sesion");

const irAFacturas = async (page) => {
  await page.goto("/facturas.html");
  await expect(page.locator("#vista-cargar")).toBeVisible();
};

/**
 * Abre "Nueva factura manual" con una línea vacía. No guarda nada.
 * ⚠ Espera a que estén los insumos: el desplegable de la fila se arma con
 *   `_insumos`, y si se abre el modal antes de que lleguen queda con la sola
 *   opción "— Seleccioná —". Una prueba del buscador contra una lista vacía
 *   falla sin que haya ningún bug.
 */
const abrirCargaManual = async (page) => {
  await expect.poll(() => page.evaluate(() =>
    (typeof _insumos !== "undefined" && _insumos) ? _insumos.length : 0),
    { timeout: 30_000 }).toBeGreaterThan(0);
  await page.evaluate(() => cargarManual());
  await expect(page.locator("#conf-fecha")).toBeVisible();
};

test.describe("El mes de la factura", () => {
  // ⚠ Este bloque existe por un bug que costó plata: el período se calculaba
  //   con `dia_inicio_periodo`, que es el corte del período de facturación
  //   SALARIAL. Con el día 26 —el de los dos locales de Dinamarca— una factura
  //   del 28 de julio se guardaba con período 26/7 → 25/8 y el informe la
  //   mostraba en AGOSTO. 19 facturas quedaron corridas de mes.

  test("el período es el mes calendario de la fecha, con corte salarial o sin él",
    async ({ page }) => {
      await irAFacturas(page);
      // El corte salarial en 26, que es el que destapó el bug.
      await page.evaluate(() => {
        window.SISTEMA_MONEDA = window.SISTEMA_MONEDA || {};
        window.SISTEMA_MONEDA.dia_inicio_periodo = 26;
      });
      await abrirCargaManual(page);

      // Los días 26 al 31 son los que antes se iban al mes siguiente.
      for (const fecha of ["2026-09-02", "2026-09-25", "2026-09-26", "2026-09-28",
                           "2026-07-31", "2026-01-01", "2026-12-31"]) {
        const r = await page.evaluate((f) => {
          const el = document.getElementById("conf-fecha");
          el.value = f;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          const per = document.getElementById("conf-periodo").value;
          return { per, rango: _periodoRango(per) };
        }, fecha);

        const mes = fecha.slice(0, 7);
        expect(r.per, `factura del ${fecha}`).toBe(mes);
        // Y el rango es el mes entero: antes "Septiembre" era 26/8 → 25/9, un
        // rango que ni siquiera contiene al 28 de septiembre.
        expect(r.rango.desde).toBe(`${mes}-01`);
        expect(r.rango.hasta.slice(0, 7)).toBe(mes);
      }
    });

  test("tocar la fecha manda: recalcula el período aunque se haya elegido a mano",
    async ({ page }) => {
      await irAFacturas(page);
      await abrirCargaManual(page);

      // Elegir un período a mano se respeta...
      const elegido = await page.evaluate(() => {
        document.getElementById("conf-periodo").value = "2026-12";
        onPeriodoUserChange();
        return document.getElementById("conf-periodo").value;
      });
      expect(elegido).toBe("2026-12");

      // ...hasta que se corrige la fecha, que es el gesto con el que uno dice a
      // qué mes va. Antes quedaba clavado en el mes viejo, en silencio.
      const tras = await page.evaluate(() => {
        const el = document.getElementById("conf-fecha");
        el.value = "2026-03-15";
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return document.getElementById("conf-periodo").value;
      });
      expect(tras).toBe("2026-03");
    });
});

test.describe("Impuesto y totales", () => {
  test("neto y bruto se derivan uno del otro con el % de la línea", async ({ page }) => {
    await irAFacturas(page);
    await abrirCargaManual(page);

    const idx = await page.evaluate(() =>
      document.querySelector("[id^='conf-item-']").id.replace("conf-item-", ""));

    const casos = [
      { pct: 21, neto: 100, bruto: 121 },
      { pct: 25, neto: 80, bruto: 100 },     // el IVA danés
      { pct: 0, neto: 50, bruto: 50 },
      { pct: 10.5, neto: 200, bruto: 221 },
    ];

    for (const c of casos) {
      // Del neto sale el bruto...
      const bruto = await page.evaluate(({ i, pct, neto }) => {
        document.getElementById(`ci-imp-${i}`).value = pct;
        document.getElementById(`ci-precio-neto-${i}`).value = neto;
        _recalcFila("ci", i, "neto");
        return parseFloat(document.getElementById(`ci-precio-${i}`).value);
      }, { i: idx, pct: c.pct, neto: c.neto });
      expect(bruto, `${c.neto} + ${c.pct}%`).toBeCloseTo(c.bruto, 2);

      // ...y del bruto sale el neto. Tiene que ser reversible: si no, corregir
      // un precio en una columna desajusta la otra y la factura deja de cuadrar.
      const neto = await page.evaluate(({ i, pct, bruto }) => {
        document.getElementById(`ci-imp-${i}`).value = pct;
        document.getElementById(`ci-precio-${i}`).value = bruto;
        _recalcFila("ci", i, "bruto");
        return parseFloat(document.getElementById(`ci-precio-neto-${i}`).value);
      }, { i: idx, pct: c.pct, bruto: c.bruto });
      expect(neto, `${c.bruto} con ${c.pct}% incluido`).toBeCloseTo(c.neto, 2);
    }
  });

  test("el total suma las líneas y deja fuera las omitidas", async ({ page }) => {
    await irAFacturas(page);
    await abrirCargaManual(page);

    // Tres líneas: dos cuentan y una se omite.
    const totales = await page.evaluate(() => {
      agregarItemConf();
      agregarItemConf();
      const idxs = Array.from(document.querySelectorAll("[id^='conf-item-']"))
        .map((r) => r.id.replace("conf-item-", ""));
      const poner = (i, neto, pct) => {
        document.getElementById(`ci-imp-${i}`).value = pct;
        document.getElementById(`ci-precio-neto-${i}`).value = neto;
        _recalcFila("ci", i, "neto");
      };
      poner(idxs[0], 100, 21);
      poner(idxs[1], 50, 21);
      poner(idxs[2], 999, 21);
      // La tercera se omite: no tiene que entrar en el total.
      document.getElementById(`ci-tipo-${idxs[2]}`).value = "omitir";
      _actualizarTotalesConf();
      return document.getElementById("conf-totales").innerText;
    });

    // 150 sin impuesto, 181,50 con impuesto. Y ni rastro de los 999.
    expect(totales).toMatch(/150,00/);
    expect(totales).toMatch(/181,50/);
    expect(totales).not.toMatch(/999/);
  });
});

test.describe("Proveedores", () => {
  // ⚠ Que dos proveedores que son el mismo se dupliquen no es cosmético: parte
  //   el gasto del mes en dos y el informe por proveedor deja de servir. Ya pasó
  //   una vez y hubo que fusionarlos a mano.

  test("empareja por CUIT aunque venga con puntos y guiones", async ({ page }) => {
    await irAFacturas(page);
    const r = await page.evaluate(() => {
      _proveedores = [{ id: 7, nombre: "Hørkram Foodservice A/S", cuit: "30-12345678-9" }];
      return {
        conGuiones: _matchProveedor("", "30-12345678-9"),
        sinNada: _matchProveedor("", "30123456789"),
        conEspacios: _matchProveedor("", " 30 12345678 9 "),
        otro: _matchProveedor("", "20-99999999-1"),
      };
    });
    expect(r.conGuiones.tipo).toBe("cuit");
    expect(r.sinNada.tipo).toBe("cuit");
    expect(r.conEspacios.tipo).toBe("cuit");
    expect(r.otro.tipo).toBe("ninguno");
  });

  test("empareja por nombre ignorando separadores, tildes y la ø danesa",
    async ({ page }) => {
      await irAFacturas(page);
      const r = await page.evaluate(() => {
        _proveedores = [{ id: 7, nombre: "Hørkram Foodservice A/S", cuit: null },
                        { id: 8, nombre: "Distribuciones Alcores, S.L.", cuit: null }];
        return {
          exacto: _matchProveedor("Hørkram Foodservice A/S", ""),
          sinBarra: _matchProveedor("Horkram Foodservice AS", ""),
          conPuntos: _matchProveedor("DISTRIBUCIONES ALCORES S L", ""),
          distinto: _matchProveedor("Otro Proveedor", ""),
        };
      });
      expect(r.exacto.tipo).toBe("nombre");
      expect(r.sinBarra.tipo, "'A/S' y 'AS' son el mismo proveedor").toBe("nombre");
      expect(r.conPuntos.tipo, "'S.L.' y 'S L' son el mismo proveedor").toBe("nombre");
      expect(r.distinto.tipo).toBe("ninguno");
    });

  test("con dos candidatos no adivina: marca ambigüedad", async ({ page }) => {
    await irAFacturas(page);
    // Que NO elija solo es lo importante: elegir mal imputa el gasto al
    // proveedor equivocado y nadie se entera hasta el cierre del mes.
    const r = await page.evaluate(() => {
      _proveedores = [{ id: 1, nombre: "AB Catering", cuit: "30-1-9" },
                      { id: 2, nombre: "AB Catering", cuit: "30-2-9" }];
      return { porNombre: _matchProveedor("AB Catering", "") };
    });
    expect(r.porNombre.tipo).toBe("ambiguo");
    expect(r.porNombre.candidatos.length).toBe(2);
  });
});

test.describe("Combobox de insumo", () => {
  test("se escribe y filtra por coincidencia en cualquier parte del nombre",
    async ({ page }) => {
      await irAFacturas(page);
      await abrirCargaManual(page);

      const idx = await page.evaluate(() =>
        document.querySelector("input[id^='ci-ins-txt-']").id.replace("ci-ins-txt-", ""));
      const entrada = page.locator(`#ci-ins-txt-${idx}`);

      const opciones = async (texto) => {
        await entrada.click();
        await entrada.fill(texto);
        return page.evaluate(() =>
          Array.from(document.querySelectorAll("#ci-ins-lista .ci-ins-op"))
            .map((d) => d.textContent.trim()));
      };

      // "mo" tiene que traer todo lo que LLEVE "mo", no sólo lo que empiece así.
      const conMo = await opciones("mo");
      expect(conMo.length).toBeGreaterThan(0);
      expect(conMo.every((t) => /mo/i.test(t))).toBe(true);
      expect(conMo.some((t) => !/^mo/i.test(t)),
        "tiene que haber alguno que no EMPIECE con 'mo'").toBe(true);

      // Palabras al revés y sin tildes.
      expect((await opciones("min agu")).length).toBeGreaterThan(0);
      expect((await opciones("champinones")).length).toBeGreaterThan(0);
      expect((await opciones("zzz-no-existe")).length).toBe(0);

      // Elegir deja el <select> oculto con el id: es la fuente de verdad que
      // lee el guardado, y por eso el combobox no lo reemplazó sino que lo tapó.
      await opciones("mo");                       // la lista tiene que estar ABIERTA
      const elegido = await page.evaluate((i) => {
        const d = document.querySelector("#ci-ins-lista .ci-ins-op");
        if (!d) return null;
        d.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        return { valor: document.getElementById(`ci-insumo-${i}`).value,
                 texto: document.getElementById(`ci-ins-txt-${i}`).value };
      }, idx);
      expect(elegido).not.toBeNull();
      expect(elegido.valor, "el select oculto queda con el id elegido").toMatch(/^\d+$/);
      expect(elegido.texto, "y el campo muestra su nombre").toMatch(/\S/);
    });
});
