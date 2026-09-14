// @ts-check
// Reservas. La grilla es lo que mira el encargado para decir "sí, a las 21 hay
// mesa". Lo que se prueba es que no deje poner una reserva donde no se puede
// —fuera del horario del local o encima de un bloqueo— y que las horas caigan
// en la columna que les toca, incluida la madrugada.
//
// ⚠ SOLO LECTURA. No se crea, mueve ni cancela una reserva, y no se toca la
//   lista de espera. Una reserva de prueba ocupa una mesa de verdad.
const { test, expect } = require("./sesion");

/**
 * ⚠ Se espera a que `horarios` esté cargado, no a que exista: arranca como `[]`
 *   y esa espera se cumpliría antes de que la pantalla pida nada.
 */
const irAReservas = async (page) => {
  await page.goto("/reservas.html");
  await expect.poll(() => page.evaluate(() =>
    (typeof horarios !== "undefined" && horarios) ? horarios.length : 0),
    { timeout: 40_000 }).toBeGreaterThan(0);
};

test.describe("Dónde se puede poner una reserva", () => {
  test("fuera del horario del local, no", async ({ page }) => {
    await irAReservas(page);

    const r = await page.evaluate(() => {
      const gH = horarios, gB = bloqueos, gF = fechaActual;
      // Un jueves, con el local abierto de 13:00 a 16:00 y de 20:00 a 00:30.
      fechaActual = new Date(2026, 8, 17);           // jueves 17/9/2026
      const dia = (fechaActual.getDay() + 6) % 7;
      horarios = [{ dia_semana: dia, activo: true,
                    franjas: [{ inicio: "13:00", fin: "16:00" },
                              { inicio: "20:00", fin: "00:30" }] }];
      bloqueos = [];
      // ⚠ Minutos desde MEDIANOCHE: es la base que usan los llamadores reales
      //   (`HORA_INICIO*60 + columna*SLOT_MIN`), no la de la grilla.
      const m = (h, mi) => h * 60 + (mi || 0);
      const out = {
        dentroMediodia: _posicionValida(m(13, 30), 60, [1]),
        justoAlAbrir:   _posicionValida(m(13, 0), 60, [1]),
        seVaDeLargo:    _posicionValida(m(15, 30), 60, [1]),   // terminaría 16:30
        enElHueco:      _posicionValida(m(17, 0), 60, [1]),    // cerrado
        dentroNoche:    _posicionValida(m(21, 0), 90, [1]),
        // ⚠ El turno de noche cierra a las 00:30 del día siguiente: una reserva
        //   de 23:45 a 00:15 está DENTRO. Sin sumar 24 h al fin de la franja,
        //   el local "cerraría" a medianoche y se rechazarían reservas válidas.
        cruzaMedianoche: _posicionValida(m(23, 45), 30, [1]),
        pasadoElCierre:  _posicionValida(24 * 60 + 15, 60, [1]),   // 00:15, ya cerrado
      };
      horarios = gH; bloqueos = gB; fechaActual = gF;
      return out;
    });

    expect(r.dentroMediodia).toBe(true);
    expect(r.justoAlAbrir, "a la hora exacta de apertura se puede").toBe(true);
    expect(r.seVaDeLargo, "no puede terminar después del cierre").toBe(false);
    expect(r.enElHueco, "entre los dos turnos está cerrado").toBe(false);
    expect(r.dentroNoche).toBe(true);
    expect(r.cruzaMedianoche, "23:45 → 00:15 entra en un turno que cierra 00:30").toBe(true);
    expect(r.pasadoElCierre).toBe(false);
  });

  test("con el día cerrado, en ningún horario", async ({ page }) => {
    await irAReservas(page);
    const ok = await page.evaluate(() => {
      const gH = horarios, gB = bloqueos, gF = fechaActual;
      fechaActual = new Date(2026, 8, 17);
      horarios = [{ dia_semana: (fechaActual.getDay() + 6) % 7, activo: false, franjas: [] }];
      bloqueos = [];
      const v = _posicionValida(14 * 60, 60, [1]);
      horarios = gH; bloqueos = gB; fechaActual = gF;
      return v;
    });
    expect(ok).toBe(false);
  });

  test("encima de un bloqueo, no", async ({ page }) => {
    await irAReservas(page);

    const r = await page.evaluate(() => {
      const gH = horarios, gB = bloqueos, gF = fechaActual;
      fechaActual = new Date(2026, 8, 17);
      horarios = [{ dia_semana: (fechaActual.getDay() + 6) % 7, activo: true, franjas: [] }];
      const iso = fechaISO(fechaActual);
      // Bloqueo de 15:00 a 17:00 sobre la mesa 1.
      bloqueos = [{ fecha: iso, hora_inicio: "15:00", hora_fin: "17:00", mesas_ids: [1] }];
      // ⚠ Minutos desde MEDIANOCHE: es la base que usan los llamadores reales
      //   (`HORA_INICIO*60 + columna*SLOT_MIN`), no la de la grilla.
      const m = (h, mi) => h * 60 + (mi || 0);
      const out = {
        antes:    _posicionValida(m(13, 0), 60, [1]),   // 13-14, libre
        pegado:   _posicionValida(m(14, 0), 60, [1]),   // 14-15, toca el borde
        encima:   _posicionValida(m(15, 30), 60, [1]),
        pisaElFin: _posicionValida(m(16, 30), 60, [1]),
        despues:  _posicionValida(m(17, 0), 60, [1]),   // 17-18, libre
        otraMesa: _posicionValida(m(15, 30), 60, [2]),  // el bloqueo no la alcanza
      };
      horarios = gH; bloqueos = gB; fechaActual = gF;
      return out;
    });

    expect(r.antes).toBe(true);
    expect(r.pegado, "terminar justo cuando empieza el bloqueo se permite").toBe(true);
    expect(r.encima).toBe(false);
    expect(r.pisaElFin, "solaparse con el final del bloqueo tampoco").toBe(false);
    expect(r.despues).toBe(true);
    expect(r.otraMesa, "un bloqueo de la mesa 1 no afecta a la 2").toBe(true);
  });

  test("un bloqueo sin horas tapa el día entero", async ({ page }) => {
    await irAReservas(page);
    const r = await page.evaluate(() => {
      const gH = horarios, gB = bloqueos, gF = fechaActual;
      fechaActual = new Date(2026, 8, 17);
      horarios = [{ dia_semana: (fechaActual.getDay() + 6) % 7, activo: true, franjas: [] }];
      bloqueos = [{ fecha: fechaISO(fechaActual), hora_inicio: null, hora_fin: null,
                    mesas_ids: [1] }];
      const m = (h) => h * 60;
      const out = [_posicionValida(m(13), 60, [1]), _posicionValida(m(22), 60, [1])];
      horarios = gH; bloqueos = gB; fechaActual = gF;
      return out;
    });
    expect(r).toEqual([false, false]);
  });
});

test.describe("La hora cae en su columna", () => {
  test("la madrugada va al final del día, no al principio", async ({ page }) => {
    await irAReservas(page);

    // ⚠ La grilla arranca a HORA_INICIO (no a medianoche). Una reserva de la
    //   01:00 pertenece al FINAL de la noche: sin sumarle 24 h se dibujaría a la
    //   izquierda de todo, antes de la apertura.
    const r = await page.evaluate(() => ({
      inicio:    minsDesdeInicio("" + String(HORA_INICIO).padStart(2, "0") + ":00"),
      unaHora:   minsDesdeInicio("" + String(HORA_INICIO + 1).padStart(2, "0") + ":00"),
      madrugada: minsDesdeInicio("01:00"),
      conSegundos: minsDesdeInicio("21:30:00"),
      normal:    minsDesdeInicio("21:30"),
      hi:        HORA_INICIO,
    }));

    expect(r.inicio, "la hora de apertura es el minuto 0 de la grilla").toBe(0);
    expect(r.unaHora).toBe(60);
    expect(r.madrugada, "la 01:00 va después de la apertura, no antes")
      .toBe((1 - r.hi) * 60 + 24 * 60);
    expect(r.madrugada).toBeGreaterThan(0);
    expect(r.conSegundos, "el formato con segundos se lee igual").toBe(r.normal);
  });
});

test.describe("La pantalla carga", () => {
  test("dibuja la grilla y no se queda en blanco", async ({ page }) => {
    await irAReservas(page);
    const r = await page.evaluate(() => ({
      mesas: (typeof mesas !== "undefined" && mesas) ? mesas.length : 0,
      ancho: document.getElementById("grid-canvas").width,
      alto: document.getElementById("grid-canvas").height,
    }));
    expect(r.mesas, "no se cargó ninguna mesa").toBeGreaterThan(0);
    expect(r.ancho, "el lienzo quedó sin ancho").toBeGreaterThan(0);
    expect(r.alto).toBeGreaterThan(0);
  });
});
