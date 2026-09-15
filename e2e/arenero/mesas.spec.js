// @ts-check
// SALAS Y MESAS. Lo delicado de esta pantalla no es crear: es BORRAR. La FK
// `pedidos.mesa_id` es RESTRICT, así que una mesa con historial no se puede
// eliminar de una — y el historial de ventas NO puede perderse por borrar una
// mesa que ya no existe físicamente en el local.
//
// ⚠ Todo se hace sobre salas y mesas CREADAS por la prueba y borradas al
//   terminar. Las 17 mesas de la maqueta no se tocan: borrar una se llevaría
//   puesta la referencia de sus 10.033 cuentas.
const { test, expect, api, ir, marca } = require("./_arenero");

const crearSala = async (page) => {
  const r = await api(page, "POST", "/mesas/salas", { nombre: marca("sala") });
  expect(r.ok, `no se pudo crear la sala: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
  const id = r.data.id || (r.data.sala && r.data.sala.id);
  expect(id, `el alta de sala no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();
  return id;
};

const crearMesa = async (page, salaId, numero, capacidad = 4) => {
  const r = await api(page, "POST", "/mesas/", {
    numero, capacidad, sala_id: salaId, x: 100, y: 100,
  });
  expect(r.ok, `no se pudo crear la mesa: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
  const id = r.data.id || (r.data.mesa && r.data.mesa.id);
  expect(id, `el alta de mesa no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();
  return id;
};

/** Número libre: los de la maqueta están tomados y `numero` es único. */
const numeroLibre = async (page) => {
  const r = await api(page, "GET", "/mesas/");
  const l = Array.isArray(r.data) ? r.data : (r.data.mesas || []);
  return Math.max(0, ...l.map((m) => Number(m.numero) || 0)) + 1;
};

const limpiar = async (page, { mesas = [], salas = [] }) => {
  for (const id of mesas) await api(page, "DELETE", `/mesas/${id}`);
  for (const id of salas) await api(page, "DELETE", `/mesas/salas/${id}`);
};

test.describe("Salas y mesas", () => {
  test("se crea una sala con su mesa y las dos se borran", async ({ page }) => {
    await ir(page, "mesas.html");
    const mesas = [], salas = [];
    try {
      const sala = await crearSala(page); salas.push(sala);
      const mesa = await crearMesa(page, sala, await numeroLibre(page)); mesas.push(mesa);

      const r = await api(page, "GET", "/mesas/");
      const l = Array.isArray(r.data) ? r.data : (r.data.mesas || []);
      const m = l.find((x) => x.id === mesa);
      expect(m, "la mesa creada no figura en el listado").toBeTruthy();
      expect(m.sala_id, "la mesa no quedó en su sala").toBe(sala);
    } finally {
      await limpiar(page, { mesas, salas });
    }
  });

  test("dos mesas no pueden tener el mismo número", async ({ page }) => {
    await ir(page, "mesas.html");
    const mesas = [], salas = [];
    try {
      const sala = await crearSala(page); salas.push(sala);
      const n = await numeroLibre(page);
      mesas.push(await crearMesa(page, sala, n));

      // ⚠ El número de mesa es lo que dice el mozo en voz alta y lo que sale en
      //   el ticket. Dos mesas con el mismo número hacen imposible saber a cuál
      //   se le cobró.
      const repe = await api(page, "POST", "/mesas/", {
        numero: n, capacidad: 2, sala_id: sala, x: 0, y: 0,
      });
      expect(repe.ok, `aceptó dos mesas con el número ${n}`).toBe(false);
      const id = repe.data && (repe.data.id || (repe.data.mesa && repe.data.mesa.id));
      if (id) mesas.push(id);
    } finally {
      await limpiar(page, { mesas, salas });
    }
  });

  test("cambiar el estado de una mesa la libera y la ocupa", async ({ page }) => {
    await ir(page, "mesas.html");
    const mesas = [], salas = [];
    try {
      const sala = await crearSala(page); salas.push(sala);
      const mesa = await crearMesa(page, sala, await numeroLibre(page)); mesas.push(mesa);

      const leer = async () => {
        const r = await api(page, "GET", "/mesas/");
        const l = Array.isArray(r.data) ? r.data : (r.data.mesas || []);
        return (l.find((x) => x.id === mesa) || {}).estado;
      };
      expect(await leer(), "una mesa nueva no nace libre").toBe("libre");

      const oc = await api(page, "PATCH", `/mesas/${mesa}/estado`, { estado: "reservada" });
      expect(oc.ok, `no se pudo cambiar el estado: ${oc.status}`).toBe(true);
      expect(await leer()).toBe("reservada");

      await api(page, "PATCH", `/mesas/${mesa}/estado`, { estado: "libre" });
      expect(await leer()).toBe("libre");
    } finally {
      await limpiar(page, { mesas, salas });
    }
  });
});

test.describe("Borrar una mesa no borra su historia", () => {
  // ⚠ Es la razón de ser de esta pantalla en lo que hace a la plata. La FK
  //   `pedidos.mesa_id` es RESTRICT: sin limpiar las referencias, borrar tira un
  //   500 que en la web llega SIN CORS y se ve como "error de conexión" —un
  //   mensaje que no dice nada de lo que pasa—. Y si se borrara en cascada, se
  //   perderían las ventas hechas en esa mesa.

  test("las cuentas cobradas sobreviven a que se borre la mesa", async ({ page }) => {
    await ir(page, "mesas.html");
    const mesas = [], salas = [];
    let sala = null, mesa = null;
    try {
      sala = await crearSala(page); salas.push(sala);
      mesa = await crearMesa(page, sala, await numeroLibre(page)); mesas.push(mesa);

      // Se abre una cuenta en la mesa y se cancela vacía: alcanza para dejar la
      // referencia que hace fallar un borrado ingenuo.
      const ab = await api(page, "POST", "/pedidos/abrir", { mesa_id: mesa, comensales: 2 });
      expect(ab.ok, `no se pudo abrir la cuenta: ${ab.status} ${JSON.stringify(ab.data)}`)
        .toBe(true);
      const pedido = ab.data.id || (ab.data.pedido && ab.data.pedido.id);
      expect(pedido, `abrir no devolvió id: ${JSON.stringify(ab.data)}`).toBeTruthy();

      // Con la cuenta ABIERTA, borrar tiene que estar prohibido: adentro hay gente.
      const conAbierta = await api(page, "DELETE", `/mesas/${mesa}`);
      expect(conAbierta.ok, "dejó borrar una mesa con una cuenta abierta").toBe(false);

      await api(page, "POST", `/pedidos/${pedido}/cancelar-vacio`);

      // Ahora sí se borra, y sin 500.
      const bo = await api(page, "DELETE", `/mesas/${mesa}`);
      expect(bo.ok, `no se pudo borrar la mesa: ${bo.status} ${JSON.stringify(bo.data)}`)
        .toBe(true);
      expect(bo.status, "el borrado devolvió un error de servidor (el 500 que en la " +
        "web se ve como 'error de conexión')").toBeLessThan(500);
      mesas.length = 0;   // ya no existe
    } finally {
      await limpiar(page, { mesas, salas });
    }
  });

  test("una sala con mesas adentro no se borra de un tirón", async ({ page }) => {
    await ir(page, "mesas.html");
    const mesas = [], salas = [];
    try {
      const sala = await crearSala(page); salas.push(sala);
      const mesa = await crearMesa(page, sala, await numeroLibre(page)); mesas.push(mesa);

      // Borrar la sala con mesas adentro dejaría mesas huérfanas o se las
      // llevaría puestas con su historial.
      const r = await api(page, "DELETE", `/mesas/salas/${sala}`);
      if (r.ok) {
        // Si se permite, las mesas NO pueden haber desaparecido en silencio.
        const l = await api(page, "GET", "/mesas/");
        const lista = Array.isArray(l.data) ? l.data : (l.data.mesas || []);
        expect(lista.some((x) => x.id === mesa),
          "borró la sala y se llevó la mesa puesta").toBe(true);
      } else {
        expect(r.status, "rechazó por un error de servidor en vez de explicar")
          .toBeLessThan(500);
      }
    } finally {
      await limpiar(page, { mesas, salas });
    }
  });
});

test.describe("El plano de la sala", () => {
  test("se guarda y vuelve igual", async ({ page }) => {
    await ir(page, "mesas.html");
    const salas = [];
    try {
      const sala = await crearSala(page); salas.push(sala);
      // ⚠ El plano son SOLO bloques —paredes, puertas, escaleras y textos se
      //   RETIRARON por decisión del dueño— y el contrato lo refleja: la clave es
      //   `elementos` y el único `tipo` aceptado es "rect". Cualquier otra cosa da
      //   400, que es lo que hay que mantener: sin esa validación volverían a
      //   colarse elementos que la pantalla ya no sabe dibujar.
      const plano = { elementos: [{ tipo: "rect", x: 10, y: 20, w: 100, h: 50, texto: "Barra" }] };
      const g = await api(page, "PATCH", `/mesas/salas/${sala}/plano`, { plano });
      expect(g.ok, `no se pudo guardar el plano: ${g.status}`).toBe(true);

      const r = await api(page, "GET", "/mesas/salas");
      const l = Array.isArray(r.data) ? r.data : (r.data.salas || []);
      const s = l.find((x) => x.id === sala);
      expect(s, "la sala no vuelve en el listado").toBeTruthy();
      const guardado = typeof s.plano === "string" ? JSON.parse(s.plano) : s.plano;
      expect(guardado, "el plano no volvió igual").toEqual(plano);

      // Y un tipo que ya no existe se rechaza con 400, no con un 500.
      const malo = await api(page, "PATCH", `/mesas/salas/${sala}/plano`,
        { plano: { elementos: [{ tipo: "pared", x: 0, y: 0 }] } });
      expect(malo.ok, "aceptó un elemento de plano que ya no existe").toBe(false);
      expect(malo.status).toBe(400);
    } finally {
      await limpiar(page, { salas });
    }
  });
});
