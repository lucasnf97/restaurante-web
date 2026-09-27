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

/**
 * Revela los sueldos. ⚠ Es sólo la cerradura de la PANTALLA: los números ya
 * vinieron del servidor en `_data` (a un gerente se los manda igual). Con la
 * pantalla bloqueada las filas se pintan con `•••••` y sin el campo del sueldo.
 */
const desbloquear = (page) => page.evaluate(() => { _unlocked = true; renderAll(); });

/**
 * El primer empleado con TODO en juego a la vez: 100 h fichadas contra 90
 * asignadas (fichó de más), una corrección del §23 de −4, y 10 h declaradas.
 *
 * ⚠ Los números están elegidos para que la fórmula VIEJA y la NUEVA den
 *   resultados distintos. Con la vieja (se pagaba lo fichado) cobraría
 *   15 × (96 + 10) − 20 = 1570; con la nueva (se paga el horario)
 *   15 × (90 + 10) − 20 = 980. Con números que coincidieran, estas pruebas
 *   pasarían sin haber probado nada y una reversión silenciosa no se vería.
 */
const conCorreccion = (page) => page.evaluate(() => {
  const u = _data.usuarios[0];
  Object.assign(u, {
    sueldo_hora: 15, horas_fichadas: 100, horas_correccion: -4, horas_netas: 96,
    horas_declaradas: 10, cargos: 20, horas_asignadas: 90, ajuste_delta: 0,
    ajuste_periodo: 0,
    salario_total: 15 * (90 + 10) - 20,          // 980, como lo calcula el servidor
  });
  _data.total_salarios = _data.usuarios.reduce((s, x) => s + x.salario_total, 0);
  renderAll();
  return u.id;
});

test.describe("La fórmula del salario", () => {
  // ⚠ SE PAGA EL HORARIO, NO EL FICHAJE (decisión del dueño, 2026-09-24).
  //   El cuadrante se asigna en horas enteras o medias: quien tiene 8 h
  //   asignadas y ficha 5 minutos antes y 5 después cobra 8 h, no 8 h 10.
  //
  //   La fórmula, tal como la escribe el servidor (salarios.py):
  //     pagadas = horas_asignadas + declaradas + ajuste_periodo
  //     salario = sueldo × pagadas − cargos
  //
  //   El fichaje queda como CONTROL: `horas_netas` (fichadas + correcciones) se
  //   sigue calculando y mostrando, pero no es la base del salario. Una
  //   diferencia grande significa horas trabajadas que nadie cargó en el
  //   cuadrante, y el gerente las añade para que se paguen.

  test("el salario es sueldo × (asignadas + declaradas + ajuste) − cargos",
    async ({ page }) => {
      await irASalarios(page);
      const d = await resumen(page);
      test.skip(!d.usuarios.length, "el período no tiene empleados");

      for (const u of d.usuarios) {
        const pagadas = (u.horas_asignadas || 0) + (u.horas_declaradas || 0)
                      + (u.ajuste_periodo || 0);
        const esperado = u.sueldo_hora * pagadas - (u.cargos || 0);
        // Margen de un decimal: el servidor redondea las horas a 2 decimales
        // para mostrarlas, pero calcula el salario con el valor sin redondear.
        expect(u.salario_total, `salario de ${u.username}`).toBeCloseTo(esperado, 1);
        // Y lo dice explícitamente, para que la pantalla no tenga que deducirlo
        // sumando columnas.
        if (u.horas_pagadas != null) {
          expect(u.horas_pagadas, `horas pagadas de ${u.username}`).toBeCloseTo(pagadas, 1);
        }
      }
    });

  test("fichar de más NO se paga", async ({ page }) => {
    await irASalarios(page);
    const d = await resumen(page);
    // Es EL punto de la regla: el que se queda diez minutos extra los trabajó
    // —y se ven en la diferencia— pero no los cobra.
    const deMas = d.usuarios.filter((u) => u.horas_netas > (u.horas_asignadas || 0) + 0.01);
    test.skip(!deMas.length, "nadie fichó por encima de su horario en este período");
    for (const u of deMas) {
      const tope = u.sueldo_hora * ((u.horas_asignadas || 0) + (u.horas_declaradas || 0)
                                   + (u.ajuste_periodo || 0)) - (u.cargos || 0);
      expect(u.salario_total, `${u.username} cobró horas que no tenía asignadas`)
        .toBeLessThanOrEqual(tope + 0.05);
    }
  });

  test("quien no tiene horario asignado no cobra por fichar", async ({ page }) => {
    await irASalarios(page);
    const d = await resumen(page);
    // Consecuencia buscada: el cuadrante es la ÚNICA fuente de lo que se paga.
    // Es también lo que hace que un turno olvidado abierto —en las maquetas había
    // uno de 700 h— no infle la nómina sin que nadie tenga que corregirlo.
    const sinNada = d.usuarios.filter(
      (u) => (u.horas_asignadas || 0) <= 0 && (u.horas_declaradas || 0) <= 0
             && (u.ajuste_periodo || 0) <= 0);
    for (const u of sinNada) {
      expect(u.salario_total, `${u.username} cobró sin horario asignado`)
        .toBeCloseTo(-(u.cargos || 0), 1);
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

  test("un empleado de baja sólo figura si cobró en el período", async ({ page }) => {
    await irASalarios(page);
    const d = await resumen(page);
    const bajas = d.usuarios.filter((u) => u.activo === false);

    // Hoy puede no haber ninguno; el día que lo haya, esto lo agarra. La regla
    // (decisión del dueño, 2026-09-14): el que se dio de baja en mayo sale en
    // mayo con su liquidación y en junio ya no.
    for (const u of bajas) {
      const movio = u.horas_netas !== 0 || (u.horas_declaradas || 0) !== 0 ||
                    (u.cargos || 0) !== 0 || (u.ajuste_periodo || 0) !== 0;
      expect(movio, `${u.username} está de baja y no cobró nada en el período`).toBe(true);
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

    // Y el total tampoco — salvo el redondeo que el servidor NO puede evitar
    // publicar, ver abajo.
    //
    // ⚠ HALLAZGO (2026-09-24), no es un fallo de esta prueba: el servidor cobra
    //   con las horas SIN redondear (`sueldo * horas_pagadas`) pero en la
    //   respuesta manda `horas_netas` ya redondeada a 2 decimales. La pantalla,
    //   al reescribir el sueldo, recalcula con ESAS horas, así que su salario
    //   difiere del servidor hasta 5 céntimos por empleado. Medido en septiembre
    //   2026: -0,07 EUR sobre 17.747,83 en 0000A y +0,13 sobre 8.184,50 en 0000B.
    //   Se ve sólo cuando las horas tienen decimales largos (un turno de 11 h
    //   20 min son 11,3333 h); con horas redondas no aparece.
    //   Arreglo propuesto (es LÓGICA DE DINERO, lo decide el dueño): publicar
    //   `horas_netas` con 4 decimales, que es la precisión que el propio front ya
    //   usa en `sincronizarNetas`. No cambia lo que cobra nadie.
    //
    // Por eso el margen va por empleado y no fijo: lo que esta prueba tiene que
    // cazar es una deriva DE VERDAD (un salario que se mueve al guardar), no el
    // medio céntimo que el redondeo publicado arrastra.
    const fin = await resumen(page);
    const margen = Math.max(0.05, 0.05 * d.usuarios.length);
    expect(Math.abs(fin.total_salarios - d.total_salarios),
      `el total se movió ${(fin.total_salarios - d.total_salarios).toFixed(2)} ` +
      `con ${d.usuarios.length} empleados`).toBeLessThanOrEqual(margen);
  });

  test("una corrección del §23 no cambia lo que se cobra", async ({ page }) => {
    await irASalarios(page);
    await desbloquear(page);
    test.skip(!(await resumen(page)).usuarios.length, "el período no tiene empleados");

    const uid = await conCorreccion(page);

    // La corrección ajusta el REGISTRO de lo trabajado —sigue siendo obligatoria
    // por el registro de personal sueco y danés— pero el salario sale del
    // horario, así que ni ella ni las 10 h fichadas de más lo mueven.
    const r = await guardarSinPersistir(page, uid, 15);
    expect(r.salario, "el salario siguió al fichaje en vez de al horario")
      .toBeCloseTo(15 * (90 + 10) - 20, 1);
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
      const pagadas = (u.horas_asignadas || 0) + (u.horas_declaradas || 0)
                    + (u.ajuste_periodo || 0);
      expect(r.salario).toBeCloseTo(doble * pagadas - (u.cargos || 0), 1);
    });
});

test.describe("Ajuste de horas", () => {
  // ⚠ `confirmarAjuste` sólo toca los datos en memoria: lo que se persiste se
  //   manda después, con "Confirmar ajustes", y eso NO se llama acá. El resto de
  //   la pantalla mira estos números, así que si quedan mal se decide con ellos.

  /** Abre el modal de ajuste, escribe las horas y confirma. No sale a la red. */
  const ajustar = (page, uid, horas) => page.evaluate(({ id, h }) => {
    abrirAjusteHoras(id);
    document.getElementById("aj-inp").value = String(h);
    calcAjusteDesdeHoras();
    const previa = document.getElementById("aj-sal-fin").textContent;
    confirmarAjuste();
    const u = _data.usuarios.find((x) => x.id === id);
    return { previa, salario: u.salario_total, netas: u.horas_netas,
             fichadas: u.horas_fichadas, dif: u.diferencia_horas,
             ajuste: u.ajuste_periodo };
  }, { id: uid, h: horas });

  test("sumar horas las paga sin volver a pagar lo que corrige la corrección",
    async ({ page }) => {
      await irASalarios(page);
      await desbloquear(page);
      test.skip(!(await resumen(page)).usuarios.length, "el período no tiene empleados");
      const uid = await conCorreccion(page);   // 100 fichadas, −4 corrección, 96 netas

      const r = await ajustar(page, uid, 5);

      // ⚠ El ajuste suma a lo que se PAGA (`ajuste_periodo`), NO a lo fichado.
      //   Antes movía `horas_fichadas` porque el pago salía de ahí; hacerlo ahora
      //   falsearía el registro de lo trabajado y encima no cambiaría un céntimo,
      //   porque el salario ya no mira el fichaje.
      expect(r.ajuste, "el ajuste no llegó a las horas pagadas").toBeCloseTo(5, 1);
      expect(r.fichadas, "el ajuste falseó las horas fichadas").toBeCloseTo(100, 1);
      expect(r.netas, "el ajuste falseó lo trabajado").toBeCloseTo(96, 1);
      expect(r.salario, "salario = 15 × (90 + 10 + 5) − 20").toBeCloseTo(15 * 105 - 20, 1);

      // La diferencia mide TRABAJADO contra ASIGNADO, y un ajuste de PAGO no la
      // mueve: no cambia lo que se fichó ni lo que se asignó. Para cerrarla hay
      // que corregir el cuadrante.
      expect(r.dif, "diferencia = netas − asignadas").toBeCloseTo(96 - 90, 1);
    });

  test("la vista previa anuncia el salario que después queda", async ({ page }) => {
    await irASalarios(page);
    await desbloquear(page);
    test.skip(!(await resumen(page)).usuarios.length, "el período no tiene empleados");
    const uid = await conCorreccion(page);

    // ⚠ Que el "salario final" de la vista previa no sea el que termina
    //   quedando es de lo peor que puede hacer esta pantalla: se aprueba un
    //   ajuste mirando un número y se guarda otro.
    const r = await ajustar(page, uid, 5);
    const soloDigitos = (t) => parseFloat(String(t).replace(/[^\d.,-]/g, "").replace(",", "."));
    expect(soloDigitos(r.previa)).toBeCloseTo(r.salario, 1);
  });

  test("editar un ajuste reemplaza el anterior, no lo acumula", async ({ page }) => {
    await irASalarios(page);
    await desbloquear(page);
    test.skip(!(await resumen(page)).usuarios.length, "el período no tiene empleados");
    const uid = await conCorreccion(page);

    await ajustar(page, uid, 5);              // +5 h
    const r = await page.evaluate(({ id }) => {
      editarAjuste(id);                       // modo edición: el +5 ya está puesto
      document.getElementById("aj-inp").value = "8";
      calcAjusteDesdeHoras();
      const previa = document.getElementById("aj-sal-fin").textContent;
      confirmarAjuste();
      const u = _data.usuarios.find((x) => x.id === id);
      return { previa, salario: u.salario_total, netas: u.horas_netas,
               ajuste: u.ajuste_periodo };
    }, { id: uid });

    // El ajuste queda en 8, no en 13: editar lo REEMPLAZA, no agrega otro.
    expect(r.ajuste, "el ajuste viejo se sumó en vez de reemplazarse").toBeCloseTo(8, 1);
    // Y lo trabajado no se toca: el ajuste es pago, no fichaje.
    expect(r.netas, "editar el ajuste falseó lo trabajado").toBeCloseTo(96, 1);
    expect(r.salario, "salario = 15 × (90 + 10 + 8) − 20").toBeCloseTo(15 * 108 - 20, 1);

    // Y la vista previa del modo edición también tiene que anunciar ese número:
    // se armaba a mano y se comía las correcciones y los cargos.
    const soloDigitos = (t) => parseFloat(String(t).replace(/[^\d.,-]/g, "").replace(",", "."));
    expect(soloDigitos(r.previa), "la vista previa de edición miente").toBeCloseTo(r.salario, 1);
  });
});

test.describe("El informe del mes y la nómina", () => {
  // ⚠ Son DOS consultas SQL distintas que calculan lo mismo, y nada las obliga a
  //   coincidir. Ya se habían separado: el informe no miraba ni las correcciones
  //   (§23) ni los ajustes guardados al confirmar un período, así que en un local
  //   real el costo laboral de julio salía 3.289 cuando la nómina pagó 24.529.

  test("el costo laboral del mes es el mismo por los dos caminos", async ({ page }) => {
    await irASalarios(page);

    // ⚠ La comparación sólo vale en meses donde NO cierra un período desalineado.
    //   Un período que va del 30/4 al 30/5 se paga en mayo —así lo imputa el
    //   informe desde la decisión del dueño (2026-09)— pero una consulta de
    //   nómina por el mes calendario de mayo no lo ve, porque sus ajustes están
    //   guardados contra ESE rango y no contra 1/5–31/5. Los dos números son
    //   correctos y distintos; exigir que sean iguales sería pedir un imposible.
    //   Ojo: no alcanza con mirar `dia_inicio_periodo`, porque los períodos ya
    //   confirmados se guardaron con el corte que hubiera entonces.
    const periodos = await page.evaluate(() =>
      (_confirmados || []).map((p) => ({ i: p.periodo_inicio, f: p.periodo_fin })));

    const hoy = new Date();
    const comparados = [];
    for (let atras = 1; atras <= 12; atras++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
      const [year, month] = [d.getFullYear(), d.getMonth() + 1];
      const mm = `${year}-${String(month).padStart(2, "0")}`;
      const ultimo = new Date(year, month, 0).getDate();
      const desalineado = periodos.some((p) => p.f.startsWith(mm) &&
        !(p.i === `${mm}-01` && p.f === `${mm}-${ultimo}`));
      if (desalineado) continue;

      const r = await page.evaluate(async ({ y, m }) => {
        const [nom, inf] = await Promise.all([
          api.get(`/salarios/resumen?year=${y}&month=${m}`),
          api.get(`/reportes/facturacion-mes?year=${y}&month=${m}`),
        ]);
        return { nomina: nom.total_salarios, bruto: inf.salarios, cargos: inf.salarios_cargos };
      }, { y: year, m: month });

      // El informe publica el BRUTO y los cargos por separado; la nómina los trae
      // ya restados. Los empleados dados de BAJA entran en los dos desde
      // 2026-09-14 (si cobraron en el período), así que ya no son excusa para
      // que estos números difieran.
      expect(r.bruto - r.cargos, `costo laboral de ${mm}`).toBeCloseTo(r.nomina, 1);
      comparados.push(mm);
    }

    // Sin esto la prueba podría pasar sin haber comparado un solo mes.
    test.skip(!comparados.length,
      "los 12 meses anteriores cierran períodos desalineados: nada que comparar");
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
