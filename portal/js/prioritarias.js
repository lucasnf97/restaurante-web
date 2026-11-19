// ── prioritarias.js — gate de publicaciones PRIORITARIAS ─────
// Port del overlay bloqueante de restaurante-web/js/sidebar.js (rama del
// portal del empleado): al abrir la app / volver del background, si hay
// publicaciones prioritarias que este empleado no aceptó en ninguno de sus
// locales, se muestran en primer plano una por una (la más antigua primero).
// Para continuar hay que tildar "Leí y entiendo" y Aceptar. El acuse es
// server-side (social_acuses) → aceptar acá lo saca de la web y viceversa.
// TODO el chequeo es fail-silent: un error jamás bloquea la app.

import * as config from "./core/config.js";
import { API_URL, esc, apiCuenta, esGerente } from "./core/api.js";

let _visible = false;
let _ultimoCheck = 0;
const _DEBOUNCE_MS = 60000;

export function visible() { return _visible; }

export async function checkear({ forzar = false } = {}) {
    if (_visible || !config.getToken()) return;
    if (esGerente()) return;   // el gate de acuse es para empleados; el gerente publica, no acusa
    if (!forzar && Date.now() - _ultimoCheck < _DEBOUNCE_MS) return;
    _ultimoCheck = Date.now();
    try {
        const posts = await apiCuenta.getSilent("/empleado/prioritarias-pendientes");
        if (!Array.isArray(posts) || !posts.length) return;
        _mostrar(posts);
    } catch (_) { /* fail-silent */ }
}

function _fmtF(ts) {
    try {
        const d = new Date(ts);
        return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) + " " +
               d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
}

function _mostrar(posts) {
    _visible = true;
    let idx = 0;
    const ov = document.createElement("div");
    ov.id = "prio-overlay";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(10,10,25,.78);z-index:5000;" +
        "display:flex;align-items:center;justify-content:center;padding:16px;" +
        "padding-top:calc(16px + var(--safe-top));padding-bottom:calc(16px + var(--safe-bottom));";
    document.body.appendChild(ov);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function render() {
        if (idx >= posts.length) {
            ov.remove();
            document.body.style.overflow = prevOverflow;
            _visible = false;
            return;
        }
        const p = posts[idx];
        const imgs = (p.adjuntos || []).filter(a => a.tipo === "imagen").map(a =>
            `<img src="${esc(a.url)}" alt="" style="max-width:100%;border-radius:10px;margin-top:10px;display:block;">`).join("");
        const files = (p.adjuntos || []).filter(a => a.tipo === "archivo").map(a =>
            `<a href="${esc(a.url)}" target="_blank" rel="noopener" style="display:block;margin-top:8px;color:#4f46e5;font-weight:600;font-size:13px;text-decoration:none;">📄 ${esc(a.nombre)}</a>`).join("");
        // Solo linkear si es http(s): un enlace 'javascript:...' guardado ejecutaría JS al hacer clic.
        const _urlOk = p.enlace && /^https?:\/\//i.test(String(p.enlace).trim());
        const enlace = _urlOk
            ? `<a href="${esc(p.enlace)}" target="_blank" rel="noopener" style="display:block;margin-top:8px;color:#4f46e5;font-size:13px;word-break:break-all;">🔗 ${esc(p.enlace)}</a>`
            : (p.enlace ? `<div style="margin-top:8px;color:#6b7280;font-size:13px;word-break:break-all;">🔗 ${esc(p.enlace)}</div>` : "");
        const grupo = (p.grupo_nombre ? ` · grupo ${esc(p.grupo_nombre)}` : "")
            + (p.restaurante ? ` · 🏠 ${esc(p.restaurante)}` : "");
        ov.innerHTML = `
          <div style="background:#fff;border-radius:16px;width:560px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.4);">
            <div style="background:#b91c1c;color:#fff;padding:13px 20px;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:800;font-size:15px;">🚨 Publicación prioritaria</span>
              <span style="font-size:12px;font-weight:700;opacity:.9;">${idx + 1} de ${posts.length}</span>
            </div>
            <div style="padding:16px 20px;overflow-y:auto;flex:1;">
              <div style="font-size:12px;color:#6b7280;margin-bottom:10px;"><b style="color:#1a1a2e">${esc(p.nombre_display || p.username)}</b> · ${_fmtF(p.creado_en)}${grupo}</div>
              <div style="font-size:14px;color:#1f2937;white-space:pre-wrap;word-break:break-word;">${esc(p.contenido || "")}</div>
              ${imgs}${files}${enlace}
              <div id="prio-err" style="display:none;color:#b91c1c;font-size:13px;font-weight:600;margin-top:12px;"></div>
            </div>
            <div style="border-top:1px solid #e5e7eb;padding:14px 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:#fafafa;">
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#374151;cursor:pointer;">
                <input type="checkbox" id="prio-check" style="width:20px;height:20px;min-height:20px;"> Leí y entiendo esta publicación
              </label>
              <button id="prio-aceptar" disabled style="margin-left:auto;background:#b91c1c;color:#fff;border:none;border-radius:8px;padding:9px 24px;font-size:14px;font-weight:700;cursor:pointer;opacity:.5;min-height:44px;">Aceptar</button>
            </div>
          </div>`;
        const chk = ov.querySelector("#prio-check");
        const btn = ov.querySelector("#prio-aceptar");
        chk.addEventListener("change", () => {
            btn.disabled = !chk.checked;
            btn.style.opacity = chk.checked ? "1" : ".5";
        });
        btn.addEventListener("click", async () => {
            btn.disabled = true; btn.style.opacity = ".5";
            try {
                // Por el transporte NATIVO (apiCuenta): el fetch del webview falla
                // en iOS ("Load failed" → caía siempre al catch como "Sin conexión").
                // Semántica original: 2xx o 4xx (p.ej. ya aceptada) → seguir; solo
                // el error de RED real mantiene el post y ofrece reintentar.
                await apiCuenta.post(`/empleado/aceptar/${p.restaurante_id}/${p.id}`, {});
                idx++; render();
            } catch (e) {
                if (e && e.status) { idx++; render(); return; }   // respuesta HTTP (4xx) → seguir
                const err = ov.querySelector("#prio-err");
                if (err) { err.style.display = "block"; err.textContent = "Sin conexión — no se pudo confirmar. Volvé a intentar."; }
                btn.textContent = "Reintentar";
                btn.disabled = !chk.checked;
                btn.style.opacity = chk.checked ? "1" : ".5";
            }
        });
    }
    render();
}
