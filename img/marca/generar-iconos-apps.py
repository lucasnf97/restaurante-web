# Iconos de app a partir del monograma elegido.
#
# POS -> fondo AZUL NOCHE. Portal -> fondo BLANCO.
# El argumento no es estetico: alguien puede tener LAS DOS apps (un encargado usa el
# Portal en su movil y el POS en la tablet, o las dos en el mismo aparato). Con el
# mismo monograma y el mismo fondo serian indistinguibles en la pantalla de inicio.
# Fondos opuestos es lo que las hace distinguibles de un vistazo. Cual va a cada una
# pesa menos: el POS es equipo del local, montado en una tablet y usado en penumbra
# durante el servicio -> oscuro lee como herramienta; el Portal vive en el movil
# personal del empleado, entre apps personales -> claro lee mas cercano.
import os
os.environ["QT_QPA_PLATFORM"] = "offscreen"
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QImage, QPainter, QColor, QPixmap
from PyQt6.QtSvg import QSvgRenderer
from PyQt6.QtCore import QRectF, Qt

AQUI = os.path.dirname(os.path.abspath(__file__))
FIN = os.path.join(AQUI, "final")
app = QApplication([])

APPS = [
    {"repo": "restaurante-pos",        "fondo": "#1B1B33", "svg": "chiefpoint-monograma.svg"},
    {"repo": "restaurante-empleados",  "fondo": "#FFFFFF", "svg": "chiefpoint-monograma-claro.svg"},
]
DENS = [("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216),
        ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432)]

def pintar(rend, lado, fondo, forma, frac):
    """forma: 'cuadrado' | 'circulo' | 'ninguno' (foreground adaptativo)."""
    img = QImage(lado, lado, QImage.Format.Format_ARGB32)
    img.fill(Qt.GlobalColor.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    if forma != "ninguno":
        p.setPen(Qt.PenStyle.NoPen); p.setBrush(QColor(fondo))
        if forma == "circulo":
            p.drawEllipse(QRectF(0, 0, lado, lado))
        else:
            p.drawRoundedRect(QRectF(0, 0, lado, lado), lado * 0.16, lado * 0.16)
    m = lado * (1 - frac) / 2
    rend.render(p, QRectF(m, m, lado * frac, lado * frac))
    p.end()
    return img

for a in APPS:
    base = os.path.join(r"c:\Users\lucas\proyecto", a["repo"], "android", "app", "src", "main", "res")
    rend = QSvgRenderer(os.path.join(FIN, a["svg"]))
    assert rend.isValid(), a["svg"]
    print("== %s  fondo %s" % (a["repo"], a["fondo"]))

    for dens, leg, fg in DENS:
        d = os.path.join(base, "mipmap-" + dens)
        # Legado (Android < 8): el fondo va incrustado.
        pintar(rend, leg, a["fondo"], "cuadrado", 0.62).save(os.path.join(d, "ic_launcher.png"))
        pintar(rend, leg, a["fondo"], "circulo", 0.60).save(os.path.join(d, "ic_launcher_round.png"))
        # ⚠ Adaptativo: el lienzo es de 108dp pero el sistema solo garantiza los 72dp
        # centrales — el resto lo recorta la mascara del fabricante. Por eso la marca
        # ocupa el 58%: mas grande, un movil con mascara circular le come el trazo.
        pintar(rend, fg, None, "ninguno", 0.58).save(os.path.join(d, "ic_launcher_foreground.png"))
    print("   android: 15 png")

    # Color de fondo del icono adaptativo.
    xml = os.path.join(base, "values", "ic_launcher_background.xml")
    open(xml, "w", encoding="utf-8").write(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        '    <color name="ic_launcher_background">%s</color>\n</resources>\n' % a["fondo"])
    print("   android: color de fondo -> %s" % a["fondo"])

    # iOS: 1024, cuadrado completo y SIN canal alfa (App Store lo rechaza con alfa).
    ios = os.path.join(r"c:\Users\lucas\proyecto", a["repo"], "ios", "App", "App",
                       "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png")
    img = QImage(1024, 1024, QImage.Format.Format_RGB32)
    img.fill(QColor(a["fondo"]))
    p = QPainter(img); p.setRenderHint(QPainter.RenderHint.Antialiasing)
    m = 1024 * (1 - 0.62) / 2
    rend.render(p, QRectF(m, m, 1024 * 0.62, 1024 * 0.62)); p.end()
    img.save(ios)
    print("   ios: AppIcon-512@2x.png 1024x1024 sin alfa")
