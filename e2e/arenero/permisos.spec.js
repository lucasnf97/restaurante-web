// @ts-check
// PERMISOS — el portón de seguridad. Es lo más caro de tener mal: no se rompe
// nada a la vista, simplemente alguien ve o cambia lo que no le toca.
//
// Se prueba contra empleados REALES del arenero, que hoy no tienen ni un
// permiso (sólo `activo` y `email_notif`). Eso los vuelve la línea base más
// estricta posible: todo lo sensible les tiene que dar 403.
//
// ⚠ Esta prueba NO ESCRIBE nada. Los caminos de guardado se sondean con un
//   cuerpo INVÁLIDO a propósito: si el permiso funciona contesta 403 y si
//   estuviera roto contesta 422 por validación — nunca llega a guardar. Sin ese
//   truco, probar que un empleado "no puede crear" exigiría arriesgarse a que sí
//   pueda, y dejar la basura adentro.
const { test, expect, api, apiComo, ir } = require("./_arenero");

/** Un empleado sin permisos y el gerente, sacados de la base. */
const gente = async (page) => {
  const r = await api(page, "GET", "/auth/usuarios");
  expect(r.ok, `no se pudo listar usuarios: ${r.status}`).toBe(true);
  const us = (r.data || []).filter((u) => u.activo !== false);
  const jefe = us.find((u) => u.rol === "gerente");
  const raso = us.find((u) => u.rol !== "gerente" && u.username !== "sistema");
  expect(jefe, "el arenero no tiene gerente").toBeTruthy();
  expect(raso, "el arenero no tiene un empleado sin mando").toBeTruthy();
  return { jefe, raso };
};

/** Endpoints de LECTURA sensibles, con el permiso que los protege. */
const LECTURA = [
  ["/salarios/resumen?year=2026&month=5", "nómina"],
  ["/caja/cierres?desde=2026-05-01&hasta=2026-05-31", "gestion_caja"],
  ["/caja/revision/cerradas", "revision"],
  ["/reportes/facturacion-mes?year=2026&month=5", "acceso_estadisticas"],
  ["/ventas/rentabilidad?desde=2026-05-01&hasta=2026-05-31", "acceso_estadisticas"],
];

test.describe("Un empleado sin permisos no pasa", () => {
  test("lo sensible le da 403, y al gerente no", async ({ page }) => {
    await ir(page, "dashboard.html");
    const { raso } = await gente(page);

    const malos = [];
    for (const [ep, que] of LECTURA) {
      const suyo = await apiComo(page, raso.username, "GET", ep);
      // ⚠ Diferencial: se comprueba contra lo que responde el GERENTE en la
      //   misma corrida. Afirmar "200" a secas haría fallar la prueba el día que
      //   ese endpoint devuelva 404 por datos, y taparía el problema real.
      const delJefe = await api(page, "GET", ep);

      if (suyo.status !== 403) {
        malos.push(`${que}: ${ep} le dio ${suyo.status} a ${raso.username} (esperaba 403)`);
      }
      if (delJefe.status === 403) {
        malos.push(`${que}: ${ep} le dio 403 AL GERENTE`);
      }
    }
    expect(malos).toEqual([]);
  });

  test("tampoco puede guardar en lo que no le toca", async ({ page }) => {
    await ir(page, "dashboard.html");
    const { raso } = await gente(page);

    // ⚠ Cuerpos VACÍOS a propósito: con el permiso bien puesto rebota en 403
    //   ANTES de mirar el cuerpo. Un 422 significaría que pasó el portón y sólo
    //   lo frenó la validación — el permiso estaría roto.
    const ESCRITURA = [
      ["POST", "/auth/usuarios", "alta de usuarios"],
      ["POST", "/roles/familias", "familias de permisos"],
      ["PUT", "/config/negocio", "configuración del local"],
      ["POST", "/stock/insumos", "alta de insumos"],
    ];

    const malos = [];
    for (const [metodo, ep, que] of ESCRITURA) {
      const r = await apiComo(page, raso.username, metodo, ep, {});
      if (r.status !== 403) {
        malos.push(`${que}: ${metodo} ${ep} dio ${r.status} (esperaba 403; ` +
                   `422 = el portón lo dejó pasar y sólo lo frenó la validación)`);
      }
    }
    expect(malos).toEqual([]);
  });

  test("lo que es de acceso libre, sí lo ve", async ({ page }) => {
    await ir(page, "dashboard.html");
    const { raso } = await gente(page);

    // Horarios, Fichajes y Social son de acceso universal por diseño (§6): si
    // estos dieran 403, el empleado no podría ni ver su propio turno.
    const LIBRES = ["/auth/me", "/turnos/mis-turnos", "/social/posts"];
    const malos = [];
    for (const ep of LIBRES) {
      const r = await apiComo(page, raso.username, "GET", ep);
      if (r.status === 403) malos.push(`${ep} le dio 403 y es de acceso libre`);
    }
    expect(malos).toEqual([]);
  });
});

test.describe("El catálogo de permisos", () => {
  test("no se lo lleva cualquiera de internet", async ({ page }) => {
    await ir(page, "dashboard.html");
    // ⚠ `/roles/permisos` no tenía NINGUNA dependencia: sin sesión lo leía
    //   cualquiera. No trae datos del inquilino, pero describe entera la
    //   superficie del sistema (permisos, grupos, páginas). Su vecino
    //   `/familias` ya llevaba el cierre; este se había salteado.
    const sinSesion = await page.evaluate(async () => {
      const r = await fetch(window._API_URL + "/roles/permisos");
      return r.status;
    });
    expect(sinSesion, "el catálogo de permisos se lee sin sesión").toBe(401);
  });

  test("cualquier usuario logueado sí puede leerlo", async ({ page }) => {
    await ir(page, "dashboard.html");
    const { raso } = await gente(page);
    // Es una tabla ESTÁTICA y no dice nada de quién la pide: cerrarla por
    // `acceso_configuracion` rompería pantallas que sólo la usan para rotular.
    const r = await apiComo(page, raso.username, "GET", "/roles/permisos");
    expect(r.status).toBe(200);
  });
});

test.describe("El gerente sí pasa", () => {
  test("no se lleva un 403 en ninguna pantalla suya", async ({ page }) => {
    await ir(page, "dashboard.html");
    const malos = [];
    for (const [ep, que] of LECTURA) {
      const r = await api(page, "GET", ep);
      if (r.status === 403) malos.push(`${que}: ${ep}`);
    }
    expect(malos, "el gerente tiene que poder con todo lo de su local").toEqual([]);
  });
});
