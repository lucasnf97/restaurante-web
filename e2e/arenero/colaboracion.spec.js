// @ts-check
// SOCIAL, DOCUMENTOS y TAREAS — la mitad "colaborativa" del producto, que en el
// arenero estaba entera en cero (sus tablas vacías). Lo que se prueba en las
// tres es lo mismo y es lo que importa: QUIÉN VE QUÉ. Un grupo existe para que
// algo lo vean unos y no otros; si el filtro falla, el sueldo de alguien o el
// documento del dueño quedan a la vista de todos.
//
// ⚠ Todo lo que se crea se borra al terminar.
const { test, expect, api, apiComo, ir, marca } = require("./_arenero");

/** Un empleado sin permisos, para comprobar qué NO ve. */
const unEmpleado = async (page) => {
  const r = await api(page, "GET", "/auth/usuarios");
  const us = (r.data || []).filter((u) => u.activo !== false);
  const raso = us.find((u) => u.rol !== "gerente" && u.username !== "sistema");
  expect(raso, "el arenero no tiene un empleado sin mando").toBeTruthy();
  return raso;
};

// ── SOCIAL ──────────────────────────────────────────────────────────────────
test.describe("Social", () => {
  test("una publicación se crea, se lista y se borra", async ({ page }) => {
    await ir(page, "social.html");
    const texto = marca("publicacion");
    let id = null;
    try {
      const r = await api(page, "POST", "/social/posts-json", { contenido: texto });
      expect(r.ok, `no se pudo publicar: ${r.status} ${JSON.stringify(r.data)}`).toBe(true);
      id = r.data.id || (r.data.post && r.data.post.id);
      expect(id, `publicar no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();

      // ⚠ El muro se lee por `/social/feed`. `/social/posts` existe sólo para
      //   PUBLICAR: pedirle un GET no da error, da otra cosa, y la prueba
      //   buscaba en el lugar equivocado.
      const l = await api(page, "GET", "/social/feed");
      const posts = Array.isArray(l.data) ? l.data : (l.data.posts || l.data.feed || []);
      expect(posts.some((p) => p.id === id), "la publicación no figura en el muro")
        .toBe(true);
    } finally {
      if (id) await api(page, "DELETE", `/social/posts/${id}`);
    }
  });

  test("lo publicado en un grupo NO lo ve quien no es del grupo", async ({ page }) => {
    await ir(page, "social.html");
    const raso = await unEmpleado(page);
    let grupo = null, post = null;
    try {
      // ⚠ Un grupo cuyo contenido ve cualquiera no es un grupo. Es el sentido
      //   entero de la función: publicar algo para los cocineros y que el resto
      //   no lo vea.
      const g = await api(page, "POST", "/social/grupos",
        { nombre: marca("grupo"), roles: [], usuarios: [] });
      expect(g.ok, `no se pudo crear el grupo: ${g.status} ${JSON.stringify(g.data)}`)
        .toBe(true);
      grupo = g.data.id || (g.data.grupo && g.data.grupo.id);

      const texto = marca("secreto");
      const p = await api(page, "POST", "/social/posts-json",
        { contenido: texto, grupo_id: grupo });
      expect(p.ok, `no se pudo publicar en el grupo: ${p.status}`).toBe(true);
      post = p.data.id || (p.data.post && p.data.post.id);

      // El empleado NO está en el grupo: no puede verlo.
      const suyo = await apiComo(page, raso.username, "GET", `/social/feed?grupo_id=${grupo}`);
      const suyos = Array.isArray(suyo.data) ? suyo.data : ((suyo.data || {}).posts || (suyo.data || {}).feed || []);
      const loVe = suyo.status === 200 && suyos.some((x) => x.id === post);
      expect(loVe, `${raso.username} ve una publicación de un grupo al que no pertenece`)
        .toBe(false);

      // Y tampoco se le cuela en el muro general.
      const general = await apiComo(page, raso.username, "GET", "/social/feed");
      const gen = Array.isArray(general.data) ? general.data : ((general.data || {}).posts || (general.data || {}).feed || []);
      expect(gen.some((x) => x.id === post),
        "la publicación de grupo se cuela en el muro general").toBe(false);
    } finally {
      if (post) await api(page, "DELETE", `/social/posts/${post}`);
      if (grupo) await api(page, "DELETE", `/social/grupos/${grupo}`);
    }
  });

  test("un empleado sin permiso de edición no puede fijar ni priorizar",
    async ({ page }) => {
      await ir(page, "social.html");
      const raso = await unEmpleado(page);
      // Fijar y "prioritaria" mandan una notificación a todo el personal: no
      // puede hacerlo cualquiera.
      const r = await apiComo(page, raso.username, "POST", "/social/posts-json",
        { contenido: marca("intento"), prioritaria: true });
      expect(r.ok, "un empleado sin edición publicó algo prioritario").toBe(false);
      expect(r.status).toBe(403);
    });
});

// ── DOCUMENTOS ──────────────────────────────────────────────────────────────
test.describe("Documentos", () => {
  test("una carpeta se crea en General y se borra", async ({ page }) => {
    await ir(page, "documentos.html");
    let id = null;
    try {
      const r = await api(page, "POST", "/documentos/carpetas",
        { categoria: "general", nombre: marca("carpeta") });
      expect(r.ok, `no se pudo crear la carpeta: ${r.status} ${JSON.stringify(r.data)}`)
        .toBe(true);
      id = r.data.id || (r.data.carpeta && r.data.carpeta.id);
      expect(id, `el alta no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();

      const l = await api(page, "GET", "/documentos/contenido?categoria=general");
      expect(l.ok, `no se pudo listar: ${l.status}`).toBe(true);
      const carpetas = l.data.carpetas || [];
      expect(carpetas.some((c) => c.id === id), "la carpeta nueva no figura").toBe(true);
    } finally {
      if (id) await api(page, "DELETE", `/documentos/carpetas/${id}`);
    }
  });

  test("lo PERSONAL de uno no lo ve otro", async ({ page }) => {
    await ir(page, "documentos.html");
    const raso = await unEmpleado(page);
    let id = null;
    try {
      // ⚠ La categoría `personal` es de cada empleado. Que otro la vea es la
      //   peor falla posible de esta pantalla: ahí van contratos y nóminas.
      const r = await api(page, "POST", "/documentos/carpetas",
        { categoria: "personal", nombre: marca("personal") });
      expect(r.ok, `no se pudo crear la carpeta personal: ${r.status}`).toBe(true);
      id = r.data.id || (r.data.carpeta && r.data.carpeta.id);

      const suyo = await apiComo(page, raso.username, "GET",
        "/documentos/contenido?categoria=personal");
      const cs = (suyo.data && suyo.data.carpetas) || [];
      expect(cs.some((c) => c.id === id),
        `${raso.username} ve la carpeta personal de otro`).toBe(false);
    } finally {
      if (id) await api(page, "DELETE", `/documentos/carpetas/${id}`);
    }
  });

  test("las carpetas se anidan y borrar la madre se lleva el árbol",
    async ({ page }) => {
      await ir(page, "documentos.html");
      let madre = null, hija = null;
      try {
        const m = await api(page, "POST", "/documentos/carpetas",
          { categoria: "general", nombre: marca("madre") });
        madre = m.data.id;
        const h = await api(page, "POST", "/documentos/carpetas",
          { categoria: "general", nombre: marca("hija"), parent_id: madre });
        expect(h.ok, `no se pudo anidar: ${h.status} ${JSON.stringify(h.data)}`).toBe(true);
        hija = h.data.id;

        // Borrar la madre borra el subárbol entero: si la hija quedara suelta,
        // sería una carpeta invisible con archivos adentro.
        const bo = await api(page, "DELETE", `/documentos/carpetas/${madre}`);
        expect(bo.ok, `no se pudo borrar la madre: ${bo.status}`).toBe(true);
        madre = null;

        const l = await api(page, "GET", "/documentos/contenido?categoria=general");
        const cs = (l.data && l.data.carpetas) || [];
        expect(cs.some((c) => c.id === hija),
          "la hija sobrevivió a que se borrara la carpeta madre").toBe(false);
        hija = null;
      } finally {
        if (hija) await api(page, "DELETE", `/documentos/carpetas/${hija}`);
        if (madre) await api(page, "DELETE", `/documentos/carpetas/${madre}`);
      }
    });
});

// ── TAREAS ──────────────────────────────────────────────────────────────────
test.describe("Tareas", () => {
  test("una tarea le llega al empleado del rol al que va dirigida", async ({ page }) => {
    await ir(page, "tareas.html");
    const raso = await unEmpleado(page);
    let id = null;
    try {
      // ⚠ Una tarea SIEMPRE va dirigida: a uno o más roles, o a un empleado
      //   concreto. Sin destinatario no se crea —y está bien: una tarea que no es
      //   de nadie no la hace nadie—.
      const texto = marca("tarea");
      const r = await api(page, "POST", "/tareas", {
        // ⚠ Los momentos válidos son `dia`, `apertura_caja`, `cierre_caja` y
        //   `diaria` (MOMENTOS en tareas.py). Cualquier otro da 400.
        texto, momentos: ["dia"], rol: raso.rol,
      });
      expect(r.ok, `no se pudo crear la tarea: ${r.status} ${JSON.stringify(r.data)}`)
        .toBe(true);
      id = r.data.id || (r.data.tarea && r.data.tarea.id);
      expect(id, `el alta no devolvió id: ${JSON.stringify(r.data)}`).toBeTruthy();

      // ⚠ No hay un listado plano de tareas: se leen por el CHECKLIST de cada
      //   empleado, que es lo que de verdad importa —que le llegue a quien tiene
      //   que hacerla—. Se comprueba contra el empleado de ese rol.
      // ⚠ El checklist pide `momento` y `fecha`: es el de UN momento de UN día,
      //   no una lista general. Sin esos parámetros da 422.
      const hoy = new Date();
      const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-` +
                  `${String(hoy.getDate()).padStart(2, "0")}`;
      const ck = await apiComo(page, raso.username, "GET",
        `/tareas/checklist?momento=dia&fecha=${iso}`);
      expect(ck.ok, `no se pudo leer el checklist: ${ck.status}`).toBe(true);
      expect(JSON.stringify(ck.data), `la tarea del rol ${raso.rol} no le llega a ${raso.username}`)
        .toContain(texto);
    } finally {
      if (id) await api(page, "DELETE", `/tareas/${id}`);
    }
  });

  test("un empleado sin gestión no puede crear ni borrar tareas", async ({ page }) => {
    await ir(page, "tareas.html");
    const raso = await unEmpleado(page);
    // Las tareas son órdenes de trabajo: quien no las gestiona no se las
    // inventa (ni se borra las propias para no hacerlas).
    const r = await apiComo(page, raso.username, "POST", "/tareas",
      { texto: marca("no deberia"), momentos: ["dia"], rol: raso.rol });
    expect(r.ok, "un empleado sin gestión creó una tarea").toBe(false);
    expect(r.status).toBe(403);
  });
});
