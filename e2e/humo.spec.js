// @ts-check
// BARRIDO DE HUMO SOBRE TODAS LAS PÁGINAS.
//
// No prueba flujos: abre cada pantalla con la sesión que le corresponde y mira
// que no se rompa. Es barato y atrapa lo más caro de encontrar a mano:
//   · errores de JavaScript (un <script> roto deja la página en blanco);
//   · respuestas 5xx del servidor;
//   · endpoints que no existen (404) o permisos mal puestos (401/403);
//   · páginas que cargan pero se quedan vacías o clavadas en "Cargando…".
//
// ⚠ SOLO LECTURA: abre y mira. No toca un botón que escriba.
const { test, expect, token } = require("./sesion");

/** Las que NO llevan sesión: son públicas o el login. */
const PUBLICAS = ["index.html", "terminos.html", "privacidad.html",
                  "restablecer.html", "reserva.html"];

/** Las que expulsan si el rol no encaja. */
const ROL = {
  "restaurantes.html": "superadmin",
  "cadena.html": "gerente_cadena",
  "cadena-personal.html": "gerente_cadena",
};

const PAGINAS = [
  "analisis-mes.html", "cadena-personal.html", "cadena.html", "caja.html",
  "clientes.html", "cocina.html", "configuracion-usuario.html", "configuracion.html",
  "dashboard.html", "documentos.html", "estadisticas-personal.html", "estadisticas.html",
  "facturas.html", "fichajes.html", "historicos.html", "horarios.html",
  "importar-ventas.html", "index.html", "mensajes.html", "mesas.html",
  "preview-dashboard.html", "privacidad.html", "productos.html", "reserva.html",
  "reservas.html", "restablecer.html", "restaurantes.html", "salarios.html",
  "social.html", "stock.html", "tareas.html", "terminos.html", "usuarios.html",
  "ventas-estadisticas.html",
];

/**
 * Peticiones que fallan y NO son un problema de la página:
 *  · el favicon, que no existe;
 *  · /auth/me y afines con un rol sintético (superadmin y gerente de cadena no
 *    tienen fila en el esquema del inquilino — es por diseño, ver prefs.py);
 *  · lo que pida una página pública sin sesión.
 */
const RUIDO = [/favicon/i, /\/auth\/me\b/];

test.describe("Barrido de humo", () => {
  for (const pagina of PAGINAS) {
    const publica = PUBLICAS.includes(pagina);
    const rol = ROL[pagina];

    test(pagina, async ({ page, browser }) => {
      // Las públicas se abren en un contexto limpio: con sesión, index.html
      // redirige al panel y no se estaría probando el login.
      const ctx = publica ? await browser.newContext() : null;
      const p = publica ? await ctx.newPage() : page;

      const erroresJS = [];
      const fallos = [];
      p.on("pageerror", (e) => erroresJS.push(String(e).slice(0, 200)));
      p.on("dialog", (d) => d.dismiss().catch(() => {}));
      p.on("response", (r) => {
        const url = r.url();
        if (RUIDO.some((re) => re.test(url))) return;
        if (r.status() >= 400) fallos.push(`${r.status()} ${url.replace(/^https?:\/\/[^/]+/, "")}`);
      });

      // ⚠ El rol va en el TOKEN, no sólo en localStorage: la API decide por los
      //   claims. Cambiar sólo el localStorage deja un token de gerente pidiendo
      //   /restaurantes y devuelve 403 —correctamente—, lo que parece un bug de
      //   la página cuando es de la prueba.
      if (rol) {
        await p.addInitScript(({ t, r }) => {
          localStorage.setItem("token", t);
          const u = JSON.parse(localStorage.getItem("user") || "{}");
          localStorage.setItem("user", JSON.stringify({ ...u, rol: r }));
        }, { t: token(rol), r: rol });
      }

      await p.goto(`/${pagina}`, { waitUntil: "domcontentloaded" });

      // ⚠ NADA de esperar un rato fijo. Con 3,5 s, tres pantallas pesadas
      //   (Análisis del mes, Estadísticas y Horarios) se daban por colgadas
      //   cuando sólo estaban tardando: con 9 s cargan perfecto. Un tiempo fijo
      //   o miente o vuelve el barrido lentísimo. Se reintenta hasta que se
      //   asienta, y lo que sigue cargando a los 30 s sí está colgado de verdad.
      const leerEstado = () => p.evaluate(() => {
        // ⚠ Sólo lo VISIBLE. Varias pantallas tienen pestañas que no se cargan
        //   hasta que se las abre y dejan su "Cargando…" en el marcado oculto
        //   (la de Producción en Stock, por ejemplo). Contarlo daba por colgada
        //   una página que funciona perfecto.
        //   Y "visible" es mas que tener tamaño: #ui-cargando (el indicador
        //   flotante de js/api.js) se apaga por OPACIDAD, no por display, asi
        //   que mide 100x30 aun estando invisible. Se mira la opacidad de toda
        //   la cadena de padres, y ademas se lo excluye: es un indicador
        //   global y transitorio, no contenido de la pantalla.
        const seVe = (e) => {
          if (e.closest("#ui-cargando")) return false;
          const r = e.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return false;
          }
          return true;
        };
        const texto = (document.body.innerText || "").trim();
        return {
          texto: texto.length,
          cargando: Array.from(document.querySelectorAll("td, div, span, p"))
            .filter((e) => e.children.length === 0 && seVe(e))
            .some((e) => /^cargando/i.test((e.textContent || "").trim())),
          skel: Array.from(document.querySelectorAll(".ui-skel")).filter(seVe).length,
        };
      });

      // ⚠ TODAS las señales de "ya está" van en el MISMO reintento. El esqueleto
      //   se pinta DESPUÉS de que desaparece el "Cargando…", y el contenido
      //   llega después del esqueleto: mirarlas por separado deja pasar la
      //   ventana entre una y otra y da por vacía una pantalla que sí carga
      //   (le pasó a Cocina, que renderiza bien pero tiene poco texto).
      await expect.poll(async () => {
        const e = await leerEstado();
        return !e.cargando && e.skel === 0 && e.texto > 50;
      }, { message: `${pagina}: no terminó de cargar (sigue cargando o quedó vacía)`,
           timeout: 30_000 })
        .toBe(true);
      const estado = await leerEstado();

      // Lo que de verdad importa, en orden de gravedad.
      expect(erroresJS, `${pagina}: errores de JavaScript`).toEqual([]);
      expect(fallos.filter((f) => f.startsWith("5")), `${pagina}: el servidor devolvió 5xx`).toEqual([]);
      expect(fallos.filter((f) => /^40[134]/.test(f)), `${pagina}: peticiones rechazadas o inexistentes`).toEqual([]);

      if (ctx) await ctx.close();
    });
  }
});
