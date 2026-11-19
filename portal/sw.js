// ── Service worker del Portal como PWA (2026-11-19) ──────────────────────────────
// Sólo en el navegador (la app nativa no lo registra: ver `main.js`). Lo publica
// `publicar-pwa.sh` en lucasnf97.github.io/restaurante-web/portal/.
//
// Estrategia: RED PRIMERO para los archivos de la app (mismo origen) y la copia guardada
// sólo si no hay red. Así una versión nueva llega al toque (sin quedar pegado a una vieja,
// el problema clásico de las PWA) y sin internet la app igual abre. La API (Railway) es
// OTRO origen: no se toca ni se guarda nunca — los datos siempre son los del momento.
const CACHE = "portal-0a4c77e";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
    e.respondWith((async () => {
        try {
            const res = await fetch(req, { cache: "no-cache" });
            if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
            return res;
        } catch (err) {
            const guardada = await caches.match(req, { ignoreSearch: true });
            if (guardada) return guardada;
            if (req.mode === "navigate") {
                const inicio = await caches.match("./");
                if (inicio) return inicio;
            }
            throw err;
        }
    })());
});
