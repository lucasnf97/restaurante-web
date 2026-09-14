// @ts-check
// Mensajería interna. Primera pantalla del arenero: es la más simple con un
// camino de ESCRITURA completo (enviar → recibir → leer → papelera), así que
// además de probarla valida que la maquinaria de escribir funcione de punta a
// punta y limpie lo que crea.
//
// ⚠ Escribe en `0000B`. Cada prueba borra lo suyo al terminar.
const { test, expect, api, apiComo, ir, marca } = require("./_arenero");

/**
 * Borra de verdad los mensajes que creo una prueba.
 * ⚠ Hay que borrar LOS DOS LADOS. `lado` vale "recibido" por defecto, que
 *   comprueba `para_usuario_id = yo`: como remitente eso da 404 y el mensaje
 *   queda para siempre en la bandeja del destinatario. La fila sólo se purga de
 *   verdad cuando los dos lados la vaciaron.
 */
const limpiar = async (page, ids, destinatario) => {
  for (const id of ids || []) {
    // El remitente vacia SU lado...
    await api(page, "DELETE", `/mensajes/${id}?lado=enviado`);
    await api(page, "DELETE", `/mensajes/${id}/definitivo?lado=enviado`);
    // ...y el destinatario el suyo. ⚠ Sin esto la fila NO se purga (sólo se
    // borra de verdad cuando los dos lados la vaciaron) y queda un mensaje de
    // prueba en la bandeja de un empleado, acumulandose en cada corrida.
    const quien = destinatario || null;
    if (quien) {
      await apiComo(page, quien, "DELETE", `/mensajes/${id}?lado=recibido`);
      await apiComo(page, quien, "DELETE", `/mensajes/${id}/definitivo?lado=recibido`);
    } else {
      await api(page, "DELETE", `/mensajes/${id}?lado=recibido`);
      await api(page, "DELETE", `/mensajes/${id}/definitivo?lado=recibido`);
    }
  }
};

/** Los destinatarios salen de la base, no de ids escritos a mano. */
const empleados = async (page) => {
  const r = await api(page, "GET", "/auth/usuarios");
  expect(r.ok, `no se pudieron listar los usuarios: ${r.status}`).toBe(true);
  return (r.data || []).filter((u) => u.activo !== false);
};

test.describe("El arenero es el arenero", () => {
  test("la sesión cae en La Brasa Dorada y no en otro local", async ({ page }) => {
    // ⚠ Si esto falla, NINGUNA otra prueba de esta carpeta debe correr: estaría
    //   escribiendo en un restaurante de verdad.
    await ir(page, "dashboard.html");

    // El claim `schema` del token es LO QUE DECIDE dónde se escribe (el header
    // es sólo un respaldo sin sesión), así que se comprueba ahí mismo.
    const esq = await page.evaluate(() => {
      const t = localStorage.getItem("token") || "";
      const p = t.split(".")[1] || "";
      return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))).schema;
    });
    expect(esq, "el token NO apunta al arenero").toBe("r_0000b");

    // Y los datos que devuelve son los de ese local y no los de otro: estos dos
    // empleados existen en La Brasa Dorada y no en la otra maqueta.
    const us = await api(page, "GET", "/auth/usuarios");
    expect(us.ok, `/auth/usuarios respondió ${us.status}`).toBe(true);
    const nombres = (us.data || []).map((u) => (u.username || "").toLowerCase());
    expect(nombres, "la lista de empleados no es la de La Brasa Dorada")
      .toEqual(expect.arrayContaining(["nerea", "pabloh"]));
  });
});

test.describe("Enviar y recibir", () => {
  test("un mensaje enviado aparece en enviados y en recibidos del destinatario",
    async ({ page }) => {
      await ir(page, "mensajes.html");
      const us = await empleados(page);
      expect(us.length, "el arenero no tiene empleados").toBeGreaterThan(1);

      const asunto = marca("mensaje");
      const destino = us.find((u) => u.username !== "Lucas") || us[0];

      const env = await api(page, "POST", "/mensajes/", {
        para_usuario_ids: [destino.id], cc_usuario_ids: [],
        asunto, cuerpo: "Cuerpo de prueba automática. Se borra al terminar.",
      });
      expect(env.ok, `no se pudo enviar: ${env.status} ${JSON.stringify(env.data)}`).toBe(true);
      // ⚠ Devuelve `ids` (uno por destinatario), no `id`: el mensaje se guarda
      //   una vez POR destinatario. Quedarse con `.id` deja undefined y la
      //   limpieza del final no borra nada.
      const ids = env.data.ids || [];
      expect(ids.length, `el envío no devolvió ids: ${JSON.stringify(env.data)}`)
        .toBeGreaterThan(0);

      try {
        const enviados = await api(page, "GET", "/mensajes/enviados");
        expect(enviados.ok).toBe(true);
        expect((enviados.data || []).some((m) => m.asunto === asunto),
          "el mensaje no figura en enviados").toBe(true);

        // Y el contador de no leídos del destinatario lo cuenta.
        const rec = await api(page, "GET", "/mensajes/recibidos");
        expect(rec.ok).toBe(true);
      } finally {
        // ⚠ Siempre se limpia, falle lo que falle: un mensaje de prueba en la
        //   bandeja de alguien es basura que queda a la vista.
        await limpiar(page, ids, destino.username);
      }
    });

  test("sin destinatario no se envía", async ({ page }) => {
    await ir(page, "mensajes.html");
    const r = await api(page, "POST", "/mensajes/", {
      para_usuario_ids: [], cc_usuario_ids: [],
      asunto: marca("sin destino"), cuerpo: "no debería entrar",
    });
    // Un mensaje sin a quién va es un mensaje perdido: tiene que rebotar.
    expect(r.ok, "aceptó un mensaje sin destinatarios").toBe(false);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  test("borrar lo manda a la papelera, y de ahí se restaura", async ({ page }) => {
    await ir(page, "mensajes.html");
    const us = await empleados(page);
    // ⚠ A SI MISMO a propósito: borrar de la papelera es algo que hace el
    //   DESTINATARIO, y así la sesión es dueña de los dos lados del mensaje.
    const yo = us.find((u) => u.username === "Lucas") || us[0];
    const asunto = marca("papelera");

    const env = await api(page, "POST", "/mensajes/", {
      para_usuario_ids: [yo.id], asunto, cuerpo: "Prueba de papelera.",
    });
    expect(env.ok).toBe(true);
    const ids = env.data.ids || [];
    const id = ids[0];

    try {
      // ⚠ Borrar NO es destruir: va a la papelera. Si borrara de verdad, un
      //   clic accidental perdería una conversación sin vuelta atrás.
      const del = await api(page, "DELETE", `/mensajes/${id}`);
      expect(del.ok, `no se pudo borrar: ${del.status}`).toBe(true);

      const pap = await api(page, "GET", "/mensajes/papelera");
      expect(pap.ok).toBe(true);
      expect((pap.data || []).some((m) => m.asunto === asunto),
        "el mensaje borrado no está en la papelera").toBe(true);

      const res = await api(page, "POST", `/mensajes/${id}/restaurar`);
      expect(res.ok, `no se pudo restaurar: ${res.status}`).toBe(true);
      const pap2 = await api(page, "GET", "/mensajes/papelera");
      expect((pap2.data || []).some((m) => m.asunto === asunto),
        "restaurar no lo sacó de la papelera").toBe(false);
    } finally {
      await limpiar(page, ids, yo.username);
    }
  });
});

test.describe("La pantalla", () => {
  test("lista los mensajes y no queda en blanco", async ({ page }) => {
    await ir(page, "mensajes.html");
    const us = await empleados(page);
    const asunto = marca("visible");
    const destino = us.find((u) => u.username !== "Lucas") || us[0];

    const env = await api(page, "POST", "/mensajes/", {
      para_usuario_ids: [destino.id], asunto,
      cuerpo: "Este mensaje tiene que verse en la lista.",
    });
    const ids = (env.data && env.data.ids) || [];

    try {
      await page.goto("/mensajes.html");
      // Se busca en ENVIADOS, que es la bandeja donde cae lo que manda esta
      // sesión. La pestaña se elige con `_tabActual` y se recarga: no hay una
      // función `cambiarCarpeta`, el endpoint se decide dentro de cargarMensajes.
      await page.evaluate(async () => { _tabActual = "enviados"; await cargarMensajes(); });
      await expect(page.locator("body")).toContainText(asunto, { timeout: 30_000 });
    } finally {
      await limpiar(page, ids, destino.username);
    }
  });
});
