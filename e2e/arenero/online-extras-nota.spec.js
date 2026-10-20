// @ts-check
// MENÚ ONLINE: extras del Menú y nota del producto (2026-10-20, pedido del dueño).
//
//   · al editar un producto online se eligen como extras los productos HABILITADOS como
//     extra en el Menú (`productos.es_extra`), que llegan con el catálogo;
//   · un extra vinculado cobra el precio ACTUAL de ese extra del Menú (no la copia del día
//     en que se agregó): "respetando los valores que se llevan";
//   · cada producto online puede tener una NOTA para el cliente, que la tienda muestra.
//
// ⚠ Sólo cosas creadas por la prueba (un producto online) y borradas al terminar.
const { test, expect, api, ir } = require("./_arenero");

test.describe("Menú online: extras del Menú y nota", () => {
  test("el catálogo trae los extras habilitados con sus categorías", async ({ page }) => {
    await ir(page, "online.html");
    const r = await api(page, "GET", "/online/catalogo");
    expect(r.ok, `catálogo: ${r.status}`).toBe(true);
    expect(Array.isArray(r.data.extras), "el catálogo no trae la lista de extras").toBe(true);
    for (const e of r.data.extras) {
      expect(typeof e.precio).toBe("number");
      expect(Array.isArray(e.categorias)).toBe(true);
    }
  });

  test("la nota se guarda y un extra vinculado usa el precio del Menú", async ({ page }) => {
    await ir(page, "online.html");
    const cat = (await api(page, "GET", "/online/catalogo")).data;
    const prod = cat.productos[0];
    test.skip(!prod, "el arenero no tiene productos en el Menú");
    const extra = (cat.extras || [])[0] || null;

    let opid = null;
    try {
      // El precio que se manda para el extra vinculado es a propósito OTRO: la tienda tiene
      // que cobrar el del Menú, no esta copia.
      const c = await api(page, "POST", "/online/productos", {
        producto_id: prod.id, activo: false, nota: "  Contiene frutos secos  ",
        extras: extra ? [{ nombre: extra.nombre, precio: extra.precio + 99, producto_id: extra.id }] : [],
      });
      expect(c.ok, `no se pudo crear el producto online: ${c.status} ${JSON.stringify(c.data)}`).toBe(true);
      opid = c.data.id;

      const m = await api(page, "GET", "/online/menu");
      const p = m.data.productos.find((x) => x.id === opid);
      expect(p, "el producto creado no está en el menú online").toBeTruthy();
      expect(p.nota, "la nota no se guardó (o no se recortó)").toBe("Contiene frutos secos");
      if (extra) {
        expect(p.extras.length).toBe(1);
        expect(p.extras[0].producto_id).toBe(extra.id);
        expect(p.extras[0].precio, "el extra vinculado no usa el precio del Menú").toBe(extra.precio);
      }

      // Nota vacía = sin nota.
      const e = await api(page, "PATCH", `/online/productos/${opid}`, { nota: "   " });
      expect(e.ok).toBe(true);
      const m2 = await api(page, "GET", "/online/menu");
      expect(m2.data.productos.find((x) => x.id === opid).nota).toBeNull();
    } finally {
      if (opid) await api(page, "DELETE", `/online/productos/${opid}`);
    }
  });
});
