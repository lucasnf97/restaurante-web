// @ts-check
// LAS MÉTRICAS DEL PERÍODO Y LA PREVISIÓN.
//
// Lo que hay que proteger acá no son los importes —de eso ya se ocupan las
// pruebas de informes, y el backend reusa esos mismos cálculos— sino las cuatro
// formas concretas en que un tablero de estos MIENTE sin que se note:
//
//   1. Promediar porcentajes entre locales. El consolidado de una cadena tiene
//      que dividir sobre los TOTALES: si no, un local chico con 60 % de coste de
//      personal arrastra el número de toda la cadena como si facturara igual que
//      el grande.
//   2. Confundir un % con PUNTOS porcentuales. Un coste que pasa del 30 % al
//      33 % no subió "un 3 %": subió 3 puntos, que es un 10 % relativo.
//   3. Devolver NaN o Infinity cuando no hay base de ventas, que en pantalla se
//      lee como si fuera un dato.
//   4. Inventar un número cuando no hay datos. Un "0 €" con confianza alta es
//      peor que no decir nada, porque alguien lo usa para pedir mercadería.
//
// ⚠ SOLO LECTURA. Apunta al ARENERO (0000B) porque es el único esquema con un
//   año de datos continuo, pero no escribe nada: sólo lee y mira la pantalla.
const { test, expect, tokenCadena, ARENERO } = require("./sesion");

test.use({ esquema: ARENERO });

/** Un mes que el arenero tiene cargado, y cuántos clics de ‹ hay hasta él. */
const MES_CON_DATOS = { year: 2026, month: 5 };
function clicsAtras() {
  const hoy = new Date();
  return (hoy.getFullYear() - MES_CON_DATOS.year) * 12 +
         (hoy.getMonth() + 1 - MES_CON_DATOS.month);
}

/**
 * Llama a la API con la sesión de la página (mismo token que usa la pantalla).
 * ⚠ Va por `api` PELADO, no por `window.api`: api.js lo declara con `const` en el
 *   tope de un script clásico, y eso crea un global LÉXICO que no se cuelga de
 *   `window`. Con `window.api` da "undefined" y parece que la página no cargó.
 */
const pedir = (page, ep) => page.evaluate((e) => api.get(e), ep);

/** ¿Ese KPI viaja en el bloque recortado a mismos días? */
const c_tiene = (bloque, k) => bloque[k] !== undefined && bloque[k] !== null;

/** Llama a la API como GERENTE DE CADENA (gid 3 = las maquetas). */
const comoCadena = (page, ep) => page.evaluate(async ({ e, t }) => {
  const r = await fetch(window._API_URL + e, { headers: { Authorization: "Bearer " + t } });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
}, { e: ep, t: tokenCadena(Number(process.env.E2E_GID || 3), process.env.E2E_USER || "Lucas") });

/**
 * Espera a que el tablero de cadena esté POBLADO.
 * ⚠ No alcanza con esperar a que haya un `<tr>` en el tbody: el marcador inicial
 *   "Cargando…" ya es un `<tr>` visible, así que esa espera pasa al instante y la
 *   prueba sigue con la pantalla vacía. Se espera al selector de restaurantes, que
 *   sólo se llena cuando los datos llegaron.
 */
async function esperarTableroCadena(page) {
  await expect.poll(
    () => page.locator("#mxc-rest option").count(),
    { timeout: 30000, message: "el selector de restaurantes nunca se pobló" },
  ).toBeGreaterThan(1);
  await expect(page.locator("#mxc-tfoot")).toContainText(/./, { timeout: 30000 });
}

async function abrirEnMesConDatos(page) {
  await page.goto("/analisis-mes.html");
  const atras = clicsAtras();
  for (let i = 0; i < atras; i++) {
    await page.locator(".mx-nav button").first().click();
  }
  // La grilla se pinta en dos pasos (primero los KPIs, después las
  // comparaciones): se espera a que haya tarjetas, no a un temporizador.
  await expect(page.locator(".mx-card").first()).toBeVisible({ timeout: 20000 });
}

test.describe("Métricas del período", () => {

  test("muestra los KPIs pedidos, en dinero y en % de ventas", async ({ page }) => {
    await abrirEnMesConDatos(page);

    // Los siete del encargo. Si alguno desaparece, la pantalla dejó de cumplir.
    for (const kpi of ["ventas", "coste_personal", "coste_insumos", "gastos_fijos",
                       "gastos_totales", "resultado", "horas_trabajadas"]) {
      await expect(page.locator(`.mx-card[data-kpi="${kpi}"]`)).toBeVisible();
    }

    // El coste de personal, en dinero arriba y en % de ventas en el chip.
    const personal = page.locator('.mx-card[data-kpi="coste_personal"]');
    await expect(personal.locator(".mx-card-val")).not.toHaveText("—");
    await expect(personal.locator(".mx-card-pct")).toContainText("% de ventas");

    // Las horas son las EFECTIVAMENTE TRABAJADAS (fichadas + correcciones), no
    // las asignadas del cuadrante: tienen que venir en horas, no en dinero.
    await expect(page.locator('.mx-card[data-kpi="horas_trabajadas"] .mx-card-val'))
      .toContainText("h");
  });

  test("el % sobre ventas es el que sale de los propios importes", async ({ page }) => {
    await abrirEnMesConDatos(page);
    const d = await pedir(page, `/metricas/restaurante?periodo=mes&year=${MES_CON_DATOS.year}&month=${MES_CON_DATOS.month}`);
    expect(d.actual.hay_datos).toBe(true);
    const esperado = Math.round(d.actual.coste_personal / d.actual.ventas * 100 * 100) / 100;
    expect(d.actual.pct_personal).toBeCloseTo(esperado, 2);

    // Y el total de gastos cuadra con lo que la pantalla muestra como resultado.
    expect(d.actual.ventas - d.actual.resultado).toBeCloseTo(d.actual.gastos_totales, 2);
    expect(d.actual.descuadre).toBe(0);
  });

  test("la variación de un RATIO va en puntos, no en porcentaje", async ({ page }) => {
    await abrirEnMesConDatos(page);
    const personal = page.locator('.mx-card[data-kpi="coste_personal"]');
    // Las comparaciones llegan en la segunda tanda.
    await expect(personal.locator(".mx-card-cmps")).toBeVisible({ timeout: 20000 });
    // Cada comparación trae DOS lecturas: "en dinero" y "sobre ventas". La
    // segunda es la del ratio y va en PUNTOS.
    await expect(personal.locator(".mx-cmp", { hasText: "en dinero" }).first()).toBeVisible();
    const puntos = personal.locator(".mx-cmp", { hasText: "sobre ventas" });
    await expect(puntos.first()).toBeVisible();

    // ⚠ Y cada comparación muestra EL VALOR del período de referencia. Sin él,
    //   "Agosto 2026 −2.792 €" se lee como "en agosto gasté 2.792 menos", que es
    //   lo contrario de lo que dice. Al dueño le pasó leyendo la pantalla.
    const refs = personal.locator(".mx-ref");
    expect(await refs.count(), "falta el valor del período contra el que se compara")
      .toBeGreaterThanOrEqual(1);
    await expect(refs.first().locator(".mx-ref-val")).not.toBeEmpty();

    // ⚠ Al menos UNA tiene que traer el número, no todas: un comparador sin datos
    //   —la maqueta de 0000B arranca en agosto 2025, así que mayo 2025 no existe—
    //   dice "sin datos" con razón, y exigirle un valor probaría lo contrario de
    //   lo que hay que probar.
    const textos = await puntos.locator(".mx-cmp-val").allTextContents();
    expect(textos.some((t) => t.includes("pp")),
      `ninguna comparación mostró puntos: ${JSON.stringify(textos)}`).toBe(true);
    // Y el de-a-dónde al lado, que es lo que hace entendible "pp" sin saber qué es
    // un punto porcentual.
    const conPp = textos.find((t) => t.includes("pp"));
    expect(conPp, `los puntos no muestran el tramo de ratios: ${conPp}`).toMatch(/→/);

    // Y el número es exactamente la resta de los dos ratios.
    const qs = `periodo=mes&year=${MES_CON_DATOS.year}&month=${MES_CON_DATOS.month}&comparar=1`;
    const d = await pedir(page, `/metricas/restaurante?${qs}`);
    expect(d.vs_anterior.pct_personal)
      .toBeCloseTo(d.actual.pct_personal - d.anterior.pct_personal, 2);
    // La comparación interanual mira el mismo mes del año anterior.
    expect(d.periodo.label_anio_pasado).toContain(String(MES_CON_DATOS.year - 1));
  });

  test("un período EN CURSO se compara contra los mismos días transcurridos",
    async ({ page }) => {
      await page.goto("/analisis-mes.html");
      const hoy = new Date();
      const d = await pedir(page,
        `/metricas/restaurante?periodo=mes&year=${hoy.getFullYear()}` +
        `&month=${hoy.getMonth() + 1}&comparar=1`);

      expect(d.periodo.en_curso, "el mes en curso no se detecta como tal").toBe(true);
      expect(d.periodo.dias_transcurridos).toBeGreaterThan(0);
      expect(d.periodo.dias_transcurridos).toBeLessThanOrEqual(d.periodo.dias);

      // ⚠ ES EL PUNTO: un mes a medias contra meses CERRADOS hunde todos los
      //   porcentajes porque faltan DÍAS, no ventas. Medido en la cadena de
      //   prueba, la pantalla decía −46,6 % cuando a mismos días era +3,4 %
      //   contra el año pasado: el negocio crecía y se leía un derrumbe.
      const c = d.comparable;
      expect(c, "no se calculó la comparación a mismos días").toBeTruthy();
      expect(c.dias).toBe(d.periodo.dias_transcurridos);

      // Los tres tramos tienen que durar lo mismo, o no se está comparando nada.
      expect(c.anterior.dias).toBe(c.actual.dias);
      expect(c.anio_pasado.dias).toBe(c.actual.dias);

      // Y el tramo actual ES el período hasta hoy: mismo dinero que la tarjeta.
      expect(c.actual.ventas).toBeCloseTo(d.actual.ventas, 0);
    });

  test("los costes de factura NO se parten por días, y se dice", async ({ page }) => {
    await page.goto("/analisis-mes.html");
    const hoy = new Date();
    const d = await pedir(page,
      `/metricas/restaurante?periodo=mes&year=${hoy.getFullYear()}` +
      `&month=${hoy.getMonth() + 1}&comparar=1`);
    test.skip(!d.comparable, "el período no está en curso");

    // Sólo se recorta lo que tiene dato DIARIO. Insumos y gastos fijos se imputan
    // por período de factura —el alquiler entero cae el día 1— y partirlos
    // inventaría un criterio contable que no existe en el resto del sistema.
    for (const k of ["ventas", "coste_personal", "horas_trabajadas"]) {
      expect(c_tiene(d.comparable.actual, k), `${k} debería recortarse por días`).toBe(true);
    }
    for (const k of ["coste_insumos", "gastos_fijos"]) {
      expect(c_tiene(d.comparable.actual, k), `${k} no se puede partir por días`).toBe(false);
    }
    // Y la pantalla lo explica en vez de dejar al lector adivinando.
    await expect(page.locator("#mx-aviso")).toContainText("va por el día", { timeout: 20000 });
  });

  test("un período sin datos lo dice, en vez de inventar ceros", async ({ page }) => {
    await page.goto("/analisis-mes.html");
    // 2019 es anterior a cualquier dato del sistema.
    const d = await pedir(page, "/metricas/restaurante?periodo=mes&year=2019&month=1&comparar=1");
    expect(d.actual.hay_datos).toBe(false);
    // Sin ventas no hay sobre qué calcular un %: va null, NUNCA Infinity ni 0.
    expect(d.actual.pct_personal).toBeNull();
    expect(d.actual.pct_gastos_totales).toBeNull();
    const texto = JSON.stringify(d);
    expect(texto).not.toContain("Infinity");
    expect(texto).not.toContain("NaN");
  });

  test("el selector de Año cambia el período y esconde el detalle mensual", async ({ page }) => {
    await page.goto("/analisis-mes.html");
    await expect(page.locator("#mes-only")).toBeVisible();

    await page.locator("#mx-tab-anio").click();
    await expect(page.locator("#lbl-mes")).toContainText("Año");
    // El detalle por factura y la meta son mensuales: con el año elegido no
    // pueden quedar a la vista con el último mes cargado, o se leen como del año.
    await expect(page.locator("#mes-only")).toBeHidden();

    await page.locator("#mx-tab-mes").click();
    await expect(page.locator("#mes-only")).toBeVisible();
    await expect(page.locator("#lbl-mes")).not.toContainText("Año");
  });

  test("no se pinta NaN ni Infinity en ningún lado", async ({ page }) => {
    await abrirEnMesConDatos(page);
    const txt = await page.locator("body").innerText();
    expect(txt).not.toMatch(/\bNaN\b/);
    expect(txt).not.toMatch(/\bInfinity\b/);
  });
});

test.describe("Previsión de la próxima semana", () => {

  test("da los siete días, de lunes a domingo", async ({ page }) => {
    await page.goto("/analisis-mes.html");
    await expect(page.locator(".mx-dia")).toHaveCount(7, { timeout: 20000 });
    await expect(page.locator(".mx-dia").first()).toContainText("Lunes");
    await expect(page.locator(".mx-dia").last()).toContainText("Domingo");
  });

  test("sin datos dice 'Sin datos' — nunca un cero con confianza alta", async ({ page }) => {
    await page.goto("/analisis-mes.html");
    await expect(page.locator(".mx-dia").first()).toBeVisible({ timeout: 20000 });
    const p = await pedir(page, "/metricas/prevision");

    for (const d of p.dias) {
      if (d.motivo === "sin_datos") {
        // Es EL fallo que hay que evitar: un local sin movimiento reciente
        // respondía "0 €, confianza alta" como si fuera un hecho.
        expect(d.prevision).toBeNull();
        expect(d.confianza).toBe("baja");
      }
      if (d.prevision === 0 && d.confianza === "alta") {
        // Un cero seguro sólo se admite si de verdad no se abre ese día, y eso
        // exige un patrón de trabajo legible en la ventana.
        expect(d.cerrado).toBe(true);
        expect(p.ventana.hay_patron).toBe(true);
      }
      expect(["alta", "media", "baja"]).toContain(d.confianza);
    }
    expect(JSON.stringify(p)).not.toContain("Infinity");
  });

  test("cada día explica el cálculo con sus propios números", async ({ page }) => {
    await page.goto("/analisis-mes.html");
    const primero = page.locator(".mx-dia").first();
    await expect(primero).toBeVisible({ timeout: 20000 });
    await expect(primero.locator(".mx-conf")).toContainText("Confianza");
    // La explicación no es decorativa: sin ella nadie puede discutir el número.
    await expect(primero.locator(".mx-dia-exp")).not.toBeEmpty();
  });

  test("el crecimiento interanual se mide por día de servicio", async ({ page }) => {
    await page.goto("/analisis-mes.html");
    const p = await pedir(page, "/metricas/prevision");
    if (!p.factor_anual) {
      // Sin patrón en los dos lados no se publica factor: eso también es correcto.
      expect(p.ventana.hay_patron && p.ventana.hay_patron_anio_pasado).toBe(false);
      return;
    }
    // Medido sobre el total, un año con 12 días abiertos contra otro con 26 da un
    // "crecimiento" que sólo mide cuántos días abrió cada uno.
    expect(p.factor_anual.valor).toBeCloseTo(
      p.factor_anual.promedio_dia / p.factor_anual.promedio_dia_anio_pasado, 3);
    expect(p.factor_anual.dias_con_venta).toBeGreaterThanOrEqual(p.ventana.minimo_dias);
  });
});

test.describe("Consolidado de cadena", () => {
  test.use({ rol: "gerente_cadena" });

  test("los ratios salen de los TOTALES, no del promedio de los locales", async ({ page }) => {
    await page.goto("/cadena.html?cadena=1");
    const hoy = new Date();
    const r = await comoCadena(page,
      `/metricas/cadena?periodo=mes&year=${MES_CON_DATOS.year}&month=${MES_CON_DATOS.month}`);
    expect(r.ok).toBe(true);

    const locales = (r.data.restaurantes || []).filter((x) => x.actual && x.actual.hay_datos);
    test.skip(locales.length < 1, "la cadena de pruebas no tiene datos en ese mes");

    const total = r.data.total;
    // 1) Los importes del total son la SUMA de los locales.
    const suma = locales.reduce((a, x) => a + x.actual.ventas, 0);
    expect(total.ventas).toBeCloseTo(Math.round(suma * 100) / 100, 1);

    // 2) Y el ratio se calcula DESPUÉS de sumar. Esta es la regla que el encargo
    //    marca como fundamental, y la que un tablero rompe sin que se note.
    const personal = locales.reduce((a, x) => a + x.actual.coste_personal, 0);
    expect(total.pct_personal).toBeCloseTo(personal / suma * 100, 1);

    if (locales.length > 1) {
      const promedioIngenuo = locales.reduce((a, x) => a + x.actual.pct_personal, 0) / locales.length;
      // No siempre difieren (si los locales facturan parecido, coinciden), pero
      // cuando difieren tiene que ganar el agregado.
      if (Math.abs(promedioIngenuo - total.pct_personal) > 0.05) {
        expect(total.pct_personal).not.toBeCloseTo(promedioIngenuo, 1);
      }
    }
    expect(JSON.stringify(r.data)).not.toContain("Infinity");
  });

  test("la tabla comparativa se ordena y cierra con el Total cadena", async ({ page }) => {
    await page.goto("/cadena.html?cadena=1");
    await esperarTableroCadena(page);
    await expect(page.locator("#mxc-tfoot")).toContainText("Total cadena");

    // Ordenar por Ventas: la primera fila tiene que ser la de más ventas.
    const ventasDe = async () => page.evaluate(() =>
      Array.from(document.querySelectorAll("#mxc-tbody tr"))
        .map((tr) => tr.children[1] && tr.children[1].textContent)
        .filter(Boolean));

    await page.locator("#mxc-thead th", { hasText: "Ventas" }).click();
    const desc = await ventasDe();
    await page.locator("#mxc-thead th", { hasText: "Ventas" }).click();  // invierte
    const asc = await ventasDe();
    if (desc.length > 1) expect(asc[0]).not.toBe(desc[0]);
    // Y el orden se refleja en la cabecera, no sólo en los datos.
    await expect(page.locator("#mxc-thead th.orden")).toHaveCount(1);
  });

  test("el selector de restaurante cambia el ámbito sin volver a pedir datos", async ({ page }) => {
    await page.goto("/cadena.html?cadena=1");
    await esperarTableroCadena(page);

    // Cambiar de ámbito NO dispara una llamada nueva: los datos de todos los
    // locales vinieron en la misma respuesta.
    let llamadas = 0;
    page.on("request", (r) => { if (r.url().includes("/metricas/cadena")) llamadas++; });
    const valor = await page.locator("#mxc-rest option").nth(1).getAttribute("value");
    await page.locator("#mxc-rest").selectOption(valor || "");
    await expect(page.locator("#mxc-kpis")).not.toBeEmpty();
    expect(llamadas).toBe(0);
  });

  test("el consolidado declara en qué moneda está y de dónde salió", async ({ page }) => {
    await page.goto("/cadena.html?cadena=1");
    const r = await comoCadena(page, "/metricas/cadena?periodo=mes");
    expect(r.ok).toBe(true);
    const mon = r.data.moneda;
    expect(mon).toBeTruthy();

    // La base tiene que ser una de las monedas realmente en uso: nunca una
    // inventada ni una que no aparezca en ningún local.
    const codigos = mon.disponibles.map((m) => m.codigo);
    expect(codigos).toContain(mon.base);
    expect(mon.mezcladas).toBe(codigos.length > 1);

    await esperarTableroCadena(page);
    await expect(page.locator("#mxc-tfoot")).toContainText("Total cadena");

    // El desplegable de moneda sólo existe si hay más de una en juego.
    const sel = page.locator("#mxc-moneda");
    if (mon.mezcladas) {
      await expect(sel).toBeVisible();
      await expect(sel.locator("option")).toHaveCount(codigos.length);
    } else {
      await expect(sel).toBeHidden();
    }
  });

  test("los locales sin tasa quedan fuera del total y se avisa", async ({ page }) => {
    await page.goto("/cadena.html?cadena=1");
    const r = await comoCadena(page, "/metricas/cadena?periodo=mes");
    expect(r.ok).toBe(true);
    const mon = r.data.moneda;

    // Invariante que vale siempre: lo que entra al total es EXACTAMENTE lo que se
    // pudo convertir. Nada se suma "como venga".
    const sumables = (r.data.restaurantes || []).filter((x) => x.actual_convertido);
    const suma = sumables.reduce((a, x) => a + x.actual_convertido.ventas, 0);
    expect(r.data.total.ventas).toBeCloseTo(Math.round(suma * 100) / 100, 1);

    const fuera = (r.data.restaurantes || [])
      .filter((x) => x.actual && !x.actual_convertido);
    expect(mon.sin_convertir.length > 0).toBe(fuera.length > 0);
    if (fuera.length) {
      await esperarTableroCadena(page);
      await expect(page.locator("#mxc-aviso")).toContainText("FUERA del total");
    }
  });

  test("pedir una moneda ajena a la cadena se rechaza", async ({ page }) => {
    await page.goto("/cadena.html?cadena=1");
    // Nunca se convierte a una moneda que nadie usa: sin tasa, el resultado
    // sería inventado.
    const r = await comoCadena(page, "/metricas/cadena?periodo=mes&moneda=JPY");
    expect(r.status).toBe(400);
  });

  test("un local que falla no deja a la cadena sin tablero", async ({ page }) => {
    await page.goto("/cadena.html?cadena=1");
    const r = await comoCadena(page, "/metricas/cadena?periodo=mes");
    expect(r.ok).toBe(true);
    // Cada fila trae o sus números o el motivo, nunca desaparece de la lista.
    for (const x of r.data.restaurantes || []) {
      expect(x.actual !== undefined || x.error !== undefined).toBe(true);
      expect(x.codigo).toBeTruthy();
    }
  });
});
