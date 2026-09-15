// @ts-check
// CADENA y RESTAURANTES. Son las pantallas de arriba de todo: un gerente de
// cadena administra varios locales, y el superadmin ve a todos los clientes.
//
// Lo que se prueba es el AISLAMIENTO, que acá no es un detalle: si un gerente de
// cadena viera los locales de otro, un cliente estaría viendo la facturación y
// el personal de otro cliente. Es la peor falla posible de un producto
// multi-empresa, y no se nota nunca desde adentro.
//
// ⚠ SOLO LECTURA, y con un cuidado extra: estas pantallas alcanzan a Breto, que
//   es un restaurante REAL. No se escribe nada y sólo se leen las listas de
//   locales, que es lo mínimo para demostrar la separación.
const { test, expect, token, tokenCadena } = require("./sesion");

/**
 * gid 3 = las maquetas (0000A, 0000B, 0001A). gid 4 = Breto y Breto 2.
 * ⚠ El gid va SIEMPRE con su usuario: el backend valida que coincidan.
 */
const MAQUETAS = { gid: Number(process.env.E2E_GID || 3), user: process.env.E2E_USER || "Lucas" };
const OTRO = { gid: Number(process.env.E2E_GID_OTRO || 4), user: process.env.E2E_USER_OTRO || "Agus" };

/** Llama a la API con el token de un gerente de CADENA concreto. */
const comoCadena = (page, quien, ep) => page.evaluate(async ({ e, t }) => {
  const r = await fetch(window._API_URL + e, {
    headers: { "Authorization": "Bearer " + t },
  });
  let data = null;
  try { data = await r.json(); } catch (x) { /* vacío */ }
  return { ok: r.ok, status: r.status, data };
}, { e: ep, t: tokenCadena(quien.gid, quien.user) });

const codigos = (r) => {
  const l = Array.isArray(r.data) ? r.data : ((r.data || {}).restaurantes || []);
  return l.map((x) => x.codigo).filter(Boolean).sort();
};

test.describe("Un gerente de cadena ve SUS locales y sólo esos", () => {
  test.use({ rol: "gerente_cadena" });

  test("las dos cadenas no se ven entre sí", async ({ page }) => {
    await page.goto("/cadena.html");
    await expect(page.locator("body")).toBeVisible();

    const mios = await comoCadena(page, MAQUETAS, "/cadena/restaurantes");
    expect(mios.ok, `el gerente ${MAQUETAS.gid} no puede listar sus locales: ${mios.status}`)
      .toBe(true);
    const otros = await comoCadena(page, OTRO, "/cadena/restaurantes");
    expect(otros.ok, `el gerente ${OTRO.gid} no puede listar sus locales: ${otros.status}`)
      .toBe(true);

    const a = codigos(mios), b = codigos(otros);
    expect(a.length, "el gerente de las maquetas no ve ningún local").toBeGreaterThan(0);
    expect(b.length, "el otro gerente no ve ningún local").toBeGreaterThan(0);

    // ⚠ LA prueba: ni un solo código en común. Si se cruzaran, un cliente vería
    //   los locales de otro.
    const cruce = a.filter((x) => b.includes(x));
    expect(cruce, `hay locales visibles para los dos gerentes: ${cruce.join(", ")}`)
      .toEqual([]);
  });

  test("no puede pedir los datos de un local que no es suyo", async ({ page }) => {
    await page.goto("/cadena.html");
    const otros = await comoCadena(page, OTRO, "/cadena/restaurantes");
    const ajeno = (Array.isArray(otros.data) ? otros.data : [])[0];
    test.skip(!ajeno, "no se pudo identificar un local ajeno");

    // Pedir explícitamente el id de un local de OTRA cadena. Adivinar un id es
    // trivial (son seriales), así que la defensa no puede ser que no se sepa.
    const r = await comoCadena(page, MAQUETAS, `/cadena/roles/${ajeno.id}`);
    expect(r.ok, `el gerente de las maquetas leyó datos del local ${ajeno.codigo}`)
      .toBe(false);
    expect([403, 404], `respondió ${r.status} en vez de negar el acceso`)
      .toContain(r.status);
  });

  test("el personal de la cadena es sólo el de sus locales", async ({ page }) => {
    await page.goto("/cadena-personal.html");
    await expect(page.locator("body")).toBeVisible();

    const r = await comoCadena(page, MAQUETAS, "/cadena/personal");
    expect(r.ok, `no se pudo leer el personal: ${r.status}`).toBe(true);

    // Cada ficha tiene que pertenecer a alguno de SUS locales.
    const mios = await comoCadena(page, MAQUETAS, "/cadena/restaurantes");
    const idsMios = new Set((Array.isArray(mios.data) ? mios.data : []).map((x) => x.id));
    const gente = Array.isArray(r.data) ? r.data : ((r.data || {}).empleados || []);
    const intrusos = [];
    for (const e of gente) {
      const asigs = e.restaurantes || e.asignaciones || [];
      for (const a of asigs) {
        const rid = a.restaurante_id ?? a.id ?? a;
        if (rid != null && !idsMios.has(rid)) intrusos.push(`${e.username || e.nombre}→${rid}`);
      }
    }
    expect(intrusos.slice(0, 5),
      "hay empleados de locales que no son de esta cadena").toEqual([]);
  });
});

test.describe("No se salta de cadena cambiando el token", () => {
  test.use({ rol: "gerente_cadena" });

  test("un gid ajeno con el usuario propio se rechaza", async ({ page }) => {
    await page.goto("/cadena.html");
    // ⚠ Los claims los elige quien tiene la clave de firma, no el servidor. Si
    //   el backend sólo mirara el `gid`, bastaría con cambiar ese número para
    //   entrar a la cadena de otro cliente: los ids son seriales, se adivinan
    //   contando. La defensa es que valida gid Y usuario juntos
    //   (`WHERE id = :g AND username = :u`).
    const mezclado = { gid: OTRO.gid, user: MAQUETAS.user };   // gid ajeno, usuario propio
    const r = await comoCadena(page, mezclado, "/cadena/restaurantes");
    expect(r.ok, `entró a la cadena ${OTRO.gid} firmando con el usuario propio`)
      .toBe(false);
    expect([401, 403], `respondió ${r.status} en vez de rechazar el token`)
      .toContain(r.status);

    // Y al revés también: el usuario ajeno con el gid propio.
    const alReves = { gid: MAQUETAS.gid, user: OTRO.user };
    const r2 = await comoCadena(page, alReves, "/cadena/restaurantes");
    expect(r2.ok, "aceptó un token con el usuario de otro gerente").toBe(false);
  });
});

test.describe("Un gerente de local no llega a las pantallas de cadena", () => {
  test("los endpoints de cadena le dan 403", async ({ page }) => {
    await page.goto("/dashboard.html");
    await expect(page.locator("body")).toBeVisible();

    // ⚠ El aislamiento va en las dos direcciones: un gerente de UN restaurante
    //   no puede asomarse a la cadena. Su token no tiene `gid`.
    const malos = [];
    for (const ep of ["/cadena/restaurantes", "/cadena/personal", "/cadena/empleados"]) {
      const r = await page.evaluate(async (e) => {
        const res = await fetch(window._API_URL + e, {
          headers: { "Authorization": "Bearer " + localStorage.getItem("token") },
        });
        return res.status;
      }, ep);
      if (r !== 403 && r !== 401) malos.push(`${ep} → ${r}`);
    }
    expect(malos, "un gerente de local alcanza endpoints de cadena").toEqual([]);
  });
});

test.describe("El superadmin", () => {
  test.use({ rol: "superadmin" });

  test("ve la lista de restaurantes y las cadenas", async ({ page }) => {
    await page.goto("/restaurantes.html");
    await expect(page.locator("body")).toBeVisible();

    const r = await page.evaluate(async () => {
      const res = await fetch(window._API_URL + "/restaurantes/", {
        headers: { "Authorization": "Bearer " + localStorage.getItem("token") },
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    });
    expect(r.status, `el superadmin no puede listar restaurantes: ${r.status}`).toBe(200);
    const l = Array.isArray(r.data) ? r.data : ((r.data || {}).restaurantes || []);
    // Es el único rol que los ve a TODOS: si viera menos, estaría administrando
    // a ciegas.
    expect(l.length, "el superadmin ve menos de dos restaurantes").toBeGreaterThan(1);
  });

  test("un gerente de local NO puede entrar a la administración", async ({ page }) => {
    // Se usa un token de gerente de inquilino contra el panel del superadmin.
    const tok = token("gerente");
    await page.goto("/dashboard.html");
    const st = await page.evaluate(async (t) => {
      const res = await fetch(window._API_URL + "/restaurantes/", {
        headers: { "Authorization": "Bearer " + t },
      });
      return res.status;
    }, tok);
    expect([401, 403], `un gerente de local leyó el panel del superadmin (${st})`)
      .toContain(st);
  });
});
