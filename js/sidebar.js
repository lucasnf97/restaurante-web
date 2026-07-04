(function () {
    // ── PÁGINAS DEL SISTEMA ─────────────────────────────────────
    // perm: string o array de strings — basta con tener UNO para ver el ítem.
    // Sin perm → siempre visible para cualquier usuario autenticado.
    const PAGES = [
        { href: "dashboard.html", icon: "🏠", label: "Panel principal" },
        {
            group: true,
            key: "restaurante",
            icon: "🍽️",
            label: "Restaurante",
            children: [
                { href: "reservas.html",  icon: "📅", label: "Reservas",               mod: "reservas" },
                { href: "productos.html", icon: "🍽️", label: "Productos",              mod: "productos", perm: ["edicion_carta"] },
                { href: "importar-ventas.html", icon: "📥", label: "Importar ventas",  mod: "importar",  perm: ["edicion_carta","acceso_estadisticas"] },
                { href: "mesas.html",     icon: "🗺️", label: "Herramienta de Edición", mod: "mesas",    perm: "edicion_sala" },
                { href: "stock.html",     icon: "📦", label: "Stock",                  mod: "stock",     perm: ["gestion_stock","gestion_produccion","ver_stock"] },
                { href: "clientes.html",  icon: "🧑‍🤝‍🧑", label: "Clientes",             mod: "clientes",  perm: ["gestion_clientes","ver_clientes"] },
                { href: "facturas.html",  icon: "🧾", label: "Facturas",               mod: "facturas",  perm: ["acceso_facturacion","ver_facturas"] },
                { href: "caja.html",      icon: "💰", label: "Caja",                   mod: "caja",      perm: "gestion_caja" },
            ]
        },
        {
            group: true,
            key: "personal",
            icon: "👥",
            label: "Personal",
            mod: "personal",
            children: [
                { href: "fichajes.html",   icon: "🕐", label: "Fichajes" },
                { href: "usuarios.html",   icon: "👤", label: "Usuarios",  perm: ["acceso_usuarios","ver_usuarios"] },
                { href: "horarios.html",   icon: "📋", label: "Horarios" },
                { href: "salarios.html",   icon: "💼", label: "Salarios",  perm: "revision_salarios" },
            ]
        },
        {
            group: true,
            key: "estadisticas",
            href: "estadisticas.html",
            icon: "📊",
            label: "Facturación y Estadísticas",
            mod: "estadisticas",
            perm: "acceso_estadisticas",
            children: [
                { href: "estadisticas.html",         icon: "📊", label: "Resumen" },
                { href: "analisis-mes.html",          icon: "📅", label: "Análisis de mes" },
                { href: "historicos.html",            icon: "📈", label: "Históricos" },
                { href: "ventas-estadisticas.html",   icon: "🛒", label: "Est. de Ventas" },
            ]
        },
        { href: "social.html", icon: "📣", label: "Social" },
        { href: "mensajes.html", icon: "💬", label: "Mensajes" },
        { href: "documentos.html", icon: "📁", label: "Documentos" },
        { href: "configuracion-usuario.html", icon: "🙍", label: "Configuración de usuario" },
        { href: "configuracion.html", icon: "⚙️", label: "Configuración de sistema", perm: "acceso_configuracion" },
    ];

    const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";

    // ── Helpers de permisos ──────────────────────────────────────
    function _getUser() {
        try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
    }
    function _canSee(perm) {
        if (!perm) return true;   // sin restricción
        const u = _getUser();
        if (!u) return false;
        if (u.rol === "admin" || u.rol === "gerente") return true;
        const perms = Array.isArray(perm) ? perm : [perm];
        return perms.some(p => !!u[p]);
    }
    // Módulo habilitado en el restaurante (admin/gerente NO lo saltean: es del restaurante).
    function _canModulo(mod) {
        if (!mod) return true;            // ítem sin módulo → siempre
        const u = _getUser();
        const mods = u && u.modulos;
        if (!Array.isArray(mods)) return true;   // token viejo sin módulos → no restringir
        return mods.includes(mod);
    }

    // ── CSS ──────────────────────────────────────────────────────
    const style = document.createElement("style");
    style.textContent = `
        /* Subir navbar por encima del sidebar */
        nav.navbar {
            z-index: 300 !important;
        }
        /* Centrar el título en todas las páginas */
        .navbar-brand {
            position: absolute !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            pointer-events: none;
        }

        /* Left button group (hamburger + home) */
        #sidebar-left {
            display: flex;
            align-items: center;
            gap: 2px;
            flex-shrink: 0;
            position: relative;
            z-index: 2;
        }

        /* Home button */
        #sidebar-home {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px 8px;
            color: white;
            font-size: 18px;
            line-height: 1;
            text-decoration: none;
            display: flex;
            align-items: center;
            border-radius: 6px;
            transition: background 0.15s;
            flex-shrink: 0;
        }
        #sidebar-home:hover { background: rgba(255,255,255,0.12); }

        /* Hamburger button */
        #sidebar-toggle {
            background: none;
            border: none;
            cursor: pointer;
            padding: 6px 8px;
            margin-right: 10px;
            display: flex;
            flex-direction: column;
            gap: 5px;
            flex-shrink: 0;
            align-self: center;
        }
        #sidebar-toggle span {
            display: block;
            width: 22px;
            height: 2px;
            background: white;
            border-radius: 2px;
            transition: all 0.25s ease;
        }
        #sidebar-toggle.open span:nth-child(1) {
            transform: translateY(7px) rotate(45deg);
        }
        #sidebar-toggle.open span:nth-child(2) {
            opacity: 0;
        }
        #sidebar-toggle.open span:nth-child(3) {
            transform: translateY(-7px) rotate(-45deg);
        }

        /* Overlay */
        #sidebar-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.35);
            z-index: 250;
        }
        #sidebar-overlay.visible { display: block; }

        /* Sidebar panel */
        #sidebar-panel {
            position: fixed;
            top: 60px;
            left: 0;
            width: 240px;
            height: calc(100% - 60px);
            background: #1a1a2e;
            z-index: 260;
            transform: translateX(-100%);
            transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
            display: flex;
            flex-direction: column;
            box-shadow: 4px 0 24px rgba(0,0,0,0.25);
        }
        #sidebar-panel.open {
            transform: translateX(0);
        }

        /* Sidebar header */
        .sidebar-title {
            padding: 20px 20px 10px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1.2px;
            color: #6366f1;
        }

        /* Nav links */
        .sidebar-nav {
            flex: 1;
            overflow-y: auto;
            padding: 4px 10px 20px;
        }
        .sidebar-link {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 8px;
            color: #a5b4fc;
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            transition: background 0.15s, color 0.15s;
            margin-bottom: 2px;
        }
        .sidebar-link:hover {
            background: rgba(99,102,241,0.18);
            color: white;
        }
        .sidebar-link.active {
            background: #4f46e5;
            color: white;
        }
        .sidebar-link .si-icon {
            font-size: 18px;
            width: 24px;
            text-align: center;
            flex-shrink: 0;
        }

        /* Group head */
        .sidebar-group-head {
            display:flex; align-items:center; gap:12px;
            padding:10px 12px; border-radius:8px;
            color:#a5b4fc; font-size:14px; font-weight:500;
            cursor:pointer; margin-bottom:2px;
            transition:background .15s, color .15s; user-select:none;
        }
        .sidebar-group-head:hover { background:rgba(99,102,241,0.18); color:white; }
        .sidebar-group-head.active { background:#4f46e5; color:white; }
        .grp-arrow { font-size:13px; color:#a5b4fc; margin-left:auto; transition:transform .22s; flex-shrink:0; }
        .sidebar-group-head.active .grp-arrow { color:white; }
        .grp-arrow.open { transform:rotate(90deg); }

        /* Group children */
        .sidebar-children {
            display:none; padding-left:12px; margin-bottom:4px;
            border-left:2px solid rgba(99,102,241,.3); margin-left:18px;
        }
        .sidebar-children.open { display:block; }
        .sidebar-child {
            display:flex; align-items:center; gap:10px;
            padding:7px 10px; border-radius:6px;
            color:#c4b5fd; font-size:13px; font-weight:500;
            text-decoration:none; margin-bottom:1px;
            transition:background .15s, color .15s;
        }
        .sidebar-child:hover { background:rgba(99,102,241,0.15); color:white; }
        .sidebar-child.active { background:rgba(79,70,229,.5); color:white; }
        .sidebar-child .si-icon { font-size:14px; width:20px; text-align:center; flex-shrink:0; }

        /* ── Modo Edición: btn-config oculto por defecto ── */
        .btn-config { display: none !important; }
        html.edit-mode .btn-config { display: flex !important; }

        /* Badge de mensajes en el sidebar */
        #sidebar-mensajes-badge {
            background: #dc2626;
            color: white;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 800;
            min-width: 18px;
            height: 18px;
            padding: 0 5px;
            text-align: center;
            line-height: 18px;
        }
    `;
    document.head.appendChild(style);

    // Aplicar clase edit-mode según localStorage
    if (localStorage.getItem('edit_mode') === 'true') {
        document.documentElement.classList.add('edit-mode');
    }

    // ── Helpers para grupos ──────────────────────────────────────
    function groupKey(p) {
        return p.key || (p.href ? p.href.replace('.html', '') : p.label);
    }

    function isInGroup(p) {
        if (!p.group) return false;
        return (p.href && p.href === currentPage) || p.children.some(c => c.href === currentPage);
    }

    function renderNav() {
        return PAGES.map(p => {
            // Ítem simple
            if (!p.group) {
                if (!_canSee(p.perm) || !_canModulo(p.mod)) return "";
                // Ítem de Mensajes: incluir badge de no leídos
                const badgeHtml = p.href === "mensajes.html"
                    ? `<span id="sidebar-mensajes-badge" style="display:none;margin-left:auto;"></span>`
                    : "";
                return `
                <a href="${p.href}" class="sidebar-link${currentPage === p.href ? " active" : ""}">
                    <span class="si-icon">${p.icon}</span>
                    ${p.label}${badgeHtml}
                </a>`;
            }

            // Grupo: si el módulo del grupo está apagado, ocultar todo el grupo
            if (!_canModulo(p.mod)) return "";
            // Filtrar hijos por permiso y por módulo propio del hijo
            const visibleChildren = p.children.filter(c => _canSee(c.perm) && _canModulo(c.mod));

            // Si el grupo tiene perm propio, verificarlo; si no, mostrar solo si hay hijos visibles
            if (p.perm && !_canSee(p.perm)) return "";
            if (!p.perm && visibleChildren.length === 0) return "";

            const key        = groupKey(p);
            const inGroup    = isInGroup(p);
            const isOpen     = inGroup;
            const headActive = inGroup ? " active" : "";
            const openCls    = isOpen  ? " open"   : "";

            const childrenHtml = visibleChildren.map(c => `
                <a href="${c.href}" class="sidebar-child${currentPage === c.href ? " active" : ""}">
                    <span class="si-icon">${c.icon}</span>${c.label}
                </a>`).join("");

            return `
                <div class="sidebar-group-head${headActive}" onclick="toggleGroup('${key}')">
                    <span class="si-icon">${p.icon}</span>
                    ${p.label}
                    <span class="grp-arrow${openCls}" id="grpa-${key}">›</span>
                </div>
                <div class="sidebar-children${openCls}" id="grpc-${key}">
                    ${childrenHtml}
                </div>`;
        }).join("");
    }

    // ── toggleGroup (expuesto globalmente para onclick inline) ───
    function toggleGroup(key) {
        const children = document.getElementById('grpc-' + key);
        const arrow    = document.getElementById('grpa-' + key);
        if (!children) return;
        const isOpen = children.classList.toggle('open');
        if (arrow) arrow.classList.toggle('open', isOpen);
    }
    window.toggleGroup = toggleGroup;

    // ── MODO EMPLEADO DE CADENA ─────────────────────────────────
    // Sesión de empleado (sin restaurante): el sidebar muestra los comunes (a medida que
    // se adaptan las pantallas) + un grupo por cada restaurante donde tiene rol, con solo
    // las pantallas permitidas ahí. Al abrir una común → contexto cuenta; un local → entra.
    // OJO: leer localStorage directo, NO esEmpleadoCadena() de api.js. Este IIFE puede
    // correr ANTES de que api.js cargue (el orden de <script> varía por página); si
    // dependiera de api.js, _isEmpleado quedaría false y nunca se arma el modo empleado.
    const _isEmpleado = !!localStorage.getItem("emp_token");

    function _escS(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }
    function _hasPermDe(permisos, perm){ if(!perm) return true; const ps=Array.isArray(perm)?perm:[perm]; return ps.some(p=>!!(permisos||{})[p]); }
    function _hasModDe(modulos, mod){ if(!mod) return true; return Array.isArray(modulos) && modulos.includes(mod); }

    // Pantallas con CONTEXTO de restaurante (se abren entrando al local).
    const REST_PAGES = [
        { href:"reservas.html",        icon:"📅", label:"Reservas",                mod:"reservas" },
        { href:"productos.html",       icon:"🍽️", label:"Productos",               mod:"productos",    perm:["edicion_carta"] },
        { href:"importar-ventas.html", icon:"📥", label:"Importar ventas",         mod:"importar",     perm:["edicion_carta","acceso_estadisticas"] },
        { href:"mesas.html",           icon:"🗺️", label:"Herramienta de Edición",  mod:"mesas",        perm:"edicion_sala" },
        { href:"stock.html",           icon:"📦", label:"Stock",                   mod:"stock",        perm:["gestion_stock","gestion_produccion","ver_stock"] },
        { href:"clientes.html",        icon:"🧑‍🤝‍🧑", label:"Clientes",            mod:"clientes",     perm:["gestion_clientes","ver_clientes"] },
        { href:"facturas.html",        icon:"🧾", label:"Facturas",                mod:"facturas",     perm:["acceso_facturacion","ver_facturas"] },
        { href:"caja.html",            icon:"💰", label:"Caja",                    mod:"caja",         perm:"gestion_caja" },
        { href:"usuarios.html",        icon:"👤", label:"Usuarios",                mod:"personal",     perm:["acceso_usuarios","ver_usuarios"] },
        { href:"salarios.html",        icon:"💼", label:"Salarios",                mod:"personal",     perm:"revision_salarios" },
        { href:"estadisticas.html",    icon:"📊", label:"Facturación y Est.",      mod:"estadisticas", perm:"acceso_estadisticas" },
        { href:"configuracion.html",   icon:"⚙️", label:"Configuración de sistema",                    perm:"acceso_configuracion" },
    ];

    // Comunes del empleado (sin restaurante). Se irán sumando al adaptar cada pantalla.
    // 'ready:true' = ya funciona en modo empleado.
    const COMMON_EMP = [
        { href:"dashboard.html",             icon:"🏠", label:"Panel principal",          ready:true },
        { href:"horarios.html",              icon:"📋", label:"Horarios",                 ready:true },
        { href:"fichajes.html",              icon:"🕐", label:"Fichajes",                 ready:true },
        { href:"mensajes.html",              icon:"💬", label:"Mensajes",                 ready:true },
        { href:"social.html",                icon:"📣", label:"Social",                   ready:true },
        { href:"documentos.html",            icon:"📁", label:"Documentos",              ready:true },
        { href:"configuracion-usuario.html", icon:"🙍", label:"Configuración de usuario", ready:true },
    ];

    function renderNavEmpleado() {
        const comunes = COMMON_EMP.filter(c => c.ready).map(c => {
            const act = currentPage === c.href ? " active" : "";
            return `<a href="#" onclick="navCuenta('${c.href}');return false;" class="sidebar-link${act}"><span class="si-icon">${c.icon}</span>${c.label}</a>`;
        }).join("");
        return comunes + `<div id="emp-rest-groups"><div style="padding:10px 16px;color:#9ca3af;font-size:12px;">Cargando tus restaurantes…</div></div>`;
    }

    function _grupoRestaurante(r) {
        const vis = REST_PAGES.filter(c => _hasModDe(r.modulos, c.mod) && _hasPermDe(r.permisos, c.perm));
        if (!vis.length) return "";
        const key = "resto-" + r.restaurante_id;
        const children = vis.map(c =>
            `<a href="#" onclick="navResto(${r.restaurante_id},'${c.href}');return false;" class="sidebar-child"><span class="si-icon">${c.icon}</span>${c.label}</a>`).join("");
        return `
            <div class="sidebar-group-head" onclick="toggleGroup('${key}')">
                <span class="si-icon">🍽️</span>${_escS(r.restaurante)}
                <span class="grp-arrow" id="grpa-${key}">›</span>
            </div>
            <div class="sidebar-children" id="grpc-${key}">${children}</div>`;
    }

    async function _cargarRestaurantesEmpleado() {
        const cont = document.getElementById("emp-rest-groups");
        if (!cont) return;
        let rests = [];
        try {
            // fetch crudo (no apiFetch): este código puede correr antes de que api.js cargue.
            const token = localStorage.getItem("emp_token");
            const API_URL = window._API_URL || "https://restaurante-backend-production-459b.up.railway.app";
            const res = await fetch(`${API_URL}/empleado/mis-restaurantes`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) rests = await res.json();
        } catch (e) { rests = []; }
        const html = (rests || []).map(_grupoRestaurante).filter(Boolean).join("");
        cont.innerHTML = html || '<div style="padding:10px 16px;color:#9ca3af;font-size:12px;">Sin restaurantes asignados.</div>';
    }

    window.navCuenta = function (href) {
        try { sessionStorage.removeItem("emp_hor"); } catch (e) {}
        if (typeof volverACuenta === "function") volverACuenta();
        window.location.href = href;
    };
    window.navResto = async function (restId, href) {
        try { sessionStorage.removeItem("emp_hor"); } catch (e) {}
        try { if (typeof entrarRestaurante === "function") await entrarRestaurante(restId); window.location.href = href; }
        catch (e) { alert("No se pudo entrar al restaurante: " + (e.message || e)); }
    };

    // ── HTML: overlay + panel ────────────────────────────────────
    const overlay = document.createElement("div");
    overlay.id = "sidebar-overlay";
    overlay.addEventListener("click", closeSidebar);
    document.body.appendChild(overlay);

    const panel = document.createElement("div");
    panel.id = "sidebar-panel";
    panel.innerHTML = `
        <div class="sidebar-title">Acceso rápido</div>
        <nav class="sidebar-nav">
            ${_isEmpleado ? renderNavEmpleado() : renderNav()}
        </nav>
    `;
    document.body.appendChild(panel);
    if (_isEmpleado) _cargarRestaurantesEmpleado();

    // ── CSS extra para el botón de mensajes en navbar ───────────
    style.textContent += `
        #nav-mensajes-btn {
            position: relative;
            background: none;
            border: none;
            cursor: pointer;
            color: white;
            font-size: 18px;
            padding: 4px 8px;
            border-radius: 6px;
            text-decoration: none;
            display: flex;
            align-items: center;
            transition: background .15s;
            flex-shrink: 0;
        }
        #nav-mensajes-btn:hover { background: rgba(255,255,255,0.12); }
        #nav-mensajes-badge {
            display: none;
            position: absolute;
            top: -2px;
            right: -2px;
            background: #dc2626;
            color: white;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 800;
            min-width: 16px;
            height: 16px;
            padding: 0 4px;
            text-align: center;
            line-height: 16px;
            border: 1.5px solid #1a1a2e;
        }
    `;

    // ── HAMBURGER + HOME en el navbar ───────────────────────────
    function injectHamburger() {
        const navbar = document.querySelector("nav.navbar");
        if (!navbar) return;

        // Contenedor agrupado → un solo ítem flex, evita que space-between
        // reparta los botones separados y el 🏠 quede sobre el brand
        const leftGroup = document.createElement("div");
        leftGroup.id = "sidebar-left";

        const btn = document.createElement("button");
        btn.id = "sidebar-toggle";
        btn.setAttribute("aria-label", "Menú");
        btn.innerHTML = "<span></span><span></span><span></span>";
        btn.addEventListener("click", toggleSidebar);
        leftGroup.appendChild(btn);

        // Botón 🏠 solo en páginas que no son el dashboard
        if (currentPage !== "dashboard.html") {
            const home = document.createElement("a");
            home.id = "sidebar-home";
            home.href = "dashboard.html";
            home.setAttribute("aria-label", "Ir al dashboard");
            home.textContent = "🏠";
            leftGroup.appendChild(home);
        }

        // Botón 💬 mensajes con badge — junto al 🏠 en el lado izquierdo
        const msgBtn = document.createElement("a");
        msgBtn.id   = "nav-mensajes-btn";
        msgBtn.href = "mensajes.html";
        msgBtn.setAttribute("aria-label", "Mensajes");
        msgBtn.innerHTML = `💬<span id="nav-mensajes-badge"></span>`;
        leftGroup.appendChild(msgBtn);

        // Insertar el grupo como primer hijo del navbar
        navbar.insertBefore(leftGroup, navbar.firstChild);

        // Cargar conteo de no leídos (solo si hay token)
        _cargarBadgeMensajes();
    }

    async function _cargarBadgeMensajes() {
        try {
            const token = localStorage.getItem("token");
            if (!token) return;
            const API_URL = window._API_URL || "https://restaurante-backend-production-459b.up.railway.app";
            // Empleado de cadena en su "cuenta" (token activo == emp_token, sin esquema):
            // el conteo por-esquema no aplica → usar el agregado de todos sus locales.
            const empToken = localStorage.getItem("emp_token");
            const enCuentaEmp = empToken && token === empToken;
            const url = enCuentaEmp ? `${API_URL}/empleado/mensajes/no-leidos`
                                    : `${API_URL}/mensajes/no-leidos/count`;
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) return;
            const data = await res.json();
            const count = data.count || 0;
            const show  = count > 0 ? "inline-block" : "none";
            const txt   = count > 0 ? String(count)   : "";

            // Badge en el navbar
            const navBadge = document.getElementById("nav-mensajes-badge");
            if (navBadge) {
                navBadge.textContent  = txt;
                navBadge.style.display = show;
            }

            // Badge en el sidebar
            const sideBadge = document.getElementById("sidebar-mensajes-badge");
            if (sideBadge) {
                sideBadge.textContent  = txt;
                sideBadge.style.display = show;
            }
        } catch(e) { /* silencioso — no crítico */ }
    }

    // ── TOGGLE ───────────────────────────────────────────────────
    function toggleSidebar() {
        const isOpen = panel.classList.contains("open");
        isOpen ? closeSidebar() : openSidebar();
    }

    function openSidebar() {
        panel.classList.add("open");
        overlay.classList.add("visible");
        document.getElementById("sidebar-toggle")?.classList.add("open");
    }

    function closeSidebar() {
        panel.classList.remove("open");
        overlay.classList.remove("visible");
        document.getElementById("sidebar-toggle")?.classList.remove("open");
    }

    // Cerrar con Escape
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") closeSidebar();
    });

    // ── INIT ─────────────────────────────────────────────────────
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", injectHamburger);
    } else {
        injectHamburger();
    }
})();
