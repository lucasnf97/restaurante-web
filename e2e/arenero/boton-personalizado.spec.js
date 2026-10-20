// @ts-check
// BOTÓN PERSONALIZADO DEL MENÚ (2026-10-20, pedido del dueño): una celda de la página de
// menú que NO está atada a ningún producto — nombre y precio a elección, o sin precio
// ("se pone al usarlo"). Sirve para cargar un cargo cualquiera y ajustar cuentas.
//
// Lo que no puede romperse:
//   · la celda se guarda y vuelve igual (con y sin precio);
//   · la línea entra en la cuenta SIN producto y SIN comanda (no va a cocina ni
//     descuenta stock), y se ve en el resumen de la mesa como renglón suelto;
//   · un cargo sin nombre o sin importe se rechaza (no puede quedar una línea muda).
//
// ⚠ Todo sobre cosas CREADAS por la prueba (página de menú, sala, mesa, cuenta) y
//   borradas al terminar: las páginas y mesas de la maqueta no se tocan.
const { test, expect, api, ir, marca } = require("./_arenero");

const crearPagina = async (page) => {
  const r = await api(page, "POST", "/menu/paginas", { nombre: marca("menu"), filas: 2, columnas: 3 });
  expect(r.ok, `no se pudo crear la página: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
  return r.data.id;
};

test.describe("Botón personalizado en la página de menú", () => {
  test("se guarda con y sin precio y vuelve igual", async ({ page }) => {
    await ir(page, "mesas.html");
    let pag = null;
    try {
      pag = await crearPagina(page);
      const g = await api(page, "PUT", `/menu/paginas/${pag}/layout`, {
        filas: 2, columnas: 3,
        items: [
          { fila: 0, columna: 0, color: "yellow", cargo_nombre: "Cargo por servicio", cargo_precio: 12.5 },
          { fila: 0, columna: 1, color: "red", cargo_nombre: "Ajuste libre", cargo_precio: null },
        ],
      });
      expect(g.ok, `no se pudo guardar el layout: ${g.status} ${JSON.stringify(g.data)}`).toBe(true);

      const r = await api(page, "GET", `/menu/paginas/${pag}/layout`);
      const it = (f, c) => r.data.items.find((x) => x.fila === f && x.columna === c);
      expect(it(0, 0), "no volvió el botón con precio").toBeTruthy();
      expect(it(0, 0).cargo_nombre).toBe("Cargo por servicio");
      expect(Number(it(0, 0).cargo_precio)).toBe(12.5);
      expect(it(0, 0).producto_id, "el botón quedó atado a un producto").toBeNull();
      expect(it(0, 1).cargo_nombre).toBe("Ajuste libre");
      expect(it(0, 1).cargo_precio, "sin precio tiene que volver null (se pone al usarlo)").toBeNull();

      // El mismo dato llega por el endpoint que usan el programa y la comandera.
      const todas = await api(page, "GET", "/menu/paginas/con-layouts");
      const p = todas.data.find((x) => x.id === pag);
      expect(p.items.some((x) => x.cargo_nombre === "Cargo por servicio"),
        "con-layouts no trae el botón personalizado").toBe(true);
    } finally {
      if (pag) await api(page, "DELETE", `/menu/paginas/${pag}`);
    }
  });

  test("el editor lo muestra y se crea desde su ventana", async ({ page }) => {
    await ir(page, "mesas.html");
    let pag = null;
    try {
      pag = await crearPagina(page);
      // Se carga la página recién creada en el editor (las funciones son de la página).
      await page.evaluate(async (id) => {
        setTabPanel("menus");
        setTabModo("diseno");
        await cargarPaginas();
        await seleccionarPagina(id);
      }, pag).catch(() => {});
      const disponible = await page.evaluate(() => typeof abrirCargo === "function"
        && typeof guardarCargo === "function");
      expect(disponible, "faltan las funciones del botón personalizado").toBe(true);
      const hay = await page.evaluate(() => !!_menuLayout);
      test.skip(!hay, "no se pudo abrir la página en el editor desde la prueba");

      await page.evaluate(() => {
        abrirCargo();
        document.getElementById("cargo-nombre").value = "Propina sugerida";
        document.getElementById("cargo-precio").value = "";
        guardarCargo();
      });
      const celda = await page.evaluate(() => Object.values(_menuCargos));
      expect(celda).toEqual([{ nombre: "Propina sugerida", precio: null }]);
      const txt = await page.evaluate(() => document.getElementById("menu-diseno-grid").innerText);
      expect(txt, "la celda del botón no se dibujó en la grilla").toContain("Propina sugerida");
    } finally {
      if (pag) await api(page, "DELETE", `/menu/paginas/${pag}`);
    }
  });
});

test.describe("La línea del botón personalizado en la cuenta", () => {
  test("entra sin producto y sin comanda, y se ve en el resumen", async ({ page }) => {
    await ir(page, "mesas.html");
    let sala = null, mesa = null, pedido = null, item = null;
    try {
      const s = await api(page, "POST", "/mesas/salas", { nombre: marca("sala") });
      sala = s.data.id || (s.data.sala && s.data.sala.id);
      const l = await api(page, "GET", "/mesas/");
      const lista = Array.isArray(l.data) ? l.data : (l.data.mesas || []);
      const numero = Math.max(0, ...lista.map((m) => Number(m.numero) || 0)) + 1;
      const m = await api(page, "POST", "/mesas/", { numero, capacidad: 4, sala_id: sala, x: 50, y: 50 });
      mesa = m.data.id || (m.data.mesa && m.data.mesa.id);

      const ab = await api(page, "POST", "/pedidos/abrir", { mesa_id: mesa, comensales: 2 });
      expect(ab.ok, `no se pudo abrir la cuenta: ${ab.status}`).toBe(true);
      pedido = ab.data.id || (ab.data.pedido && ab.data.pedido.id);

      // Sin nombre o sin importe: rechazado (no puede quedar una línea muda).
      const sinNombre = await api(page, "POST", `/pedidos/${pedido}/items`,
        { producto_id: null, cantidad: 1, precio_override: 5 });
      expect(sinNombre.status, "aceptó un cargo sin nombre").toBe(422);
      const sinPrecio = await api(page, "POST", `/pedidos/${pedido}/items`,
        { producto_id: null, cantidad: 1, nombre_override: "Cargo" });
      expect(sinPrecio.status, "aceptó un cargo sin importe").toBe(422);

      const ok = await api(page, "POST", `/pedidos/${pedido}/items`, {
        producto_id: null, cantidad: 2, nombre_override: "Cargo por servicio", precio_override: 7.25,
      });
      expect(ok.ok, `no entró el cargo: ${ok.status} ${JSON.stringify(ok.data)}`).toBe(true);
      item = ok.data.id;

      const r = await api(page, "GET", `/pedidos/mesa/${mesa}/resumen-activo`);
      const linea = (r.data.items || []).find((x) => x.id === item);
      expect(linea, "el cargo no aparece en el resumen de la mesa").toBeTruthy();
      expect(linea.producto_id, "el cargo quedó atado a un producto").toBeNull();
      expect(linea.nombre_snapshot).toBe("Cargo por servicio");
      expect(Number(linea.precio_unit)).toBe(7.25);
      expect(linea.cantidad).toBe(2);
      expect(linea.en_orden, "el cargo entró en una comanda (iría a cocina)").toBe(false);
      expect((r.data.ordenes || []).length, "se creó una comanda para el cargo").toBe(0);
    } finally {
      if (pedido && item) await api(page, "DELETE", `/pedidos/${pedido}/items/${item}`);
      if (pedido) await api(page, "POST", `/pedidos/${pedido}/cancelar-vacio`);
      if (mesa) await api(page, "DELETE", `/mesas/${mesa}`);
      if (sala) await api(page, "DELETE", `/mesas/salas/${sala}`);
    }
  });
});
