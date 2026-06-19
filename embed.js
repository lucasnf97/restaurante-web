/**
 * embed.js — Incrusta el widget de reservas en una web existente, con auto-alto.
 *
 * Uso (cualquiera de las dos formas):
 *   <div id="reserva-widget" data-restaurante="CODIGO"></div>
 *   <script src="https://lucasnf97.github.io/restaurante-web/embed.js"></script>
 *
 *   …o bien:
 *   <script src="https://lucasnf97.github.io/restaurante-web/embed.js" data-restaurante="CODIGO"></script>
 *
 * El iframe apunta a nuestra página hosteada, así las llamadas a la API salen de NUESTRO
 * origen (sin tocar CORS del sitio anfitrión ni mezclar estilos).
 */
(function () {
    var BASE = "https://lucasnf97.github.io/restaurante-web/reserva.html";
    var cur  = document.currentScript;
    var mount = document.getElementById("reserva-widget");
    var code = (cur && cur.getAttribute("data-restaurante")) ||
               (mount && mount.getAttribute("data-restaurante")) || "";
    if (!code) { console.warn("[reserva embed] Falta data-restaurante con el código del restaurante."); return; }

    var iframe = document.createElement("iframe");
    iframe.src = BASE + "?r=" + encodeURIComponent(code);
    iframe.title = "Reservá tu mesa";
    iframe.loading = "lazy";
    iframe.style.width = "100%";
    iframe.style.border = "0";
    iframe.style.minHeight = "620px";
    iframe.style.transition = "height .2s ease";
    (mount || (cur && cur.parentNode) || document.body).appendChild(iframe);

    window.addEventListener("message", function (ev) {
        var d = ev.data;
        if (d && d.type === "reserva-height" && d.height) {
            iframe.style.height = (d.height + 2) + "px";
        }
    });
})();
