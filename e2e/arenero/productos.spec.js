// @ts-check
// CARTA Y PRECIOS. Acá se decide cuánto se le cobra al cliente, así que un
// error no se ve: simplemente se cobra mal hasta que alguien lo nota.
//
// ⚠ Todo se hace sobre un producto CREADO por la prueba y borrado al terminar.
//   Ni un precio de la maqueta se toca: son parte del año curado.
const { test, expect, api, ir, marca } = require("./_arenero");

/** Crea un producto de prueba y devuelve su id. Lo borra el `finally` de cada prueba. */
const crearProducto = async (page, precio = 10) => {
  const cats = await api(page, "GET", "/productos/categorias");
  expect(cats.ok, `no se pudieron leer categorías: ${cats.status}`).toBe(true);
  const cat = (cats.data || [])[0];
  expect(cat, "el arenero no tiene categorías").toBeTruthy();

  const r = await api(page, "POST", "/productos/", {
    nombre: marca("producto"), precio, categoria_id: cat.id,
    descripcion: "Creado por una prueba automática. Se borra al terminar.",
    en_carta: false,          // fuera de la carta: no ensucia la maqueta mientras existe
    disponible: false,
  });
  expect(r.ok, `no se pudo crear el producto: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
  const id = r.data.id || (r.data.producto && r.data.producto.id);
  expect(id, `el alta no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();
  return id;
};

const borrarProducto = (page, id) =>
  id ? api(page, "DELETE", `/productos/${id}`) : Promise.resolve();

/** El producto, releído del listado. */
const leer = async (page, id) => {
  const r = await api(page, "GET", "/productos/");
  expect(r.ok).toBe(true);
  const lista = Array.isArray(r.data) ? r.data : (r.data.productos || []);
  return lista.find((p) => p.id === id);
};

test.describe("Alta, edición y baja de un producto", () => {
  test("se crea, se edita el precio y se borra", async ({ page }) => {
    await ir(page, "productos.html");
    let id = null;
    try {
      id = await crearProducto(page, 12.5);
      const creado = await leer(page, id);
      expect(creado, "el producto creado no figura en el listado").toBeTruthy();
      expect(Number(creado.precio)).toBeCloseTo(12.5, 2);

      const ed = await api(page, "PATCH", `/productos/${id}`, { precio: 18.75 });
      expect(ed.ok, `no se pudo editar: ${ed.status}`).toBe(true);
      const tras = await leer(page, id);
      expect(Number(tras.precio), "la edición no cambió el precio").toBeCloseTo(18.75, 2);
    } finally {
      await borrarProducto(page, id);
    }
    expect(await leer(page, id), "el producto borrado sigue en el listado").toBeFalsy();
  });

  test("un precio negativo no entra", async ({ page }) => {
    await ir(page, "productos.html");
    const cats = await api(page, "GET", "/productos/categorias");
    const cat = (cats.data || [])[0];
    const r = await api(page, "POST", "/productos/", {
      nombre: marca("precio negativo"), precio: -5, categoria_id: cat.id, en_carta: false,
    });
    try {
      // Un precio negativo le PAGA al cliente por comer. Si entra, es un bug.
      expect(r.ok, "aceptó un producto con precio negativo").toBe(false);
    } finally {
      const id = r.data && (r.data.id || (r.data.producto && r.data.producto.id));
      await borrarProducto(page, id);
    }
  });
});

test.describe("Precios masivos", () => {
  // ⚠ Es la operación más peligrosa de la pantalla: toca TODA la carta de una.
  //   Además escribe `precio_slot_activo` en la configuración del local, así que
  //   estas pruebas aplican SIEMPRE la columna que ya está activa — así ese
  //   UPDATE deja el mismo valor y no se le cambia la configuración a la maqueta.

  const slotActivo = async (page) => {
    const c = await api(page, "GET", "/config/sistema");
    expect(c.ok, `no se pudo leer la config: ${c.status}`).toBe(true);
    const s = Number(c.data.precio_slot_activo || 1);
    expect([1, 2, 3], `slot activo raro: ${s}`).toContain(s);
    return s;
  };

  test("los tres slots se guardan y la columna aplicada pasa a ser el precio",
    async ({ page }) => {
      await ir(page, "productos.html");
      const slot = await slotActivo(page);
      let id = null;
      try {
        id = await crearProducto(page, 10);
        const valores = { precio_1: 11, precio_2: 22, precio_3: 33 };

        const r = await api(page, "POST", "/productos/precios-masivo", {
          aplicar_columna: slot,
          filas: [{ id, ...valores }],
        });
        expect(r.ok, `no se pudo aplicar: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);

        const p = await leer(page, id);
        expect(Number(p.precio_1)).toBeCloseTo(11, 2);
        expect(Number(p.precio_2)).toBeCloseTo(22, 2);
        expect(Number(p.precio_3)).toBeCloseTo(33, 2);
        // El precio que se COBRA es el de la columna aplicada.
        expect(Number(p.precio), `la columna ${slot} no pasó al precio activo`)
          .toBeCloseTo(valores[`precio_${slot}`], 2);
      } finally {
        await borrarProducto(page, id);
      }
    });

  test("un slot en null lo BORRA, no lo deja como estaba", async ({ page }) => {
    await ir(page, "productos.html");
    const slot = await slotActivo(page);
    let id = null;
    try {
      id = await crearProducto(page, 10);
      const llenos = { precio_1: 11, precio_2: 22, precio_3: 33 };
      llenos[`precio_${slot}`] = 11;   // la columna aplicada nunca va en null
      await api(page, "POST", "/productos/precios-masivo",
        { aplicar_columna: slot, filas: [{ id, ...llenos }] });

      // Ahora se manda uno de los slots NO aplicados en null.
      const otro = [1, 2, 3].find((s) => s !== slot);
      const conNull = { ...llenos };
      conNull[`precio_${otro}`] = null;
      const r = await api(page, "POST", "/productos/precios-masivo",
        { aplicar_columna: slot, filas: [{ id, ...conNull }] });
      expect(r.ok).toBe(true);

      // ⚠ Esto fija el contrato REAL, que NO es el que dice la documentación del
      //   endpoint ("un campo null significa sin cambio en ese slot"): el UPDATE
      //   escribe los tres sin condición, así que null BORRA. Por la pantalla no
      //   se pierde nada —siempre manda los tres campos con lo que hay en
      //   cada casilla— pero cualquier otro cliente que mande sólo lo que cambió
      //   se llevaría puestas las otras dos listas de precios.
      const p = await leer(page, id);
      expect(p[`precio_${otro}`], `precio_${otro} sobrevivió a un null`).toBeNull();
      // Y la columna aplicada sigue intacta.
      expect(Number(p[`precio_${slot}`])).toBeCloseTo(11, 2);
    } finally {
      await borrarProducto(page, id);
    }
  });

  test("una columna inválida se rechaza", async ({ page }) => {
    await ir(page, "productos.html");
    const r = await api(page, "POST", "/productos/precios-masivo",
      { aplicar_columna: 7, filas: [] });
    // Sin este guarda, un 7 no aplicaría nada y además dejaría
    // `precio_slot_activo = 7` en la configuración del local.
    expect(r.ok, "aceptó aplicar_columna = 7").toBe(false);
    expect(r.status).toBe(400);
  });
});

test.describe("La pantalla", () => {
  test("lista la carta y muestra el producto nuevo", async ({ page }) => {
    await ir(page, "productos.html");
    let id = null;
    try {
      id = await crearProducto(page, 9.99);
      // Se crea fuera de carta, así que se busca en la vista que los incluye.
      const p = await leer(page, id);
      expect(p, "el producto nuevo no vuelve en el listado").toBeTruthy();
      expect(p.en_carta, "se creó dentro de la carta y debía quedar fuera").toBeFalsy();
    } finally {
      await borrarProducto(page, id);
    }
  });
});
