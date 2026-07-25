// ── NOTIFICACIONES EMERGENTES DE MENSAJES ─────────────────────────────────
// Globo abajo a la derecha (✉️ + contador) que aparece en CUALQUIER página al
// llegar un mensaje nuevo. Al tocarlo abre una ventana flotante ARRASTRABLE (por
// su barra superior) con el contenido del mensaje y las mismas acciones que la
// casilla: responder, reenviar, eliminar, confirmar/aceptar/rechazar solicitudes
// de turno y reactivar usuarios bloqueados. La ✕ cierra sin backend; cualquier
// ACCIÓN cierra la ventana automáticamente. sidebar.js inyecta este script en
// todas las páginas → no hay que tocar cada HTML.
//
// Autocontenido (IIFE propio, sin globales): usa fetch crudo con el token, igual
// que el badge de mensajes del sidebar. Corre SOLO en sesión de restaurante
// (tenant); en la "cuenta" del empleado de cadena no hace nada (esos mensajes los
// atiende el Portal del Empleado). Detección por sondeo cada 30 s.
(function () {
    "use strict";

    const API_URL = window._API_URL || "https://restaurante-backend-production-459b.up.railway.app";
    const POLL_MS = 30000;

    // ── Contexto / sesión ────────────────────────────────────────────────
    function _ctx() {
        const token = localStorage.getItem("token");
        const empToken = localStorage.getItem("emp_token");
        return { token, enCuentaEmp: !!(empToken && token === empToken) };
    }
    function _uid() {
        try { const u = JSON.parse(localStorage.getItem("user") || "null"); return (u && u.id != null) ? String(u.id) : "x"; }
        catch (_) { return "x"; }
    }

    // ── Helpers ──────────────────────────────────────────────────────────
    function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c])); }
    function dn(u) { return (u && (u.nombre_display || u.username)) || "Sistema"; }
    function linkify(s) {
        return esc(s).replace(/(https?:\/\/[^\s]+|[\w./-]+\.html(?:\?[^\s]*)?)/g,
            m => `<a href="${m}" target="_blank" rel="noopener" style="color:#4f46e5;font-weight:600;">${m}</a>`);
    }
    function fechaFull(ts) {
        if (!ts) return "—";
        const d = new Date(ts); if (isNaN(d)) return "—";
        const p = n => String(n).padStart(2, "0");
        return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    async function api(method, path, body) {
        const { token } = _ctx();
        const opts = { method, headers: { Authorization: "Bearer " + token } };
        if (body !== undefined && body !== null) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(API_URL + path, opts);
        if (!res.ok) {
            let msg = "Error " + res.status;
            try { const j = await res.json(); if (j && typeof j.detail === "string") msg = j.detail; } catch (_) {}
            const e = new Error(msg); e.status = res.status; throw e;
        }
        if (res.status === 204) return null;
        try { return await res.json(); } catch (_) { return null; }
    }

    // ── Estado ───────────────────────────────────────────────────────────
    let _cola = [];            // mensajes nuevos encolados (dedupe por id)
    let _idx = 0;              // índice visible dentro de _cola
    let _usuarios = null;      // cache de /mensajes/usuarios (para reenviar)
    let _pos = null;           // {left, top} tras arrastrar (persiste al reabrir)
    let _tmr = null;
    const K_MAX = "notif_max_" + _uid();
    const K_BASE = "notif_base_" + _uid();
    const K_CNT = "notif_cnt_" + _uid();
    let _maxId = parseInt(sessionStorage.getItem(K_MAX) || "0", 10) || 0;
    let _lastCount = parseInt(sessionStorage.getItem(K_CNT) || "0", 10) || 0;
    let _baseSet = sessionStorage.getItem(K_BASE) === "1";

    function _persist() {
        sessionStorage.setItem(K_MAX, String(_maxId));
        sessionStorage.setItem(K_CNT, String(_lastCount));
    }
    function _maxOf(lista, actual) {
        return (lista || []).reduce((a, m) => Math.max(a, m.id || 0), actual || 0);
    }

    // ── CSS ──────────────────────────────────────────────────────────────
    function _css() {
        if (document.getElementById("notif-css")) return;
        const s = document.createElement("style");
        s.id = "notif-css";
        s.textContent = `
        #notif-bubble{position:fixed;right:22px;bottom:22px;width:56px;height:56px;border-radius:50%;
            background:#4f46e5;color:#fff;display:none;align-items:center;justify-content:center;font-size:24px;
            cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.28);z-index:4000;border:none;transition:background .15s;}
        #notif-bubble.show{display:flex;}
        #notif-bubble:hover{background:#4338ca;}
        #notif-bubble-count{position:absolute;top:-4px;right:-4px;background:#dc2626;color:#fff;border-radius:11px;
            min-width:22px;height:22px;padding:0 6px;font-size:12px;font-weight:800;display:flex;align-items:center;
            justify-content:center;border:2px solid #fff;box-sizing:border-box;}
        #notif-win{position:fixed;width:372px;max-width:94vw;max-height:76vh;background:#fff;border-radius:14px;
            box-shadow:0 18px 60px rgba(0,0,0,.35);z-index:4001;display:none;flex-direction:column;overflow:hidden;}
        #notif-win.show{display:flex;}
        .notif-head{background:#4f46e5;color:#fff;padding:9px 10px 9px 14px;display:flex;align-items:center;gap:6px;
            cursor:move;user-select:none;touch-action:none;}
        .notif-head .nt{font-weight:800;font-size:14px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .notif-head .np{font-size:11px;font-weight:700;opacity:.85;}
        .notif-head button{background:rgba(255,255,255,.16);border:none;color:#fff;width:27px;height:27px;border-radius:7px;
            cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
        .notif-head button:hover{background:rgba(255,255,255,.32);}
        .notif-body{padding:14px 16px;overflow-y:auto;flex:1;font-size:14px;color:#1f2937;}
        .notif-de{font-size:12px;color:#6b7280;margin-bottom:8px;}
        .notif-de b{color:#1a1a2e;}
        .notif-asunto{font-size:15px;font-weight:800;color:#1a1a2e;margin-bottom:10px;word-break:break-word;}
        .notif-cuerpo{white-space:pre-wrap;word-break:break-word;line-height:1.5;}
        .notif-adj{margin-top:12px;}
        .notif-adj a{display:block;color:#4f46e5;font-weight:600;font-size:13px;text-decoration:none;margin-top:6px;word-break:break-all;}
        .notif-adj img{max-width:100%;border-radius:10px;margin-top:8px;display:block;}
        .notif-sol{border:1px solid #e5e7eb;border-radius:9px;padding:10px 12px;margin-top:12px;background:#fafafa;}
        .notif-sol-st{font-size:13px;font-weight:700;color:#374151;margin-bottom:8px;}
        .notif-sol-info{font-size:12.5px;color:#374151;background:#fff;border:1px solid #eef0f3;border-radius:6px;padding:8px 10px;margin-bottom:8px;line-height:1.5;}
        .notif-sol-btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
        .notif-foot{border-top:1px solid #eee;padding:10px 12px;display:flex;gap:8px;flex-wrap:wrap;background:#fafafa;align-items:center;}
        .notif-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:700;
            cursor:pointer;color:#374151;}
        .notif-btn:hover{filter:brightness(.97);}
        .notif-btn.prim{background:#4f46e5;color:#fff;border-color:#4f46e5;}
        .notif-btn.dng{color:#b91c1c;border-color:#fecaca;}
        .notif-btn.sm{padding:6px 12px;font-size:12.5px;}
        .notif-btn:disabled{opacity:.5;cursor:default;}
        .notif-cmp-lbl{font-size:12px;color:#6b7280;font-weight:600;margin:2px 0 4px;}
        .notif-cmp-para{width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:10px;box-sizing:border-box;}
        .notif-cmp-ta{width:100%;min-height:120px;padding:9px 11px;border:1px solid #d1d5db;border-radius:8px;font-size:13.5px;
            font-family:inherit;line-height:1.5;box-sizing:border-box;resize:vertical;}
        .notif-err{color:#b91c1c;font-size:12.5px;font-weight:600;margin-top:8px;display:none;}
        .notif-toast{position:fixed;right:22px;bottom:86px;background:#111827;color:#fff;padding:9px 15px;border-radius:9px;
            font-size:13px;font-weight:600;z-index:4002;box-shadow:0 8px 24px rgba(0,0,0,.3);opacity:0;transition:opacity .2s;pointer-events:none;}
        .notif-toast.show{opacity:1;}
        `;
        document.head.appendChild(s);
    }

    // ── DOM base ─────────────────────────────────────────────────────────
    let _bubble, _win, _head, _body, _foot;
    function _crearDom() {
        _css();
        _bubble = document.createElement("button");
        _bubble.id = "notif-bubble";
        _bubble.setAttribute("aria-label", "Mensajes nuevos");
        _bubble.innerHTML = `✉️<span id="notif-bubble-count">0</span>`;
        _bubble.addEventListener("click", () => { _idx = 0; _abrir(); });
        document.body.appendChild(_bubble);

        _win = document.createElement("div");
        _win.id = "notif-win";
        _win.innerHTML = `
            <div class="notif-head" id="notif-head">
                <span class="nt" id="notif-titulo">✉️ Nuevo mensaje</span>
                <span class="np" id="notif-pos"></span>
                <button id="notif-prev" title="Anterior" style="display:none;">‹</button>
                <button id="notif-next" title="Siguiente" style="display:none;">›</button>
                <button id="notif-cerrar" title="Cerrar">✕</button>
            </div>
            <div class="notif-body" id="notif-body"></div>
            <div class="notif-foot" id="notif-foot"></div>`;
        document.body.appendChild(_win);
        _head = _win.querySelector("#notif-head");
        _body = _win.querySelector("#notif-body");
        _foot = _win.querySelector("#notif-foot");

        _win.querySelector("#notif-cerrar").addEventListener("click", _cerrar);
        _win.querySelector("#notif-prev").addEventListener("click", () => { if (_idx > 0) { _idx--; _pintar(); } });
        _win.querySelector("#notif-next").addEventListener("click", () => { if (_idx < _cola.length - 1) { _idx++; _pintar(); } });
        _hacerArrastrable();
    }

    // ── Arrastre por la barra superior ───────────────────────────────────
    function _hacerArrastrable() {
        let drag = false, sx = 0, sy = 0, ox = 0, oy = 0;
        _head.addEventListener("pointerdown", e => {
            if (e.target.closest("button")) return;   // los botones del header no arrastran
            drag = true;
            try { _head.setPointerCapture(e.pointerId); } catch (_) {}
            const r = _win.getBoundingClientRect();
            _win.style.left = r.left + "px"; _win.style.top = r.top + "px";
            _win.style.right = "auto"; _win.style.bottom = "auto";
            sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        });
        _head.addEventListener("pointermove", e => {
            if (!drag) return;
            const w = _win.offsetWidth, h = _win.offsetHeight;
            let nx = ox + (e.clientX - sx), ny = oy + (e.clientY - sy);
            nx = Math.max(4, Math.min(nx, window.innerWidth - w - 4));
            ny = Math.max(4, Math.min(ny, window.innerHeight - h - 4));
            _win.style.left = nx + "px"; _win.style.top = ny + "px";
            _pos = { left: nx, top: ny };
        });
        const fin = e => { if (drag) { drag = false; try { _head.releasePointerCapture(e.pointerId); } catch (_) {} } };
        _head.addEventListener("pointerup", fin);
        _head.addEventListener("pointercancel", fin);
    }

    function _toast(txt) {
        let t = document.getElementById("notif-toast");
        if (!t) { t = document.createElement("div"); t.id = "notif-toast"; t.className = "notif-toast"; document.body.appendChild(t); }
        t.textContent = txt; t.classList.add("show");
        clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600);
    }

    // ── Bubble ───────────────────────────────────────────────────────────
    function _renderBubble() {
        if (!_bubble) return;
        const n = _cola.length;
        const cnt = _bubble.querySelector("#notif-bubble-count");
        if (n > 0) { cnt.textContent = n > 99 ? "99+" : String(n); _bubble.classList.add("show"); }
        else { _bubble.classList.remove("show"); }
    }

    // ── Abrir / cerrar ventana ───────────────────────────────────────────
    function _abrir() {
        if (!_cola.length) return;
        if (_idx >= _cola.length) _idx = 0;
        if (_pos) { _win.style.left = _pos.left + "px"; _win.style.top = _pos.top + "px"; _win.style.right = "auto"; _win.style.bottom = "auto"; }
        else { _win.style.right = "22px"; _win.style.bottom = "22px"; _win.style.left = "auto"; _win.style.top = "auto"; }
        _win.classList.add("show");
        _pintar();
    }
    function _cerrar() {
        // ✕ = cerrar sin realizar ninguna acción de backend. Se descarta el aviso
        // actual de la cola (ya lo viste) y, si quedan otros, el globo los mantiene.
        _win.classList.remove("show");
        if (_cola.length) { _cola.splice(_idx, 1); _idx = 0; }
        _renderBubble();
    }
    // Tras una ACCIÓN (responder/reenviar/eliminar/solicitud/reactivar): quitar el
    // mensaje de la cola y cerrar la ventana (auto). El globo refleja lo que queda.
    function _hecho(m, txt) {
        const i = _cola.findIndex(x => x.id === m.id);
        if (i !== -1) _cola.splice(i, 1);
        _idx = 0;
        _win.classList.remove("show");
        _renderBubble();
        if (txt) _toast(txt);
    }

    // ── Pintar el mensaje actual ─────────────────────────────────────────
    async function _pintar() {
        const m = _cola[_idx];
        if (!m) { _cerrar(); return; }
        const esSistema = (m.de_username || "") === "sistema";

        // Header
        _win.querySelector("#notif-titulo").textContent = "✉️ Nuevo mensaje";
        const posEl = _win.querySelector("#notif-pos");
        const prev = _win.querySelector("#notif-prev"), next = _win.querySelector("#notif-next");
        if (_cola.length > 1) {
            posEl.textContent = `${_idx + 1}/${_cola.length}`;
            prev.style.display = _idx > 0 ? "" : "none";
            next.style.display = _idx < _cola.length - 1 ? "" : "none";
        } else { posEl.textContent = ""; prev.style.display = "none"; next.style.display = "none"; }

        // Cuerpo
        let acc = null;
        try { acc = m.accion ? (typeof m.accion === "string" ? JSON.parse(m.accion) : m.accion) : null; } catch (_) {}
        const esReactivar = acc && ["reactivar_usuario", "reactivar_empleado"].includes(acc.tipo);

        let html = `<div class="notif-de">De: <b>${esc(dn({ nombre_display: m.de_nombre_display, username: m.de_username }))}</b> · ${esc(fechaFull(m.creado_en))}`;
        if (m.restaurante) html += ` · 🏠 ${esc(m.restaurante)}`;
        html += `</div>`;
        html += `<div class="notif-asunto">${esc(m.asunto || "(sin asunto)")}</div>`;
        html += `<div class="notif-cuerpo">${linkify(m.cuerpo || "")}</div>`;

        if (m.adjuntos && m.adjuntos.length) {
            html += `<div class="notif-adj">📎 Adjuntos (${m.adjuntos.length})`;
            html += m.adjuntos.map(a => a.tipo === "imagen"
                ? `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.nombre || "")}" loading="lazy"></a>`
                : `<a href="${esc(a.url)}" target="_blank" rel="noopener">📄 ${esc(a.nombre || "archivo")}</a>`).join("");
            html += `</div>`;
        }
        if (m.solicitud_id) html += _tarjetaSolicitud(m);
        _body.innerHTML = html;
        if (m.solicitud_id) _rellenarSolicitud(m);

        // Pie de acciones
        _foot.innerHTML = "";
        if (esReactivar) {
            const b = _btn("🔓 Reactivar usuario" + (acc.nombre ? " — " + acc.nombre : ""), "prim");
            b.style.width = "100%"; b.style.justifyContent = "center";
            b.addEventListener("click", () => _reactivar(m, acc));
            _foot.appendChild(b);
        }
        const bResp = _btn(esSistema ? "↪️ Reenviar" : "↩️ Responder", "prim");
        bResp.addEventListener("click", () => _compose(m, esSistema ? "reenviar" : "responder"));
        _foot.appendChild(bResp);

        const bDel = _btn("🗑️ Eliminar", "dng");
        bDel.addEventListener("click", () => _eliminar(m));
        _foot.appendChild(bDel);

        const bInbox = _btn("Ver en Mensajes", "sm");
        bInbox.style.marginLeft = "auto";
        bInbox.addEventListener("click", () => { window.location.href = "mensajes.html"; });
        _foot.appendChild(bInbox);

        // Marcar leído al abrir (como la casilla). Best-effort.
        if (m.leido === false) {
            api("PATCH", `/mensajes/${m.id}/leer`).then(() => { m.leido = true; _refrescarBadgeMenos(); }).catch(() => {});
        }
    }

    function _btn(txt, cls) {
        const b = document.createElement("button");
        b.className = "notif-btn" + (cls ? " " + cls : "");
        b.textContent = txt;
        return b;
    }

    // ── Solicitudes de turno (tarjeta accionable) ────────────────────────
    function _tarjetaSolicitud(m) {
        const st = m.solicitud_estado;
        const estadoTxt = ({ prop_receptor: "Pendiente de tu respuesta", prop_solicitante: "Contrapropuesta — pendiente de tu respuesta",
            disponible: "Disponible", abierta: "Disponible", asignada: "✔ Asignado", pend_confirmacion: "Pendiente de confirmación",
            aprobada: "✔ Aprobado", denegada: "Denegado", rechazada: "Rechazado", cancelada: "Cancelado" })[st] || st || "";
        const titulo = m.solicitud_tipo === "abierto" ? "⊕ Turno abierto" : (m.solicitud_tipo === "oferta" ? "📣 Oferta de turno" : "🔁 Intercambio de turno");
        return `<div class="notif-sol">
            <div class="notif-sol-st">${esc(titulo)} · ${esc(estadoTxt)}</div>
            <div class="notif-sol-info" id="notif-sol-info">Cargando detalle…</div>
            <div class="notif-sol-btns" id="notif-sol-btns"></div>
        </div>`;
    }
    function _fmtFranjas(jsonStr) {
        try { return (JSON.parse(jsonStr || "[]") || []).map(f => `${(f.inicio || "").slice(0, 5)}–${(f.fin || "").slice(0, 5)}`).join(", "); }
        catch (_) { return ""; }
    }
    async function _rellenarSolicitud(m) {
        const info = _body.querySelector("#notif-sol-info");
        const btns = _body.querySelector("#notif-sol-btns");
        // Botones según estado (mismo criterio que la casilla)
        if (btns) {
            const st = m.solicitud_estado;
            const rid = (m.restaurante_id != null) ? m.restaurante_id : null;
            const mk = (accion, label, cls) => {
                const b = _btn(label, cls); b.classList.add("sm");
                b.addEventListener("click", () => _accionSolicitud(m, accion, rid, b));
                return b;
            };
            if (st === "prop_receptor" || st === "prop_solicitante") { btns.appendChild(mk("aceptar", "Aceptar", "prim")); btns.appendChild(mk("rechazar", "Rechazar", "dng")); }
            else if (st === "pend_confirmacion") { btns.appendChild(mk("confirmar", "Confirmar", "prim")); btns.appendChild(mk("denegar", "Denegar", "dng")); }
            if (st === "pend_confirmacion") {
                const a = document.createElement("a");
                a.className = "notif-btn sm"; a.textContent = "Ver en la grilla"; a.style.textDecoration = "none";
                a.href = `horarios.html?solicitud=${m.solicitud_id}${rid != null ? "&restaurante_id=" + rid : ""}`;
                btns.appendChild(a);
            }
        }
        if (!info) return;
        try {
            const q = (m.restaurante_id != null) ? ("?restaurante_id=" + m.restaurante_id) : "";
            const d = await api("GET", `/horarios/solicitudes/${m.solicitud_id}${q}`);
            if (!info.isConnected) return;
            const fmt = t => `${t.fecha || "—"} · ${_fmtFranjas(t.franjas) || "—"}`;
            if (d.tipo === "abierto") {
                let h = `⊕ Turno: <b>${esc(d.origen_fecha || "—")}</b> · ${esc(_fmtFranjas(d.origen_franjas) || "—")}${d.origen_rol ? " · " + esc(d.origen_rol) : ""}`;
                if (d.tomado_username) h += `<br>Asignado a: <b>${esc(d.tomado_username)}</b>`;
                info.innerHTML = h; return;
            }
            const da = (d.turnos || []).filter(t => t.lado === "da");
            const re = (d.turnos || []).filter(t => t.lado === "recibe");
            const verbo = d.tipo === "oferta" ? "ofrece" : "da";
            let h = "";
            h += `<b>${esc(d.creador_username || "—")}</b> ${verbo}: ${da.length ? da.map(fmt).join("  |  ") : (d.origen_fecha || "—") + " · " + (_fmtFranjas(d.origen_franjas) || "—")}`;
            if (d.tipo !== "oferta") {
                if (re.length) h += `<br><b>${esc(d.destino_username || "—")}</b> da: ${re.map(fmt).join("  |  ")}`;
                else if (d.destino_horario_id) h += `<br><b>${esc(d.destino_username || "—")}</b> da: ${d.destino_fecha || "—"} · ${_fmtFranjas(d.destino_franjas) || "—"}`;
                else h += `<br><b>${esc(d.destino_username || "—")}</b>: sin turno a cambio`;
            }
            if (d.tipo === "oferta" && d.tomado_username) h += `<br>✋ Quiere tomarlo: <b>${esc(d.tomado_username)}</b>`;
            info.innerHTML = h;
        } catch (_) { if (info.isConnected) info.textContent = "No se pudo cargar el detalle."; }
    }
    async function _accionSolicitud(m, accion, rid, btn, permitir) {
        if (btn) btn.disabled = true;
        // Aviso al aceptar un intercambio si ya tenés turno ese día.
        if (accion === "aceptar") {
            try {
                const q = (rid != null) ? ("?restaurante_id=" + rid) : "";
                const d = await api("GET", `/horarios/solicitudes/${m.solicitud_id}${q}`);
                if (d && d.mi_conflicto && !confirm("Ya tenés un turno ese día. ¿Aceptar igual?")) { if (btn) btn.disabled = false; return; }
            } catch (_) {}
        }
        const body = (rid != null) ? { restaurante_id: rid } : {};
        if (permitir) body.permitir_conflicto = true;
        try {
            await api("POST", `/horarios/solicitudes/${m.solicitud_id}/${accion}`, body);
            _hecho(m, "Solicitud actualizada ✓");
        } catch (e) {
            if (accion === "confirmar" && !permitir && String(e.message || "").includes("conflicto_dia")) {
                if (confirm("Un empleado ya tiene un turno ese día. ¿Confirmar igual (turno doble)?")) return _accionSolicitud(m, accion, rid, btn, true);
                if (btn) btn.disabled = false; return;
            }
            if (btn) btn.disabled = false;
            _toast(e.message || "No se pudo procesar la solicitud");
        }
    }

    // ── Eliminar ─────────────────────────────────────────────────────────
    async function _eliminar(m) {
        if (m.leido === false && !confirm("Este mensaje no está leído. ¿Eliminarlo igual?")) return;
        try {
            await api("DELETE", `/mensajes/${m.id}?lado=recibido`);
            _refrescarBadgeMenos();
            _hecho(m, "Mensaje eliminado 🗑️");
        } catch (e) { _toast(e.message || "No se pudo eliminar"); }
    }

    // ── Reactivar usuario bloqueado ──────────────────────────────────────
    async function _reactivar(m, acc) {
        const pass = prompt(`Para reactivar a ${acc.nombre || "este usuario"}, confirmá con TU contraseña:`);
        if (!pass) return;
        const body = { password: pass };
        if (acc.tipo === "reactivar_usuario") body.usuario_id = acc.usuario_id; else body.empleado_id = acc.empleado_id;
        try {
            const r = await api("POST", "/auth/usuarios/reactivar-bloqueo", body);
            _hecho(m, (r && r.mensaje) || "Usuario reactivado ✔");
        } catch (e) { _toast(e.message || "No se pudo reactivar"); }
    }

    // ── Responder / Reenviar (compose dentro de la ventana) ──────────────
    async function _compose(m, modo) {
        const base = (m.asunto || "").startsWith("[CC] ") ? (m.asunto || "").slice(5) : (m.asunto || "");
        const pref = modo === "reenviar" ? "RV: " : "Re: ";
        const asunto = base.startsWith(pref) ? base : pref + base;
        const cita = `\n\n---\nMensaje de ${dn({ nombre_display: m.de_nombre_display, username: m.de_username })} (${fechaFull(m.creado_en)}):\n${m.cuerpo || ""}`;

        _win.querySelector("#notif-titulo").textContent = modo === "reenviar" ? "↪️ Reenviar" : "↩️ Responder";
        _win.querySelector("#notif-pos").textContent = "";
        _win.querySelector("#notif-prev").style.display = "none";
        _win.querySelector("#notif-next").style.display = "none";

        let paraHtml;
        if (modo === "reenviar") {
            paraHtml = `<div class="notif-cmp-lbl">Para</div><select class="notif-cmp-para" id="notif-cmp-para"><option value="">Cargando destinatarios…</option></select>`;
        } else {
            paraHtml = `<div class="notif-cmp-lbl">Para</div><input class="notif-cmp-para" value="${esc(dn({ nombre_display: m.de_nombre_display, username: m.de_username }))}" disabled>`;
        }
        _body.innerHTML = `${paraHtml}
            <div class="notif-cmp-lbl">Asunto</div>
            <input class="notif-cmp-para" id="notif-cmp-asunto" value="${esc(asunto)}">
            <div class="notif-cmp-lbl">Mensaje</div>
            <textarea class="notif-cmp-ta" id="notif-cmp-cuerpo">${esc(cita)}</textarea>
            <div class="notif-err" id="notif-cmp-err"></div>`;

        // Foco al inicio del textarea (para escribir arriba de la cita)
        setTimeout(() => { const ta = _body.querySelector("#notif-cmp-cuerpo"); if (ta) { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; } }, 60);

        if (modo === "reenviar") {
            try {
                if (!_usuarios) _usuarios = await api("GET", "/mensajes/usuarios");
                const sel = _body.querySelector("#notif-cmp-para");
                if (sel) sel.innerHTML = `<option value="">Elegí un destinatario…</option>` +
                    (_usuarios || []).map(u => `<option value="${u.id}">${esc(dn(u))}${u.rol ? " (" + esc(u.rol) + ")" : ""}</option>`).join("");
            } catch (_) {
                const sel = _body.querySelector("#notif-cmp-para");
                if (sel) sel.innerHTML = `<option value="">No se pudo cargar la lista</option>`;
            }
        }

        _foot.innerHTML = "";
        const bEnv = _btn("Enviar", "prim");
        const bCanc = _btn("Cancelar", "");
        bCanc.addEventListener("click", () => _pintar());
        bEnv.addEventListener("click", async () => {
            const err = _body.querySelector("#notif-cmp-err");
            const asuntoV = (_body.querySelector("#notif-cmp-asunto").value || "").trim();
            const cuerpoV = (_body.querySelector("#notif-cmp-cuerpo").value || "").trim();
            let paraId;
            if (modo === "reenviar") { paraId = parseInt(_body.querySelector("#notif-cmp-para").value || "0", 10); }
            else { paraId = m.de_usuario_id; }
            if (!paraId) { err.style.display = "block"; err.textContent = "Elegí un destinatario."; return; }
            if (!asuntoV) { err.style.display = "block"; err.textContent = "Escribí un asunto."; return; }
            if (!cuerpoV) { err.style.display = "block"; err.textContent = "Escribí el mensaje."; return; }
            bEnv.disabled = true; bEnv.textContent = "Enviando…";
            try {
                await api("POST", "/mensajes/", {
                    para_usuario_ids: [paraId], cc_usuario_ids: [], asunto: asuntoV, cuerpo: cuerpoV, adjuntos: [],
                });
                _hecho(m, modo === "reenviar" ? "Mensaje reenviado ✓" : "Respuesta enviada ✓");
            } catch (e) {
                bEnv.disabled = false; bEnv.textContent = "Enviar";
                err.style.display = "block"; err.textContent = e.message || "No se pudo enviar.";
            }
        });
        _foot.appendChild(bEnv);
        _foot.appendChild(bCanc);
    }

    // ── Badges del navbar/sidebar (mantenerlos vivos) ────────────────────
    function _setBadges(n) {
        const txt = n > 0 ? String(n) : "";
        ["nav-mensajes-badge", "sidebar-mensajes-badge"].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = txt; el.style.display = n > 0 ? "inline-block" : "none"; }
        });
    }
    function _refrescarBadgeMenos() {
        // Al leer/eliminar desde la ventana, bajar el conteo visible sin esperar al poll.
        const el = document.getElementById("nav-mensajes-badge");
        const actual = el && el.textContent ? parseInt(el.textContent, 10) : 0;
        const n = Math.max(0, (actual || 0) - 1);
        _lastCount = Math.max(0, _lastCount - 1); _persist();
        _setBadges(n);
    }

    // ── Sondeo ───────────────────────────────────────────────────────────
    async function _poll() {
        const { token, enCuentaEmp } = _ctx();
        if (!token || enCuentaEmp) { _setBadges(0); _cola = []; _renderBubble(); return; }

        let cntObj;
        try { cntObj = await api("GET", "/mensajes/no-leidos/count"); } catch (_) { return; }
        const n = (cntObj && cntObj.count) || 0;
        _setBadges(n);

        if (!_baseSet) {
            // Primer sondeo de la sesión: fijar la línea base SIN avisar (no spamear al entrar).
            try { const l = await api("GET", "/mensajes/recibidos"); _maxId = _maxOf(l, _maxId); } catch (_) {}
            _baseSet = true; sessionStorage.setItem(K_BASE, "1");
            _lastCount = n; _persist();
            return;
        }
        // Traer la lista completa solo si el conteo subió (llegó algo nuevo).
        if (n > _lastCount) {
            let lista;
            try { lista = await api("GET", "/mensajes/recibidos"); } catch (_) { _lastCount = n; _persist(); return; }
            const nuevos = (lista || []).filter(m => (m.id || 0) > _maxId && m.leido === false && !m.archivado);
            _maxId = _maxOf(lista, _maxId);
            for (const m of nuevos) if (!_cola.some(x => x.id === m.id)) _cola.push(m);
            if (nuevos.length) _renderBubble();
            _persist();
        }
        _lastCount = n; _persist();
    }

    // ── Init ─────────────────────────────────────────────────────────────
    function _init() {
        const { token, enCuentaEmp } = _ctx();
        if (!token || enCuentaEmp) return;   // solo sesión de restaurante
        _crearDom();
        _renderBubble();
        _poll();
        _tmr = setInterval(_poll, POLL_MS);
        // Al volver a la pestaña, sondear enseguida (ponerse al día).
        document.addEventListener("visibilitychange", () => { if (!document.hidden) _poll(); });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _init);
    else _init();
})();
