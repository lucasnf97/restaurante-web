// @ts-check
// Control de Stock: filtros, orden por fecha de control, listado impreso,
// revisión (conteo, balance, calculadora).
//
// ⚠ TODO DE SOLO LECTURA. La API local pega contra la base de producción, así
//   que ninguna prueba guarda una revisión ni toca un insumo. Lo que se verifica
//   es el comportamiento de la pantalla, que es donde estuvieron los bugs.
//
// ⚠ CÓMO SE ESPERA ACÁ, Y POR QUÉ NO DE OTRA FORMA
//   Los filtros recargan la tabla de forma asíncrona y NO hay una señal fiable
//   de "ya terminó": UI.skeleton (js/api.js) sólo pinta en la PRIMERA carga —
//   sale temprano si el tbody ya tiene filas de verdad—, así que esperar a que
//   desaparezca el esqueleto no espera nada en una recarga y se termina leyendo
//   la tabla anterior. Tampoco sirve waitForResponse: puede resolver con una
//   consulta que ya venía en vuelo.
//   Por eso se afirma SOBRE EL RESULTADO con expect/expect.poll, que reintentan
//   hasta que la pantalla se asienta. Además de correcto, prueba lo que importa:
//   lo que queda en pantalla, no cuándo dejó de cargar.
const { test, expect } = require("./sesion");

/** La tabla ya muestra DATOS (no "Cargando…" ni el esqueleto de la 1ª carga). */
const esperarTabla = async (page, tbody = "#tbody-insumos") => {
  await expect(page.locator(`${tbody} .empty`)).toHaveCount(0);
  await expect(page.locator(`${tbody} tr`).first().locator("td").first())
    .toHaveText(/\S/, { timeout: 30_000 });
  await expect(page.locator(`${tbody} .ui-skel`)).toHaveCount(0);
};

const irAStock = async (page) => {
  await page.goto("/stock.html");
  await esperarTabla(page);
};

/** Una columna del listado, en el orden en que se ve. */
const columna = (page, i) => page.evaluate((n) =>
  Array.from(document.querySelectorAll("#tbody-insumos tr")).map((tr) =>
    (tr.cells[n]?.innerText || "").trim()), i);

/**
 * Fechas de control sembradas en la RESPUESTA (la base real las tiene vacías).
 * Deja además `__fechas` (nombre → milisegundos) para comparar contra el dato.
 *
 * ⚠ NO se leen las fechas de la pantalla: lo que se muestra es una fecha
 *   LOCALIZADA ("14/9/2026, 18:21") y volver a parsearla con new Date() la
 *   interpreta al revés —toma el 14 como mes— y da NaN o un valor absurdo. Una
 *   prueba que compara basura contra basura falla sin que haya ningún bug.
 */
async function sembrarFechas(page, endpoint = "/stock/insumos") {
  await page.evaluate((ep) => {
    // ⚠ `api` es un const de nivel superior de js/api.js: vive en el ámbito del
    //   script, NO en window. `window.api` es undefined.
    const orig = api.get;
    window.__fechas = {};
    api.get = async (e) => {
      const r = await orig(e);
      if (e === ep && Array.isArray(r)) {
        const hoy = Date.now();
        r.forEach((i, n) => {
          const ms = (n % 5 === 0) ? null : hoy - n * 2 * 86400000;
          i.ultimo_control = ms === null ? null : new Date(ms).toISOString();
          window.__fechas[i.nombre] = ms;
        });
      }
      return r;
    };
  }, endpoint);
}

/** Milisegundos de cada fila, EN EL ORDEN EN QUE SE VEN. null = "Nunca". */
const fechasVisibles = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll("#tbody-insumos tr")).map((tr) => {
    const nombre = tr.cells[0].innerText.replace(/^[^\p{L}\d]+/u, "").trim();
    const ms = window.__fechas[nombre];
    return ms === undefined ? null : ms;
  }));

const ordenado = (xs, dir) => {
  const limpio = xs.filter((x) => x !== null);
  return JSON.stringify(limpio) ===
         JSON.stringify([...limpio].sort((a, b) => (dir === "asc" ? a - b : b - a)));
};

test.describe("Listado de insumos", () => {
  test("los filtros se acumulan y el botón de limpiar los devuelve todos", async ({ page }) => {
    await irAStock(page);
    const filas = page.locator("#tbody-insumos tr");
    const total = await filas.count();
    expect(total).toBeGreaterThan(5);

    // El botón no está hasta que haya algo que limpiar.
    await expect(page.locator("#btn-limpiar-filtros")).toBeHidden();

    // Filtrar por estado: TODO lo que queda está agotado.
    await page.selectOption("#filtro-ins-estado", "agotado");
    await expect(page.locator("#btn-limpiar-filtros")).toBeVisible();
    await expect.poll(() => columna(page, 8).then((c) => [...new Set(c)])).toEqual(["Agotado"]);
    const agotados = await filas.count();
    expect(agotados).toBeLessThan(total);

    // Sumar ubicación ACOTA todavía más: los filtros no se pisan.
    const ubic = await page.locator("#filtro-ins-ubic option").nth(1).getAttribute("value");
    await page.selectOption("#filtro-ins-ubic", ubic);
    await expect.poll(() => filas.count()).toBeLessThanOrEqual(agotados);

    // Limpiar devuelve la lista entera.
    await page.click("#btn-limpiar-filtros");
    await expect(page.locator("#btn-limpiar-filtros")).toBeHidden();
    await expect(filas).toHaveCount(total);
  });

  test("buscar encuentra por parte del nombre, sin tildes y en cualquier orden", async ({ page }) => {
    await irAStock(page);
    const buscador = page.locator("#filtro-ins-nombre");
    const primera = page.locator("#tbody-insumos tr td:first-child").first();

    // "mineral" trae "Agua mineral 500ml" aunque el nombre no empiece así.
    await buscador.fill("mineral");
    await expect(primera).toContainText(/mineral/i);

    // Las palabras al revés dan lo mismo.
    await buscador.fill("mineral agua");
    await expect(primera).toContainText(/agua mineral/i);

    // Y sin la eñe también.
    await buscador.fill("champinones");
    await expect(primera).toContainText(/champi/i);
  });

  test("último control ordena en los dos sentidos y se suma al filtro", async ({ page }) => {
    await page.goto("/stock.html");
    await sembrarFechas(page);
    await page.evaluate(() => cargarInsumos());
    await esperarTabla(page);

    // 1er clic: lo más antiguo primero, y lo que NUNCA se controló arriba.
    await page.click("#th-ctrl");
    await expect.poll(() => fechasVisibles(page).then((f) => f[0])).toBeNull();
    await expect.poll(() => fechasVisibles(page).then((f) => ordenado(f, "asc"))).toBe(true);

    // 2º clic: al revés, y lo que nunca se controló al final.
    await page.click("#th-ctrl");
    await expect.poll(() => fechasVisibles(page).then((f) => f[0])).not.toBeNull();
    await expect.poll(() => fechasVisibles(page).then((f) => ordenado(f, "desc"))).toBe(true);

    // Filtrar NO pierde el orden: los dos criterios se aplican.
    const ubic = await page.locator("#filtro-ins-ubic option").nth(1).getAttribute("value");
    await page.selectOption("#filtro-ins-ubic", ubic);
    await expect.poll(() => columna(page, 3).then((c) => new Set(c).size)).toBeLessThanOrEqual(1);
    expect(ordenado(await fechasVisibles(page), "desc")).toBe(true);
  });
});

test.describe("Listado imprimible", () => {
  // ⚠ Texto CRUDO: toHaveText mira textContent, así que el text-transform del
  //   CSS (que las muestra en mayúsculas) no entra.
  const CABECERA = ["Producto", "Ubicación", "Estado", "Último control",
                    "Stock actual", "Observaciones"];

  test("columnas fijas y centradas, no cambian con el filtro", async ({ page }) => {
    await irAStock(page);
    await page.evaluate(() => abrirImprimirStock());
    const cabecera = page.locator("#imprimir-body thead th");
    await expect(cabecera).toHaveText(CABECERA);

    // Centrado: es una planilla para recorrer el depósito con una lapicera.
    const alineaciones = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#imprimir-body th, #imprimir-body td"))
        .map((c) => getComputedStyle(c).textAlign));
    expect(new Set(alineaciones)).toEqual(new Set(["center"]));

    // La última columna va VACÍA a propósito: es para anotar a mano.
    const obs = page.locator("#imprimir-body td.obs");
    expect(await obs.count()).toBeGreaterThan(0);
    await expect(obs.first()).toHaveText("");

    // Con un filtro puesto, la hoja tiene la MISMA forma.
    await page.click("#modal-imprimir-stock .modal-footer .btn-secondary");
    await page.selectOption("#filtro-ins-estado", "agotado");
    await expect.poll(() => columna(page, 8).then((c) => [...new Set(c)])).toEqual(["Agotado"]);
    await page.evaluate(() => abrirImprimirStock());
    await expect(cabecera).toHaveText(CABECERA);
  });

  test("agrupar y ordenar se combinan", async ({ page }) => {
    await page.goto("/stock.html");
    await sembrarFechas(page);
    await page.evaluate(() => cargarInsumos());
    await esperarTabla(page);

    await page.evaluate(() => abrirImprimirStock());
    await page.selectOption("#imprimir-grupo", "ubicacion");
    await page.selectOption("#imprimir-orden", "ctrl-asc");

    const filas = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#imprimir-body tbody tr"))
        .map((tr) => ({ ubic: tr.cells[1].innerText.trim(), ctrl: tr.cells[3].innerText.trim() })));
    expect(filas.length).toBeGreaterThan(3);

    // Agrupado: cada ubicación aparece en UN solo bloque contiguo.
    const bloques = filas.map((f) => f.ubic).filter((u, i, a) => u !== a[i - 1]);
    expect(new Set(bloques).size).toBe(bloques.length);

    // Y DENTRO de cada bloque, por fecha: "Nunca" primero, después ascendente.
    for (const grupo of new Set(filas.map((f) => f.ubic))) {
      const dentro = filas.filter((f) => f.ubic === grupo).map((f) => f.ctrl);
      const nunca = dentro.filter((c) => c === "Nunca").length;
      expect(dentro.slice(0, nunca).every((c) => c === "Nunca")).toBe(true);
      const fechas = dentro.slice(nunca).map((c) => {
        const [d, m, a] = c.split("/").map(Number);
        return new Date(a, m - 1, d).getTime();
      });
      expect(fechas).toEqual([...fechas].sort((x, y) => x - y));
    }
  });
});

test.describe("Revisión de stock", () => {
  const abrirRevision = async (page) => {
    await page.evaluate(() => abrirModalRevision());
    await esperarTabla(page, "#rev-tbody");
  };

  test("lo contado sobrevive a filtrar y a cambiar el orden", async ({ page }) => {
    await irAStock(page);
    await abrirRevision(page);

    const primero = page.locator("#rev-tbody input.rev-inp").first();
    const id = await primero.getAttribute("id");
    await primero.fill("123");
    await expect(page.locator("#rev-total-val")).not.toHaveText("€ 0.00");

    // Buscar algo que lo saque de la vista.
    await page.fill("#rev-filtro-nombre", "zzz-no-existe");
    await expect(page.locator("#rev-tbody .empty")).toHaveCount(1);

    // Al volver, el conteo sigue ahí. Este era EL bug: se borraba.
    await page.fill("#rev-filtro-nombre", "");
    await expect(page.locator(`#${id}`)).toHaveValue("123");

    // Y tampoco se pierde al reordenar.
    await page.selectOption("#rev-orden", "ctrl-asc");
    await expect(page.locator(`#${id}`)).toHaveValue("123");
  });

  test("un sobrante suma al balance en vez de ignorarse", async ({ page }) => {
    await irAStock(page);
    await abrirRevision(page);

    const dato = await page.evaluate(() => {
      const i = _revDataFull.find((x) => x.ultimo_precio && +x.ultimo_precio > 0);
      return i ? { id: i.id, teorico: +i.cantidad_actual, precio: +i.ultimo_precio } : null;
    });
    expect(dato, "hace falta al menos un insumo con precio de referencia").not.toBeNull();

    // Falta uno → pérdida, en rojo.
    await page.fill(`#rev-inp-${dato.id}`, String(dato.teorico - 1));
    await expect(page.locator("#rev-total-lbl")).toContainText("Pérdida");
    await expect(page.locator("#rev-total-val")).toHaveText(new RegExp(dato.precio.toFixed(2)));

    // Sobra uno → EXCEDENTE, en verde. Antes esto se descartaba.
    await page.fill(`#rev-inp-${dato.id}`, String(dato.teorico + 1));
    await expect(page.locator("#rev-total-lbl")).toContainText("Excedente");
    await expect(page.locator("#rev-total-bar")).toHaveClass(/cero/);
    await expect(page.locator(`#rev-perd-${dato.id}`)).toContainText("+");
  });

  test("los ocho títulos entran en un renglón", async ({ page }) => {
    await irAStock(page);
    await abrirRevision(page);
    const altos = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#modal-revision thead th"))
        .map((t) => t.getBoundingClientRect().height));
    expect(altos.length).toBe(8);
    expect(Math.max(...altos) - Math.min(...altos)).toBeLessThan(6);
  });

  test("la calculadora suma, convierte y no inventa números", async ({ page }) => {
    await irAStock(page);
    await abrirRevision(page);
    await page.click("#rev-btn-calc");
    await expect(page.locator("#calc-panel")).toBeVisible();

    const cuenta = async (teclas) => {
      await page.evaluate((t) => {
        calcTecla("C");
        for (const c of t) calcTecla(c);
        calcTecla("=");
      }, teclas);
      return page.locator("#calc-vis").innerText();
    };

    expect(await cuenta("12+30")).toBe("42");
    expect(await cuenta("(2+3)×4")).toBe("20");
    expect(await cuenta("10÷0")).toBe("Error");     // no inventa un número
    // Dos signos seguidos: gana el PRIMERO, así una multiplicación no se
    // convierte en suma por un dedo de más.
    expect(await cuenta("4×+6")).toBe("24");
    expect(await cuenta("5+×+÷+5")).toBe("10");

    // Conversor: dentro de la misma magnitud convierte...
    await page.click("#calc-tab");
    await page.fill("#cu-val", "1");
    await page.selectOption("#cu-de", "peso|kg");
    await page.selectOption("#cu-a", "peso|g");
    await expect(page.locator("#cu-res")).toHaveText(/^1\.?000 g$/);

    // ...y de litros a kilos NO, porque haría falta la densidad del producto.
    await page.selectOption("#cu-a", "peso|kg");
    await page.selectOption("#cu-de", "volumen|l");
    await expect(page.locator("#cu-res")).toContainText("densidad");
  });

  test("la calculadora se arrastra y no se pierde fuera de la pantalla", async ({ page }) => {
    await irAStock(page);
    await abrirRevision(page);
    await page.click("#rev-btn-calc");

    const caja = () => page.locator("#calc-panel").boundingBox();
    const antes = await caja();
    const barra = await page.locator("#calc-barra").boundingBox();

    await page.mouse.move(barra.x + barra.width / 2, barra.y + barra.height / 2);
    await page.mouse.down();
    await page.mouse.move(barra.x - 400, barra.y + 200, { steps: 10 });
    await page.mouse.up();
    expect((await caja()).x).not.toBeCloseTo(antes.x, 0);

    // Contra el borde, queda dentro: si se va, no se recupera sin recargar.
    const b2 = await page.locator("#calc-barra").boundingBox();
    await page.mouse.move(b2.x + 10, b2.y + 10);
    await page.mouse.down();
    await page.mouse.move(-500, -500, { steps: 10 });
    await page.mouse.up();
    const fuera = await caja();
    expect(fuera.x).toBeGreaterThanOrEqual(0);
    expect(fuera.y).toBeGreaterThanOrEqual(0);
  });
});

test.describe("Control de stock sin diferencias", () => {
  // Reportado por el socio: "cuando hago un control de stock y el esperado coincide con
  // el real no me toma el ingreso". Confirmar que TODO coincide es un control válido —
  // no ajusta nada ni mueve plata, pero deja constancia y sella la fecha de último
  // control de cada insumo contado, que es para lo que se hace el conteo.
  //
  // ⚠ SOLO LECTURA: se intercepta `api.post` y no se guarda ninguna revisión de verdad.
  const correrConfirmacion = (page, declarado, datos) => page.evaluate(async ({ d, f }) => {
    // @ts-ignore  (globales de la página)
    _revDataFull = f; _revDeclarado = d;
    const notas = document.getElementById("rev-notas");
    if (notas) notas.value = "";
    let capturado = null;
    // @ts-ignore
    const origPost = api.post, origI = window.cargarInsumos, origP = window.cargarInsumosProduccion;
    // @ts-ignore
    api.post = async (ep, body) => { capturado = { ep, body }; return { mensaje: "ok" }; };
    // @ts-ignore  (no recargar listas por red al terminar)
    window.cargarInsumos = async () => {}; window.cargarInsumosProduccion = async () => {};
    try { await confirmarRevision(); } catch (e) { /* el resultado se juzga por lo enviado */ }
    finally {
      // @ts-ignore
      api.post = origPost; window.cargarInsumos = origI; window.cargarInsumosProduccion = origP;
    }
    return capturado;
  }, { d: declarado, f: datos });

  test("todo coincide: se guarda igual, sin ajustar nada", async ({ page }) => {
    await page.goto("/stock.html");
    const enviado = await correrConfirmacion(page, { 4242: 7 },
      [{ id: 4242, nombre: "Insumo de prueba", unidad: "kg", cantidad_actual: 7 }]);

    expect(enviado, "no llamó al endpoint: siguió bloqueando el control sin diferencias")
      .not.toBeNull();
    expect(enviado.ep).toContain("/stock/revision");
    expect(enviado.body.items, "no debe ajustar ningún stock").toEqual([]);
    expect(enviado.body.controlados, "tiene que sellar el insumo contado").toEqual([4242]);
  });

  test("una diferencia real sí viaja como ajuste", async ({ page }) => {
    await page.goto("/stock.html");
    const enviado = await correrConfirmacion(page, { 4242: 5 },
      [{ id: 4242, nombre: "Insumo de prueba", unidad: "kg", cantidad_actual: 7 }]);

    expect(enviado).not.toBeNull();
    expect(enviado.body.items).toEqual([{ insumo_id: 4242, stock_real: 5 }]);
    expect(enviado.body.controlados).toEqual([4242]);
  });

  test("sin contar nada no se guarda", async ({ page }) => {
    // Lo único que de verdad no tiene sentido: un control donde no se contó ningún insumo.
    await page.goto("/stock.html");
    const enviado = await correrConfirmacion(page, {},
      [{ id: 4242, nombre: "Insumo de prueba", unidad: "kg", cantidad_actual: 7 }]);
    expect(enviado, "un control vacío no debería guardarse").toBeNull();
  });
});
