// @ts-check
// Salarios. La fórmula del sueldo vive en TRES lugares —el resumen de la API, el
// balance del mes y el recálculo de esta pantalla— y no hay nada que los obligue
// a coincidir. Estas pruebas son ese obligador.
//
// ⚠ SOLO LECTURA. No se guarda un sueldo, no se confirma un período y no se
//   registra el gasto de nómina. Confirmar un período escribe en
//   `periodos_confirmados` y puede crear una factura de servicio: sería plata
//   inventada. Donde hace falta ejercitar el guardado, se reemplaza `api.patch`
//   en la página para que la cuenta corra sin que nada salga a la red.
const { test, expect } = require("./sesion");

/** Abre la pantalla y espera a que el resumen del período esté cargado. */
const irASalarios = async (page) => {
  await page.goto("/salarios.html");
  await expect.poll(() => page.evaluate(() =>
    (typeof _data !== "undefined" && _data && _data.usuarios) ? _data.usuarios.length : -1),
    { timeout: 30_000 }).toBeGreaterThanOrEqual(0);
};

const resumen = (page) => page.evaluate(() => _data);

test.describe("La fórmula del salario", () => {
  // La fórmula, tal como la escribe el servidor (salarios.py):
  //   pagadas = horas_netas + declaradas,  con horas_netas = fichadas + correcciones
  //   salario = sueldo × pagadas − cargos

  test("el salario de cada empleado es sueldo × (netas + declaradas) − cargos",
    async ({ page }) => {
      await irASalarios(page);
      const d = await resumen(page);
      test.skip(!d.usuarios.length, "el período no tiene empleados");

      for (const u of d.usuarios) {
        const pagadas = u.horas_netas + (u.horas_declaradas || 0);
        const esperado = u.sueldo_hora * pagadas - (u.cargos || 0);
        // Margen de un decimal: el servidor redondea las horas a 2 decimales
        // para mostrarlas, pero calcula el salario con el valor sin redondear.
        expect(u.salario_total, `salario de ${u.username}`).toBeCloseTo(esperado, 1);
      }
    });

  test("las horas netas son las fichadas más las correcciones", async ({ page }) => {
    await irASalarios(page);
    const d = await resumen(page);
    test.skip(!d.usuarios.length, "el período no tiene empleados");

    for (const u of d.usuarios) {
      expect(u.horas_netas, `horas netas de ${u.username}`)
        .toBeCloseTo(u.horas_fichadas + (u.horas_correccion || 0), 1);
    }
  });

  test("el total del período es la suma de las filas", async ({ page }) => {
    await irASalarios(page);
    const d = await resumen(page);
    const suma = d.usuarios.reduce((s, u) => s + u.salario_total, 0);
    expect(d.total_salarios).toBeCloseTo(suma, 1);
  });

  test("la diferencia de horas es lo trabajado menos lo asignado", async ({ page }) => {
    await irASalarios(page);
    const d = await resumen(page);
    test.skip(!d.usuarios.length, "el período no tiene empleados");

    for (const u of d.usuarios) {
      expect(u.diferencia_horas, `diferencia de ${u.username}`)
        .toBeCloseTo(u.horas_netas - u.horas_asignadas, 1);
      expect(u.diferencia_saldo, `saldo de ${u.username}`)
        .toBeCloseTo(u.sueldo_hora * u.diferencia_horas, 1);
    }
  });
});

test.describe("Guardar el sueldo", () => {
  // ⚠ Acá estaba el bug. La pantalla, para no volver a pedir todo, recalcula el
  //   salario sola al guardar un sueldo. Esa copia de la fórmula se olvidaba de
  //   las CORRECCIONES (§23: el que no cerró el turno y quedaron 12 h
  //   registradas cobra 8). Resultado: guardar el MISMO sueldo, sin cambiar
  //   nada, hacía saltar el salario en pantalla —y el que mira la cifra no
  //   tiene cómo saber que la buena era la anterior.

  /**
   * Revela los sueldos. ⚠ Es sólo la cerradura de la PANTALLA: los números ya
   * vinieron del servidor en `_data` (a un gerente se los manda igual). Con la
   * pantalla bloqueada las filas se pintan con `•••••` y sin el campo del
   * sueldo, así que sin esto no hay nada que guardar.
   */
  const desbloquear = (page) => page.evaluate(() => { _unlocked = true; renderAll(); });

  /** Corre guardarSueldo con `api.patch` anulado: calcula, no persiste. */
  const guardarSinPersistir = (page, uid, sueldo) => page.evaluate(async ({ id, s }) => {
    const orig = api.patch;
    api.patch = async () => ({ ok: true });          // ⚠ nada sale a la red
    try {
      const inp = document.getElementById(`si-${id}`);
      inp.removeAttribute("readonly");
      inp.value = String(s);
      await guardarSueldo(id);
    } finally {
      api.patch = orig;
    }
    const u = _data.usuarios.find((x) => x.id === id);
    return { salario: u.salario_total, total: _data.total_salarios };
  }, { id: uid, s: sueldo });

  test("guardar el mismo sueldo no mueve el salario", async ({ page }) => {
    await irASalarios(page);
    await desbloquear(page);
    const d = await resumen(page);
    test.skip(!d.usuarios.length, "el período no tiene empleados");

    // Se prueban todos: el que tiene una corrección puede ser cualquiera.
    for (const u of d.usuarios) {
      const r = await guardarSinPersistir(page, u.id, u.sueldo_hora);
      expect(r.salario, `${u.username}: el salario cambió sin tocar el sueldo`)
        .toBeCloseTo(u.salario_total, 1);
    }

    // Y el total tampoco.
    const fin = await resumen(page);
    expect(fin.total_salarios).toBeCloseTo(d.total_salarios, 1);
  });

  test("con una corrección de horas, guardar el mismo sueldo tampoco lo mueve",
    async ({ page }) => {
      await irASalarios(page);
      await desbloquear(page);
      test.skip(!(await resumen(page)).usuarios.length, "el período no tiene empleados");

      // ⚠ La fila se arma acá a propósito. La prueba de arriba sólo mira el
      //   período que está cargado, y si ese período no tiene ninguna corrección
      //   —lo normal— la fórmula mala da el mismo número que la buena y la
      //   prueba pasa sin haber probado nada. Esta fila es la del empleado que
      //   se olvidó de cerrar el turno: 100 h registradas, corrección de −4,
      //   cobra 96. El servidor la habría mandado exactamente así.
      const uid = await page.evaluate(() => {
        const u = _data.usuarios[0];
        Object.assign(u, {
          sueldo_hora: 15, horas_fichadas: 100, horas_correccion: -4,
          horas_netas: 96, horas_declaradas: 10, cargos: 20,
          salario_total: 15 * (96 + 10) - 20,       // 1570, como lo calcula el servidor
        });
        _data.total_salarios = _data.usuarios.reduce((s, x) => s + x.salario_total, 0);
        renderAll();
        return u.id;
      });

      const r = await guardarSinPersistir(page, uid, 15);
      expect(r.salario, "se pagaron las 4 h que la corrección descuenta").toBeCloseTo(1570, 1);
    });

  test("al duplicar el sueldo, el salario sigue la fórmula del servidor",
    async ({ page }) => {
      await irASalarios(page);
      await desbloquear(page);
      const d = await resumen(page);
      const u = d.usuarios[0];
      test.skip(!u, "el período no tiene empleados");

      const doble = (u.sueldo_hora || 10) * 2;
      const r = await guardarSinPersistir(page, u.id, doble);
      const pagadas = u.horas_netas + (u.horas_declaradas || 0);
      expect(r.salario).toBeCloseTo(doble * pagadas - (u.cargos || 0), 1);
    });
});

test.describe("Los períodos", () => {
  test("se encadenan sin huecos ni solapes, con cualquier día de corte",
    async ({ page }) => {
      await irASalarios(page);

      // ⚠ Un hueco entre períodos son horas que nadie cobra; un solape son horas
      //   pagadas dos veces. Se recorren los 31 días de corte posibles porque el
      //   corte es configurable y los meses cortos hacen rodar las fechas
      //   (31 de febrero no existe: JavaScript lo pasa a marzo).
      const fallos = await page.evaluate(() => {
        const malos = [];
        const guardado = _diaInicio;
        for (let corte = 1; corte <= 31; corte++) {
          _diaInicio = corte;
          let previo = null;
          for (let i = 0; i < 26; i++) {           // dos años corridos
            const mes = (i % 12) + 1;
            const year = 2026 + Math.floor(i / 12);
            const { inicio, fin } = calcPeriodo(mes, year);
            if (inicio > fin) {
              malos.push(`corte ${corte}: ${mes}/${year} empieza después de terminar`);
            }
            if (previo) {
              const siguiente = new Date(previo);
              siguiente.setDate(siguiente.getDate() + 1);
              if (inicio.getTime() !== siguiente.getTime()) {
                malos.push(`corte ${corte}: entre ${previo.toDateString()} y ` +
                           `${inicio.toDateString()} hay hueco o solape`);
              }
            }
            previo = fin;
          }
        }
        _diaInicio = guardado;
        return malos.slice(0, 10);
      });
      expect(fallos).toEqual([]);
    });

  test("el período actual contiene al día de hoy", async ({ page }) => {
    await irASalarios(page);
    const fuera = await page.evaluate(() => {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const malos = [];
      const guardado = _diaInicio;
      for (let corte = 1; corte <= 28; corte++) {
        _diaInicio = corte;
        const { inicio, fin } = periodoActual();
        if (hoy < inicio || hoy > fin) malos.push(`corte ${corte}`);
      }
      _diaInicio = guardado;
      return malos;
    });
    expect(fuera, "hay cortes cuyo período actual no incluye hoy").toEqual([]);
  });

  test("el rango que se pide al servidor es el que muestra el encabezado",
    async ({ page }) => {
      await irASalarios(page);
      // Si la etiqueta y el rango pedido se separan, se estarían mirando los
      // números de un mes con el título de otro.
      const r = await page.evaluate(() => ({
        desde: _periodoActualDesde, hasta: _periodoActualHasta,
        dataDesde: _data.desde, dataHasta: _data.hasta,
        label: document.getElementById("periodo-label-header").textContent,
      }));
      expect(r.dataDesde).toBe(r.desde);
      expect(r.dataHasta).toBe(r.hasta);
      expect(r.label).toMatch(/\d/);
    });
});
