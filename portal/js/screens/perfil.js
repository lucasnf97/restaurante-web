// ── PERFIL — cuenta del empleado ──────────────────────────────
import * as config from "../core/config.js";
import { apiCuenta, esc, displayName, esGerente } from "../core/api.js";
import { getRestaurantes, logout } from "../core/sesion.js";
import { fileAB64 } from "../core/adjuntos.js";
import * as drawer from "../drawer.js";

export async function mount(el) {
    const u = config.getUser();
    const ger = esGerente();
    const _ini = x => (displayName(x) || "?").trim().split(/\s+/).map(s => s[0] || "").slice(0, 2).join("").toUpperCase() || "?";
    const _pfSetAvatar = url => {
        const av = document.getElementById("pf-avatar");
        const q = document.getElementById("pf-foto-quitar");
        if (!av) return;
        if (url) { av.style.backgroundImage = `url('${url}')`; av.textContent = ""; if (q) q.style.display = ""; }
        else { av.style.backgroundImage = ""; av.textContent = _ini(u); if (q) q.style.display = "none"; }
    };
    el.innerHTML = `
    <div class="pantalla">
        ${drawer.headerConMenu("Mi perfil")}
        <div class="pantalla-body">
            <div class="card res-card" style="display:flex;align-items:center;gap:14px;">
                <div id="pf-avatar" style="width:60px;height:60px;border-radius:50%;background:#e0e7ff;color:#4f46e5;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;overflow:hidden;flex-shrink:0;background-size:cover;background-position:center;">${esc(_ini(u))}</div>
                <div class="crece">
                    <div class="perfil-nombre">${esc(displayName(u))}</div>
                    <div class="muted" id="pf-email-actual">${ger ? "Gerente" : ""}</div>
                    ${ger ? "" : `
                    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
                        <button id="pf-foto-cam-btn" type="button" style="background:none;border:none;color:#4f46e5;font-weight:700;font-size:13px;padding:4px 0;cursor:pointer;">📷 Tomar foto</button>
                        <button id="pf-foto-gal-btn" type="button" style="background:none;border:none;color:#4f46e5;font-weight:700;font-size:13px;padding:4px 0;cursor:pointer;">🖼️ Galería</button>
                        <button id="pf-foto-quitar" type="button" style="background:none;border:none;color:#9ca3af;font-weight:600;font-size:13px;padding:4px 0;cursor:pointer;display:none;">Quitar</button>
                    </div>
                    <input type="file" id="pf-foto-cam" accept="image/*" capture="user" style="display:none;">
                    <input type="file" id="pf-foto-gal" accept="image/*" style="display:none;">`}
                </div>
            </div>
            <div class="card res-card">
                <div class="res-card-titulo">🏠 Mis locales</div>
                <div id="pf-locales" class="muted">Cargando…</div>
            </div>
            ${ger ? `<div class="card res-card"><div class="muted" style="font-size:13px;">Tu email y contraseña de gerente se administran desde el panel web.</div></div>` : `
            <div class="card res-card">
                <div class="res-card-titulo">✉️ Cambiar email</div>
                <label class="campo">Email nuevo</label>
                <input id="pf-email" type="email" inputmode="email" autocapitalize="none">
                <button class="btn-secundario" id="pf-email-btn" style="margin-top:10px;width:100%;">Guardar email</button>
                <div class="perfil-msg" id="pf-email-msg"></div>
            </div>
            <div class="card res-card">
                <div class="res-card-titulo">🔒 Contraseña</div>
                <div class="muted" style="font-size:13.5px;line-height:1.45;">Por seguridad, la contraseña se cambia por correo: te mandamos un enlace a tu email y desde ahí definís la nueva.</div>
                <button class="btn-secundario" id="pf-pass-btn" style="margin-top:10px;width:100%;">📧 Enviarme el correo de cambio</button>
                <div class="perfil-msg" id="pf-pass-msg"></div>
            </div>`}
            <button class="btn-peligro" id="pf-salir" style="width:100%;">Cerrar sesión</button>
            <div class="muted centrado" style="margin-top:14px;font-size:12px;">Portal del Empleado v1.0</div>
        </div>
    </div>`;

    // Datos de la cuenta (email editable + foto: solo empleados)
    if (!ger) apiCuenta.getSilent("/empleado/perfil").then(p => {
        const e1 = document.getElementById("pf-email-actual");
        const e2 = document.getElementById("pf-email");
        if (e1 && p) e1.textContent = p.email || "";
        if (e2 && p) e2.value = p.email || "";
        if (p) _pfSetAvatar(p.foto_url);
    }).catch(() => {});

    // Foto de perfil — multipart por el webview con token de cuenta.
    // "Tomar foto" = input con capture=user (abre la cámara al instante);
    // "Galería" = input común (elegir una imagen existente).
    const camBtn = el.querySelector("#pf-foto-cam-btn");
    const galBtn = el.querySelector("#pf-foto-gal-btn");
    const camInput = el.querySelector("#pf-foto-cam");
    const galInput = el.querySelector("#pf-foto-gal");
    const fotoQuitar = el.querySelector("#pf-foto-quitar");
    const _subirFoto = async (input) => {
        const f = input.files[0];
        if (!f) return;
        try {
            // JSON + base64 por el transporte NATIVO (multipart del webview falla en iOS).
            const r = await apiCuenta.post("/empleado/perfil/foto-json", await fileAB64(f));
            _pfSetAvatar(r && r.foto_url);
            UI.toast("Foto actualizada", "success");
        } catch (e) { UI.toast(e.message || "No se pudo subir la foto", "error"); }
        input.value = "";
    };
    if (camBtn && camInput) { camBtn.addEventListener("click", () => camInput.click()); camInput.addEventListener("change", () => _subirFoto(camInput)); }
    if (galBtn && galInput) { galBtn.addEventListener("click", () => galInput.click()); galInput.addEventListener("change", () => _subirFoto(galInput)); }
    if (fotoQuitar) fotoQuitar.addEventListener("click", async () => {
        try { await apiCuenta.del("/empleado/perfil/foto"); _pfSetAvatar(null); UI.toast("Foto quitada", "success"); }
        catch (e) { UI.toast(e.message || "No se pudo quitar", "error"); }
    });

    getRestaurantes().then(ls => {
        const cont = document.getElementById("pf-locales");
        if (!cont) return;
        cont.innerHTML = ls.length ? ls.map(r =>
            `<div class="pf-local"><b>${esc(r.restaurante || r.codigo)}</b><span class="muted"> · ${esc(r.rol || "")} · ${esc(r.codigo || "")}</span></div>`).join("")
            : "Sin locales asignados.";
        cont.classList.remove("muted");
    }).catch(() => {});

    const emailBtn = el.querySelector("#pf-email-btn");
    if (emailBtn) emailBtn.addEventListener("click", async () => {
        const msg = document.getElementById("pf-email-msg");
        try {
            const email = document.getElementById("pf-email").value.trim();
            if (!email) return;
            await apiCuenta.patch("/empleado/perfil", { email });
            msg.className = "perfil-msg ok"; msg.textContent = "Email actualizado.";
            document.getElementById("pf-email-actual").textContent = email;
        } catch (e) { msg.className = "perfil-msg err"; msg.textContent = e.message; }
    });

    // Cambio de contraseña SOLO por correo (decisión del dueño): dispara el mismo
    // flujo de restablecimiento que "¿Olvidaste tu contraseña?" del login.
    const passBtn = el.querySelector("#pf-pass-btn");
    if (passBtn) passBtn.addEventListener("click", async () => {
        const msg = document.getElementById("pf-pass-msg");
        const email = (document.getElementById("pf-email-actual").textContent || "").trim();
        if (!email.includes("@")) {
            msg.className = "perfil-msg err"; msg.textContent = "No encontramos el email de tu cuenta."; return;
        }
        passBtn.disabled = true;
        try {
            await apiCuenta.post("/auth/reset/solicitar", { email });
            msg.className = "perfil-msg ok";
            msg.textContent = "Listo: te enviamos el correo (revisá también el spam). El enlace vence en 1 hora.";
        } catch (e) { msg.className = "perfil-msg err"; msg.textContent = e.message; }
        passBtn.disabled = false;
    });

    el.querySelector("#pf-salir").addEventListener("click", async () => {
        const sse = await import("../core/sse.js");
        sse.cerrar();
        await logout();
        drawer.setSesion(false);
        window._ir("login");
    });
}

export function unmount() {}
