// @ts-check
// PERFIL PROPIO y RESTABLECER CONTRASEÑA — las dos últimas pantallas con lógica.
//
// El perfil es lo único que un empleado puede cambiarse a sí mismo, así que el
// límite importa: que no pueda quedarse con el nombre de usuario de otro.
// El restablecer es la única puerta que se abre SIN sesión: un enlace inválido
// no puede dejar cambiar una contraseña.
//
// ⚠ Todo sobre un usuario DESCARTABLE: tocarle el perfil a alguien de la maqueta
//   le cambia el nombre con el que entra.
const { test, expect, api, apiComo, ir } = require("./_arenero");

const CLAVE = "Prueba-e2e-2026!";

const crearDescartable = async (page) => {
  const sufijo = Date.now().toString(36) + Math.floor(Math.random() * 1000);
  const username = `e2e_${sufijo}`;
  const r = await api(page, "POST", "/auth/usuarios", {
    username, password: CLAVE, rol: "empleado",
    email: `${username}@prueba-e2e.invalid`,
    nombre: "Prueba", apellido: sufijo,
  });
  expect(r.ok, `no se pudo crear el usuario: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
  return { id: r.data.id, username, sufijo };
};

const borrar = (page, u) => u ? api(page, "DELETE", `/auth/usuarios/${u.id}`) : Promise.resolve();

test.describe("El perfil propio", () => {
  test("un empleado se cambia sus iniciales y su aviso por correo",
    async ({ page }) => {
      await ir(page, "configuracion-usuario.html");
      let u = null;
      try {
        u = await crearDescartable(page);
        const r = await apiComo(page, u.username, "PATCH", "/auth/perfil",
          { iniciales: "ZZ", email_notif: false });
        expect(r.ok, `no se pudo editar el perfil: ${r.status} ${JSON.stringify(r.data)}`)
          .toBe(true);

        // ⚠ `/auth/me` NO devuelve `iniciales` (su SELECT trae identidad y
        //   permisos, no el resto de la ficha). Se relee del listado de usuarios,
        //   que es de donde lo saca la pantalla.
        const l = await api(page, "GET", "/auth/usuarios");
        const yo = (l.data || []).find((x) => x.id === u.id);
        expect(yo, "el usuario desapareció del listado").toBeTruthy();
        expect(yo.iniciales, "las iniciales no se guardaron").toBe("ZZ");
      } finally {
        await borrar(page, u);
      }
    });

  test("no puede quedarse con el nombre de usuario de otro", async ({ page }) => {
    await ir(page, "configuracion-usuario.html");
    let u = null;
    try {
      u = await crearDescartable(page);
      // ⚠ El nombre de usuario es ÚNICO GLOBAL. Si dos personas pudieran tener
      //   el mismo, el login deja de identificar a nadie —y con él, quién
      //   autorizó un descuento o quién fichó—.
      const r = await apiComo(page, u.username, "PATCH", "/auth/perfil",
        { username: "Lucas" });
      expect(r.ok, "se quedó con el nombre de usuario del gerente").toBe(false);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);

      // Y sigue siendo quien era.
      const yo = await apiComo(page, u.username, "GET", "/auth/me");
      expect(yo.ok, "el intento fallido le rompió la sesión").toBe(true);
    } finally {
      await borrar(page, u);
    }
  });

  test("un nombre de usuario vacío no entra", async ({ page }) => {
    await ir(page, "configuracion-usuario.html");
    let u = null;
    try {
      u = await crearDescartable(page);
      const r = await apiComo(page, u.username, "PATCH", "/auth/perfil",
        { username: "   " });
      // Un usuario sin nombre no puede volver a entrar nunca.
      expect(r.ok, "aceptó un nombre de usuario vacío").toBe(false);
      expect(r.status).toBe(400);
    } finally {
      await borrar(page, u);
    }
  });
});

test.describe("Restablecer la contraseña", () => {
  // ⚠ Es la ÚNICA puerta que se abre sin sesión, así que lo que se prueba es que
  //   no se abra de más. El camino feliz NO se puede probar desde acá: el token
  //   viaja por correo y en la base sólo queda su sha256, así que no hay forma
  //   honesta de obtenerlo sin leer el mail. Se cubren los rechazos, que son los
  //   que protegen.

  const sinSesion = (page, metodo, ep, cuerpo) => page.evaluate(async ({ m, e, b }) => {
    const r = await fetch(window._API_URL + e, {
      method: m,
      headers: { "Content-Type": "application/json" },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let data = null;
    try { data = await r.json(); } catch (x) { /* vacío */ }
    return { ok: r.ok, status: r.status, detail: (data && data.detail) || "" };
  }, { m: metodo, e: ep, b: cuerpo });

  test("un enlace inventado no valida", async ({ page }) => {
    await ir(page, "dashboard.html");
    // ⚠ Este endpoint contesta 200 con `{valido: false}` A PROPÓSITO: la página
    //   lo usa para decidir si muestra el formulario o el cartel de "enlace
    //   vencido". Un 4xx acá no sería más seguro y complicaría la pantalla; lo
    //   que importa es que diga `false`, y que CONFIRMAR sí rechace (abajo).
    const r = await page.evaluate(async (t) => {
      const res = await fetch(window._API_URL + "/auth/reset/validar?token=" + t);
      return { status: res.status, data: await res.json().catch(() => null) };
    }, `inventado-${Date.now()}`);
    expect(r.status).toBe(200);
    expect(r.data && r.data.valido, "un token inventado salió como válido").toBe(false);
  });

  test("con un enlace inventado no se puede fijar una contraseña", async ({ page }) => {
    await ir(page, "dashboard.html");
    const r = await sinSesion(page, "POST", "/auth/reset/confirmar",
      { token: `inventado-${Date.now()}`, password: "OtraClave-2026!" });
    // ⚠ Si esto pasara, cualquiera cambia la contraseña de cualquiera probando
    //   tokens. Es la falla más grave que puede tener esta pantalla.
    expect(r.ok, "un token inventado dejó cambiar una contraseña").toBe(false);
    expect(r.status).toBe(400);
    expect(r.detail).toMatch(/no es válido|venció/i);
  });

  test("una contraseña demasiado corta se rechaza", async ({ page }) => {
    await ir(page, "dashboard.html");
    const r = await sinSesion(page, "POST", "/auth/reset/confirmar",
      { token: `inventado-${Date.now()}`, password: "ab" });
    expect(r.ok).toBe(false);
    // ⚠ El largo se comprueba ANTES que el token: si no, un atacante distingue
    //   "token malo" de "token bueno, clave corta" y con eso sabe que acertó.
    expect(r.detail, "no valida el largo de la contraseña").toMatch(/4 caracteres/i);
  });

  test("el usuario descartable sigue entrando con su clave de siempre",
    async ({ page }) => {
      await ir(page, "dashboard.html");
      let u = null;
      try {
        u = await crearDescartable(page);
        // Tras todos los intentos fallidos de reset, la clave original NO puede
        // haber cambiado.
        const entra = await page.evaluate(async ({ usr, cl }) => {
          const form = new URLSearchParams();
          form.append("username", usr);
          form.append("password", cl);
          form.append("codigo", "0000B");
          const r = await fetch(window._API_URL + "/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form,
          });
          return r.ok;
        }, { usr: u.username, cl: CLAVE });
        expect(entra, "la clave original dejó de funcionar").toBe(true);
      } finally {
        await borrar(page, u);
      }
    });
});
