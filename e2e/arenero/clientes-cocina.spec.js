// @ts-check
// CLIENTES y COCINA, las dos caras operativas que faltaban.
//
// Clientes: lo que importa es la FUSIÓN. Dos fichas de la misma persona parten
// su historial en dos, y fusionar mal se lleva puesto el del que se elimina.
// Cocina: el ciclo de una comanda (pendiente → preparación → lista → entregada)
// y el cronómetro, que es lo que mira el cocinero para saber qué sale primero.
//
// ⚠ Todo sobre datos creados por la prueba, pero la de COCINA tiene un limite
//   que conviene saber: una cuenta que ya mando una comanda NO se puede cerrar
//   por API sin COBRARLA. `cancelar-vacio` la rechaza —y con razon: una mesa que
//   mando algo a cocina no esta "vacia"— y cobrarla inventaria una venta en la
//   maqueta. Asi que la prueba cancela la comanda, quita la linea y libera la
//   mesa, pero la CUENTA queda abierta hasta que se corre `deshacer_0000b.py`.
//   Despues del barrido hay que verificar que las mesas que uso volvieron a
//   `libre`: borrar la cuenta no cambia el estado de la mesa.
const { test, expect, api, ir, marca } = require("./_arenero");

// ── Clientes ────────────────────────────────────────────────────────────────
const crearCliente = async (page, nombre, telefono) => {
  const r = await api(page, "POST", "/clientes/", { nombre, telefono });
  expect(r.ok, `no se pudo crear el cliente: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
  const id = r.data.id || (r.data.cliente && r.data.cliente.id);
  expect(id, `el alta no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();
  return id;
};

const buscarCliente = async (page, id) => {
  const r = await api(page, "GET", `/clientes/${id}`);
  return r.ok ? r.data : null;
};

test.describe("Clientes", () => {
  test("se da de alta y se encuentra por el buscador", async ({ page }) => {
    await ir(page, "clientes.html");
    const nombre = marca("cliente");
    const tel = "+45 " + String(Date.now()).slice(-9);
    const id = await crearCliente(page, nombre, tel);

    const r = await api(page, "GET", `/clientes/?q=${encodeURIComponent(nombre)}`);
    expect(r.ok, `el buscador falló: ${r.status}`).toBe(true);
    const l = Array.isArray(r.data) ? r.data : (r.data.clientes || []);
    expect(l.some((c) => c.id === id), "el cliente nuevo no aparece al buscarlo").toBe(true);
  });

  test("dos fichas de la misma persona se fusionan en una", async ({ page }) => {
    await ir(page, "clientes.html");
    const base = Date.now();
    const telPpal = "+45 " + String(base).slice(-9);
    const telSec  = "+45 " + String(base + 7).slice(-9);
    const principal = await crearCliente(page, marca("ppal"), telPpal);
    const secundario = await crearCliente(page, marca("sec"), telSec);

    // ⚠ Fusionar es de una sola dirección y sin vuelta atrás: el secundario
    //   DESAPARECE. Lo que no puede pasar es que se lleve su historial: sus
    //   contactos tienen que quedar en el principal.
    const f = await api(page, "POST", "/clientes/unificar",
      { id_principal: principal, id_secundario: secundario });
    expect(f.ok, `no se pudo fusionar: ${f.status} ${JSON.stringify(f.data)}`).toBe(true);

    expect(await buscarCliente(page, secundario),
      "el secundario sigue existiendo tras fusionar").toBeFalsy();
    const ppal = await buscarCliente(page, principal);
    expect(ppal, "el principal desapareció al fusionar").toBeTruthy();
    // Los contactos del secundario VIAJAN al principal: si no, se pierde el
    // teléfono por el que ese cliente llamaba y la ficha fusionada vale menos
    // que las dos por separado.
    const contactos = JSON.stringify(ppal.contactos || ppal);
    expect(contactos, "el teléfono del principal se perdió").toContain(telPpal);
    expect(contactos, "el teléfono del secundario no viajó al principal").toContain(telSec);
  });

  test("no se puede fusionar un cliente consigo mismo", async ({ page }) => {
    await ir(page, "clientes.html");
    const id = await crearCliente(page, marca("solo"),
      "+45 " + String(Date.now() + 11).slice(-9));
    const r = await api(page, "POST", "/clientes/unificar",
      { id_principal: id, id_secundario: id });
    // Sin este guarda, el cliente se borraría a sí mismo al "fusionarse".
    expect(r.ok, "dejó fusionar un cliente consigo mismo").toBe(false);
    expect(r.status).toBe(400);
  });
});

// ── Cocina ──────────────────────────────────────────────────────────────────
test.describe("El ciclo de una comanda", () => {
  /** Abre una cuenta en una mesa libre y le manda una comanda. */
  const montar = async (page) => {
    const ms = await api(page, "GET", "/mesas/");
    const lista = Array.isArray(ms.data) ? ms.data : (ms.data.mesas || []);
    const libres = lista.filter((m) => m.estado === "libre");
    expect(libres.length, "no hay ninguna mesa libre en el arenero").toBeGreaterThan(0);

    const ps = await api(page, "GET", "/productos/");
    const prods = Array.isArray(ps.data) ? ps.data : (ps.data.productos || []);
    const prod = prods.find((p) => p.area_id) || prods[0];
    expect(prod, "el arenero no tiene productos").toBeTruthy();

    // ⚠ "libre" es el ESTADO de la mesa, y puede mentir: una corrida anterior
    //   pudo dejar una cuenta abierta y la mesa marcada libre. Abrir ahi no crea
    //   una cuenta nueva: el indice unico salta y el endpoint devuelve LA QUE YA
    //   ESTABA. Si la prueba se quedara con esa, estaria trabajando sobre datos
    //   ajenos y al final los cancelaria. Se prueba mesa por mesa hasta abrir una
    //   de verdad.
    let libre = null, pedido = null;
    for (const m of libres) {
      const ab = await api(page, "POST", "/pedidos/abrir", { mesa_id: m.id, comensales: 2 });
      if (!ab.ok) continue;
      if (/ya tiene una cuenta/i.test(ab.data.mensaje || "")) continue;   // no es mia
      libre = m;
      pedido = ab.data.id || (ab.data.pedido && ab.data.pedido.id);
      break;
    }
    expect(pedido, "no se pudo abrir una cuenta NUEVA en ninguna mesa libre").toBeTruthy();

    // ⚠ La comanda NO lleva productos: lleva los ids de las LINEAS que ya estan
    //   en la cuenta, mas el area a la que va. Primero se agrega la linea.
    const it = await api(page, "POST", `/pedidos/${pedido}/items`, {
      producto_id: prod.id, cantidad: 1, notas: marca("comanda"),
    });
    expect(it.ok, `no se pudo agregar la linea: ${it.status} ${JSON.stringify(it.data)}`)
      .toBe(true);
    const itemId = it.data.id || (it.data.item && it.data.item.id);
    expect(itemId, `agregar linea no devolvio id: ${JSON.stringify(it.data)}`).toBeTruthy();

    const area = prod.area_id || (await api(page, "GET", "/productos/areas")).data[0].id;
    const or = await api(page, "POST", `/pedidos/${pedido}/ordenes`, {
      area_id: area, items: [itemId],
    });
    expect(or.ok, `no se pudo mandar la comanda: ${or.status} ${JSON.stringify(or.data)}`)
      .toBe(true);
    const orden = or.data.id || (or.data.orden && or.data.orden.id) ||
                  (or.data.ordenes && or.data.ordenes[0] && or.data.ordenes[0].id);
    expect(orden, `la comanda no devolvió id: ${JSON.stringify(or.data)}`).toBeTruthy();
    return { pedido, orden, item: itemId, mesa: libre.id, area };
  };

  /**
   * Deja la mesa libre y sin rastro.
   * ⚠ El orden importa: `cancelar-vacio` exige que la cuenta esté VACIA, asi que
   *   primero se cancela la comanda y se quita la linea. Sin quitar la linea, la
   *   cuenta queda abierta, la mesa ocupada y —porque abrir una mesa crea un
   *   bloque automatico de 90 min en la grilla— tambien queda una reserva colgada.
   */
  const desmontar = async (page, m) => {
    if (!m) return;
    if (m.orden) await api(page, "PATCH", `/pedidos/ordenes/${m.orden}/estado`,
      { estado: "cancelada" });
    if (m.item) await api(page, "DELETE", `/pedidos/${m.pedido}/items/${m.item}`);
    if (m.pedido) {
      const c = await api(page, "POST", `/pedidos/${m.pedido}/cancelar-vacio`);
      // ⚠ Si la cuenta no se pudo cancelar, lo que NO puede quedar es la mesa
      //   ocupada: eso se ve en el plano del salon de la maqueta como una mesa
      //   con gente que no existe. Se libera a mano.
      if (!c.ok && m.mesa) {
        await api(page, "PATCH", `/mesas/${m.mesa}/estado`, { estado: "libre" });
      }
    }
  };

  test("pasa de pendiente a entregada y aparece en su área", async ({ page }) => {
    await ir(page, "cocina.html");
    let m = null;
    try {
      m = await montar(page);

      // ⚠ La comanda nace PENDIENTE y tiene que verse en la pantalla de su área:
      //   si no aparece, el plato no se cocina y nadie se entera hasta que el
      //   cliente pregunta.
      if (m.area) {
        const enArea = await api(page, "GET", `/pedidos/ordenes/area/${m.area}`);
        expect(enArea.ok, `no se pudo leer el área: ${enArea.status}`).toBe(true);
        const ords = Array.isArray(enArea.data) ? enArea.data : (enArea.data.ordenes || []);
        expect(ords.some((o) => o.id === m.orden),
          "la comanda nueva no aparece en la pantalla de su área").toBe(true);
      }

      for (const estado of ["en_preparacion", "lista", "entregada"]) {
        const r = await api(page, "PATCH", `/pedidos/ordenes/${m.orden}/estado`, { estado });
        expect(r.ok, `no pasó a ${estado}: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
      }

      // ⚠ ENTREGADA con la cuenta ABIERTA sigue a la vista, y está bien: es el
      //   historial del turno (el ejecutable lo muestra en su pantalla de
      //   "Entregadas", con la hora de entrega). Recién desaparece cuando la
      //   cuenta se COBRA o se CANCELA —asi lo dice el filtro:
      //   `NOT (estado='entregada' AND pedido IN ('cobrado','cancelado'))`—.
      //   Si desapareciera antes, el cocinero perdería de vista lo que ya salió.
      if (m.area) {
        const conCuentaAbierta = await api(page, "GET", `/pedidos/ordenes/area/${m.area}`);
        const abiertas = Array.isArray(conCuentaAbierta.data)
          ? conCuentaAbierta.data : (conCuentaAbierta.data.ordenes || []);
        expect(abiertas.some((o) => o.id === m.orden),
          "lo entregado desaparecio de la cocina con la cuenta todavia abierta")
          .toBe(true);
      }

      // Cancelar la comanda si la saca: eso no se cocina.
      await api(page, "PATCH", `/pedidos/ordenes/${m.orden}/estado`, { estado: "cancelada" });
      if (m.area) {
        const post = await api(page, "GET", `/pedidos/ordenes/area/${m.area}`);
        const ords = Array.isArray(post.data) ? post.data : (post.data.ordenes || []);
        expect(ords.some((o) => o.id === m.orden),
          "una comanda cancelada sigue en la pantalla de la cocina").toBe(false);
      }
    } finally {
      await desmontar(page, m);
    }
  });

  test("un estado que no existe se rechaza", async ({ page }) => {
    await ir(page, "cocina.html");
    let m = null;
    try {
      m = await montar(page);
      const r = await api(page, "PATCH", `/pedidos/ordenes/${m.orden}/estado`,
        { estado: "quemada" });
      expect(r.ok, "aceptó un estado inventado").toBe(false);
      expect(r.status).toBe(400);
    } finally {
      await desmontar(page, m);
    }
  });
});
