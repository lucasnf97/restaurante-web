// @ts-check
// CONFIGURACIÓN (roles y permisos) y DASHBOARD. Acá se reparte quién puede qué:
// un permiso mal puesto no rompe nada a la vista, simplemente alguien ve el
// sueldo de sus compañeros. Es la pantalla que más conviene tener probada.
//
// ⚠ Se trabaja SIEMPRE sobre un rol y una plantilla CREADOS por la prueba. Los
//   tres roles de la maqueta (Cocinero, Camarero, Bartender) no se tocan:
//   cambiarles un permiso se lo cambia a los empleados que los tienen.
const { test, expect, api, apiComo, ir, marca } = require("./_arenero");

const crearRol = async (page, permisos = {}) => {
  const r = await api(page, "POST", "/roles", {
    nombre: marca("rol"), descripcion: "rol de prueba", permisos,
  });
  expect(r.ok, `no se pudo crear el rol: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
  const id = r.data.id || (r.data.rol && r.data.rol.id);
  expect(id, `el alta no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();
  return id;
};

const leerRol = async (page, id) => {
  const r = await api(page, "GET", "/roles");
  const l = Array.isArray(r.data) ? r.data : (r.data.roles || []);
  return l.find((x) => x.id === id);
};

test.describe("Roles y permisos", () => {
  test("un rol se crea con sus permisos y vuelven igual", async ({ page }) => {
    await ir(page, "configuracion.html");
    let id = null;
    try {
      id = await crearRol(page, { ver_stock: true, gestion_stock: false });
      const rol = await leerRol(page, id);
      expect(rol, "el rol creado no figura").toBeTruthy();
      const p = typeof rol.permisos === "string" ? JSON.parse(rol.permisos) : rol.permisos;
      expect(p.ver_stock, "el permiso que se puso en true volvió distinto").toBe(true);
      // ⚠ Un permiso guardado en false NO puede volver como true: el editor
      //   distingue "ver" de "editar" y confundirlos da acceso de edición a
      //   quien sólo tenía que mirar.
      expect(!!p.gestion_stock, "un permiso en false volvió activado").toBe(false);
    } finally {
      if (id) await api(page, "DELETE", `/roles/${id}`);
    }
  });

  test("aplicar el rol le cambia los permisos a sus empleados de verdad",
    async ({ page }) => {
      await ir(page, "configuracion.html");
      // ⚠ Es el paso que la gente olvida: editar el rol NO alcanza, hay que
      //   APLICARLO. Si aplicar no hiciera nada, el gerente creería que le dio
      //   -o le quitó- un acceso a alguien y no se lo dio.
      const us = await api(page, "GET", "/auth/usuarios");
      const raso = (us.data || []).find((u) => u.activo !== false && u.rol !== "gerente");
      expect(raso, "el arenero no tiene empleados").toBeTruthy();

      // ⚠ Se sondea un endpoint GATEADO con cuerpo VACIO: 403 = el porton lo
      //   frena, 422 = paso el porton y solo lo freno la validacion. Asi se mide
      //   el permiso sin escribir un solo insumo.
      //   (`GET /stock/insumos` NO sirve para esto: no tiene gate. El nivel
      //   "ver" se filtra en la pantalla, no en la API.)
      const puede = async () => {
        const r = await apiComo(page, raso.username, "POST", "/stock/insumos", {});
        return r.status !== 403;
      };

      let id = null, nombreRol = null;
      const rolOriginal = raso.rol;
      try {
        expect(await puede(), "el empleado ya tenía el permiso antes de empezar")
          .toBe(false);

        const r = await api(page, "POST", "/roles", {
          nombre: marca("rol"), descripcion: "rol de prueba",
          permisos: { gestion_stock: true },
        });
        expect(r.ok, `no se pudo crear el rol: ${r.status}`).toBe(true);
        id = r.data.id;
        nombreRol = (await leerRol(page, id) || {}).nombre;
        expect(nombreRol, "el rol creado no vuelve en el listado").toBeTruthy();

        await api(page, "PATCH", `/auth/usuarios/${raso.id}`, { rol: nombreRol });
        const ap = await api(page, "POST", `/roles/${id}/aplicar`);
        expect(ap.ok, `no se pudo aplicar el rol: ${ap.status}`).toBe(true);
        expect(await puede(), "aplicar el rol no le dio el permiso que decía darle")
          .toBe(true);

        // Y quitarlo tambien tiene que llegar: revocar un acceso es mas
        // importante que darlo.
        await api(page, "PATCH", `/roles/${id}`,
          { nombre: nombreRol, permisos: { gestion_stock: false } });
        await api(page, "POST", `/roles/${id}/aplicar`);
        expect(await puede(), "quitar el permiso del rol no se lo quitó al empleado")
          .toBe(false);
      } finally {
        // ⚠ Devolver el rol ANTES de borrar el de prueba, o el empleado queda
        //   apuntando a un rol que no existe.
        await api(page, "PATCH", `/auth/usuarios/${raso.id}`, { rol: rolOriginal });
        if (id) await api(page, "DELETE", `/roles/${id}`);
        expect(await puede(), "la prueba le dejó puesto un permiso que no tenía")
          .toBe(false);
      }
    });

  test("un empleado sin acceso a configuración no puede tocar roles",
    async ({ page }) => {
      await ir(page, "configuracion.html");
      const us = await api(page, "GET", "/auth/usuarios");
      const raso = (us.data || []).find((u) => u.activo !== false && u.rol !== "gerente");
      // Quien puede editar roles puede darse a sí mismo cualquier permiso: es
      // la llave maestra de todo el sistema de accesos.
      const r = await apiComo(page, raso.username, "POST", "/roles",
        { nombre: marca("no deberia"), permisos: { acceso_configuracion: true } });
      expect(r.ok, "un empleado sin acceso a configuración creó un rol").toBe(false);
      expect(r.status).toBe(403);
    });
});

test.describe("Dashboard", () => {
  test("el dashboard propio se guarda y vuelve", async ({ page }) => {
    await ir(page, "dashboard.html");
    const antes = await api(page, "GET", "/dashboards/mio");
    expect(antes.ok, `no se pudo leer el dashboard: ${antes.status}`).toBe(true);

    try {
      const config = { blocks: [{ key: "accesos", span: 12 }] };
      const g = await api(page, "PUT", "/dashboards/mio", { config });
      expect(g.ok, `no se pudo guardar: ${g.status} ${JSON.stringify(g.data)}`).toBe(true);

      const post = await api(page, "GET", "/dashboards/mio");
      const c = post.data.config || post.data;
      expect(JSON.stringify(c), "lo guardado no volvió").toContain("accesos");
    } finally {
      // ⚠ Restaurar: el dashboard del gerente es lo primero que se ve al entrar
      //   a la maqueta. Dejarlo con un solo bloque la empobrece.
      const orig = antes.data.config || antes.data;
      if (orig) await api(page, "PUT", "/dashboards/mio", { config: orig });
    }
  });

  test("una plantilla se crea, se renombra y se borra", async ({ page }) => {
    await ir(page, "configuracion.html");
    let id = null;
    try {
      const r = await api(page, "POST", "/dashboards/templates", {
        nombre: marca("plantilla"), config: { blocks: [{ key: "accesos", span: 6 }] },
      });
      expect(r.ok, `no se pudo crear la plantilla: ${r.status} ${JSON.stringify(r.data)}`)
        .toBe(true);
      id = r.data.id || (r.data.template && r.data.template.id);
      expect(id, `el alta no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();

      const nuevo = marca("renombrada");
      const ren = await api(page, "PATCH", `/dashboards/templates/${id}`, { nombre: nuevo });
      expect(ren.ok, `no se pudo renombrar: ${ren.status}`).toBe(true);

      const l = await api(page, "GET", "/dashboards/overview");
      expect(JSON.stringify(l.data), "el nombre nuevo no figura").toContain(nuevo);
    } finally {
      if (id) await api(page, "DELETE", `/dashboards/templates/${id}`);
    }
  });

  test("un empleado sin gestión no administra plantillas", async ({ page }) => {
    await ir(page, "dashboard.html");
    const us = await api(page, "GET", "/auth/usuarios");
    const raso = (us.data || []).find((u) => u.activo !== false && u.rol !== "gerente");
    // El dashboard de los demás lo cura el gerente: si cualquiera pudiera
    // editarlo, podría ponerle a otro widgets con datos que no le tocan.
    const r = await apiComo(page, raso.username, "POST", "/dashboards/templates",
      { nombre: marca("no deberia"), config: { blocks: [] } });
    expect(r.ok, "un empleado sin gestión creó una plantilla de dashboard").toBe(false);
    expect(r.status).toBe(403);
  });

  test("cada quien recibe UN dashboard, aunque no tenga plantilla propia",
    async ({ page }) => {
      await ir(page, "dashboard.html");
      const us = await api(page, "GET", "/auth/usuarios");
      const raso = (us.data || []).find((u) => u.activo !== false && u.rol !== "gerente");
      // ⚠ Sin plantilla propia ni de rol, tiene que caer el default mínimo. Si
      //   devolviera vacío, el empleado entra a una pantalla en blanco y parece
      //   que la aplicación se rompió.
      const r = await apiComo(page, raso.username, "GET", "/dashboards/mio");
      expect(r.ok, `el empleado no recibe dashboard: ${r.status}`).toBe(true);
      const c = r.data.config || r.data;
      expect(c, "el dashboard del empleado vino vacío").toBeTruthy();
      expect(JSON.stringify(c).length, "el dashboard del empleado no tiene ni un bloque")
        .toBeGreaterThan(10);
    });
});
