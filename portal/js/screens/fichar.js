// ── FICHAR — entrada y salida desde el móvil ──────────────────────────────────
//
// Por qué existe: fichar en el terminal obliga a tipear usuario y contraseña delante de la cola
// de la caja. Acá el empleado YA está identificado por su sesión; lo único que falta es probar
// que está EN EL LOCAL, y para eso hay tres caminos que el restaurante activa desde la web:
// apoyar el móvil en un tag (NFC), estar en el WiFi del local, o estar dentro del radio (GPS).
// De más fuerte a más flojo como prueba de presencia, en ese mismo orden.
//
// ⚠ Lo que el tag prueba y lo que no: prueba que el TELÉFONO estuvo en el local, no que la
// persona estuvo. Prestarle el móvil a un compañero sigue funcionando — igual que darle tu
// usuario y contraseña para que fiche por vos en el terminal.
//
// ⚠ Los tags de prueba (NTAG213/215) se clonan en 30 segundos. La verificación de verdad la da
// el NTAG 424 DNA, que firma cada toque; el backend ya tiene el hueco para eso.
import { esc } from "../core/api.js";
import { getRestaurantes, getLocalActivo, setLocalActivo, apiLocal, nombreLocal } from "../core/sesion.js";
import * as drawer from "../drawer.js";
import * as nfc from "../core/nfc.js";

let _rid = null;
let _estado = null;
let _leyendo = false;

function _hora(ts) {
    if (!ts) return "—";
    try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return "—"; }
}

function _transcurrido(desde) {
    if (!desde) return "";
    const min = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000));
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h} h ${m} min` : `${m} min`;
}

export async function mount(el) {
    const locales = await getRestaurantes();
    _rid = getLocalActivo() || (locales[0] && locales[0].id) || null;

    el.innerHTML = `
    <div class="pantalla">
        ${drawer.headerConMenu("Fichar")}
        <div class="pantalla-body">
            ${locales.length > 1 ? `
            <div class="card res-card">
                <div class="res-card-titulo">🏠 Local</div>
                <select id="fi-local" class="input">
                    ${locales.map(l => `<option value="${l.id}" ${l.id === _rid ? "selected" : ""}>${esc(l.nombre || ("Local " + l.id))}</option>`).join("")}
                </select>
            </div>` : ""}

            <div class="card res-card" id="fi-estado-card">
                <div class="muted">Cargando…</div>
            </div>

            <div id="fi-accion"></div>

            <div class="card res-card" style="background:#f8fafc;">
                <div class="muted" style="font-size:12px;line-height:1.6;">
                    Sólo se puede fichar estando en el local. Si desde acá no podés,
                    fichá en el terminal de la caja como siempre.
                </div>
            </div>
        </div>
    </div>`;

    const sel = document.getElementById("fi-local");
    if (sel) sel.onchange = async () => {
        _rid = Number(sel.value);
        await setLocalActivo(_rid);
        await _cargar();
    };

    await _cargar();
}

async function _cargar() {
    const card = document.getElementById("fi-estado-card");
    if (!card || !_rid) return;
    try {
        _estado = await apiLocal(_rid).get("/turnos/mio");
    } catch (e) {
        card.innerHTML = `<div class="muted">No se pudo consultar tu estado. ${esc(e.message || "")}</div>`;
        return;
    }
    _pintar();
}

function _pintar() {
    const card = document.getElementById("fi-estado-card");
    const acc = document.getElementById("fi-accion");
    if (!card || !acc) return;

    const fichado = !!(_estado && _estado.fichado);
    const f = _estado && _estado.fichaje;

    card.innerHTML = fichado
        ? `<div class="res-card-titulo">🟢 Estás fichado</div>
           <div style="font-size:15px;">Entrada a las <b>${esc(_hora(f && f.ts_entrada))}</b></div>
           <div class="muted">Llevás ${esc(_transcurrido(f && f.ts_entrada))} en el turno</div>`
        : `<div class="res-card-titulo">⚪ No estás fichado</div>
           <div class="muted">${esc(nombreLocal(_rid) || "")}</div>`;

    const accion = fichado ? "salida" : "entrada";
    const etiqueta = fichado ? "Fichar salida" : "Fichar entrada";

    // Dos caminos, y se ofrecen los que de verdad estén disponibles ahora mismo. Prometer uno
    // que no va —el NFC en un local sin pegatina, o el WiFi estando con datos— es mandar a la
    // gente a pelearse con un botón que nunca iba a funcionar.
    // Los métodos los habilita el restaurante desde Configuración. Que el local tenga un tag
    // pegado o WiFi no significa que quiera que se fiche así.
    const hayNFC = !!(_estado && _estado.metodo_nfc) && nfc.disponible();
    const hayRed = !!(_estado && _estado.red_ok);
    const hayGPS = !!(_estado && _estado.metodo_gps) && !!navigator.geolocation;

    let html = "";
    if (hayNFC) {
        html += `<button id="fi-btn" class="btn-primario" style="width:100%;padding:18px;font-size:17px;">
                    📱 ${etiqueta} apoyando el móvil
                 </button>`;
    }
    if (hayRed) {
        html += `<button id="fi-btn-red" class="${hayNFC ? "btn-sec" : "btn-primario"}"
                    style="width:100%;padding:${hayNFC ? "14px" : "18px"};font-size:${hayNFC ? "15px" : "17px"};margin-top:${hayNFC ? "10px" : "0"};">
                    📶 ${etiqueta} (estás en el WiFi del local)
                 </button>`;
    }

    if (hayGPS) {
        const primero = !hayNFC && !hayRed;
        html += `<button id="fi-btn-gps" class="${primero ? "btn-primario" : "btn-sec"}"
                    style="width:100%;padding:${primero ? "18px" : "14px"};font-size:${primero ? "17px" : "15px"};margin-top:${primero ? "0" : "10px"};">
                    📍 ${etiqueta} (estás en el local)
                 </button>`;
    }

    // Respaldo por contraseña: SIEMPRE el último y el más discreto. No prueba presencia
    // (se puede fichar desde casa), así que no puede competir visualmente con el tag.
    const hayClave = _estado && _estado.metodo_credencial;
    if (hayClave) {
        const solo = !hayNFC && !hayRed && !hayGPS;
        html += `<button id="fi-btn-clave" class="${solo ? "btn-primario" : "btn-sec"}"
                    style="width:100%;padding:${solo ? "18px" : "12px"};font-size:${solo ? "17px" : "14px"};margin-top:${solo ? "0" : "10px"};">
                    🔑 ${etiqueta} con mi contraseña
                 </button>`;
    }

    if (!html) {
        // Se explica POR QUÉ no se puede, no un "no disponible" a secas: el que llega tarde y
        // no puede fichar necesita saber si le falta WiFi o si tiene que ir a la caja.
        let motivo = "Este restaurante no tiene activado el fichaje desde el móvil. Fichá en el terminal de la caja.";
        const algunoActivo = _estado && (_estado.metodo_nfc || _estado.metodo_wifi || _estado.metodo_gps);
        if (algunoActivo && _estado.metodo_wifi && _estado.red_motivo === "otra_red") {
            motivo = "Conectate al WiFi del local para fichar desde el móvil, o fichá en el terminal.";
        } else if (algunoActivo && _estado.metodo_nfc && !nfc.disponible()) {
            motivo = "Este teléfono no puede leer NFC. Fichá en el terminal de la caja.";
        } else if (algunoActivo) {
            motivo = "Ahora mismo no se puede fichar desde el móvil. Fichá en el terminal de la caja.";
        }
        acc.innerHTML = `<div class="card res-card"><div class="muted">${esc(motivo)}</div></div>`;
        return;
    }

    acc.innerHTML = html +
        `<div id="fi-msg" class="muted" style="text-align:center;margin-top:10px;min-height:20px;"></div>`;
    const bn = document.getElementById("fi-btn");
    if (bn) bn.onclick = () => _fichar(accion);
    const br = document.getElementById("fi-btn-red");
    if (br) br.onclick = () => _ficharPorRed(accion);
    const bg = document.getElementById("fi-btn-gps");
    if (bg) bg.onclick = () => _ficharPorGPS(accion);
    const bc = document.getElementById("fi-btn-clave");
    if (bc) bc.onclick = () => _ficharConClave(accion);
}

// ── FUERA DE LA VENTANA DE ENTRADA ───────────────────────────────────────────
// El backend no dice "no": dice "decí por qué" (409 `fuera_de_horario`). Mostrar eso como
// un error a secas dejaría a alguien sin poder fichar por un turno que cambió a último
// momento — lo más común del mundo. Así que se pide el motivo ACÁ y se reintenta.
//
// ⚠ No se vuelve a leer el tag ni a pedir la contraseña: se reintenta el MISMO envío con
//   el motivo agregado. Volver a empezar sería castigar al usuario por preguntarle algo.
function _pedirMotivo(mensaje) {
    return new Promise(resolve => {
        const acc = document.getElementById("fi-accion");
        if (!acc) { resolve(null); return; }
        acc.innerHTML = `
        <div class="card res-card" style="border-left:4px solid #d97706;">
            <div style="font-weight:700;margin-bottom:6px;">⏰ Fuera de tu horario</div>
            <div class="muted" style="margin-bottom:10px;">${esc(mensaje || "Estás fuera de tu horario asignado.")}</div>
            <div class="muted" style="margin-bottom:6px;">Podés fichar igual explicando por qué. Queda registrado con tu motivo.</div>
            <textarea id="fi-motivo" class="input" rows="3"
                placeholder="Ej.: hablado con el encargado, me pidió entrar 1 h antes"></textarea>
            <div id="fi-motivo-err" class="muted" style="color:#dc2626;min-height:18px;"></div>
            <button id="fi-motivo-ok" class="btn-primario" style="width:100%;padding:14px;">Fichar igual</button>
            <button id="fi-motivo-no" class="btn-sec" style="width:100%;padding:12px;margin-top:8px;">Cancelar</button>
        </div>`;
        const ta = document.getElementById("fi-motivo");
        if (ta) ta.focus();
        document.getElementById("fi-motivo-no").onclick = () => { resolve(null); _pintar(); };
        document.getElementById("fi-motivo-ok").onclick = () => {
            const v = (ta && ta.value || "").trim();
            // Lo mismo que exige el backend: que no esté vacío (sin mínimo de largo).
            if (!v) {
                document.getElementById("fi-motivo-err").textContent = "Escribí el motivo.";
                return;
            }
            resolve(v);
        };
    });
}

/** ¿Fue el 409 de fuera de horario? Si sí, pide el motivo y reintenta. Devuelve true
 *  cuando ya se hizo cargo (haya reintentado o cancelado), para no mostrar el error. */
async function _siFueraDeHorario(e, reintentar) {
    const d = e && e.datos;
    if (!d || d.codigo !== "fuera_de_horario") return false;
    const motivo = await _pedirMotivo(d.mensaje);
    if (motivo) await reintentar(motivo);
    return true;
}

/** Manda el fichaje y muestra el resultado. Todos los caminos (tag, WiFi, GPS,
 *  contraseña) pasan por acá para que el reintento CON MOTIVO sea idéntico en los
 *  cuatro: se reenvía el MISMO cuerpo más el motivo, sin repetir la lectura del tag
 *  ni volver a pedir la contraseña. */
async function _enviar(url, cuerpo, okTexto) {
    try {
        const r = await apiLocal(_rid).post(url, cuerpo);
        _leyendo = false;
        await _cargar();
        const m = document.getElementById("fi-msg");
        if (m) { m.textContent = okTexto(r); m.style.color = "#16a34a"; }
    } catch (e) {
        _leyendo = false;
        if (await _siFueraDeHorario(e, mo => _enviar(url, Object.assign({}, cuerpo, { motivo: mo }), okTexto))) return;
        _pintar();
        const m = document.getElementById("fi-msg");
        // El backend ya manda mensajes en cristiano ("Ese punto no está habilitado…",
        // "conectate al WiFi del local"), así que se muestran tal cual.
        if (m) { m.textContent = e.message || "No se pudo fichar."; m.style.color = "#dc2626"; }
    }
}

const _txtOk = (extra) => (r) => r.accion === "salida"
    ? `Salida registrada a las ${_hora(r.ts)}`
    : (r.reclamado ? ("Ya tenías el turno abierto" + (extra || "") + ".")
                   : `Entrada registrada a las ${_hora(r.ts)}`);

async function _fichar(accion) {
    if (_leyendo) return;
    _leyendo = true;
    const btn = document.getElementById("fi-btn");
    const msg = document.getElementById("fi-msg");
    const decir = t => { if (msg) msg.textContent = t; };
    // Pulso: esperando algo que no tiene porcentaje ni final conocido. El texto es
    // fijo, así que innerHTML acá no mete nada del usuario.
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = UI.marca("pulse", "cp-mini") + "Apoyá el móvil en el punto…";
    }
    decir("Acercalo a la pegatina y mantenelo un segundo.");

    let uid = null;
    try {
        uid = await nfc.leerUID();
    } catch (e) {
        decir(e && e.message ? e.message : "No se pudo leer el tag.");
        _leyendo = false;
        _pintar();
        return;
    }
    if (!uid) {                      // el usuario canceló el escaneo
        _leyendo = false;
        _pintar();
        return;
    }

    await _enviar("/turnos/fichar-nfc", { tag_uid: uid, accion },
                  _txtOk(": se trajo a este punto"));
}

/** Fichar reingresando la contraseña. Es el ÚLTIMO recurso y conviene que se note:
 *  prueba QUIÉN sos, no DÓNDE estás. Existe para que nadie trabaje sin registrar su
 *  jornada porque el tag se despegó o el teléfono no lee NFC. */
async function _ficharConClave(accion) {
    if (_leyendo) return;
    const acc = document.getElementById("fi-accion");
    if (!acc) return;
    acc.innerHTML = `
    <div class="card res-card">
        <div style="font-weight:700;margin-bottom:6px;">🔑 ${accion === "salida" ? "Registrar salida" : "Registrar entrada"} con contraseña</div>
        <div class="muted" style="margin-bottom:10px;">Usá esto sólo si no podés fichar con el tag. Queda registrado que fichaste así.</div>
        <input id="fi-clave" class="input" type="password" autocomplete="current-password" placeholder="Tu contraseña">
        <div id="fi-clave-err" class="muted" style="color:#dc2626;min-height:18px;"></div>
        <button id="fi-clave-ok" class="btn-primario" style="width:100%;padding:14px;">Fichar</button>
        <button id="fi-clave-no" class="btn-sec" style="width:100%;padding:12px;margin-top:8px;">Cancelar</button>
        <div id="fi-msg" class="muted" style="text-align:center;margin-top:10px;min-height:20px;"></div>
    </div>`;
    const inp = document.getElementById("fi-clave");
    if (inp) inp.focus();
    document.getElementById("fi-clave-no").onclick = () => _pintar();
    document.getElementById("fi-clave-ok").onclick = async () => {
        const pw = (inp && inp.value) || "";
        if (!pw) {
            document.getElementById("fi-clave-err").textContent = "Escribí tu contraseña.";
            return;
        }
        _leyendo = true;
        await _enviar("/turnos/fichar-credencial", { password: pw, accion }, _txtOk());
    };
}

/** Fichar por estar en la red del local. No hay nada que leer: la comprobación la hace el
 *  servidor con la IP desde la que llega esta misma petición. */
async function _ficharPorRed(accion) {
    if (_leyendo) return;
    _leyendo = true;
    const br = document.getElementById("fi-btn-red");
    if (br) { br.disabled = true; br.textContent = "Fichando…"; }
    await _enviar("/turnos/fichar-red", { accion }, _txtOk());
}

/** Fichar por ubicación. Pide el GPS del móvil y manda las coordenadas; el servidor decide
 *  si caen dentro del radio del local.
 *
 *  ⚠ La ubicación NO se guarda en ningún lado: se usa para decidir y se descarta. En el
 *  fichaje sólo queda que se verificó por GPS. */
async function _ficharPorGPS(accion) {
    if (_leyendo) return;
    _leyendo = true;
    const bg = document.getElementById("fi-btn-gps");
    const msg = document.getElementById("fi-msg");
    if (bg) {
        bg.disabled = true;
        bg.innerHTML = UI.marca("pulse", "cp-mini") + "Buscando tu ubicación…";
    }
    if (msg) { msg.textContent = "Puede tardar unos segundos."; msg.style.color = ""; }

    let pos = null;
    try {
        pos = await new Promise((ok, err) => {
            navigator.geolocation.getCurrentPosition(ok, err,
                // `enableHighAccuracy`: sin esto el móvil responde con la posición de la antena,
                // que puede errar cientos de metros y el servidor la rechaza por imprecisa.
                { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        });
    } catch (e) {
        _leyendo = false;
        _pintar();
        const m = document.getElementById("fi-msg");
        if (m) {
            m.textContent = (e && e.code === 1)
                ? "Hace falta dar permiso de ubicación para fichar así."
                : "No se pudo obtener tu ubicación. Probá al aire libre o fichá en el terminal.";
            m.style.color = "#dc2626";
        }
        return;
    }

    await _enviar("/turnos/fichar-gps", {
        accion,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        precision_m: pos.coords.accuracy,
    }, _txtOk());
}

export function unmount() { _leyendo = false; }
