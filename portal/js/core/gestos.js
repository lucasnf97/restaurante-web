// ── gestos.js — gestos globales de móvil ──────────────────────
// · swipeBack(onBack): deslizar desde el borde izquierdo hacia el centro =
//   volver (con chevron ← que sigue el dedo como feedback).
// · cerrarModalSuperior(): cierra el modal/popup/panel abierto más arriba
//   simulando el tap en su backdrop (todos los modales de la app cierran por
//   `e.target === overlay`, y los basados en Promise resuelven null por esa
//   misma vía — no queda ninguna promesa colgada).
// · arrastrable(el): paneo con drag de MOUSE para dev/desktop (el touch ya
//   panea nativo por overflow + touch-action).

// ── Cerrar el modal/overlay superior ──────────────────────────
export function cerrarModalSuperior() {
    // Popup de estado de reservas (flotante sin backdrop)
    const popup = document.querySelector(".rv-popup");
    if (popup) { popup.remove(); return true; }
    // Modales apilados: el último del body es el de más arriba.
    const overlays = document.querySelectorAll(".modal-overlay");
    if (overlays.length) {
        const ov = overlays[overlays.length - 1];
        // Tap sintético en el backdrop → dispara el handler de cierre propio
        // del modal (incluye resolve(null) en los diálogos-Promise).
        ov.dispatchEvent(new MouseEvent("click", { bubbles: false }));
        // Si el modal no cerraba por backdrop (raro), forzar.
        if (document.body.contains(ov)) ov.remove();
        return true;
    }
    // Panel de resumen de mesas en modo overlay (pantallas angostas)
    const panel = document.querySelector(".resumen-panel.abierto");
    if (panel && getComputedStyle(panel).position === "fixed") {
        panel.classList.remove("abierto");
        return true;
    }
    return false;
}

// ── Swipe desde el borde izquierdo = volver ───────────────────
const _EDGE = 28;        // franja de arranque (px desde el borde)
const _UMBRAL = 70;      // desplazamiento horizontal que dispara el back

export function swipeBack(onBack) {
    let seguimiento = null;
    let chevron = null;

    const crearChevron = () => {
        const el = document.createElement("div");
        el.style.cssText = `position:fixed;left:-48px;top:50%;transform:translateY(-50%);
            width:44px;height:44px;border-radius:50%;background:rgba(26,26,46,.82);
            color:#fff;display:flex;align-items:center;justify-content:center;
            font-size:20px;font-weight:800;z-index:99990;pointer-events:none;
            transition:opacity .18s ease;`;
        el.textContent = "←";
        document.body.appendChild(el);
        return el;
    };

    document.addEventListener("pointerdown", (e) => {
        if (e.clientX > _EDGE) return;
        seguimiento = { x0: e.clientX, y0: e.clientY, activo: false };
    }, { passive: true });

    document.addEventListener("pointermove", (e) => {
        if (!seguimiento) return;
        const dx = e.clientX - seguimiento.x0;
        const dy = Math.abs(e.clientY - seguimiento.y0);
        if (!seguimiento.activo) {
            if (dx > 14 && dx > dy * 1.5) {
                seguimiento.activo = true;
                chevron = chevron || crearChevron();
            } else if (dy > 24) {
                seguimiento = null;   // gesto vertical → scroll normal
                return;
            }
        }
        if (seguimiento.activo && chevron) {
            const avance = Math.min(dx, _UMBRAL + 30);
            chevron.style.left = `${avance - 48}px`;
            chevron.style.opacity = dx >= _UMBRAL ? "1" : "0.6";
        }
    }, { passive: true });

    const soltar = (e) => {
        if (!seguimiento) return;
        const disparar = seguimiento.activo && (e.clientX - seguimiento.x0) >= _UMBRAL;
        seguimiento = null;
        if (chevron) {
            chevron.style.opacity = "0";
            const c = chevron; chevron = null;
            setTimeout(() => c.remove(), 200);
        }
        if (disparar) onBack();
    };
    document.addEventListener("pointerup", soltar, { passive: true });
    document.addEventListener("pointercancel", () => {
        seguimiento = null;
        if (chevron) { chevron.remove(); chevron = null; }
    }, { passive: true });
}

// ── Paneo con drag de mouse (dev/desktop) ─────────────────────
// Ignora los arranques sobre controles interactivos para no comerse los taps.
export function arrastrable(el) {
    if (!el) return;
    let pan = null;
    el.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "mouse") return;
        if (e.target.closest("button, input, select, textarea, a, .mesa-item, .bloque-card, .cx-prod, .cc-fila, .carrito-item")) return;
        pan = { sx: e.clientX, sy: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    });
    el.addEventListener("pointermove", (e) => {
        if (!pan) return;
        el.scrollLeft = pan.sl - (e.clientX - pan.sx);
        el.scrollTop = pan.st - (e.clientY - pan.sy);
    });
    const fin = () => { pan = null; };
    el.addEventListener("pointerup", fin);
    el.addEventListener("pointercancel", fin);
    el.addEventListener("pointerleave", fin);
}
