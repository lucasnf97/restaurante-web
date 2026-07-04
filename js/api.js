const API_URL = "https://restaurante-backend-production-459b.up.railway.app";

// ── TOKEN ─────────────────────────────────────────────────────
function getToken() {
    return localStorage.getItem("token");
}

function setToken(token) {
    localStorage.setItem("token", token);
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
                throw new Error(err.detail || "Error en la API");
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
    #ui-progress {
        position: fixed; top: 0; left: 0; height: 3px; width: 0;
        background: linear-gradient(90deg,#6366f1,#a855f7);
        box-shadow: 0 0 8px rgba(99,102,241,.6);
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
    .ui-overlay-box {
        background: #fff; border-radius: 14px; padding: 26px 34px;
        box-shadow: 0 16px 48px rgba(0,0,0,.28);
        display: flex; flex-direction: column; align-items: center; gap: 14px;
        font-family: 'Segoe UI', sans-serif; color: #374151; font-size: 14px;
        min-width: 200px; text-align: center;
    }
    .ui-overlay-box .ui-spinner {
        width: 38px; height: 38px; border-width: 3.5px; color: #6366f1;
        border-color: #e5e7eb; border-top-color: #6366f1;
    }
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
            }
        },
        _reqEnd() {
            _pending = Math.max(0, _pending - 1);
            if (_pending === 0) {
                clearInterval(_trickle);
                _set(100);
                const b = _ensureBar();
                setTimeout(() => { b.style.opacity = "0"; setTimeout(() => _set(0), 300); }, 220);
            }
        },
        // Rellena un <tbody> con filas "shimmer" mientras carga la tabla.
        skeleton(tbody, rows = 6, cols = 4) {
            if (!tbody) return;
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
        // Tarjetas grises (para grids de stats/dashboard).
        skeletonCards(cont, n = 4) {
            if (!cont) return;
            cont.innerHTML = Array.from({ length: n }, () => `<div class="ui-skel-card"></div>`).join("");
        },
        // Overlay bloqueante con spinner + texto (acciones: cobrar/guardar/importar/IA).
        overlay(show, texto = "Procesando…") {
            let ov = document.getElementById("ui-overlay");
            if (show) {
                if (!ov) {
                    ov = document.createElement("div");
                    ov.id = "ui-overlay"; ov.className = "ui-overlay";
                    ov.innerHTML = `<div class="ui-overlay-box"><div class="ui-spinner"></div><div id="ui-overlay-txt"></div></div>`;
                    document.body.appendChild(ov);
                }
                ov.querySelector("#ui-overlay-txt").textContent = texto;
                ov.style.display = "flex";
            } else if (ov) {
                ov.style.display = "none";
            }
        },
        // Cambia el texto del overlay ya abierto (p.ej. contador de segundos).
        overlayText(texto) {
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
})();