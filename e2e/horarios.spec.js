// @ts-check
// Horarios. De acá salen las HORAS ASIGNADAS, que son contra las que se compara
// lo fichado: la diferencia que aparece en Salarios (y el botón "Anular
// diferencia") se apoya en este número. Si la grilla y la nómina no lo cuentan
// igual, la diferencia no significa nada.
//
// ⚠ SOLO LECTURA. No se guarda un turno, no se publica un horario y no se acepta
//   un intercambio. Publicar hace visible la semana a todo el personal.
const { test, expect } = require("./sesion");

/**
 * ⚠ Se espera a que el rango YA esté resuelto (`_desdeISO`), no a que exista la
 *   variable: arranca como `''` y la espera se cumpliría antes de que la pantalla
 *   cargue nada.
 */
const irAHorarios = async (page) => {
  await page.goto("/horarios.html");
  await expect.poll(() => page.evaluate(() =>
    (typeof _desdeISO !== "undefined" && _desdeISO) ? _desdeISO : ""),
    { timeout: 40_000 }).toMatch(/^\d{4}-\d{2}-\d{2}$/);
};

test.describe("Cuántas horas es un turno", () => {
  // ⚠ Dos casos que la resta pelada de horas se come:
  //   · el turno que CRUZA LA MEDIANOCHE — cerrar a las 02:00 habiendo entrado a
  //     las 22:00 son 4 h, no −20;
  //   · el BREAK, que se descuenta igual que en las horas fichadas.

  test("cruzar la medianoche suma, no resta", async ({ page }) => {
    await irAHorarios(page);
    const r = await page.evaluate(() => ({
      dia:        _totMin([{ inicio: "10:00", fin: "18:00" }]),
      noche:      _totMin([{ inicio: "22:00", fin: "02:00" }]),
      justoAlFin: _totMin([{ inicio: "18:00", fin: "00:00" }]),
      dosFranjas: _totMin([{ inicio: "10:00", fin: "14:00" },
                           { inicio: "20:00", fin: "01:00" }]),
      vacia:      _totMin([]),
    }));
    expect(r.dia).toBe(8 * 60);
    expect(r.noche, "22:00 → 02:00 son 4 h").toBe(4 * 60);
    expect(r.justoAlFin, "18:00 → 00:00 son 6 h").toBe(6 * 60);
    expect(r.dosFranjas, "4 h + 5 h").toBe(9 * 60);
    expect(r.vacia).toBe(0);
  });

  test("el break se descuenta y no deja el turno en negativo", async ({ page }) => {
    await irAHorarios(page);
    const r = await page.evaluate(() => ({
      conBreak:  _netMin({ franjas: [{ inicio: "10:00", fin: "18:00" }], break_mins: 30 }),
      sinBreak:  _netMin({ franjas: [{ inicio: "10:00", fin: "18:00" }] }),
      exagerado: _netMin({ franjas: [{ inicio: "10:00", fin: "11:00" }], break_mins: 600 }),
    }));
    expect(r.conBreak).toBe(7.5 * 60);
    expect(r.sinBreak).toBe(8 * 60);
    expect(r.exagerado, "un break más largo que el turno no da horas negativas").toBe(0);
  });
});

test.describe("La grilla y la nómina cuentan lo mismo", () => {
  test("las horas asignadas del salario son las que muestra el horario",
    async ({ page }) => {
      await irAHorarios(page);

      // ⚠ Es el cruce que importa de esta pantalla. La nómina calculaba las
      //   asignadas en BRUTO —sin descontar el break y restando `time` pelados—
      //   así que el que cumplía su turno exacto aparecía en déficit por el
      //   tamaño de su descanso, y un turno nocturno le restaba 20 h.
      //
      // ⚠ Se pide la grilla de UN local (`/horarios-personal/grid`, el del token)
      //   y no se lee la pantalla: si el gerente es de cadena, la grilla muestra
      //   TODOS los locales y estaría comparando los turnos de dos restaurantes
      //   contra la nómina de uno. La cuenta sí es la de la pantalla (`_netMin`).
      const r = await page.evaluate(async () => {
        const mes = (atras) => {
          const h = new Date();
          const d = new Date(h.getFullYear(), h.getMonth() - atras, 1);
          const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0);
          const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-` +
                             `${String(x.getDate()).padStart(2, "0")}`;
          return { desde: iso(d), hasta: iso(fin) };
        };
        // Se retrocede hasta un mes con turnos PUBLICADOS: el mes en curso suele
        // estar sin publicar y la prueba se saltearía sin comparar nada.
        for (let atras = 0; atras < 18; atras++) {
          const { desde, hasta } = mes(atras);
          const grid = await api.get(`/horarios-personal/grid?desde=${desde}&hasta=${hasta}`);
          const porUsuario = {};
          (grid || []).forEach((rest) => (rest.empleados || []).forEach((e) => {
            let min = 0;
            Object.values(e.dias || {}).forEach((d) => {
              if (d && d.publicado) min += _netMin(d);   // la cuenta de la pantalla
            });
            if (min > 0) porUsuario[(e.username || "").toLowerCase()] = min / 60;
          }));
          if (!Object.keys(porUsuario).length) continue;

          const sd = await api.get(`/salarios/resumen?desde=${desde}&hasta=${hasta}`);
          const nomina = {};
          (sd.usuarios || []).forEach((u) => {
            // `horas_asignadas` incluye `ajuste_horas`; la base comparable es sin él.
            const base = (u.horas_asig_base != null) ? u.horas_asig_base : u.horas_asignadas;
            if (base) nomina[(u.username || "").toLowerCase()] = base;
          });
          return { grilla: porUsuario, nomina, desde, hasta };
        }
        return { grilla: {}, nomina: {}, desde: null, hasta: null };
      });

      const nombres = Object.keys(r.grilla);
      test.skip(!nombres.length, "no hay turnos publicados en 18 meses");

      const malos = [];
      for (const n of nombres) {
        const g = r.grilla[n], s = r.nomina[n] || 0;
        if (Math.abs(g - s) > 0.02) malos.push(`${n}: grilla ${g.toFixed(2)} h, nómina ${s.toFixed(2)} h`);
      }
      expect(malos).toEqual([]);
    });
});

test.describe("El rango que se muestra", () => {
  test("es un rango válido y la grilla no se queda cargando", async ({ page }) => {
    await irAHorarios(page);
    const r = await page.evaluate(() => ({ desde: _desdeISO, hasta: _hastaISO }));
    expect(r.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.desde <= r.hasta, `el rango va al revés: ${r.desde} → ${r.hasta}`).toBe(true);
    await expect(page.locator(".grid-loading")).toHaveCount(0, { timeout: 30_000 });
  });
});
