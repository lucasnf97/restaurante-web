// @ts-check
// IMPORTAR. Es la única función que escribe datos de OTRO sistema dentro de
// este: ventas, fichajes que suman en la nómina, clientes, productos de la
// carta. Lo que de verdad hay que probar no es que importe —eso se ve— sino que
// la REVERSIÓN revierta: una importación mal interpretada por la IA se deshace
// con un botón, y si ese botón deja la mitad adentro, nadie se entera.
//
// ⚠ No se llama a la IA. `POST /importar/confirmar` recibe la estructura ya
//   armada, así que las pruebas la arman a mano: ni se gasta cuota de Gemini ni
//   se depende de que interprete igual dos veces.
//
// ⚠ Todo se importa a un período LEJOS del año curado de la maqueta (2027), para
//   no mezclarse con su narrativa de tendencias ni con ningún informe real.
const { test, expect, api, ir, marca } = require("./_arenero");

const PERIODO = { desde: "2027-03-01", hasta: "2027-03-31" };

/** Importa y devuelve el id, o falla con el detalle del servidor. */
const importar = async (page, cuerpo) => {
  const r = await api(page, "POST", "/importar/confirmar", {
    nombre: marca("importacion"),
    periodo_desde: PERIODO.desde, periodo_hasta: PERIODO.hasta,
    ...cuerpo,
  });
  expect(r.ok, `no se pudo importar: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
  const id = r.data.importacion_id || r.data.id;
  expect(id, `el confirmar no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();
  return id;
};

const revertir = (page, id) =>
  id ? api(page, "DELETE", `/importar/${id}`) : Promise.resolve({ ok: true });

const listaImportaciones = async (page) => {
  const r = await api(page, "GET", "/importar");
  expect(r.ok, `no se pudo listar: ${r.status}`).toBe(true);
  return Array.isArray(r.data) ? r.data : (r.data.importaciones || []);
};

test.describe("Ventas importadas", () => {
  test("se importan, figuran en el listado y la reversión las borra",
    async ({ page }) => {
      await ir(page, "importar-ventas.html");
      let id = null;
      try {
        id = await importar(page, {
          tipo: "productos",
          items: [
            { nombre: marca("hamburguesa"), cantidad: 10, importe: 150, iva_pct: 10, crear: true },
            { nombre: marca("bebida"), cantidad: 20, importe: 80, iva_pct: 10, crear: true },
          ],
        });

        const lista = await listaImportaciones(page);
        expect(lista.some((x) => x.id === id), "la importación no figura en el listado").toBe(true);

        const det = await api(page, "GET", `/importar/${id}/detalle`);
        expect(det.ok, `sin detalle: ${det.status}`).toBe(true);

        // Y la venta aparece en la rentabilidad del período importado.
        const rent = await api(page, "GET",
          `/ventas/rentabilidad?desde=${PERIODO.desde}&hasta=${PERIODO.hasta}`);
        expect(rent.ok).toBe(true);
        expect(rent.data.resumen.ingresos_inc,
          "lo importado no llegó a la rentabilidad").toBeGreaterThan(0);
      } finally {
        const rev = await revertir(page, id);
        expect(rev.ok, `la reversión falló: ${rev.status}`).toBe(true);
      }

      // ⚠ Lo que importa: DESPUÉS de revertir, el período tiene que quedar en
      //   cero. Si quedara algo, una importación mal interpretada seguiría
      //   sumando en los informes aunque el usuario la haya deshecho.
      const post = await api(page, "GET",
        `/ventas/rentabilidad?desde=${PERIODO.desde}&hasta=${PERIODO.hasta}`);
      expect(post.data.resumen.ingresos_inc, "la reversión dejó ventas adentro").toBe(0);
      expect((await listaImportaciones(page)).some((x) => x.id === id),
        "la importación revertida sigue en el listado").toBe(false);
    });

  test("importar por DÍAS suma facturación y también se revierte",
    async ({ page }) => {
      await ir(page, "importar-ventas.html");
      let id = null;
      try {
        id = await importar(page, {
          tipo: "dias",
          dias: [
            { fecha: "2027-03-10", recibos: 40, importe: 1200 },
            { fecha: "2027-03-11", recibos: 35, importe: 990 },
          ],
        });
        const r = await api(page, "GET", "/reportes/facturacion-mes?year=2027&month=3");
        expect(r.ok).toBe(true);
        expect(r.data.ventas, "los días importados no suman en la facturación")
          .toBeGreaterThan(0);
      } finally {
        const rev = await revertir(page, id);
        expect(rev.ok, `la reversión falló: ${rev.status}`).toBe(true);
      }
      const post = await api(page, "GET", "/reportes/facturacion-mes?year=2027&month=3");
      expect(post.data.ventas, "la reversión dejó facturación adentro").toBe(0);
    });
});

test.describe("Fichajes importados", () => {
  // ⚠ El caso más delicado: los fichajes importados son filas REALES en
  //   `turnos_fichaje` y SUMAN EN LA NÓMINA. Si la reversión no los saca, se le
  //   paga a alguien por horas de un archivo que se descartó.

  test("suman horas en la nómina, y al revertir la nómina vuelve a lo que era",
    async ({ page }) => {
      await ir(page, "importar-ventas.html");

      const us = await api(page, "GET", "/auth/usuarios");
      const emp = (us.data || []).find((u) => u.activo !== false && u.rol !== "gerente");
      expect(emp, "el arenero no tiene empleados").toBeTruthy();

      const nomina = async () => {
        const r = await api(page, "GET",
          `/salarios/resumen?desde=${PERIODO.desde}&hasta=${PERIODO.hasta}`);
        expect(r.ok, `no se pudo leer la nómina: ${r.status}`).toBe(true);
        const u = (r.data.usuarios || []).find((x) => x.id === emp.id);
        return u ? u.horas_fichadas : 0;
      };

      const antes = await nomina();
      let id = null;
      try {
        id = await importar(page, {
          tipo: "fichajes",
          fichajes: [
            { usuario_id: emp.id, fecha: "2027-03-10", entrada: "10:00", salida: "18:00" },
            { usuario_id: emp.id, fecha: "2027-03-11", entrada: "10:00", salida: "16:00" },
          ],
        });
        const conImport = await nomina();
        expect(conImport - antes, "las 14 h importadas no llegaron a la nómina")
          .toBeCloseTo(14, 1);
      } finally {
        const rev = await revertir(page, id);
        expect(rev.ok, `la reversión falló: ${rev.status}`).toBe(true);
      }

      expect(await nomina(), "la reversión dejó horas pagables adentro")
        .toBeCloseTo(antes, 1);
    });
});

test.describe("Clientes importados", () => {
  test("se dan de alta de verdad y la reversión los quita", async ({ page }) => {
    await ir(page, "importar-ventas.html");
    const nombre = marca("cliente");
    // ⚠ Teléfono Único por corrida. Los clientes se DEDUPLICAN POR CONTACTO: con
    //   un teléfono ya usado por otra prueba, el alta FUSIONA con el existente en
    //   vez de crear uno nuevo, y la prueba falla buscando un nombre que nunca se
    //   escribió. Es comportamiento correcto del producto —dos fichas de la misma
    //   persona parten su historial— y hay que respetarlo al probar.
    const telefono = "+45 " + String(Date.now()).slice(-9);
    const cuantos = async () => {
      const r = await api(page, "GET", "/clientes");
      expect(r.ok, `no se pudo listar clientes: ${r.status}`).toBe(true);
      const l = Array.isArray(r.data) ? r.data : (r.data.clientes || []);
      return l.filter((c) => (c.nombre || "").includes(nombre)).length;
    };

    let id = null;
    try {
      id = await importar(page, {
        tipo: "clientes",
        clientes: [{ nombre, telefono, notas: "alta por prueba" }],
      });
      expect(await cuantos(), "el cliente importado no se dio de alta").toBe(1);
    } finally {
      const rev = await revertir(page, id);
      expect(rev.ok, `la reversión falló: ${rev.status}`).toBe(true);
    }
    expect(await cuantos(), "la reversión dejó el cliente adentro").toBe(0);
  });
});

test.describe("Qué se puede importar y quién", () => {
  test("el catálogo de destinos viene con sus permisos", async ({ page }) => {
    await ir(page, "importar-ventas.html");
    const r = await api(page, "GET", "/importar/destinos");
    expect(r.ok, `sin catálogo de destinos: ${r.status}`).toBe(true);
    const dest = Array.isArray(r.data) ? r.data : (r.data.destinos || []);
    const claves = dest.map((d) => d.clave || d.id || d.tipo);
    // Son los destinos que el catálogo declara (app/importar_destinos.py): si
    // alguno desaparece, la pantalla se queda sin esa opción en silencio.
    expect(claves, "faltan destinos en el catálogo").toEqual(
      expect.arrayContaining(["productos", "dias", "insumos", "compras",
                              "fichajes", "clientes", "carta"]));
  });

  test("importar sin nada que importar rebota", async ({ page }) => {
    await ir(page, "importar-ventas.html");
    const r = await api(page, "POST", "/importar/confirmar",
      { nombre: marca("vacia"), tipo: "fichajes", fichajes: [] });
    expect(r.ok, "aceptó una importación vacía").toBe(false);
    expect(r.status).toBe(400);
  });
});
