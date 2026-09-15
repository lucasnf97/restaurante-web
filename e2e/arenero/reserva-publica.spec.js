// @ts-check
// LA PÁGINA PÚBLICA DE RESERVAS. Es la única pantalla que ve un cliente que no
// trabaja acá, y la única puerta abierta sin sesión: lo que falle se ve desde
// afuera. Lo que se prueba son los CONTROLES —que no se pueda reservar para
// ayer, ni para dentro de un año, ni una mesa de 40 personas— y que la
// cancelación por enlace funcione, porque si no el cliente no tiene cómo avisar.
//
// ⚠ Cada reserva creada se cancela Y se borra al terminar: una reserva de prueba
//   ocupa una mesa de verdad en la grilla del salón.
//
// ⚠ RESIDUO CONOCIDO: reservar da de alta al CLIENTE, y los clientes no se
//   pueden borrar por API (son permanentes por diseño: guardan el historial).
//   Queda 1 cliente + 1 contacto por contacto distinto usado. Como todas las
//   pruebas usan el mismo teléfono y hay dedup por contacto, NO se acumula: es
//   siempre el mismo. Lo barre `deshacer_0000b.py`.
//
// ⚠ Excepción consciente a "sólo INSERT": los topes online viven en
//   `sistema_config`, que es una fila de la maqueta. Para probarlos hay que
//   fijarlos. Se leen ANTES, se restauran en un `finally`, y hoy están todos en
//   null, así que la restauración es exacta. Sin esto, los topes —que son el
//   grueso de la función— quedarían sin probar.
const { test, expect, api, ir, marca } = require("./_arenero");

const CODIGO = "0000B";

/** Llamada SIN sesión, como la haría el navegador de un cliente. */
const publico = (page, metodo, ep, cuerpo) => page.evaluate(async ({ m, e, b, c }) => {
  const r = await fetch(window._API_URL + e, {
    method: m,
    headers: { "Content-Type": "application/json", "X-Restaurant-Code": c },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  let data = null;
  try { data = await r.json(); } catch (x) { /* vacío */ }
  return { ok: r.ok, status: r.status, data, detail: (data && data.detail) || "" };
}, { m: metodo, e: ep, b: cuerpo, c: CODIGO });

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-` +
                   `${String(d.getDate()).padStart(2, "0")}`;
const enDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

/**
 * Reserva base válida. `extra` pisa lo que haga falta.
 * ⚠ Los campos son `hora_inicio` y `comensales` —no `hora`/`personas`—, y el
 *   alta devuelve un `cancelar_url` con el token adentro, no un `token` suelto.
 */
const solicitud = (extra = {}) => ({
  // ⚠ El teléfono es FIJO a propósito: los clientes se deduplican por contacto,
  //   asi que todas las reservas de prueba caen en UN solo cliente en vez de
  //   dejar uno por corrida. Tiene que ser distinto del que usan las otras
  //   pruebas, o se pisan entre ellas.
  nombre: marca("cliente"), telefono: "+45 90 00 00 01",
  fecha: enDias(3), hora_inicio: "20:00", comensales: 2, website: "", ...extra,
});

/** El token de gestión viene dentro del enlace que se le manda al cliente. */
const tokenDe = (r) => {
  const url = r && r.data && r.data.cancelar_url;
  const m = /[?&]c=([^&]+)/.exec(url || "");
  return m ? m[1] : null;
};

/**
 * POST a /publico/reservas respetando el FRENO DE COSTO.
 *
 * ⚠ Ese endpoint tiene tope propio: 8 por minuto por IP (app/ratelimit.py). No
 *   es anti-bot genérico sino freno de COSTO —cada reserva dispara un correo por
 *   Brevo—, asi que es correcto y no hay que evitarlo: hay que respetarlo. Si
 *   salta, se espera a que la ventana corra y se reintenta UNA vez; si no, las
 *   pruebas de mas abajo fallarian por el tope y no por lo que prueban.
 */
const reservar = async (page, cuerpo) => {
  let r = await publico(page, "POST", "/publico/reservas", cuerpo);
  if (r.status === 429) {
    await page.waitForTimeout(62_000);          // la ventana es de 60 s
    r = await publico(page, "POST", "/publico/reservas", cuerpo);
  }
  return r;
};

/**
 * Deja el arenero como estaba: cancela por el enlace del cliente y despues BORRA
 * la fila como lo hace el staff.
 * ⚠ Cancelar NO borra —y esta bien: una cancelacion es un cambio de estado y el
 *   restaurante quiere el registro—, pero una reserva de prueba por corrida se
 *   acumula. Como es dato PROPIO de la prueba, se borra entera.
 */
const cancelar = async (page, r) => {
  const tok = tokenDe(r);
  if (tok) await publico(page, "POST", `/publico/reservas/gestion/${tok}/cancelar`);
  const id = r && r.data && r.data.id;
  if (id) await api(page, "DELETE", `/reservas/${id}`);
};

test.describe("Reservar desde la calle", () => {
  // Una espera por el freno de costo (62 s) no entra en el tiempo por defecto.
  test.setTimeout(240_000);

  test("una reserva válida entra y se puede cancelar con su enlace",
    async ({ page }) => {
      await ir(page, "dashboard.html");   // sólo para tener window._API_URL
      let r = null;
      try {
        r = await reservar(page, solicitud());
        expect(r.ok, `no entró: ${r.status} ${r.detail}`).toBe(true);

        const tok = tokenDe(r);
        expect(tok, `el alta no devolvió enlace de cancelación: ${JSON.stringify(r.data)}`)
          .toBeTruthy();

        // El cliente entra por su enlace y ve su reserva.
        const ver = await publico(page, "GET", `/publico/reservas/gestion/${tok}`);
        expect(ver.ok, `el enlace de gestión no abre: ${ver.status}`).toBe(true);

        const can = await publico(page, "POST", `/publico/reservas/gestion/${tok}/cancelar`);
        expect(can.ok, `no se pudo cancelar: ${can.status} ${can.detail}`).toBe(true);

        // Cancelada es cancelada: el enlace ya no sirve para volver a cancelar.
        const otra = await publico(page, "GET", `/publico/reservas/gestion/${tok}`);
        expect(otra.ok).toBe(true);
        expect(JSON.stringify(otra.data)).toMatch(/cancel/i);
      } finally {
        await cancelar(page, r);
      }
    });

  test("faltando el nombre o el contacto, no entra", async ({ page }) => {
    await ir(page, "dashboard.html");
    const sinNombre = await reservar(page, solicitud({ nombre: "  " }));
    expect(sinNombre.ok, "aceptó una reserva sin nombre").toBe(false);

    const sinContacto = await reservar(page, solicitud({ telefono: "", email: "" }));
    // Sin teléfono ni correo no hay forma de avisarle al cliente de nada.
    expect(sinContacto.ok, "aceptó una reserva sin forma de contacto").toBe(false);
  });

  test("para ayer, no", async ({ page }) => {
    await ir(page, "dashboard.html");
    const r = await reservar(page, solicitud({ fecha: enDias(-1) }));
    expect(r.ok, "aceptó una reserva para una fecha pasada").toBe(false);
    expect(r.detail).toMatch(/pas/i);
  });

  test("el honeypot corta a los robots", async ({ page }) => {
    await ir(page, "dashboard.html");
    // ⚠ `website` es un campo OCULTO: una persona nunca lo llena, un robot que
    //   completa todo el formulario sí. Es el único anti-abuso del alta (por
    //   decisión del dueño no hay tope por IP: una oficina o un hotel reservan
    //   varias mesas desde la misma red).
    const r = await reservar(page, solicitud({ website: "http://spam.example" }));
    expect(r.ok, "el honeypot no frenó nada").toBe(false);
  });
});

test.describe("Los topes online", () => {
  // ⚠ @lento: son 4 reservas mas, y el presupuesto del freno es 8 por minuto.
  //   Junto con las de arriba se pasa y hay que esperar la ventana. Las pruebas
  //   BASICAS de esta pagina (validaciones, honeypot, fecha pasada) suman 5
  //   reservas y si entran en el presupuesto: esas quedan en la corrida diaria.
  test.setTimeout(240_000);

  // ⚠ Se fijan y se restauran. Ver la nota de arriba.

  const leerTopes = async (page) => {
    const r = await api(page, "GET", "/config/reservas-online");
    expect(r.ok, `no se pudo leer la config online: ${r.status}`).toBe(true);
    return r.data;
  };
  const fijarTopes = async (page, vals) => {
    const r = await api(page, "PUT", "/config/reservas-online", vals);
    expect(r.ok, `no se pudieron fijar los topes: ${r.status} ${JSON.stringify(r.data)}`)
      .toBe(true);
  };

  test("respeta el tope de personas, el horizonte y la anticipación @lento",
    async ({ page }) => {
      await ir(page, "dashboard.html");
      const antes = await leerTopes(page);
      try {
        await fijarTopes(page, {
          max_personas: 6, horizonte_dias: 30, anticipacion_horas: 24,
          contacto_telefono: antes.contacto_telefono,
          contacto_email: antes.contacto_email,
          contacto_redes: antes.contacto_redes,
        });

        // Demasiada gente: una mesa de 20 por la web se acepta y después no hay
        // dónde sentarla.
        const muchos = await reservar(page, solicitud({ comensales: 20 }));
        expect(muchos.ok, "aceptó 20 personas con el tope en 6").toBe(false);

        // Demasiado lejos: más allá del horizonte la agenda ni existe.
        const lejos = await reservar(page, solicitud({ fecha: enDias(90) }));
        expect(lejos.ok, "aceptó una reserva a 90 días con el horizonte en 30").toBe(false);
        expect(lejos.detail).toMatch(/anticipaci|d[ií]as/i);

        // Demasiado pronto: con 24 h de anticipación, para hoy no se toma.
        const pronto = await reservar(page, solicitud({ fecha: enDias(0) }));
        expect(pronto.ok, "aceptó una reserva para hoy con 24 h de anticipación")
          .toBe(false);

        // Y una que cumple los tres sí entra.
        let ok = null;
        try {
          ok = await reservar(page, solicitud({ comensales: 4, fecha: enDias(5) }));
          expect(ok.ok, `una reserva que cumple los topes fue rechazada: ${ok.detail}`)
            .toBe(true);
        } finally {
          await cancelar(page, ok);
        }
      } finally {
        // ⚠ Restaurar SIEMPRE, falle lo que falle: si esto no corre, el local
        //   queda con topes que nadie puso.
        await fijarTopes(page, {
          max_personas: antes.max_personas,
          horizonte_dias: antes.horizonte_dias,
          anticipacion_horas: antes.anticipacion_horas,
          contacto_telefono: antes.contacto_telefono,
          contacto_email: antes.contacto_email,
          contacto_redes: antes.contacto_redes,
        });
        const post = await leerTopes(page);
        expect(post.max_personas, "los topes no volvieron a como estaban")
          .toBe(antes.max_personas);
        expect(post.horizonte_dias).toBe(antes.horizonte_dias);
        expect(post.anticipacion_horas).toBe(antes.anticipacion_horas);
      }
    });
});

test.describe("El freno de costo", () => {
  // ⚠ Marcada @lento: espera la ventana de 60 s dos veces. `npm test` la saltea
  //   para que la corrida de todos los dias siga siendo de minutos y no de
  //   cuartos de hora; entra en `npm run test:todo` y en `npm run test:lento`.
  //   Una suite que tarda 11 minutos se deja de correr, y una prueba que no se
  //   corre no protege nada.
  test.setTimeout(240_000);

  test("a las 8 reservas por minuto corta @lento", async ({ page }) => {
    await ir(page, "dashboard.html");
    // ⚠ No es anti-bot genérico: CADA reserva dispara un correo por Brevo, asi
    //   que sin tope alguien usa el formulario del local como relay de spam y le
    //   quema la cuota de correo. Se comprueba que el freno exista de verdad.
    //   Las que entren se cancelan.
    const creadas = [];
    let corto = false;
    try {
      for (let i = 0; i < 12; i++) {
        const r = await publico(page, "POST", "/publico/reservas",
          solicitud({ fecha: enDias(6), hora_inicio: "13:00" }));
        if (r.status === 429) { corto = true; break; }
        if (r.ok) creadas.push(r);
      }
      expect(corto, "se pudieron mandar 12 reservas seguidas sin freno").toBe(true);
    } finally {
      for (const r of creadas) await cancelar(page, r);
    }
    // Y tras esperar la ventana, vuelve a atender: el freno no deja al local sin
    // reservas online, solo lo protege del chorro.
    await page.waitForTimeout(62_000);
    let ok = null;
    try {
      ok = await publico(page, "POST", "/publico/reservas", solicitud({ fecha: enDias(7) }));
      expect(ok.status, "tras la ventana sigue frenando").not.toBe(429);
    } finally {
      await cancelar(page, ok);
    }
  });
});

test.describe("Lo que la página pública muestra", () => {
  test("el local se presenta sin pedir sesión", async ({ page }) => {
    await ir(page, "dashboard.html");
    const r = await publico(page, "GET", "/publico/info");
    expect(r.ok, `/publico/info no responde: ${r.status}`).toBe(true);
    expect(String(r.data.restaurante || ""), "no devuelve el nombre del local")
      .toMatch(/Brasa Dorada/i);
    // El widget necesita los horarios de atención del local para no ofrecer una
    // hora en la que está cerrado.
    expect(Array.isArray(r.data.horarios), "no devuelve los horarios del local").toBe(true);
  });

  test("la disponibilidad de un día devuelve horarios", async ({ page }) => {
    await ir(page, "dashboard.html");
    const r = await publico(page, "GET",
      `/publico/disponibilidad?fecha=${enDias(3)}&personas=2`);
    expect(r.ok, `sin disponibilidad: ${r.status}`).toBe(true);
    expect(Array.isArray(r.data.horarios), "no devuelve una lista de horarios").toBe(true);
  });
});
