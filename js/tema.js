/* ══════════════════════════════════════════════════════════════════════════
   TEMA — resolución, persistencia y selector
   ══════════════════════════════════════════════════════════════════════════

   Es una preferencia DE LA PERSONA, no del restaurante: dos gerentes del mismo
   local pueden querer temas distintos y cada uno tiene que encontrar el suyo al
   entrar, aunque compartan la computadora de trastienda.

   ⚠ NO depende de api.js. El orden de los <script> varía por página y en 22 de
     24 sidebar.js carga PRIMERO (ver el comentario de sidebar.js:356-361). Por
     eso acá se usa `fetch` crudo y un parseo propio del JWT.

   ⚠ localStorage es la fuente de verdad para PINTAR; el servidor sólo
     sincroniza entre dispositivos. Si se esperara la respuesta del servidor,
     cada carga arrancaría en claro y saltaría al tema real medio segundo
     después — y en una app multipágina eso pasa en cada clic.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    if (window.Tema) return;

    var VALIDOS = ["claro", "oscuro", "auto"];
    var K_ULTIMO = "tema_ultimo";     // sin ámbito: lo usa el login, que aún no sabe quién sos

    // El selector ya se muestra: las páginas están tokenizadas y hay valores
    // oscuros. Queda como interruptor por si hiciera falta apagarlo sin revertir.
    var UI_LISTA = true;

    // ── Identidad ────────────────────────────────────────────────────────
    // La preferencia se guarda por `sub` del JWT y NO por esquema: así un
    // gerente de cadena que entra al local A y al B mantiene UN solo tema.
    function _sub() {
        try {
            var t = localStorage.getItem("token");
            if (!t) return "@anon";
            var p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            // El superadmin y su "entrar como admin" son la misma persona y
            // comparten preferencia.
            // ⚠ NO se puede detectar el override por `rol === "admin"`: "admin"
            // es TAMBIÉN un rol normal de restaurante, así que eso le robaría la
            // preferencia a cualquier admin de local. El claim `admin_override`
            // es lo único que los distingue.
            if (p.admin_override) return "@super";
            if (p.rol === "superadmin") return "@super";
            return p.sub || "@anon";
        } catch (e) { return "@anon"; }
    }

    function _clave() { return "tema::" + _sub(); }

    // ── Leer / resolver ──────────────────────────────────────────────────
    function get() {
        try {
            var v = localStorage.getItem(_clave()) || localStorage.getItem(K_ULTIMO);
            return VALIDOS.indexOf(v) >= 0 ? v : "auto";
        } catch (e) { return "auto"; }
    }

    function _navegadorOscuro() {
        try { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
        catch (e) { return false; }
    }

    // La preferencia GUARDADA ('auto') y el valor APLICADO ('claro'/'oscuro')
    // son cosas distintas: `data-tema` siempre lleva un valor concreto, para que
    // el CSS no tenga que razonar sobre media queries.
    function resolver(pref) {
        var p = pref || get();
        return p === "auto" ? (_navegadorOscuro() ? "oscuro" : "claro") : p;
    }

    function getAplicado() {
        return document.documentElement.dataset.tema || resolver();
    }

    // ── Aplicar ──────────────────────────────────────────────────────────
    function aplicar(pref) {
        var v = resolver(pref);
        document.documentElement.dataset.tema = v;
        // La barra del navegador en móvil acompaña.
        var m = document.querySelector('meta[name="theme-color"]');
        if (!m) {
            m = document.createElement("meta");
            m.name = "theme-color";
            document.head.appendChild(m);
        }
        m.content = v === "oscuro" ? "#14151f" : "#1a1a2e";
        // De acá se enganchan el canvas de reservas y Chart.js, que no heredan CSS.
        try {
            document.dispatchEvent(new CustomEvent("temacambiado", { detail: { tema: v } }));
        } catch (e) { /* navegador viejo: el CSS ya se aplicó igual */ }
        return v;
    }

    // ── Guardar ──────────────────────────────────────────────────────────
    function set(pref, sincronizar) {
        if (VALIDOS.indexOf(pref) < 0) return;
        try {
            localStorage.setItem(_clave(), pref);
            localStorage.setItem(K_ULTIMO, pref);
        } catch (e) { /* modo privado: al menos se aplica en esta pestaña */ }
        aplicar(pref);
        if (sincronizar !== false) _guardarServidor(pref);
    }

    // ── Servidor (sincroniza entre dispositivos; nunca bloquea el pintado) ──
    var API = (typeof API_URL === "string" && API_URL) ||
              "https://restaurante-backend-production-459b.up.railway.app";

    function _cab() {
        var t = localStorage.getItem("token");
        if (!t) return null;
        var h = { "Authorization": "Bearer " + t, "Content-Type": "application/json" };
        return h;
    }

    var _puedeGuardarServidor = null;   // null = todavía no se sabe

    function _guardarServidor(pref) {
        var h = _cab();
        if (!h) return;
        fetch(API + "/prefs/tema", { method: "PUT", headers: h, body: JSON.stringify({ tema: pref }) })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { if (d) _puedeGuardarServidor = !!d.guardado; })
            .catch(function () { /* sin red: el valor local ya quedó guardado */ });
    }

    // Al cargar: se adopta el valor del servidor SÓLO si acá todavía no hay uno.
    // Asimétrico a propósito — si ya elegiste algo en este navegador, gana lo
    // local. Cambiar el tema en la laptop no se propaga a la tablet hasta que
    // ésta no tenga valor propio; a cambio NUNCA se revierte solo, que es el
    // fallo que la gente percibe como "no me lo guarda".
    function _leerServidor() {
        var h = _cab();
        if (!h) return;
        var hayLocal = false;
        try { hayLocal = !!localStorage.getItem(_clave()); } catch (e) {}
        fetch(API + "/prefs/tema", { headers: h })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d) return;
                _puedeGuardarServidor = !!d.guardado;
                if (!hayLocal && VALIDOS.indexOf(d.tema) >= 0) {
                    try {
                        localStorage.setItem(_clave(), d.tema);
                        localStorage.setItem(K_ULTIMO, d.tema);
                    } catch (e) {}
                    aplicar(d.tema);
                }
            })
            .catch(function () {});
    }

    // ── Arranque ─────────────────────────────────────────────────────────
    aplicar();

    // "Modo navegador" en vivo: si el sistema cambia de claro a oscuro por la
    // hora del día, la web acompaña. Sólo cuando la preferencia es 'auto'.
    try {
        var mq = window.matchMedia("(prefers-color-scheme: dark)");
        var alCambiar = function () { if (get() === "auto") aplicar("auto"); };
        if (mq.addEventListener) mq.addEventListener("change", alCambiar);
        else if (mq.addListener) mq.addListener(alCambiar);
    } catch (e) {}

    // Cambio en otra pestaña → se refleja en todas.
    window.addEventListener("storage", function (e) {
        if (e.key === _clave() || e.key === K_ULTIMO) aplicar();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Modal
    // ═══════════════════════════════════════════════════════════════════════
    var OPCIONES = [
        ["claro",  "Claro",  "Fondo claro siempre."],
        ["oscuro", "Oscuro", "Fondo oscuro siempre."],
        ["auto",   "Seguir el navegador", "Cambia solo según la configuración de tu sistema."]
    ];

    function _css() {
        if (document.getElementById("tema-css")) return;
        var s = document.createElement("style");
        s.id = "tema-css";
        // ⚠ z-index 5000: por encima del panel (260) y del navbar (300), y por
        // DEBAJO del aviso legal (5200), que es bloqueante y debe seguir arriba.
        s.textContent = [
            "#tema-ov{position:fixed;inset:0;z-index:5000;background:var(--scrim,rgba(0,0,0,.35));",
            "  display:flex;align-items:center;justify-content:center;padding:20px;}",
            "#tema-card{background:var(--sup,#fff);color:var(--tx,#1a1a2e);border-radius:14px;",
            "  width:min(420px,94vw);padding:22px 24px;box-shadow:var(--sh-3,0 18px 60px rgba(0,0,0,.35));",
            "  font-family:'Segoe UI',sans-serif;}",
            "#tema-card h3{font-size:17px;margin:0 0 4px;color:var(--tx,#1a1a2e);}",
            "#tema-card .sub{font-size:12.5px;color:var(--tx-3,#9ca3af);margin-bottom:16px;}",
            ".tema-op{display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:11px 14px;",
            "  border:2px solid var(--bd,#e5e7eb);border-radius:10px;margin-bottom:9px;",
            "  transition:border-color .15s;}",
            ".tema-op:hover{border-color:var(--bd-2,#d1d5db);}",
            ".tema-op input{margin-top:2px;accent-color:var(--ac,#4f46e5);flex:none;}",
            ".tema-op input:checked ~ .tema-txt .tema-t{color:var(--tx-acc,#4f46e5);}",
            ".tema-op.sel{border-color:var(--ac,#4f46e5);}",
            // ⚠ .tema-txt tiene que ser un bloque: son tres <span> y en flujo
            // en linea el titulo y la descripcion salen PEGADOS ("ClaroFondo
            // claro siempre.") porque margin-top no aplica a un inline.
            ".tema-txt{display:flex;flex-direction:column;gap:3px;min-width:0;}",
            ".tema-t{font-size:13.5px;font-weight:700;color:var(--tx,#1a1a2e);}",
            ".tema-d{font-size:11.5px;color:var(--tx-3,#9ca3af);line-height:1.45;}",
            "#tema-nota{font-size:11.5px;color:var(--tx-3,#9ca3af);margin-top:12px;display:none;}",
            "#tema-pie{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;}",
            "#tema-pie button{padding:9px 18px;border-radius:8px;cursor:pointer;font-size:13px;",
            "  font-weight:600;border:none;font-family:inherit;}",
            "#tema-cancel{background:var(--sup,#fff);color:var(--tx-2,#444);",
            "  border:1.5px solid var(--bd,#e0e0e0)!important;}",
            "#tema-ok{background:var(--ac,#4f46e5);color:var(--on-ac,#fff);}",
            "#tema-ok:hover{background:var(--ac-h,#4338ca);}",
            "#tema-ov :focus-visible{outline:2px solid var(--ac,#4f46e5);outline-offset:2px;}",
            /* El botón del pie del sidebar. El panel es flex-column con el <nav>
               en flex:1, así que este pie queda abajo del todo solo. */
            ".sidebar-pie{display:flex;justify-content:flex-end;padding:10px 14px 16px;",
            "  border-top:1px solid rgba(255,255,255,.08);flex-shrink:0;}",
            ".sidebar-pie button{background:transparent;border:none;cursor:pointer;font-size:17px;",
            "  line-height:1;padding:6px 8px;border-radius:8px;opacity:.75;}",
            ".sidebar-pie button:hover{background:var(--nav-hov,rgba(99,102,241,.18));opacity:1;}",
            /* Botón de repuesto para las páginas SIN sidebar (superadmin, cadena,
               cocina): sin esto, tres de los seis tipos de cuenta no tendrían
               forma de cambiar el tema. */
            ".tema-btn-nav{background:transparent;border:none;cursor:pointer;font-size:16px;",
            "  padding:6px 8px;border-radius:8px;opacity:.8;color:inherit;}",
            ".tema-btn-nav:hover{opacity:1;background:rgba(255,255,255,.12);}"
        ].join("\n");
        document.head.appendChild(s);
    }

    var _ov = null, _previo = null, _escOyente = null;

    function _marcar(sel) {
        var ops = _ov.querySelectorAll(".tema-op");
        for (var i = 0; i < ops.length; i++) {
            ops[i].classList.toggle("sel", ops[i].dataset.val === sel);
        }
    }

    function cerrar(revertir) {
        if (!_ov) return;
        if (revertir && _previo !== null) aplicar(_previo);
        if (_escOyente) document.removeEventListener("keydown", _escOyente, true);
        _escOyente = null;
        document.body.style.overflow = _ov.dataset.ovPrev || "";
        _ov.remove();
        _ov = null;
        _previo = null;
    }

    function abrirModal() {
        if (_ov) return;
        _css();
        _previo = get();
        var sel = _previo;

        _ov = document.createElement("div");
        _ov.id = "tema-ov";
        _ov.dataset.ovPrev = document.body.style.overflow || "";

        var ops = OPCIONES.map(function (o) {
            return '<label class="tema-op' + (o[0] === sel ? ' sel' : '') + '" data-val="' + o[0] + '">' +
                   '<input type="radio" name="tema-op" value="' + o[0] + '"' +
                   (o[0] === sel ? ' checked' : '') + '>' +
                   '<span class="tema-txt"><span class="tema-t">' + o[1] + '</span>' +
                   '<span class="tema-d">' + o[2] + '</span></span></label>';
        }).join("");

        _ov.innerHTML =
            '<div id="tema-card" role="dialog" aria-modal="true" aria-label="Apariencia">' +
            '<h3>Apariencia</h3>' +
            '<div class="sub">Es tu preferencia: no cambia la de tus compañeros.</div>' +
            ops +
            '<div id="tema-nota">Esta preferencia se guarda sólo en este navegador.</div>' +
            '<div id="tema-pie">' +
            '<button id="tema-cancel" type="button">Cancelar</button>' +
            '<button id="tema-ok" type="button">Guardar cambios</button>' +
            '</div></div>';

        document.body.appendChild(_ov);
        document.body.style.overflow = "hidden";

        // Vista previa en vivo: elegir aplica al instante detrás del modal. Es la
        // única semántica sensata para un selector de apariencia con Guardar.
        _ov.addEventListener("change", function (e) {
            if (e.target && e.target.name === "tema-op") {
                sel = e.target.value;
                _marcar(sel);
                aplicar(sel);
            }
        });

        _ov.querySelector("#tema-cancel").onclick = function () { cerrar(true); };
        _ov.querySelector("#tema-ok").onclick = function () {
            set(sel);
            cerrar(false);
        };
        // Clic en el velo = Cancelar.
        _ov.addEventListener("mousedown", function (e) { if (e.target === _ov) cerrar(true); });

        // ⚠ sidebar.js:596 escucha Escape a nivel document SIN condición y
        // cerraría el menú por detrás. Registrando en fase de CAPTURA corremos
        // antes que ese handler y le cortamos la propagación, sin tocarlo.
        _escOyente = function (e) {
            if (e.key === "Escape") { e.stopPropagation(); cerrar(true); }
        };
        document.addEventListener("keydown", _escOyente, true);

        if (_puedeGuardarServidor === false) {
            _ov.querySelector("#tema-nota").style.display = "block";
        }
        var marcado = _ov.querySelector('input[value="' + sel + '"]');
        if (marcado) marcado.focus();
    }

    // ── El botón ─────────────────────────────────────────────────────────
    // Lo monta tema.js y no sidebar.js: el panel se construye al cargar el
    // módulo, ANTES de que este archivo exista, así que sidebar.js no podría
    // consultar si la interfaz está lista. Así la propiedad queda de un lado
    // solo: tema.js es dueño del botón y del modal.
    //
    // ⚠ Dos ubicaciones, y la segunda no es un lujo: restaurantes.html,
    // cadena.html, cadena-personal.html y cocina.html NO cargan sidebar.js — y
    // ahí viven el superadmin y el gerente de cadena. Sin el repuesto en la
    // barra, tres de los seis tipos de cuenta nunca podrían cambiar el tema.
    function _boton() {
        if (!UI_LISTA) return;
        if (document.getElementById("tema-btn")) return;

        var b = document.createElement("button");
        b.id = "tema-btn";
        b.type = "button";
        b.title = "Apariencia";
        b.setAttribute("aria-label", "Apariencia");
        b.textContent = "◐";
        b.onclick = abrirModal;

        var panel = document.getElementById("sidebar-panel");
        if (panel) {
            // Tercer hijo del panel. Como #sidebar-panel es flex-column y
            // .sidebar-nav es flex:1, queda abajo del todo sin tocar el layout;
            // con justify-content:flex-end, abajo a la DERECHA.
            var pie = document.createElement("div");
            pie.className = "sidebar-pie";
            pie.appendChild(b);
            panel.appendChild(pie);
            return;
        }
        var cont = document.querySelector(".navbar-user") ||
                   document.querySelector(".navbar-links") ||
                   document.querySelector("nav.navbar");
        if (!cont) return;
        b.className = "tema-btn-nav";
        cont.appendChild(b);
    }

    function _init() {
        _css();
        _boton();
        _leerServidor();
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _init);
    } else { _init(); }

    window.Tema = {
        get: get,
        getAplicado: getAplicado,
        resolver: resolver,
        set: set,
        aplicar: aplicar,
        abrirModal: abrirModal,
        // sidebar.js consulta esto antes de dibujar el botón del pie del menú.
        uiLista: UI_LISTA
    };
})();
