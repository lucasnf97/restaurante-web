// @ts-check
// ARQUEO DE CAJA — el ciclo completo, con dinero de verdad.
//
// Lo que se protege acá es la aritmética del efectivo, que es la única parte del
// módulo que puede equivocarse en silencio: una pantalla rota se ve, un esperado mal
// calculado se cree. Y en particular las dos reglas que NO son obvias:
//
//   1. El esperado NO es el total del turno — ese incluye tarjeta.
//   2. El descuadre de APERTURA no se le carga al turno que abre. Si de noche
//      desapareció plata, el turno de la mañana arranca de lo que de verdad hay y
//      cierra cuadrado; el faltante queda atribuido al hueco entre turnos.
//
// ⚠ ESTA PRUEBA DEJA UN CIERRE POR CORRIDA, y es la única de la carpeta que no puede
//   limpiar todo lo que crea. Un cierre es un registro financiero de sólo-alta: no hay
//   endpoint para borrarlo, y agregarlo a la API nada más que para que un test ordene
//   sería mucho peor que dejar una fila marcada en el arenero. Por eso el cierre se
//   TAGUEA (`arqueo_notas` lleva la marca `[e2e …]`) y se purga con
//   `scratchpad/purgar_cierres_prueba.py`, que filtra justamente por esa marca.
//   Lo demás —el estado de la caja— sí queda como estaba: cerrada.
const { test, expect, api, marca } = require("./_arenero");

/** Redondeo a céntimos, para comparar importes sin arrastrar binario. */
const c = (n) => Math.round(Number(n) * 100) / 100;

test.describe("Arqueo de caja", () => {

  test("abrir y cerrar contando: el descuadre de apertura no lo paga el turno",
    async ({ page }) => {
      test.setTimeout(180000);
      await page.goto("/caja.html");

      // ⚠ Si la caja ya está abierta, no es de esta prueba: puede ser otra corrida o
      //   alguien trabajando. Interferir ahí fue justo lo que dejó mesas trabadas la
      //   última vez, así que se sale sin tocar nada.
      const est = await api(page, "GET", "/caja/estado");
      test.skip(!!(est.data && est.data.abierta),
        "la caja del arenero ya está abierta: no se toca");

      // ── Lo que el sistema dice que debería haber antes de abrir ──────────────
      const prev = await api(page, "GET", "/caja/apertura");
      expect(prev.ok, `/caja/apertura falló: ${prev.status}`).toBe(true);
      expect(prev.data).toHaveProperty("origen");
      const esperadoApertura = prev.data.origen === "sin_referencia"
        ? null : c(prev.data.esperado);

      // ── 1) Abrir con un descuadre deliberado ────────────────────────────────
      // ⚠ El signo NO es fijo, y eso es a propósito. Cada corrida deja el cajón 65
      //   más bajo (−10 al abrir, −70+20 de movimientos, −5 al cerrar): con un −10
      //   fijo, a las ~8 corridas el importe llegaría a cero y la API rechazaría un
      //   contado negativo. La prueba se rompería sola, meses después, y por su
      //   propio uso. Así que cuando el cajón baja de 200 se RECARGA con un sobrante,
      //   y de paso se ejercita el otro signo del descuadre.
      const descuadre = (esperadoApertura === null || esperadoApertura < 200) ? 200 : -10;
      const contadoApertura = esperadoApertura === null
        ? 500 : c(esperadoApertura + descuadre);
      const ab = await api(page, "POST", "/caja/abrir", {
        efectivo_contado: contadoApertura,
        notas: marca("arqueo apertura"),
      });
      expect(ab.ok, `abrir falló: ${ab.status}`).toBe(true);

      try {
        if (esperadoApertura !== null) {
          // El descuadre de apertura se detecta y se registra...
          expect(c(ab.data.apertura_esperado)).toBe(esperadoApertura);
          expect(c(ab.data.apertura_diferencia)).toBe(descuadre);
        }
        // ...pero el fondo del turno parte de lo CONTADO, no de lo que debería haber.
        // Ésta es la regla que hace que el turno no herede el faltante de la noche.
        expect(c(ab.data.fondo_inicial)).toBe(contadoApertura);

        // ── 2) Movimientos: un retiro y un ingreso ────────────────────────────
        const ret = await api(page, "POST", "/caja/movimientos",
          { tipo: "retiro", monto: 70, motivo: marca("retiro proveedor") });
        expect(ret.ok, `retiro falló: ${ret.status}`).toBe(true);
        expect(c(ret.data.efectivo_esperado)).toBe(c(contadoApertura - 70));

        const ing = await api(page, "POST", "/caja/movimientos",
          { tipo: "ingreso", monto: 20, motivo: marca("reposicion cambio") });
        expect(ing.ok, `ingreso falló: ${ing.status}`).toBe(true);

        const esperadoCierre = c(contadoApertura - 70 + 20);
        const arq = await api(page, "GET", "/caja/arqueo");
        expect(arq.ok).toBe(true);
        expect(c(arq.data.efectivo_esperado)).toBe(esperadoCierre);
        expect(c(arq.data.retiros)).toBe(70);
        expect(c(arq.data.ingresos)).toBe(20);

        // ⚠ Y el esperado NO es el total facturado: esa es la confusión que este
        //   módulo existe para evitar. Si alguien "simplifica" el cálculo usando el
        //   total del turno, esto lo caza.
        expect(c(arq.data.efectivo_esperado)).not.toBe(c(arq.data.cobrado_efectivo));

        // ── 3) Motivo obligatorio ────────────────────────────────────────────
        const malo = await api(page, "POST", "/caja/movimientos",
          { tipo: "retiro", monto: 5, motivo: "   " });
        expect(malo.status, "un retiro sin motivo tiene que rechazarse: sin motivo es " +
          "indistinguible de un faltante").toBe(400);

      } finally {
        // ── 4) Cerrar SIEMPRE, pase lo que pase arriba ──────────────────────
        // Si una aserción falla a mitad, la caja no puede quedar abierta: dejaría el
        // arenero trabado para las demás pruebas.
        const esperadoCierre = c(contadoApertura - 70 + 20);

        // ⚠ El cierre es "retirar el excedente para dejar la caja en el saldo inicial".
        //   Se retira 10 MENOS de lo sugerido (el caso "dejo un ticket por la
        //   diferencia") y se declara que quedó 5 menos de lo que debería: así se
        //   separan las dos cosas que el modelo tiene que distinguir — plata GUARDADA
        //   (que no es un faltante) y plata que FALTA de verdad.
        const arq2 = await api(page, "GET", "/caja/arqueo");
        const sugerido = c(arq2.data.retiro_sugerido);
        const retirado = c(Math.max(sugerido - 10, 0));
        const debeQuedar = c(esperadoCierre - retirado);
        const contadoCierre = c(debeQuedar - 5);            // faltan 5 de verdad

        const ci = await api(page, "POST", "/caja/cerrar", {
          retirado,
          retiro_notas: marca("retiro parcial, ticket en caja"),
          efectivo_contado: contadoCierre,
          notas: marca("arqueo cierre"),
        });
        expect(ci.ok, `cerrar falló: ${ci.status}`).toBe(true);

        const a = ci.data.arqueo || {};
        expect(c(a.efectivo_esperado)).toBe(esperadoCierre);
        expect(c(a.retirado_cierre)).toBe(retirado);
        expect(c(a.efectivo_contado)).toBe(contadoCierre);
        // ⚠ LA REGLA QUE MÁS FÁCIL SE ROMPE: la diferencia se mide contra lo que
        //   DEBERÍA QUEDAR DESPUÉS del retiro, no contra lo que había antes. Si
        //   alguien compara contra `efectivo_esperado` a secas, el dinero que se acaba
        //   de guardar aparece como un faltante enorme.
        expect(c(a.diferencia), "la diferencia tiene que ser -5 (lo que falta de " +
          "verdad), no incluir el dinero retirado").toBe(-5);

        // El cierre guarda LOS DOS arqueos, que es lo que lo hace auditable.
        const hist = await api(page, "GET", "/caja/arqueos");
        expect(hist.ok).toBe(true);
        const fila = hist.data[0];
        expect(fila.arqueado).toBe(true);
        expect(c(fila.diferencia)).toBe(-5);
        if (esperadoApertura !== null) expect(c(fila.apertura_diferencia)).toBe(descuadre);
        // Las notas son el entregable del módulo: sin ellas el histórico no sirve
        // para auditar nada, y son lo que lee quien abre al día siguiente.
        expect(fila.retiro_notas, "falta la nota del retiro en el histórico").toBeTruthy();
        expect(fila.arqueo_notas, "falta la nota del descuadre en el histórico").toBeTruthy();
        expect(c(fila.retirado_cierre)).toBe(retirado);

        // Y quien abra mañana recibe ese recado.
        const manana = await api(page, "GET", "/caja/apertura");
        expect(manana.ok).toBe(true);
        expect(manana.data.ultimo_cierre.arqueo_notas,
          "quien abre tiene que recibir la explicación del cierre").toBeTruthy();

        // Y los movimientos quedaron atados a ESE cierre (si no, se contarían otra
        // vez en el turno siguiente).
        const movs = await api(page, "GET", `/caja/arqueos/${fila.id}/movimientos`);
        expect(movs.ok).toBe(true);
        expect(movs.data.length).toBeGreaterThanOrEqual(2);

        // La caja queda CERRADA, como estaba.
        const fin = await api(page, "GET", "/caja/estado");
        expect(fin.data.abierta, "la caja tiene que quedar cerrada").toBe(false);
      }
    });

  test("la pantalla muestra el dinero antes de pedir nada", async ({ page }) => {
    // Esto es lo que de verdad se puede romper al retocar la pantalla: que deje de
    // mostrarse el dinero ANTES de pedir la acción, y la persona tenga que decidir a
    // ciegas. No escribe nada: cancela los diálogos.
    //
    // ⚠ Abrir y cerrar preguntan cosas DISTINTAS desde el rediseño: abrir pide contar,
    //   cerrar pide retirar. Por eso se comprueba cada uno con lo suyo — un assert
    //   común a los dos no probaría ninguno bien.
    await page.goto("/caja.html");

    const vistos = [];
    // ⚠ Este manejador SÓLO REGISTRA, no descarta: `sesion.js` ya instala uno que
    //   hace `dismiss()`, y dos manejadores sobre el mismo diálogo revientan con
    //   "Cannot dismiss dialog which is already handled". Descartar es justo lo que
    //   hace falta igual — cancelar el prompt significa que no se abre ni se cierra
    //   nada, que es lo que esta prueba quiere comprobar.
    page.on("dialog", (d) => { vistos.push({ tipo: d.type(), texto: d.message() }); });

    const abierta = await page.evaluate(async () => {
      const r = await fetch(window._API_URL + "/caja/estado",
        { headers: { Authorization: "Bearer " + localStorage.getItem("token") } });
      return (await r.json()).abierta;
    });

    await page.evaluate((ab) => (ab ? cerrarCaja() : abrirCaja()), abierta);
    await expect.poll(() => vistos.length, { timeout: 30000 }).toBeGreaterThan(0);

    const p = vistos.find((v) => v.tipo === "prompt");
    expect(p, "tiene que preguntar con un prompt").toBeTruthy();

    if (abierta) {
      // CERRAR: dice cuánto hay, cuál es el objetivo y cuánto retirar.
      expect(p.texto, `el cierre no dice cuánto hay: ${p.texto}`)
        .toMatch(/en el caj[óo]n hay/i);
      expect(p.texto, `el cierre no menciona el saldo inicial: ${p.texto}`)
        .toMatch(/saldo inicial/i);
      expect(p.texto, `el cierre no pregunta cuánto se retira: ${p.texto}`)
        .toMatch(/retir/i);
    } else {
      // ABRIR: pide contar y muestra antes lo que debería haber.
      expect(p.texto).toMatch(/cont/i);
      expect(p.texto, `el diálogo no muestra lo que debería haber: ${p.texto}`)
        .toMatch(/deber[íi]a haber|No hay un cierre anterior/i);
    }

    // Cancelar no cambió nada.
    const despues = await page.evaluate(async () => {
      const r = await fetch(window._API_URL + "/caja/estado",
        { headers: { Authorization: "Bearer " + localStorage.getItem("token") } });
      return (await r.json()).abierta;
    });
    expect(despues).toBe(abierta);
  });
});
