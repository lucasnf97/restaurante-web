/* ══════════════════════════════════════════════════════════════════════════
   IDIOMA de la web de gestión (es / en / da) — etapa 1 (2026-10-19)
   ══════════════════════════════════════════════════════════════════════════

   La CLAVE es el texto en castellano: lo que todavía no está traducido sigue
   saliendo en castellano en vez de mostrar una clave rota. Se traduce por tandas
   (etapa 1: menú, barra, login y panel principal); para sumar una pantalla, se
   marca su HTML con `data-i18n` (o `data-i18n-ph` / `data-i18n-title`) y lo que
   arma por JS se envuelve en `_t("texto")`, y se agregan las frases acá abajo.

   Es una preferencia DE LA PERSONA (como el tema): `idioma::<sub>` en
   localStorage y `/prefs/idioma` en el servidor para que la siga a otro
   navegador. Cambiar de idioma RECARGA la página: lo que las pantallas arman por
   JS se vuelve a armar ya traducido, sin tener que re-pintar nada a mano.

   ⚠ Se carga con <script> ANTES de sidebar.js / api.js (el menú se arma ni bien
     carga sidebar.js y tiene que salir traducido). No depende de ninguno.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    if (window.I18N) return;
    var IDIOMAS = ["es", "en", "da"];
    var API = "https://restaurante-backend-production-459b.up.railway.app";

    // ── Diccionario: castellano → [inglés, danés] ──
    var D = {
        // Menú y barra
        "Panel principal": ["Dashboard", "Oversigt"],
        "Restaurante": ["Restaurant", "Restaurant"],
        "Reservas": ["Bookings", "Bookinger"],
        "Productos": ["Products", "Produkter"],
        "Herramienta de Edición": ["Floor editor", "Redigeringsværktøj"],
        "Stock": ["Stock", "Lager"],
        "Clientes": ["Customers", "Kunder"],
        "Facturas": ["Invoices", "Fakturaer"],
        "Caja": ["Till", "Kasse"],
        "Online": ["Online", "Online"],
        "Take Away": ["Takeaway", "Takeaway"],
        "Personal": ["Staff", "Personale"],
        "Fichajes": ["Clock-ins", "Stempling"],
        "Tareas": ["Tasks", "Opgaver"],
        "Usuarios": ["Users", "Brugere"],
        "Horarios": ["Schedules", "Vagtplaner"],
        "Salarios": ["Payroll", "Løn"],
        "Facturación y Estadísticas": ["Revenue & statistics", "Omsætning og statistik"],
        "Facturación y Est.": ["Revenue & stats", "Omsætning og stat."],
        "Resumen": ["Summary", "Oversigt"],
        "Análisis de mes": ["Monthly analysis", "Månedsanalyse"],
        "Históricos": ["History", "Historik"],
        "Est. de Ventas": ["Sales stats", "Salgsstatistik"],
        "Est. de Personal": ["Staff stats", "Personalestatistik"],
        "Importar": ["Import", "Importér"],
        "Social": ["Social", "Social"],
        "Mensajes": ["Messages", "Beskeder"],
        "Documentos": ["Documents", "Dokumenter"],
        "Configuración de usuario": ["User settings", "Brugerindstillinger"],
        "Configuración de sistema": ["System settings", "Systemindstillinger"],
        "Menú": ["Menu", "Menu"],
        "Ir al dashboard": ["Go to dashboard", "Gå til oversigten"],
        "Cambiar de restaurante": ["Switch restaurant", "Skift restaurant"],
        "Cerrar sesión": ["Log out", "Log ud"],
        "⚙️ Personalizar": ["⚙️ Customise", "⚙️ Tilpas"],
        "Idioma": ["Language", "Sprog"],
        // Login
        "Panel de gerencia": ["Management panel", "Ledelsespanel"],
        "Email o usuario": ["Email or username", "E-mail eller brugernavn"],
        "tu@email.com o tu usuario": ["you@email.com or your username", "dig@email.dk eller dit brugernavn"],
        "N° de restaurante / cadena": ["Restaurant / chain no.", "Restaurant-/kædenr."],
        "Código": ["Code", "Kode"],
        "Usuario": ["Username", "Brugernavn"],
        "Tu usuario": ["Your username", "Dit brugernavn"],
        "Contraseña": ["Password", "Adgangskode"],
        "Tu contraseña": ["Your password", "Din adgangskode"],
        "Ingresar": ["Log in", "Log ind"],
        "Ingresando...": ["Logging in...", "Logger ind..."],
        "Ingresar con código (gerente / administración)": ["Log in with code (manager / admin)", "Log ind med kode (leder / administration)"],
        "Soy empleado — ingresar con email o usuario": ["I'm an employee — log in with email or username", "Jeg er medarbejder — log ind med e-mail eller brugernavn"],
        "¿Olvidaste tu contraseña?": ["Forgot your password?", "Glemt din adgangskode?"],
        "Términos y Condiciones": ["Terms and Conditions", "Vilkår og betingelser"],
        "Privacidad y Protección de Datos": ["Privacy and Data Protection", "Privatliv og databeskyttelse"],
        "Recuperar contraseña": ["Reset password", "Nulstil adgangskode"],
        "Ingresá tu <b>correo</b>. Si tiene una cuenta con email cargado, te mandamos un enlace para elegir una nueva contraseña. Si no tenés correo, pedile al encargado que te la cambie.":
            ["Enter your <b>email</b>. If it belongs to an account, we'll send you a link to choose a new password. If you don't have an email, ask your manager to change it.",
             "Skriv din <b>e-mail</b>. Hvis den hører til en konto, sender vi et link til at vælge en ny adgangskode. Har du ingen e-mail, så bed din leder om at ændre den."],
        "Cerrar": ["Close", "Luk"],
        "Enviar enlace": ["Send link", "Send link"],
        "Enviando…": ["Sending…", "Sender…"],
        "Ingresá un correo válido.": ["Enter a valid email.", "Skriv en gyldig e-mail."],
        "Si el correo corresponde a una cuenta, te enviamos un enlace.": ["If the email belongs to an account, we've sent you a link.", "Hvis e-mailen hører til en konto, har vi sendt dig et link."],
        "No se pudo enviar. Probá de nuevo.": ["Couldn't send it. Please try again.", "Kunne ikke sende. Prøv igen."],
        "Completá usuario y contraseña.": ["Enter your username and password.", "Udfyld brugernavn og adgangskode."],
        "Completá tu email o usuario y la contraseña.": ["Enter your email or username and the password.", "Udfyld e-mail eller brugernavn og adgangskoden."],
        // Panel principal
        "Bienvenido": ["Welcome", "Velkommen"],
        "Panel de administración y gerencia": ["Administration and management panel", "Administrations- og ledelsespanel"],
        "Salas y mesas": ["Rooms and tables", "Lokaler og borde"],
        "Distribución del local": ["Floor layout", "Indretning af stedet"],
        "Asignación de mesas": ["Table assignment", "Bordtildeling"],
        "Carta y productos": ["Menu and products", "Menu og produkter"],
        "Menú, precios y categorías": ["Menu, prices and categories", "Menu, priser og kategorier"],
        "Caja e historial": ["Till and history", "Kasse og historik"],
        "Abrí y cerrá caja": ["Open and close the till", "Åbn og luk kassen"],
        "Entrada y salida del personal": ["Staff clock-in and clock-out", "Personalets ind- og udstempling"],
        "Personal y roles de acceso": ["Staff and access roles", "Personale og adgangsroller"],
        "Control de insumos": ["Ingredient control", "Kontrol af råvarer"],
        "Carga con IA y proveedores": ["AI upload and suppliers", "AI-indlæsning og leverandører"],
        "Facturación": ["Revenue", "Omsætning"],
        "Costos, balance y gráficos": ["Costs, balance and charts", "Omkostninger, balance og grafer"],
        "Top productos y demanda": ["Top products and demand", "Topprodukter og efterspørgsel"],
        "Planificación del personal": ["Staff planning", "Personaleplanlægning"],
        "Resumen de facturación": ["Revenue summary", "Omsætningsoversigt"],
        "Reservas del día": ["Today's bookings", "Dagens bookinger"],
        "Reservas de hoy": ["Today's bookings", "Dagens bookinger"],
        "Accesos rápidos": ["Shortcuts", "Genveje"],
        "Mis horarios de la semana": ["My schedule this week", "Min vagtplan denne uge"],
        "Últimos mensajes": ["Latest messages", "Seneste beskeder"],
        "Estado del stock": ["Stock status", "Lagerstatus"],
        "Vista Online": ["Online view", "Onlinevisning"],
        "Personal en turno": ["Staff on shift", "Personale på vagt"],
        "Tendencia de ventas": ["Sales trend", "Salgsudvikling"],
        "últimos {n} días": ["last {n} days", "sidste {n} dage"],
        "Social (publicaciones)": ["Social (posts)", "Social (opslag)"],
        "Muro": ["Wall", "Væg"],
        "Total hoy": ["Total today", "I alt i dag"],
        "Total semana en curso": ["Total this week", "I alt denne uge"],
        "Total mes en curso": ["Total this month", "I alt denne måned"],
        "Total año en curso": ["Total this year", "I alt i år"],
    };

    // ── Quién sos (misma lógica que js/tema.js `_sub`) ──
    function _sub() {
        try {
            var t = localStorage.getItem("token");
            if (!t) return "@anon";
            var p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (p.admin_override || p.rol === "superadmin") return "@super";
            return p.sub || "@anon";
        } catch (e) { return "@anon"; }
    }
    function _clave() { return "idioma::" + _sub(); }
    function idioma() {
        try {
            var v = localStorage.getItem(_clave()) || localStorage.getItem("idioma_ultimo");
            return IDIOMAS.indexOf(v) >= 0 ? v : "es";
        } catch (e) { return "es"; }
    }
    var LANG = idioma();

    function t(es, vars) {
        var s = es;
        if (LANG !== "es" && D[es]) s = D[es][LANG === "en" ? 0 : 1] || es;
        if (vars) for (var k in vars) s = s.split("{" + k + "}").join(vars[k]);
        return s;
    }

    // Marca en el HTML: data-i18n (texto; vacío = el texto propio del elemento),
    // data-i18n-html (permite <b>), data-i18n-ph (placeholder), data-i18n-title.
    function aplicar(raiz) {
        raiz = raiz || document;
        if (LANG === "es" || !raiz.querySelectorAll) return;
        // "Cerrar sesión" está en la barra de cada página: se traduce sin marcar 35 archivos.
        raiz.querySelectorAll(".btn-logout:not([data-i18n])").forEach(function (el) {
            var es = el.textContent.trim();
            if (D[es]) el.textContent = t(es);
        });
        raiz.querySelectorAll("[data-i18n]").forEach(function (el) {
            var es = el.getAttribute("data-i18n") || el.textContent.trim();
            el.textContent = t(es);
        });
        raiz.querySelectorAll("[data-i18n-html]").forEach(function (el) {
            var es = el.getAttribute("data-i18n-html") || el.innerHTML.trim();
            el.innerHTML = t(es);
        });
        raiz.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
            el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph") || el.getAttribute("placeholder") || ""));
        });
        raiz.querySelectorAll("[data-i18n-title]").forEach(function (el) {
            el.setAttribute("title", t(el.getAttribute("data-i18n-title") || el.getAttribute("title") || ""));
        });
    }

    function set(lang) {
        if (IDIOMAS.indexOf(lang) < 0 || lang === LANG) return;
        try { localStorage.setItem(_clave(), lang); localStorage.setItem("idioma_ultimo", lang); } catch (e) {}
        var tok = null; try { tok = localStorage.getItem("token"); } catch (e) {}
        var recargar = function () { location.reload(); };
        if (!tok) return recargar();
        // El servidor es para que la preferencia te siga a otro navegador; si falla, igual cambia acá.
        fetch(API + "/prefs/idioma", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
            body: JSON.stringify({ idioma: lang }) }).catch(function () {}).then(recargar, recargar);
    }

    // Primera vez en este navegador: si el servidor ya tiene tu idioma, se usa.
    function _sincronizar() {
        var tok = null, local = null;
        try { tok = localStorage.getItem("token"); local = localStorage.getItem(_clave()); } catch (e) {}
        if (!tok || local) return;
        fetch(API + "/prefs/idioma", { headers: { Authorization: "Bearer " + tok } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (d && IDIOMAS.indexOf(d.idioma) >= 0) {
                    try { localStorage.setItem(_clave(), d.idioma); } catch (e) {}
                    if (d.idioma !== LANG) location.reload();
                }
            }).catch(function () {});
    }

    // ── Selector ES / EN / DA (los mismos botones que las páginas públicas) ──
    function _css() {
        if (document.getElementById("i18n-css")) return;
        var st = document.createElement("style");
        st.id = "i18n-css";
        st.textContent =
            ".idiomas{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--sup-2,#eef0f4);vertical-align:middle;}" +
            ".idiomas button{min-width:36px;min-height:30px;border:none;border-radius:999px;background:transparent;" +
            "color:var(--tx-3,#6b7280);font:inherit;font-size:12.5px;font-weight:800;cursor:pointer;letter-spacing:.3px;}" +
            ".idiomas button[aria-pressed=true]{background:#1B1B33;color:#C9FF1F;}" +
            "nav.navbar .idiomas{background:rgba(255,255,255,.12);margin-right:6px;}" +
            "nav.navbar .idiomas button{color:rgba(255,255,255,.75);}" +
            "nav.navbar .idiomas button[aria-pressed=true]{background:#C9FF1F;color:#1B1B33;}" +
            "@media (max-width:600px){.idiomas button{min-width:30px;font-size:11.5px;}}";
        document.head.appendChild(st);
    }
    function selector() {
        var g = document.createElement("div");
        g.className = "idiomas";
        g.setAttribute("role", "group");
        g.setAttribute("aria-label", t("Idioma"));
        IDIOMAS.forEach(function (c) {
            var b = document.createElement("button");
            b.type = "button";
            b.textContent = c.toUpperCase();
            b.setAttribute("aria-pressed", String(c === LANG));
            b.addEventListener("click", function () { set(c); });
            g.appendChild(b);
        });
        return g;
    }
    function _montar() {
        _css();
        if (document.querySelector(".idiomas")) return;
        var slot = document.getElementById("i18n-slot");
        // Cada página arma su barra a su manera: .navbar-user (panel) o .navbar-links (resto).
        var barra = document.querySelector("nav.navbar .navbar-user, nav.navbar .navbar-links");
        var nav = document.querySelector("nav.navbar");
        if (slot) slot.appendChild(selector());
        else if (barra) barra.insertBefore(selector(), barra.firstChild);
        else if (nav) nav.appendChild(selector());
    }

    document.documentElement.lang = LANG;
    window.I18N = { idioma: function () { return LANG; }, t: t, aplicar: aplicar, set: set, selector: selector, dic: D };
    window._t = t;
    aplicar(document);
    function _alCargar() { aplicar(document); _montar(); _sincronizar(); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _alCargar);
    else _alCargar();
})();
