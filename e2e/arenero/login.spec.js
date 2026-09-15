// @ts-check
// ACCESO. Lo que protege la puerta: que una contraseña equivocada no diga si el
// usuario existe, y que a los 5 intentos la cuenta se cierre —salvo la del
// dueño, que si se bloqueara dejaría al restaurante sin poder entrar a nada.
//
// ⚠ Las pruebas usan usuarios DESCARTABLES creados acá y borrados al terminar.
//   Probar esto contra un empleado de la maqueta lo dejaría bloqueado: cada
//   intento fallido cuenta, y al quinto la cuenta se da de baja.
//
// ⚠ El alta crea además la ficha maestra en `public.empleados`, que está FUERA
//   del arenero. `DELETE /auth/usuarios/{id}` quita la asignación al local y la
//   fila del inquilino, pero la ficha queda sin ningún local (invisible en la
//   aplicación). La barre `deshacer_0000b.py --global`, que sólo toca fichas que
//   ya no pertenecen a ningún restaurante.
const { test, expect, api, apiComo, ir } = require("./_arenero");

const CLAVE = "Prueba-e2e-2026!";
const MAX_INTENTOS = 5;           // app/auth.py
const ERR = "Usuario o contraseña incorrectos";

/** Crea un usuario descartable. `rol` "gerente" es de los NO bloqueables. */
const crearDescartable = async (page, rol = "empleado") => {
  const sufijo = Date.now().toString(36) + Math.floor(Math.random() * 1000);
  const username = `e2e_${sufijo}`;
  const r = await api(page, "POST", "/auth/usuarios", {
    username, password: CLAVE, rol,
    email: `${username}@prueba-e2e.invalid`,   // .invalid no existe: no se le escribe a nadie
    // ⚠ El sufijo va tambien en el APELLIDO: el aviso de bloqueo nombra al
    //   empleado por su nombre para mostrar, no por el usuario, asi que sin esto
    //   la limpieza no lo encuentra y queda un mensaje por corrida.
    nombre: "Prueba", apellido: sufijo,
  });
  expect(r.ok, `no se pudo crear el usuario: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
  const id = r.data.id || (r.data.usuario && r.data.usuario.id);
  expect(id, `el alta no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();
  return { id, username, sufijo };
};

/**
 * Borra el usuario descartable Y el aviso que el bloqueo genera.
 * ⚠ Cuando una cuenta se bloquea, el sistema le MANDA UN MENSAJE a cada quien
 *   pueda desbloquearla ("Fulano bloqueo su usuario..."). Es lo correcto —que se
 *   entere alguien— pero deja un mensaje de prueba en la bandeja del gerente.
 *   Acá se vacia el lado del DESTINATARIO, que es el que se ve.
 *
 * ⚠ El lado del REMITENTE no se puede vaciar: lo manda `sistema`, que está de
 *   baja, y a un usuario inactivo no se lo puede suplantar (get_current_user lo
 *   rechaza). Como una fila sólo se purga cuando los DOS lados la vaciaron, queda
 *   una fila invisible para todos; la barre `deshacer_0000b.py`. No hay forma de
 *   evitarlo por API, y fingir que se limpia seria peor que decirlo.
 */
const borrarDescartable = async (page, u) => {
  if (!u) return;
  await api(page, "DELETE", `/auth/usuarios/${u.id}`);
  const rec = await api(page, "GET", "/mensajes/recibidos");
  for (const m of (rec.data || [])) {
    const texto = `${m.asunto || ""} ${m.cuerpo || ""}`;
    if (!texto.includes(u.sufijo)) continue;
    await api(page, "DELETE", `/mensajes/${m.id}?lado=recibido`);
    await api(page, "DELETE", `/mensajes/${m.id}/definitivo?lado=recibido`);
    await api(page, "DELETE", `/mensajes/${m.id}?lado=enviado`);
    await api(page, "DELETE", `/mensajes/${m.id}/definitivo?lado=enviado`);
  }
};

/**
 * Intenta entrar. No usa la sesión: es el login crudo.
 * ⚠ El login NO es JSON: usa `OAuth2PasswordRequestForm`, o sea
 *   form-urlencoded, y el código del restaurante va en el CUERPO (`codigo`),
 *   no en un header. Mandarlo como JSON devuelve 422 y parece "clave mala".
 */
const entrar = (page, username, password) => page.evaluate(async ({ u, p }) => {
  const form = new URLSearchParams();
  form.append("username", u);
  form.append("password", p);
  form.append("codigo", "0000B");
  const r = await fetch(window._API_URL + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  let data = null;
  try { data = await r.json(); } catch (e) { /* vacío */ }
  return { ok: r.ok, status: r.status, detail: (data && data.detail) || "" };
}, { u: username, p: password });

const estado = async (page, id) => {
  const r = await api(page, "GET", "/auth/usuarios");
  const u = (r.data || []).find((x) => x.id === id);
  return u ? u.activo : null;
};

test.describe("La puerta", () => {
  test("la contraseña correcta entra y la equivocada no", async ({ page }) => {
    await ir(page, "dashboard.html");
    let u = null;
    try {
      u = await crearDescartable(page);
      const bien = await entrar(page, u.username, CLAVE);
      expect(bien.ok, `no pudo entrar con la clave correcta: ${bien.status}`).toBe(true);

      const mal = await entrar(page, u.username, "no-es-la-clave");
      expect(mal.ok).toBe(false);
      expect(mal.status).toBe(401);
    } finally {
      await borrarDescartable(page, u);
    }
  });

  test("no dice si el usuario existe o no", async ({ page }) => {
    await ir(page, "dashboard.html");
    let u = null;
    try {
      u = await crearDescartable(page);
      // ⚠ Los dos mensajes tienen que ser IDÉNTICOS. Si el de "no existe"
      //   difiere del de "clave incorrecta", cualquiera puede averiguar quién
      //   trabaja en el local probando nombres, sin entrar nunca.
      const existe = await entrar(page, u.username, "no-es-la-clave");
      const noExiste = await entrar(page, `no_existe_${Date.now()}`, "no-es-la-clave");

      expect(noExiste.status, "el usuario inexistente da otro código").toBe(existe.status);
      expect(noExiste.detail, "el mensaje delata si el usuario existe").toBe(existe.detail);
      expect(existe.detail).toContain(ERR);
    } finally {
      await borrarDescartable(page, u);
    }
  });
});

test.describe("El bloqueo por intentos", () => {
  test("a los 5 fallos la cuenta se da de baja", async ({ page }) => {
    await ir(page, "dashboard.html");
    let u = null;
    try {
      u = await crearDescartable(page);
      expect(await estado(page, u.id), "nació inactivo").toBe(true);

      for (let i = 1; i <= MAX_INTENTOS; i++) {
        const r = await entrar(page, u.username, `mal-${i}`);
        expect(r.ok, `el intento ${i} entró con una clave equivocada`).toBe(false);
      }

      expect(await estado(page, u.id),
        `tras ${MAX_INTENTOS} fallos la cuenta sigue activa`).toBe(false);

      // Y con la clave BUENA tampoco entra: estar bloqueado es estar bloqueado.
      const conLaBuena = await entrar(page, u.username, CLAVE);
      expect(conLaBuena.ok, "entró con la clave correcta estando bloqueado").toBe(false);
    } finally {
      await borrarDescartable(page, u);
    }
  });

  test("al dueño NO se lo bloquea", async ({ page }) => {
    await ir(page, "dashboard.html");
    // ⚠ Si el gerente se bloqueara, el restaurante se queda sin nadie que pueda
    //   entrar a desbloquear a nadie: un candado sin llave. Por eso `gerente` y
    //   `admin` están fuera del bloqueo (_ROLES_NO_BLOQUEABLES).
    //   Se prueba sobre un gerente DESCARTABLE, nunca sobre el de la maqueta.
    let u = null;
    try {
      u = await crearDescartable(page, "gerente");
      for (let i = 1; i <= MAX_INTENTOS + 2; i++) {
        await entrar(page, u.username, `mal-${i}`);
      }
      expect(await estado(page, u.id),
        "el gerente quedó bloqueado y no debería").toBe(true);
      const bien = await entrar(page, u.username, CLAVE);
      expect(bien.ok, "el gerente no puede entrar con su clave").toBe(true);
    } finally {
      await borrarDescartable(page, u);
    }
  });
});

test.describe("Restablecer la contraseña", () => {
  test("pedir el reset no dice si el correo existe", async ({ page }) => {
    await ir(page, "dashboard.html");
    // Mismo razonamiento que el login: si "ese correo no está" se distingue de
    // "listo, te lo mandamos", se puede averiguar quién trabaja acá.
    const pedir = (email) => page.evaluate(async (e) => {
      const r = await fetch(window._API_URL + "/auth/reset/solicitar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Restaurant-Code": "0000B" },
        body: JSON.stringify({ email: e }),
      });
      let d = null;
      try { d = await r.json(); } catch (x) { /* vacío */ }
      return { status: r.status, cuerpo: JSON.stringify(d || {}) };
    }, email);

    const inexistente = await pedir(`nadie_${Date.now()}@prueba-e2e.invalid`);
    const otro = await pedir(`tampoco_${Date.now()}@prueba-e2e.invalid`);
    expect(inexistente.status).toBe(otro.status);
    expect(inexistente.cuerpo).toBe(otro.cuerpo);
    // Y no puede ser un error: un 404 ya delata que ese correo no está.
    expect(inexistente.status, "el reset delata que el correo no existe").toBeLessThan(400);
  });
});
