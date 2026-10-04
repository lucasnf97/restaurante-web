/* ══════════════════════════════════════════════════════════════════════════
   BARRAS DE DESPLAZAMIENTO CON EL LOGO DE CHIEF POINT
   ══════════════════════════════════════════════════════════════════════════

   Reemplaza TODAS las barras de la página —la de la ventana y las de cada panel
   con desplazamiento, verticales y horizontales— por una propia:
     · un riel fino,
     · una píldora tenue = la parte del contenido que se está viendo (con un
       círculo solo se perdería esa información),
     · y el logo de Chief Point en el centro de la píldora.

   Dinámica "resorte" (elegida por el dueño, 2026-10-04, laboratorio en
   claude.ai): el CENTRO lima es la referencia y va siempre exacto a su lugar;
   los dos anillos cuelgan de resortes y llegan después — el exterior, más
   blando, se estira y rebota apenas.
   ⚠ Mismas constantes que el exe (salon.py, clase _BarrasChief).

   Cómo funciona:
     · Las barras nativas se ocultan con CSS; las nuevas viven en una capa fija
       por encima de todo, así no se toca el layout de ninguna página.
     · Un panel se "descubre" al pasarle el mouse por encima o al desplazarse
       (no se recorre el DOM entero: hay tablas con miles de celdas).
     · Las de los paneles aparecen al pasar el mouse o al desplazar; la de la
       ventana queda siempre visible.

   ⚠ Todo dentro de una IIFE: un const/let global acá podría chocar con los de
     api.js o de la página y matar el script entero en el parseo.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    if (window.ScrollChief) return;
    window.ScrollChief = { version: 1 };

    var T = 14;                                   // diámetro del anillo exterior (px)
    var RES = { r2: [420, 34], r4: [190, 21] };   // rigidez, amortiguación
    var PROP = { r4: 0.5, r2: 0.39, c: 0.24 };
    var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

    // ── Estilos ──────────────────────────────────────────────────────────
    var css = "" +
        "html,html *{scrollbar-width:none!important}" +
        "html::-webkit-scrollbar,html *::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}" +
        "#cp-capa{position:fixed;inset:0;pointer-events:none;z-index:2147483000}" +
        ".cp-b{position:fixed;pointer-events:auto;opacity:0;transition:opacity .25s;touch-action:none;cursor:pointer}" +
        ".cp-b.vis{opacity:1}.cp-b.doc{opacity:.6}.cp-b.doc.vis{opacity:1}" +
        ".cp-b .cp-riel,.cp-b .cp-pil{position:absolute;border-radius:999px;background:rgba(100,116,139,.22)}" +
        ".cp-b .cp-pil{background:rgba(100,116,139,.18)}" +
        ".cp-b:hover .cp-riel,.cp-b.agarrada .cp-riel{background:rgba(100,116,139,.36)}" +
        ".cp-b:hover .cp-pil,.cp-b.agarrada .cp-pil{background:rgba(100,116,139,.3)}" +
        ".cp-b .cp-a{position:absolute;left:0;top:0;border-radius:50%;will-change:transform}" +
        ".cp-a.r4{background:#4c5a15}.cp-a.r2{background:#93be1e}.cp-a.c{background:#c9ff1f}";
    var st = document.createElement("style");
    st.id = "cp-scroll-css";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);

    var capa = null;
    function _capa() {
        if (capa && capa.isConnected) return capa;
        capa = document.createElement("div");
        capa.id = "cp-capa";
        document.body.appendChild(capa);
        return capa;
    }

    // ── Qué se desplaza ──────────────────────────────────────────────────
    var DOC = document.scrollingElement || document.documentElement;
    function puede(el, eje) {
        if (el === DOC) {
            return eje === "v" ? DOC.scrollHeight > window.innerHeight + 1
                               : DOC.scrollWidth > window.innerWidth + 1;
        }
        if (!el || el.nodeType !== 1) return false;
        var cs = getComputedStyle(el), o = eje === "v" ? cs.overflowY : cs.overflowX;
        if (o !== "auto" && o !== "scroll" && o !== "overlay") return false;
        return eje === "v" ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
    }

    // ── Una barra ────────────────────────────────────────────────────────
    var barras = [];                 // todas las vivas
    var porEl = new WeakMap();       // el → { v: Barra, h: Barra }

    function Barra(el, eje) {
        this.el = el; this.v = eje === "v"; this.doc = el === DOC;
        this.n = document.createElement("div");
        this.n.className = "cp-b" + (this.doc ? " doc" : "");
        this.n.innerHTML = '<div class="cp-riel"></div><div class="cp-pil"></div>' +
            '<div class="cp-a r4"></div><div class="cp-a r2"></div><div class="cp-a c"></div>';
        this.riel = this.n.children[0]; this.pil = this.n.children[1];
        this.a = { r4: this.n.children[2], r2: this.n.children[3], c: this.n.children[4] };
        for (var k in this.a) { var d = T * PROP[k] * 2; this.a[k].style.width = this.a[k].style.height = d + "px"; }
        this.r = { r2: { p: null, v: 0 }, r4: { p: null, v: 0 } };
        this.hasta = 0; this.sobre = false; this.agarre = null;
        _capa().appendChild(this.n);
        this._eventos();
        barras.push(this);
    }
    Barra.prototype.caja = function () {
        if (this.doc) return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
        var r = this.el.getBoundingClientRect();
        return { x: r.left + this.el.clientLeft, y: r.top + this.el.clientTop, w: this.el.clientWidth, h: this.el.clientHeight };
    };
    Barra.prototype.medidas = function () {
        var el = this.el, b = this.caja();
        var otra = porEl.get(el), cruzada = otra && (this.v ? otra.h : otra.v);
        var resto = cruzada && cruzada.activa ? T : 0;           // no pisar la esquina de la otra barra
        var largo = (this.v ? b.h : b.w) - resto;
        var cli = this.v ? (this.doc ? window.innerHeight : el.clientHeight) : (this.doc ? window.innerWidth : el.clientWidth);
        var tot = this.v ? el.scrollHeight : el.scrollWidth;
        var pos = this.v ? el.scrollTop : el.scrollLeft;
        var max = Math.max(1, tot - cli), recorrido = Math.max(1, largo - T);
        var prog = Math.min(1, Math.max(0, pos / max));
        var pil = Math.max(T, Math.min(largo, largo * cli / Math.max(1, tot)));
        // El punto Chief es PROGRESIVO sobre todo el riel (arriba del todo al principio,
        // abajo del todo al final) y la píldora avanza con la misma proporción: el punto
        // siempre cae dentro de ella. Igual que en el exe (_BarrasChief._centro).
        return { b: b, largo: largo, max: max, recorrido: recorrido, pil: pil,
                 centro: T / 2 + prog * recorrido, inicioPil: prog * (largo - pil) };
    };
    Barra.prototype.ir = function (centro, m) {
        var pos = (centro - T / 2) / m.recorrido * m.max;
        if (this.v) this.el.scrollTo({ top: pos, behavior: "instant" });
        else this.el.scrollTo({ left: pos, behavior: "instant" });
    };
    Barra.prototype._eventos = function () {
        var self = this, n = this.n;
        n.addEventListener("pointerenter", function () { self.sobre = true; despertar(); });
        n.addEventListener("pointerleave", function () { self.sobre = false; self.hasta = performance.now() + 600; despertar(); });
        n.addEventListener("pointerdown", function (e) {
            if (e.button > 0) return;
            e.preventDefault();
            n.setPointerCapture(e.pointerId);
            var m = self.medidas(), r = n.getBoundingClientRect();
            var c = self.v ? e.clientY - r.top : e.clientX - r.left;
            // Agarrado del logo: no salta. En el riel: el centro va adonde se tocó.
            self.agarre = Math.abs(c - m.centro) <= T ? c - m.centro : 0;
            n.classList.add("agarrada");
            self.ir(c - self.agarre, m);
            despertar();
        });
        n.addEventListener("pointermove", function (e) {
            if (self.agarre === null) return;
            var r = n.getBoundingClientRect(), c = self.v ? e.clientY - r.top : e.clientX - r.left;
            self.ir(c - self.agarre, self.medidas());
        });
        function soltar() {
            if (self.agarre === null) return;
            self.agarre = null; n.classList.remove("agarrada");
            self.hasta = performance.now() + 900; despertar();
        }
        n.addEventListener("pointerup", soltar);
        n.addEventListener("pointercancel", soltar);
        // La rueda sobre la barra desplaza su panel (la barra está en otra capa).
        n.addEventListener("wheel", function (e) {
            self.el.scrollBy({ top: self.v ? e.deltaY : 0, left: self.v ? 0 : (e.deltaX || e.deltaY), behavior: "instant" });
            e.preventDefault();
        }, { passive: false });
    };
    Barra.prototype.quitar = function () {
        this.n.remove();
        barras.splice(barras.indexOf(this), 1);
        var p = porEl.get(this.el);
        if (p) p[this.v ? "v" : "h"] = null;
    };
    // Un paso: geometría + resortes + pintado. Devuelve true si sigue en movimiento.
    Barra.prototype.paso = function (dt, ahora) {
        if (!this.doc && !this.el.isConnected) { this.quitar(); return false; }
        this.activa = puede(this.el, this.v ? "v" : "h");
        var visible = this.activa && (this.doc || this.sobre || this.agarre !== null || ahora < this.hasta);
        this.n.classList.toggle("vis", visible && (!this.doc || this.sobre || this.agarre !== null || ahora < this.hasta));
        if (!this.activa) { this.n.style.display = "none"; return false; }
        this.n.style.display = "";
        var m = this.medidas(), b = m.b;
        // Fuera de la pantalla (panel desplazado fuera de vista): nada que mostrar.
        if (b.y + b.h < 0 || b.y > window.innerHeight || b.x + b.w < 0 || b.x > window.innerWidth) {
            this.n.style.display = "none"; return false;
        }
        var s = this.n.style;
        if (this.v) { s.left = (b.x + b.w - T) + "px"; s.top = b.y + "px"; s.width = T + "px"; s.height = m.largo + "px"; }
        else { s.left = b.x + "px"; s.top = (b.y + b.h - T) + "px"; s.width = m.largo + "px"; s.height = T + "px"; }
        var rs = this.riel.style, ps = this.pil.style, mov = false;
        if (this.v) {
            rs.left = (T / 2 - 1.5) + "px"; rs.width = "3px"; rs.top = (T / 2) + "px"; rs.height = Math.max(0, m.largo - T) + "px";
            ps.left = "2px"; ps.width = (T - 4) + "px"; ps.top = m.inicioPil + "px"; ps.height = m.pil + "px";
        } else {
            rs.top = (T / 2 - 1.5) + "px"; rs.height = "3px"; rs.left = (T / 2) + "px"; rs.width = Math.max(0, m.largo - T) + "px";
            ps.top = "2px"; ps.height = (T - 4) + "px"; ps.left = m.inicioPil + "px"; ps.width = m.pil + "px";
        }
        for (var k in RES) {
            var a = this.r[k];
            if (a.p === null || reduce.matches) { a.p = m.centro; a.v = 0; }
            else {
                a.v += (RES[k][0] * (m.centro - a.p) - RES[k][1] * a.v) * dt;
                a.p += a.v * dt;
                if (Math.abs(a.p - m.centro) > 0.05 || Math.abs(a.v) > 0.5) mov = true;
                else { a.p = m.centro; a.v = 0; }
            }
        }
        this._ubicar(this.a.r4, this.r.r4.p); this._ubicar(this.a.r2, this.r.r2.p); this._ubicar(this.a.c, m.centro);
        return mov || visible && !this.doc;     // mientras se ve, se sigue la geometría del panel
    };
    Barra.prototype._ubicar = function (nodo, p) {
        var x = this.v ? T / 2 : p, y = this.v ? p : T / 2;
        nodo.style.transform = "translate(" + x + "px," + y + "px) translate(-50%,-50%)";
    };

    function barrasDe(el) {
        var p = porEl.get(el);
        if (!p) { p = { v: null, h: null }; porEl.set(el, p); }
        if (!p.v && puede(el, "v")) p.v = new Barra(el, "v");
        if (!p.h && puede(el, "h")) p.h = new Barra(el, "h");
        return p;
    }
    function avivar(el, ms) {
        var p = barrasDe(el), hasta = performance.now() + (ms || 1200);
        if (p.v) p.v.hasta = Math.max(p.v.hasta, hasta);
        if (p.h) p.h.hasta = Math.max(p.h.hasta, hasta);
        despertar();
    }

    // ── El bucle ─────────────────────────────────────────────────────────
    var vivo = false, ultimo = 0;
    function despertar() {
        if (vivo) return;
        vivo = true; ultimo = performance.now();
        requestAnimationFrame(cuadro);
    }
    function cuadro(t) {
        var dt = Math.min(1 / 30, (t - ultimo) / 1000); ultimo = t;
        var sigue = false;
        for (var i = barras.length - 1; i >= 0; i--) if (barras[i] && barras[i].paso(dt, t)) sigue = true;
        for (var j = 0; j < barras.length; j++) if (barras[j].hasta > t || barras[j].sobre || barras[j].agarre !== null) sigue = true;
        if (sigue) requestAnimationFrame(cuadro); else vivo = false;
    }

    // ── Descubrimiento ───────────────────────────────────────────────────
    document.addEventListener("scroll", function (e) {
        var el = e.target === document ? DOC : e.target;
        if (el && (el === DOC || el.nodeType === 1)) avivar(el, 1200);
    }, { capture: true, passive: true });

    var pend = null;
    document.addEventListener("pointermove", function (e) {
        if (e.pointerType === "touch" || pend) return;
        pend = e.target;
        requestAnimationFrame(function () {
            var el = pend; pend = null;
            for (var n = 0; el && el !== document.body && el !== document.documentElement && n < 25; el = el.parentElement, n++) {
                if (el.closest && el.closest("#cp-capa")) return;
                if (puede(el, "v") || puede(el, "h")) avivar(el, 700);
            }
        });
    }, { passive: true });

    window.addEventListener("resize", despertar, { passive: true });

    function iniciar() {
        _capa();
        barrasDe(DOC);
        despertar();
        // El contenido de las páginas llega por fetch: la barra de la ventana tiene
        // que enterarse de que ahora hay algo que desplazar.
        if (window.ResizeObserver) new ResizeObserver(function () { barrasDe(DOC); despertar(); }).observe(document.body);
    }
    if (document.body) iniciar(); else document.addEventListener("DOMContentLoaded", iniciar);
})();
