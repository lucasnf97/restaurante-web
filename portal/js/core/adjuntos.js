// ── adjuntos.js — selección de archivos + helpers Cloudinary ──
// El multipart SIEMPRE va por fetch del webview (FormData); CapacitorHttp no
// arma multipart. sesion.js expone apiLocal(rid).form(endpoint, formData).

// Abre el picker del sistema y devuelve File[] (vacío si cancela).
export function elegirArchivos({ multiple = true, accept = "" } = {}) {
    return new Promise((resolve) => {
        const inp = document.createElement("input");
        inp.type = "file";
        if (multiple) inp.multiple = true;
        if (accept) inp.accept = accept;
        inp.style.display = "none";
        document.body.appendChild(inp);
        inp.addEventListener("change", () => {
            resolve(Array.from(inp.files || []));
            inp.remove();
        });
        // Si el usuario cancela no hay evento confiable: limpiar al volver el foco.
        window.addEventListener("focus", () => {
            setTimeout(() => { if (document.body.contains(inp)) { resolve([]); inp.remove(); } }, 800);
        }, { once: true });
        inp.click();
    });
}

// Miniatura Cloudinary (w_800, formato/calidad auto). El original queda para el visor.
export function thumb(url) {
    if (!url || !url.includes("/upload/")) return url;
    return url.replace("/upload/", "/upload/w_800,f_auto,q_auto/");
}

// Visor de imagen a pantalla completa (cierra por tap).
export function verImagen(url) {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.style.cssText += ";background:rgba(0,0,0,.92);padding:0;";
    ov.innerHTML = `<img src="${url}" style="max-width:100vw;max-height:100vh;object-fit:contain;">`;
    ov.addEventListener("click", () => ov.remove());
    document.body.appendChild(ov);
}

// File → {nombre, mime, data(base64)} para subir por JSON (transporte NATIVO).
// En iOS el multipart del webview falla ("Load failed"): TODAS las subidas de la
// app van por los endpoints gemelos *-json con los archivos en base64.
export function fileAB64(f) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
            const s = String(r.result || "");
            resolve({ nombre: f.name || "archivo", mime: f.type || null,
                      data: s.includes(",") ? s.slice(s.indexOf(",") + 1) : s });
        };
        r.onerror = () => reject(new Error("No se pudo leer el archivo."));
        r.readAsDataURL(f);
    });
}
export function filesAB64(files) { return Promise.all([...files].map(fileAB64)); }

// Abrir documento/archivo externo (browser del sistema en nativo).
export async function abrirArchivo(url) {
    const esNativo = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    const Browser = esNativo && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (Browser) await Browser.open({ url });
    else window.open(url, "_blank", "noopener");
}
