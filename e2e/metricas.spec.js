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

/** Un porcentaje como lo pinta la pantalla: "24,1 %". */
const fmtPct = (v) => v.toFixed(1).replace(".", ",") + " %";

/**
 * Los ratios que la tarjeta PUEDE mostrar como referencia, y el de hoy.
 * ⚠ Con el período EN CURSO la referencia sale del RECORTE a mismos días
 *   (`comparable`), no del período cerrado. Se miran los dos orígenes en vez de
 *   replicar acá la decisión del renderer: si la prueba la copia, deja de probarla.
 */
function ratiosDe(datos, clave) {
  const refs = [];
  for (const f of [datos, datos.comparable].filter(Boolean)) {
    for (const k of ["anterior", "anio_pasado"]) {
      if (f[k] && f[k][clave] != null) refs.push(fmtPct(f[k][clave]));
    }
  }
  const act = datos.comparable ? datos.comparable.actual : datos.actual;
  return { refs, hoy: act && act[clave] != null ? fmtPct(act[clave]) : null };
}

/**
 * LA REGLA DEL RATIO, que el dueño pidió dos veces (2026-09-27): UN SOLO
 * porcentaje, y que sea el del período de REFERENCIA.
 *
 * ⚠ Primero se retiraron los "pp" por jerga contable, y se pasó a un tramo
 *   "29,4 % → 37,4 %". Después se retiró el tramo también: el segundo número es el
 *   de HOY, que ya está en el chip `.mx-card-pct` de la misma tarjeta.
 * ⚠ Las dos mitades hacen falta. "Un solo porcentaje" se cumple igual dejando el
 *   de hoy, que duplicaría el chip y no diría nada nuevo — por eso también se
 *   verifica que el pintado sea uno de los de referencia y NO el de hoy.
 */
function assertRatioDeReferencia(textos, datos, clave) {
  const { refs, hoy } = ratiosDe(datos, clave);
  const pintados = textos.filter((t) => t.includes("%"));
  expect(pintados.length, `ninguna comparación mostró el ratio: ${JSON.stringify(textos)}`)
    .toBeGreaterThan(0);
  for (const t of pintados) {
    expect(t, `el ratio trae DOS porcentajes; el de hoy ya está en el chip: ${t}`)
      .not.toMatch(/%[\s\S]*%/);
    expect(t, `el ratio no tiene la forma "▲ 29,4 %": ${t}`)
      .toMatch(/^[▲▼→]\s*[\d.,]+\s*%$/);
    expect(refs.some((r) => t.includes(r)),
      `"${t}" no es ninguno de los ratios de referencia ${JSON.stringify(refs)}`).toBe(true);
    if (hoy && !refs.includes(hoy)) {
      expect(t, `se pinta el ratio de HOY (${hoy}), que ya está en el chip`)
        .not.toContain(hoy);
    }
  }
}
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

/**
 * Abre la pantalla de CADENA en un período que tenga datos.
 *
 * ⚠ POR QUÉ EXISTE (2026-10-03): la pantalla abre en el MES ACTUAL, y el día que el
 *   mes cambia ese mes todavía no tiene ventas. Las pruebas de cadena pasaron meses en
 *   verde y el 1 de octubre empezaron a fallar las dos que miran importes — no por un
 *   cambio de código, sino por el calendario. Me costó medio diagnóstico descartar que
 *   fuera mío, así que esto deja de depender de "hoy".
 *
 *   Las pruebas de RESTAURANTE ya lo resolvían (`abrirEnMesConDatos` + `MES_CON_DATOS`);
 *   las de cadena no tenían equivalente.
 *
 * ⚠ Retrocede como mucho `maxAtras` meses y DEVUELVE si encontró datos, en vez de
 *   seguir a ciegas: una prueba que corre sobre una tabla de ceros no falla, pero
 *   tampoco prueba nada, que es peor.
 */
async function abrirCadenaEnPeriodoConDatos(page, maxAtras = 3) {
  await page.goto("/cadena.html?cadena=1");
  await esperarTableroCadena(page);
  // ⚠ `_mxcDatos` va por su NOMBRE PELADO: es un global LÉXICO de cadena.html.
  const hayDatos = async () => page.evaluate(() => {
    const d = typeof _mxcDatos !== "undefined" ? _mxcDatos : null;
    return !!(d && d.total && Number(d.total.ventas) > 0);
  });
  // Qué período tiene cargado AHORA. Es lo que permite esperar a que el clic surta
  // efecto de verdad.
  const periodoCargado = async () => page.evaluate(() => {
    const d = typeof _mxcDatos !== "undefined" ? _mxcDatos : null;
    return d && d.periodo ? `${d.periodo.year}-${d.periodo.month}` : null;
  });

  for (let i = 0; i < maxAtras; i++) {
    if (await hayDatos()) return true;
    const antes = await periodoCargado();
    await page.locator('.mx-nav button[title="Período anterior"]').click();
    // ⚠ Esperar al PERÍODO NUEVO, no a un booleano: `hayDatos` siempre devuelve algo,
    //   así que un `.toBeDefined()` se cumple al instante y se comprobaba el período
    //   viejo. La cadena tarda ~11 s en cargar; sin esta espera el ayudante devolvía
    //   "no hay datos" sin haber mirado nunca el mes al que acababa de ir.
    await expect.poll(periodoCargado, { timeout: 90000, intervals: [1000] }).not.toBe(antes);
  }
  return await hayDatos();
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

  test("el ratio se muestra con el % del período de referencia, no en puntos", async ({ page }) => {
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

    // ⚠ Al menos UNA tiene que traer el dato, no todas: un comparador sin datos
    //   —la maqueta de 0000B arranca en agosto 2025, así que mayo 2025 no existe—
    //   dice "sin datos" con razón, y exigirle un valor probaría lo contrario de
    //   lo que hay que probar.
    const textos = await puntos.locator(".mx-cmp-val").allTextContents();

    // ⚠ NUNCA "pp": el dueño lo rechazó dos veces por ser jerga contable
    //   (2026-09-27). Si alguien lo reintroduce, esto lo caza.
    for (const t of textos) {
      expect(t, `volvió el "pp": ${t}`).not.toMatch(/\bpp\b/);
    }

    // Y el número es exactamente la resta de los dos ratios.
    const qs = `periodo=mes&year=${MES_CON_DATOS.year}&month=${MES_CON_DATOS.month}&comparar=1`;
    const d = await pedir(page, `/metricas/restaurante?${qs}`);
    expect(d.vs_anterior.pct_personal)
      .toBeCloseTo(d.actual.pct_personal - d.anterior.pct_personal, 2);

    assertRatioDeReferencia(textos, d, "pct_personal");
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
    // ⚠ En un mes sin ventas la tabla es toda "€ 0,00" y ordenar no cambia nada: el
    //   assert de abajo falla aunque el ordenamiento funcione perfecto. Hay que pararse
    //   en un período CON datos (ver abrirCadenaEnPeriodoConDatos).
    const hay = await abrirCadenaEnPeriodoConDatos(page);
    test.skip(!hay, "la cadena de pruebas no tiene ventas en los últimos meses");
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

  test("cada comparación muestra el IMPORTE del período con el que compara",
    async ({ page }) => {
      // ⚠ POR QUÉ ESTA PRUEBA NO ESPERA A QUE LA PANTALLA SE PINTE SOLA.
      //   El segundo paso de la cadena (el de comparaciones) son ~425 consultas:
      //   tres locales × tres períodos, cada uno con su balance, su nómina y su
      //   tramo recortado. EN PRODUCCIÓN tarda 932 ms porque la API y la base
      //   están co-locadas; desde un portátil son ~50 s, porque cada consulta
      //   paga ~112 ms de ida y vuelta.
      //   Y `apiFetch` aborta CUALQUIER request a los 20 s y reintenta 3 veces
      //   (js/api.js `_API_TIMEOUT_MS`). O sea que contra una base remota la
      //   segunda llamada NO PUEDE terminar nunca: agota los tres intentos y
      //   `mxcCargar` cae en su `catch`. Esperar a `.mx-card-cmps` acá es esperar
      //   algo que el entorno de desarrollo no puede dar, por más timeout que se
      //   le ponga — medido el 2026-09-27, con tres pares REQUEST→ERR_ABORTED a
      //   20 s exactos.
      //   Así que la prueba trae el payload REAL por `fetch` crudo (que no pasa
      //   por ese abort) y hace rendir la pantalla con él. Se sigue probando el
      //   código de cadena.html —el mapeo del ámbito, que es lo que se arregló—
      //   con datos de verdad; lo único que se reemplaza es el transporte.
      test.setTimeout(240000);
      // ⚠ Y se para en un período CON datos: en un mes sin ventas no hay comparaciones
      //   que pintar, así que `.mx-card-cmps` no existe y la prueba fallaba por el
      //   calendario, no por el código (pasó el 2026-10-03, ver el ayudante).
      const hay = await abrirCadenaEnPeriodoConDatos(page);
      test.skip(!hay, "la cadena de pruebas no tiene ventas en los últimos meses");

      // El payload se pide para EL MISMO período en el que quedó la pantalla, no para
      // el de hoy: si se piden distintos, se renderiza un mes contra el rótulo de otro.
      const per = await page.evaluate(() => ({
        year: _mxcDatos.periodo.year, month: _mxcDatos.periodo.month,
      }));
      const r = await comoCadena(page,
        `/metricas/cadena?periodo=mes&year=${per.year}&month=${per.month}&comparar=1`);
      expect(r.ok, `la cadena con comparaciones falló: ${r.status}`).toBe(true);
      test.skip(!r.data.total_anterior, "no hay período anterior con el que comparar");

      // ⚠ `_mxcDatos` y `mxcRender` van por su NOMBRE PELADO: cadena.html los
      //   declara en el tope de un script clásico y eso crea globales LÉXICOS
      //   que NO se cuelgan de `window`.
      await page.evaluate((d) => { _mxcDatos = d; mxcRender(); }, r.data);

      const personal = page.locator('.mx-card[data-kpi="coste_personal"]');
      await expect(personal.locator(".mx-card-cmps")).toBeVisible();

      // ⚠ ESTO ESTUVO ROTO EN CADENA Y NO EN RESTAURANTE (2026-09-27): el
      //   consolidado viaja como `total_anterior`, no como `anterior`, así que la
      //   tarjeta no recibía el importe de referencia y pintaba un guión con un
      //   "sin datos" al lado — que parecen falta de datos cuando el dato está.
      //   La prueba miraba sólo analisis-mes.html, donde funcionaba.
      const valores = await personal.locator(".mx-ref-val").allTextContents();
      expect(valores.length, "no se muestra ningún importe de referencia")
        .toBeGreaterThan(0);
      expect(valores.some((v) => /\d/.test(v)),
        `los importes de referencia salieron vacíos: ${JSON.stringify(valores)}`).toBe(true);

      // Y el ratio tiene que poder calcularse: sin el bloque de referencia decía
      // "sin datos" aunque el porcentaje existiera.
      // ⚠ El consolidado viaja con los nombres `total_*`, así que se traduce a los
      //   de la pantalla de restaurante antes de medirlo con la misma regla.
      if (r.data.total_anterior.pct_personal != null) {
        const sobre = await personal.locator(".mx-cmp", { hasText: "sobre ventas" })
          .locator(".mx-cmp-val").allTextContents();
        assertRatioDeReferencia(sobre, {
          actual: r.data.total,
          anterior: r.data.total_anterior,
          anio_pasado: r.data.total_anio_pasado,
          comparable: r.data.comparable,
        }, "pct_personal");
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
