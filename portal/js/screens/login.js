// ── LOGIN — entrada por email (portal del empleado) ───────────
import { loginCuenta, esc } from "../core/api.js";
import { getRestaurantes } from "../core/sesion.js";
import { abrirArchivo } from "../core/adjuntos.js";
import * as drawer from "../drawer.js";
import * as prioritarias from "../prioritarias.js";

export async function mount(el) {
    el.innerHTML = `
    <div class="login-wrap">
        <div class="login-card card">
            <div class="login-logo">🍽️</div>
            <h1 class="login-titulo">Portal del Empleado</h1>
            <p class="muted login-sub">Entrá con el email de tu cuenta de empleado.</p>
            <label class="campo">Email</label>
            <input id="lg-email" type="email" autocomplete="username" inputmode="email"
                   placeholder="tu@email.com" autocapitalize="none">
            <label class="campo">Contraseña</label>
            <input id="lg-pass" type="password" autocomplete="current-password">
            <div id="lg-msg" class="login-msg" style="display:none;"></div>
            <button id="lg-entrar" class="btn-primario login-btn">Entrar</button>
            <button id="lg-olvide" type="button"
                    style="background:none;border:none;color:#4f46e5;font-weight:600;font-size:13.5px;margin-top:14px;width:100%;min-height:40px;">
                ¿Olvidaste tu contraseña?</button>
            <button id="lg-legal" type="button"
                    style="background:none;border:none;color:#64748b;font-size:12px;margin-top:6px;width:100%;min-height:36px;">
                Términos y Condiciones · Privacidad</button>
        </div>
    </div>`;
    // Legal (igual que el login del exe): en el navegador del sistema.
    el.querySelector("#lg-legal").addEventListener("click",
        () => abrirArchivo("https://lucasnf97.github.io/restaurante-web/terminos.html"));

    const msg = el.querySelector("#lg-msg");
    const btn = el.querySelector("#lg-entrar");
    const entrar = async () => {
        const email = el.querySelector("#lg-email").value.trim();
        const pass  = el.querySelector("#lg-pass").value;
        if (!email || !pass) {
            msg.style.display = ""; msg.textContent = "Completá email y contraseña.";
            return;
        }
        btn.disabled = true; btn.textContent = "Entrando…";
        msg.style.display = "none";
        try {
            await loginCuenta(email, pass);
            const locales = await getRestaurantes({ refrescar: true });
            const sse = await import("../core/sse.js");
            drawer.setSesion(true);
            if (!locales.length) {
                msg.style.display = "";
                msg.textContent = "Tu cuenta no tiene locales asignados. Hablá con tu encargado.";
            }
            prioritarias.checkear({ forzar: true });
            window._ir("resumen");
        } catch (e) {
            msg.style.display = "";
            msg.textContent = e.message || "No se pudo iniciar sesión.";
        } finally {
            btn.disabled = false; btn.textContent = "Entrar";
        }
    };
    btn.addEventListener("click", entrar);
    el.querySelector("#lg-pass").addEventListener("keydown", e => { if (e.key === "Enter") entrar(); });

    // ¿Olvidaste tu contraseña? → correo de restablecimiento (respuesta genérica
    // del server: no revela si el email existe).
    el.querySelector("#lg-olvide").addEventListener("click", async () => {
        const email = el.querySelector("#lg-email").value.trim();
        msg.style.display = "";
        if (!email.includes("@")) {
            msg.textContent = "Escribí tu email arriba y volvé a tocar el enlace.";
            return;
        }
        msg.textContent = "Enviando…";
        try {
            const { apiFetch } = await import("../core/api.js");
            await apiFetch("/auth/reset/solicitar", {
                method: "POST", body: JSON.stringify({ email }), sinLogout: true });
            msg.textContent = "Si el correo corresponde a una cuenta, te enviamos un enlace para cambiar la contraseña. Revisá tu bandeja (y el spam).";
        } catch (e) {
            msg.textContent = e.message || "No se pudo enviar el correo.";
        }
    });
}

export function unmount() {}
