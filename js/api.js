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
    localStorage.removeItem("token");
    localStorage.removeItem("user");
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
    setUser({ username: data.username, rol: data.rol });
    return data;
}