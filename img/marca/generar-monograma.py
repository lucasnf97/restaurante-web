# El monograma elegido, y a partir de el los iconos de las dos apps.
#
# Receta: abertura 90 · punto 85% · trazo 150 · hueco arriba-derecha · terminal
# redondo · con aro. Misma geometria que el configurador (verificada: el arco
# arranca en el mismo punto que la version JS).
import os, math

AQUI = os.path.dirname(os.path.abspath(__file__))
SAL = os.path.join(AQUI, "final"); os.makedirs(SAL, exist_ok=True)

NAVY, LIMA, R2, R4 = "#1B1B33", "#C9FF1F", "#93BE1E", "#4C5A15"
CX = CY = 500.0
R, W, GAP, GIRO, CAP = 340.0, 150.0, 90.0, -45.0, "round"
FRAC = 0.85

HUECO = R - W / 2                      # 265
r_punto = HUECO * FRAC                 # 225.25
# ⚠ El aro no puede pasarse del hueco o se mete dentro del trazo de la C.
r_aro = min(r_punto * 1.30, HUECO)     # queda recortado a 265

def svg(trazo):
    a0 = math.radians(GAP / 2 + GIRO)
    a1 = math.radians(360 - GAP / 2 + GIRO)
    x0, y0 = CX + R * math.cos(a0), CY + R * math.sin(a0)
    x1, y1 = CX + R * math.cos(a1), CY + R * math.sin(a1)
    grande = 1 if (360 - GAP) > 180 else 0
    return "\n".join([
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="Chief Point">',
        '  <title>Chief Point</title>',
        '  <circle cx="500" cy="500" r="%.1f" fill="%s"/>' % (r_aro, R4),
        '  <circle cx="500" cy="500" r="%.1f" fill="%s"/>' % (r_punto, LIMA),
        '  <path d="M %.2f %.2f A %.1f %.1f 0 %d 1 %.2f %.2f" fill="none" stroke="%s" '
        'stroke-width="%.0f" stroke-linecap="%s"/>' % (x0, y0, R, R, grande, x1, y1, trazo, W, CAP),
        '</svg>', ''])

open(os.path.join(SAL, "chiefpoint-monograma.svg"), "w", encoding="utf-8").write(svg("#FFFFFF"))
open(os.path.join(SAL, "chiefpoint-monograma-claro.svg"), "w", encoding="utf-8").write(svg(NAVY))
print("hueco %.0f | punto %.1f | aro %.1f (recortado: %s)"
      % (HUECO, r_punto, r_aro, "si" if r_punto * 1.30 > HUECO else "no"))
print("monograma escrito en", SAL)
