(function () {
    // ── PÁGINAS DEL SISTEMA ─────────────────────────────────────
    const PAGES = [
        { href: "dashboard.html",  icon: "🏠", label: "Panel principal" },
        { href: "mesas.html",      icon: "🪑", label: "Mesas" },
        { href: "reservas.html",   icon: "📅", label: "Reservas" },
        { href: "productos.html",  icon: "🍽️", label: "Productos" },
        { href: "stock.html",      icon: "📦", label: "Stock" },
        { href: "facturas.html",      icon: "🧾", label: "Facturas" },
        { href: "estadisticas.html", icon: "📊", label: "Facturación y Estadísticas" },
        { href: "caja.html",         icon: "💰", label: "Caja" },
        { href: "fichajes.html",   icon: "🕐", label: "Fichajes" },
        { href: "usuarios.html",   icon: "👤", label: "Usuarios" },
    ];

    const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";

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
    `;
    document.head.appendChild(style);

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
            ${PAGES.map(p => `
                <a href="${p.href}" class="sidebar-link${currentPage === p.href ? " active" : ""}">
                    <span class="si-icon">${p.icon}</span>
                    ${p.label}
                </a>
            `).join("")}
        </nav>
    `;
    document.body.appendChild(panel);

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

        // Insertar el grupo como primer hijo del navbar
        navbar.insertBefore(leftGroup, navbar.firstChild);
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
