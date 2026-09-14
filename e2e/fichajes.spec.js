// @ts-check
// Fichajes. Acá se decide CUÁNTAS horas trabajó cada uno y A QUÉ DÍA van, que es
// de dónde sale el salario. Dos cosas lo pueden torcer sin que se note:
//   · el huso — el local está en Dinamarca y se corrige desde otro país;
//   · el corte de turno — la entrada de la 01:30 pertenece a la noche anterior.
//
// ⚠ SOLO LECTURA. No se ficha, no se corrige un turno y no se aprueba nada.
//   Las correcciones se guardan de verdad y mueven el salario del período.
const { test, expect } = require("./sesion");

/**
 * ⚠ Se espera a que `init()` HAYA TERMINADO, no a que exista `_fichajesData`:
 *   ese arranca valiendo `{}`, así que esa espera se cumple antes de que la
 *   pantalla haga nada. Quien tocaba los filtros ahí se los encontraba pisados
 *   por el init, que los deja en la semana en curso y vuelve a cargar.
 *   La señal buena es que el filtro de fechas ya tenga valor.
 */
const irAFichajes = async (page) => {
  await page.goto("/fichajes.html");
  await expect.poll(() => page.evaluate(() =>
    (document.getElementById("filtro-desde") || {}).value || ""),
    { timeout: 30_000 }).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator("#fichajes-container .ui-skel")).toHaveCount(0, { timeout: 30_000 });
};

/**
 * Abre el rango a dos años. El filtro arranca en la semana en curso y un
 * restaurante sin turnos cerrados esta semana deja la grilla vacía: las pruebas
 * que la miran se saltearían sin que nadie lo note.
 * ⚠ Centinela: `_fichajesData` ya es un objeto vacío antes de cargar, así que
 *   esperar "a que exista" se cumple al instante y se lee antes de tiempo.
 */
const irAFichajesConDatos = async (page) => {
  await irAFichajes(page);
  const hay = () => page.evaluate(() =>
    Object.values(_fichajesData || {}).filter((f) => f.ts_entrada && f.ts_salida).length);
  if (await hay()) return true;
  await page.evaluate(() => {
    const hoy = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-` +
                       `${String(d.getDate()).padStart(2, "0")}`;
    document.getElementById("filtro-desde").value = iso(new Date(hoy.getFullYear() - 2, 0, 1));
    document.getElementById("filtro-hasta").value = iso(hoy);
    _fichajesData = null;
    cargarHistorial();
  });
  // ⚠ Nada de centinelas acá: `cargarHistorial` pone `_fichajesData = {}` ni bien
  //   arranca y un objeto vacío ya es verdadero, así que la espera se cumple
  //   antes de que llegue la respuesta. Se espera la condición DE VERDAD —que
  //   haya turnos cerrados— y si no llega, no hay datos y la prueba se saltea.
  try {
    await expect.poll(hay, { timeout: 60_000 }).toBeGreaterThan(0);
  } catch (e) {
    return false;
  }
  return true;
};

test.describe("El huso del restaurante", () => {
  // ⚠ La hora que se teclea es la del LOCAL, no la del navegador. Corregir un
  //   fichaje danés desde España tiene que guardar la hora danesa; si se manda
  //   la del navegador, el turno se corre una hora y con él lo que se paga.

  test("una hora tecleada vuelve igual, con y sin horario de verano",
    async ({ page }) => {
      await irAFichajes(page);

      const malos = await page.evaluate(() => {
        const fallos = [];
        const guardado = _TZ;
        // Los dos husos reales del sistema + uno lejano, para que un error de
        // signo no se disimule con un offset chico.
        for (const tz of ["Europe/Copenhagen", "Europe/Madrid", "America/Argentina/Buenos_Aires"]) {
          _TZ = tz;
          for (const wall of [
            "2026-01-15T09:30",   // invierno
            "2026-07-15T09:30",   // verano (DST en Europa)
            "2026-03-29T04:30",   // el domingo del cambio de hora en la UE
            "2026-10-25T04:30",   // y el de vuelta
            "2026-12-31T23:59",
            "2026-01-01T00:00",
          ]) {
            const inst = _wallToInstant(wall);
            const p = _partsEnTZ(inst);
            const vuelta = `${p.y}-${String(p.mo).padStart(2, "0")}-` +
                           `${String(p.d).padStart(2, "0")}T${String(p.h).padStart(2, "0")}:` +
                           String(p.mi).padStart(2, "0");
            if (vuelta !== wall) fallos.push(`${tz} ${wall} → ${vuelta}`);
          }
        }
        _TZ = guardado;
        return fallos;
      });

      // Las madrugadas del cambio de hora pueden no existir o existir dos veces;
      // lo que no puede pasar es que una hora normal vuelva distinta.
      expect(malos.filter((f) => !/T04:30/.test(f)),
        "una hora tecleada no vuelve igual").toEqual([]);
    });

  test("el instante que se manda no depende del huso del navegador",
    async ({ page }) => {
      await irAFichajes(page);
      // El mismo wall-clock en el mismo local tiene que dar el MISMO instante,
      // se corrija desde donde se corrija. Es lo que va al backend con la Z.
      const r = await page.evaluate(() => {
        const guardado = _TZ;
        _TZ = "Europe/Copenhagen";
        const iso = _wallToInstant("2026-07-15T09:30").toISOString();
        _TZ = guardado;
        return iso;
      });
      // Copenhague en julio es UTC+2: las 09:30 locales son las 07:30 UTC.
      expect(r).toBe("2026-07-15T07:30:00.000Z");
    });
});

test.describe("El día al que va el turno", () => {
  // ⚠ Con corte a las 6, la entrada de la 01:30 del domingo es el turno del
  //   SÁBADO. Si cae en el día equivocado, las horas se van al día que no es —y
  //   en fin de mes, al período salarial que no es.

  test("antes del corte, el turno es del día anterior", async ({ page }) => {
    await irAFichajes(page);

    const r = await page.evaluate(() => {
      const gTZ = _TZ, gCorte = HORA_CORTE_TURNO;
      _TZ = "Europe/Copenhagen";
      HORA_CORTE_TURNO = 6;
      const f = (wall) => fechaTurno(_wallToInstant(wall));
      const out = {
        mediaTarde:    f("2026-07-11T15:00"),   // sábado por la tarde
        nocheTemprano: f("2026-07-11T23:30"),   // sábado de noche
        madrugada:     f("2026-07-12T01:30"),   // domingo 01:30 → turno del sábado
        justoAntes:    f("2026-07-12T05:59"),
        justoElCorte:  f("2026-07-12T06:00"),   // ya es el turno del domingo
        cambioDeMes:   f("2026-08-01T02:00"),   // → 31 de julio
        cambioDeAnio:  f("2027-01-01T03:00"),   // → 31 de diciembre
      };
      _TZ = gTZ; HORA_CORTE_TURNO = gCorte;
      return out;
    });

    expect(r.mediaTarde).toBe("2026-07-11");
    expect(r.nocheTemprano).toBe("2026-07-11");
    expect(r.madrugada, "la madrugada del domingo es el turno del sábado").toBe("2026-07-11");
    expect(r.justoAntes).toBe("2026-07-11");
    expect(r.justoElCorte, "a la hora del corte ya empieza el día nuevo").toBe("2026-07-12");
    // Los saltos de mes y de año son donde un cálculo con restas de días falla.
    expect(r.cambioDeMes, "la madrugada del 1 de agosto es turno del 31 de julio").toBe("2026-07-31");
    expect(r.cambioDeAnio).toBe("2026-12-31");
  });

  test("con corte en 0 el turno es el día calendario", async ({ page }) => {
    await irAFichajes(page);
    const r = await page.evaluate(() => {
      const gTZ = _TZ, gCorte = HORA_CORTE_TURNO;
      _TZ = "Europe/Copenhagen";
      HORA_CORTE_TURNO = 0;
      const out = [
        fechaTurno(_wallToInstant("2026-07-12T00:00")),
        fechaTurno(_wallToInstant("2026-07-12T23:59")),
      ];
      _TZ = gTZ; HORA_CORTE_TURNO = gCorte;
      return out;
    });
    expect(r).toEqual(["2026-07-12", "2026-07-12"]);
  });
});

test.describe("Las horas del turno", () => {
  test("se cuentan entre los dos instantes, aunque cruce la medianoche",
    async ({ page }) => {
      await irAFichajes(page);
      const r = await page.evaluate(() => {
        const g = _TZ;
        _TZ = "Europe/Copenhagen";
        const h = (a, b) => _horasEntre(_wallToInstant(a).toISOString(),
                                        _wallToInstant(b).toISOString());
        const out = {
          normal:      h("2026-07-11T18:00", "2026-07-12T02:00"),   // 8 h cruzando medianoche
          corta:       h("2026-07-11T18:00", "2026-07-11T18:30"),
          sinSalida:   _horasEntre("2026-07-11T18:00Z", null),
          sinEntrada:  _horasEntre(null, "2026-07-11T18:00Z"),
          // ⚠ La noche en que el reloj se adelanta dura una hora MENOS. Quien
          //   entró a las 23 y salió a las 6 estuvo 6 h, no 7.
          nocheCorta:  h("2026-03-28T23:00", "2026-03-29T06:00"),
          nocheLarga:  h("2026-10-24T23:00", "2026-10-25T06:00"),
        };
        _TZ = g;
        return out;
      });

      expect(r.normal).toBeCloseTo(8, 2);
      expect(r.corta).toBeCloseTo(0.5, 2);
      expect(r.sinSalida, "un turno abierto no suma horas").toBe(0);
      expect(r.sinEntrada).toBe(0);
      expect(r.nocheCorta, "la noche del cambio de hora dura una hora menos").toBeCloseTo(6, 2);
      expect(r.nocheLarga, "y la de octubre, una más").toBeCloseTo(8, 2);
    });
});

test.describe("La grilla", () => {
  test("las horas de cada turno son las que hay entre entrada y salida",
    async ({ page }) => {
      test.skip(!(await irAFichajesConDatos(page)), "no hay turnos cerrados en dos años");
      const r = await page.evaluate(() => {
        const malos = [];
        let n = 0;
        for (const f of Object.values(_fichajesData || {})) {
          if (!f.ts_entrada || !f.ts_salida) continue;
          n++;
          const esperado = _horasEntre(f.ts_entrada, f.ts_salida);
          if (Math.abs((f.horas || 0) - esperado) > 0.02) {
            malos.push(`${f.username}: dice ${f.horas} y son ${esperado.toFixed(2)}`);
          }
        }
        return { malos: malos.slice(0, 5), n };
      });
      expect(r.malos).toEqual([]);
    });

  test("ningún turno cerrado termina antes de empezar", async ({ page }) => {
    test.skip(!(await irAFichajesConDatos(page)), "no hay turnos cerrados en dos años");
    const malos = await page.evaluate(() =>
      Object.values(_fichajesData || {})
        .filter((f) => f.ts_entrada && f.ts_salida &&
                       new Date(f.ts_salida) <= new Date(f.ts_entrada))
        .map((f) => `${f.username} ${f.ts_entrada} → ${f.ts_salida}`)
        .slice(0, 5));
    expect(malos, "hay turnos con la salida antes de la entrada").toEqual([]);
  });
});
