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
    const _u = JSON.parse(localStorage.getItem("user") || "{}");
    if (_u.preview_logout) {
        // Llevar a vista previa antes de limpiar sesión
        window.location.href = "preview-sesion.html";
        return;
    }
    _doLogout();
}

function _doLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("edit_mode");
    window.location.href = "index.html";
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
async function apiFetch(endpoint, options = {}) {
    const token = getToken();
    const headers = {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        ...(options.headers || {})
    };

    const res = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers
    });

    if (res.status === 401) {
        logout();
        return;
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Error desconocido" }));
        throw new Error(err.detail || "Error en la API");
    }

    return res.json();
}

// ── MÉTODOS SHORTHAND ─────────────────────────────────────────
const api = {
    get: (endpoint) => apiFetch(endpoint),
    post: (endpoint, body) => apiFetch(endpoint, { method: "POST", body: JSON.stringify(body) }),
    put: (endpoint, body) => apiFetch(endpoint, { method: "PUT", body: JSON.stringify(body) }),
    patch: (endpoint, body) => apiFetch(endpoint, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (endpoint) => apiFetch(endpoint, { method: "DELETE" }),
};

// ── LOGIN ─────────────────────────────────────────────────────
async function login(username, password) {
    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);

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