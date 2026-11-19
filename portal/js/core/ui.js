// ── UI kit compartido — portado de restaurante-web/js/api.js ──
// Barra de progreso global (apiFetch la dispara sola), spinners, overlay
// bloqueante, busy de botones, toasts y skeletons. Expone window.UI.
// Ajustes para tablet: toasts más grandes y targets táctiles.

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
        font-family: 'Segoe UI', sans-serif; color: #E9EBE1; font-size: 15px;
        min-width: 220px; text-align: center;
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
        /* iOS: el notch/isla dinámica tapa top fijo — bajar por el safe-area */
        position: fixed; top: calc(14px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%);
        z-index: 100000; display: flex; flex-direction: column; gap: 8px;
        pointer-events: none; width: min(480px, calc(100vw - 28px));
    }
    .ui-toast {
        font-family: 'Segoe UI', sans-serif; font-size: 15px; color: #fff;
        background: #374151; padding: 14px 18px; border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,.22);
        white-space: pre-line; line-height: 1.35;
        opacity: 0; transform: translateY(-14px); transition: opacity .25s ease, transform .25s ease;
    }
    .ui-toast.show { opacity: 1; transform: translateY(0); }
    .ui-toast-success { background: #16a34a; }
    .ui-toast-error   { background: #dc2626; }
    .ui-toast-warning { background: #d97706; }
    .ui-toast-info    { background: #4f46e5; }
    `;
    const st = document.createElement("style");
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);

    // iOS: el teclado se SUPERPONE al WebView sin achicarlo → los modales con
    // inputs quedaban con el pie tapado. visualViewport da el alto visible; la
    // diferencia se expone como --kb y el overlay se levanta (base.css).
    if (window.visualViewport) {
        const _vv = () => {
            const kb = Math.max(0, window.innerHeight - window.visualViewport.height);
            document.documentElement.style.setProperty("--kb", kb + "px");
            // iOS además scrollea el documento al enfocar un input: fijarlo en 0
            // deja el fondo quieto (app-shell: el documento nunca scrollea).
            if (kb > 0 && (window.scrollY || window.visualViewport.offsetTop)) window.scrollTo(0, 0);
        };
        window.visualViewport.addEventListener("resize", _vv);
        window.visualViewport.addEventListener("scroll", _vv);
        // Saltar de un campo a otro con el teclado YA abierto scrollea el
        // documento sin tocar el visualViewport → escuchar también ese scroll.
        window.addEventListener("scroll", _vv, { passive: true });
        _vv();
    }

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
        skeletonCards(cont, n = 4) {
            if (!cont) return;
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
})();

export const UI = window.UI;
