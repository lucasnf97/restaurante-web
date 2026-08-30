# Vectoriza el logotipo Chief Point: convierte las letras de Poppins Medium en
# TRAZADOS, para que el logo no dependa de que la fuente esté instalada ni de que
# Google Fonts responda.
#
# Poppins es SIL OFL: convertir glifos a curvas para un logotipo está expresamente
# permitido, y el SVG resultante ya no contiene la fuente ni la redistribuye.
#
# La geometría replica EXACTAMENTE el CSS que ya se aprobó (bloque "Marca Chief Point"
# en restaurante-web/js/api.js), para que el vector y lo que se ve en pantalla no
# discrepen:
#   cuerpo 1000 u (1em) · letter-spacing -12 u (-0.012em) · punto 780 u (0.78em)
#   anillos por `inset`: 0% -> r=0.50D  ·  11% -> r=0.39D  ·  26% -> r=0.24D
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.environ.get("LOGO_SALIDA", AQUI)
os.makedirs(SALIDA, exist_ok=True)

# La fuente se BAJA, no se guarda en el repo: así no hay que redistribuirla ni
# arrastrar su licencia. Los SVG que salen de acá ya no la contienen.
TTF = os.path.join(AQUI, "Poppins-Medium.ttf")
if not os.path.exists(TTF):
    import urllib.request
    URL = "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Medium.ttf"
    print("Bajando Poppins-Medium.ttf...")
    urllib.request.urlretrieve(URL, TTF)

fuente = TTFont(TTF)
gs = fuente.getGlyphSet()
cmap = fuente.getBestCmap()
hmtx = fuente["hmtx"]
XH = fuente["OS/2"].sxHeight          # 551

TRACKING = -12                        # letter-spacing -0.012em
D_PUNTO   = 780                       # 0.78em
CY_PUNTO  = XH / 2.0                  # centrado en la altura de la x, como el CSS

NAVY, LIMA, R2, R3, R4 = "#1B1B33", "#C9FF1F", "#93BE1E", "#6E8A18", "#4C5A15"


def _glifo(ch):
    n = cmap.get(ord(ch))
    if n is None:
        raise SystemExit(f"Poppins no tiene el glifo '{ch}'")
    return n, hmtx[n][0]


def trazar(texto, x0=0.0):
    """Devuelve (path_d, ancho, huecos) de `texto`. Un '@' es el hueco del punto:
    NO se dibuja acá, se reserva su avance y se anota dónde va."""
    pen = SVGPathPen(gs)
    x, huecos = x0, []
    for i, ch in enumerate(texto):
        if ch == "@":
            huecos.append(x + D_PUNTO / 2.0)
            x += D_PUNTO
        else:
            n, avance = _glifo(ch)
            gs[n].draw(TransformPen(pen, (1, 0, 0, 1, x, 0)))
            x += avance
        if i < len(texto) - 1:
            x += TRACKING
    return pen.getCommands(), x - x0, huecos


def limites(texto, x0=0.0):
    """Caja de tinta real de las letras (sin el punto, que se suma aparte)."""
    bp = BoundsPen(gs)
    x = x0
    for i, ch in enumerate(texto):
        if ch == "@":
            x += D_PUNTO
        else:
            n, avance = _glifo(ch)
            gs[n].draw(TransformPen(bp, (1, 0, 0, 1, x, 0)))
            x += avance
        if i < len(texto) - 1:
            x += TRACKING
    return bp.bounds


def anillos(cx, cy, d, modo="tres", claro=False):
    """Los anillos concéntricos. `modo` implementa la degradación por tamaño que ya
    define el CSS: tres desde 32px, dos entre 24 y 32, plano por debajo.

    ⚠ La rampa va SIEMPRE de oscuro afuera a brillante adentro, en los dos fondos.
    El núcleo lima nunca toca el fondo —lo rodean los anillos oscuros—, así que no
    necesita cambiar sobre blanco: oscurecerlo invierte la rampa y el punto pasa a
    leerse como un agujero en vez de como una luz encendida.
    El ÚNICO que sí apoya directo sobre el fondo es el plano, y ahí sobre claro el
    lima no contrasta: ese va oliva."""
    r = d / 2.0
    if modo == "plano":
        return [(cx, cy, r, R3 if claro else LIMA)]
    if modo == "dos":
        return [(cx, cy, r, R3 if claro else R2), (cx, cy, 0.30 * d, LIMA)]
    return [(cx, cy, r, R4), (cx, cy, 0.39 * d, R2), (cx, cy, 0.24 * d, LIMA)]


def svg(nombre, lineas, claro=False, modo_punto="tres", mono=None, pad=40):
    """`lineas` = lista de (texto, y_baseline). El '@' marca dónde va el punto."""
    cuerpos, circulos = [], []
    x0, x1 = 1e9, -1e9
    y0, y1 = 1e9, -1e9

    for texto, base in lineas:
        d, ancho, huecos = trazar(texto)
        cuerpos.append((d, base))
        b = limites(texto)
        if b:
            x0, x1 = min(x0, b[0]), max(x1, b[2])
            y0, y1 = min(y0, base + b[1]), max(y1, base + b[3])
        for cx in huecos:
            circulos.append((cx, base + CY_PUNTO))
            x0, x1 = min(x0, cx - D_PUNTO / 2), max(x1, cx + D_PUNTO / 2)
            y0 = min(y0, base + CY_PUNTO - D_PUNTO / 2)
            y1 = max(y1, base + CY_PUNTO + D_PUNTO / 2)

    W = (x1 - x0) + 2 * pad
    H = (y1 - y0) + 2 * pad
    # El eje Y de las fuentes va hacia ARRIBA y el de SVG hacia abajo: se invierte
    # una sola vez en el grupo, en vez de negar cada coordenada.
    tx, ty = pad - x0, pad + y1

    tinta = mono or (NAVY if claro else "#FFFFFF")
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" '
         f'width="{W:.0f}" height="{H:.0f}" role="img" aria-label="Chief Point">',
         '  <title>Chief Point</title>',
         f'  <g transform="translate({tx:.2f} {ty:.2f}) scale(1 -1)">']
    for d, base in cuerpos:
        p.append(f'    <path fill="{tinta}" transform="translate(0 {base})" d="{d}"/>')
    for cx, cy in circulos:
        for ccx, ccy, r, col in anillos(cx, cy, D_PUNTO, modo_punto, claro):
            # En monocromo el punto es UN círculo lleno: en una térmica de tickets
            # los tres anillos se imprimen como una mancha negra indistinguible.
            if mono:
                p.append(f'    <circle cx="{ccx:.2f}" cy="{ccy:.2f}" r="{D_PUNTO/2:.2f}" fill="{mono}"/>')
                break
            p.append(f'    <circle cx="{ccx:.2f}" cy="{ccy:.2f}" r="{r:.2f}" fill="{col}"/>')
    p += ['  </g>', '</svg>', '']
    ruta = os.path.join(SALIDA, nombre)
    open(ruta, "w", encoding="utf-8").write("\n".join(p))
    print(f"  {nombre:34s} {W:5.0f} x {H:4.0f}")
    return ruta


def svg_icono(nombre, modo, claro=False):
    """Sólo el punto: es lo más reconocible de la marca y lo único que sobrevive
    intacto a 24 px."""
    d = 1000.0
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {d:.0f} {d:.0f}" '
         f'width="{d:.0f}" height="{d:.0f}" role="img" aria-label="Chief Point">',
         '  <title>Chief Point</title>']
    for cx, cy, r, col in anillos(d / 2, d / 2, d, modo, claro):
        p.append(f'  <circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="{col}"/>')
    p += ['</svg>', '']
    open(os.path.join(SALIDA, nombre), "w", encoding="utf-8").write("\n".join(p))
    print(f"  {nombre:34s} {d:5.0f} x {d:4.0f}")


print("Logotipo (letras convertidas a trazados):")
H = [("chief p@int", 0)]
V = [("chief", 1150), ("p@int", 0)]          # interlínea 1.15em, como el CSS

svg("chiefpoint-horizontal.svg",        H)
svg("chiefpoint-horizontal-claro.svg",  H, claro=True)
svg("chiefpoint-vertical.svg",          V)
svg("chiefpoint-vertical-claro.svg",    V, claro=True)
svg("chiefpoint-mono-negro.svg",        H, mono="#000000")
svg("chiefpoint-mono-blanco.svg",       H, mono="#FFFFFF")
print("Icono (sólo el punto):")
svg_icono("chiefpoint-icono.svg",        "tres")
svg_icono("chiefpoint-icono-24.svg",     "dos")
svg_icono("chiefpoint-icono-16.svg",     "plano")
svg_icono("chiefpoint-icono-claro.svg",  "tres", claro=True)
print("\nEn", SALIDA)
