#!/usr/bin/env python3
"""Genera la marca de TradIA Cloud desde una sola geometría (viewBox 108):
logo.svg, banner.svg, ícono Android (vector), ícono de notificación y PNG.
Uso: python3 docs/marca/generar.py"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(RAIZ, "docs")
RES = os.path.join(RAIZ, "app/android/app/src/main/res/drawable")

# Paleta «atardecer indie»
CIELO_A, CIELO_B = "#2E2443", "#18131F"   # degradado del fondo
CREMA, TERRACOTA, MOSTAZA, SALVIA = "#F4EBDD", "#E07A5F", "#F2B544", "#8FB9A8"

TINTA = "#15111C"                         # lentes y contorno del rayo

# Geometría (viewBox 108). Nube con lentes de sol, atravesada por una gráfica-rayo.
NUBE = [(33, 61, 15), (54, 46, 21), (76, 59, 14)]      # círculos (cx, cy, r)
BASE = (18, 58, 90, 77, 9.5)                              # rectángulo redondeado x1,y1,x2,y2,r
RAYO = [(14, 95), (34, 75), (44, 88), (86, 55)]         # gráfica en zigzag (sube como un rayo)
PUNTA = (101, 42)                                        # punta de la flecha
ESTRELLAS = [(22, 26, 1.4), (34, 17, .9), (86, 84, 1.1), (16, 60, .8), (94, 60, .9), (64, 14, 1.0)]
LENTES = [(31.5, 51.5), (57.5, 77.5)]                       # x1, x2 de cada lente
LENTE_Y, LENTE_ALTO = 48.5, 12
PUENTE = (28.5, 45.5, 80.5, 50, 2.2)


def circ_path(cx, cy, r):
    return f"M{cx - r:g},{cy:g} a{r:g},{r:g} 0 1,0 {2 * r:g},0 a{r:g},{r:g} 0 1,0 {-2 * r:g},0 Z"


def rrect_path(x1, y1, x2, y2, r):
    return (f"M{x1 + r:g},{y1:g} H{x2 - r:g} A{r:g},{r:g} 0 0 1 {x2:g},{y1 + r:g} V{y2 - r:g} A{r:g},{r:g} 0 0 1 {x2 - r:g},{y2:g} "
            f"H{x1 + r:g} A{r:g},{r:g} 0 0 1 {x1:g},{y2 - r:g} V{y1 + r:g} A{r:g},{r:g} 0 0 1 {x1 + r:g},{y1:g} Z")


def poli_path(pts):
    return "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in pts) + " Z"


def _norm(dx, dy):
    l = math.hypot(dx, dy)
    return dx / l, dy / l


def rayo_poligono(medio, borde=0.0):
    """Contorno del rayo con esquinas en inglete (filosas) y flecha al final."""
    pts = RAYO
    medio_v = medio + borde
    izq, der = [], []
    for i, (x, y) in enumerate(pts):
        if i == 0:
            dx, dy = _norm(pts[1][0] - x, pts[1][1] - y)
            nx, ny = -dy, dx
            k = medio_v
        elif i == len(pts) - 1:
            dx, dy = _norm(x - pts[i - 1][0], y - pts[i - 1][1])
            nx, ny = -dy, dx
            k = medio_v
        else:
            a = _norm(x - pts[i - 1][0], y - pts[i - 1][1])
            b = _norm(pts[i + 1][0] - x, pts[i + 1][1] - y)
            na, nb = (-a[1], a[0]), (-b[1], b[0])
            nx, ny = _norm(na[0] + nb[0], na[1] + nb[1])
            k = medio_v / max(.25, nx * na[0] + ny * na[1])
        izq.append((x + nx * k, y + ny * k))
        der.append((x - nx * k, y - ny * k))
    # Flecha: base en el último punto, punta en PUNTA.
    ex, ey = pts[-1]
    dx, dy = _norm(PUNTA[0] - ex, PUNTA[1] - ey)
    nx, ny = -dy, dx
    ala = medio * 2.8 + borde * 1.6
    atras = borde * 1.3   # el contorno de la flecha arranca un poco antes
    bx, by = ex - dx * atras, ey - dy * atras
    tx, ty = PUNTA[0] + dx * borde * 2.4, PUNTA[1] + dy * borde * 2.4
    flecha = [(bx + nx * ala, by + ny * ala), (tx, ty), (bx - nx * ala, by - ny * ala)]
    return izq[:-1] + [(bx + nx * (medio + borde), by + ny * (medio + borde))] + flecha + [(bx - nx * (medio + borde), by - ny * (medio + borde))] + der[:-1][::-1]


def lente(x1, x2):
    cx, rx = (x1 + x2) / 2, (x2 - x1) / 2
    return [(x1, LENTE_Y)] + [(cx - rx * math.cos(t), LENTE_Y + LENTE_ALTO * math.sin(t))
                              for t in [i * math.pi / 16 for i in range(17)]] + [(x2, LENTE_Y)]


def brillo(x1):
    y = LENTE_Y
    return [(x1 + 7.6, y + 2.0), (x1 + 10.0, y + 2.0), (x1 + 6.0, y + 8.2), (x1 + 3.6, y + 8.2)]


NUBE_D = " ".join([circ_path(*c) for c in NUBE] + [rrect_path(*BASE)])
FONDO_D = rrect_path(0, 0, 108, 108, 26)
RAYO_BORDE = rayo_poligono(2.7, 2.0)
RAYO_CUERPO = rayo_poligono(2.7)
LENTES_D = " ".join(poli_path(lente(*l)) for l in LENTES) + " " + rrect_path(*PUENTE)
BRILLOS_D = " ".join(poli_path(brillo(l[0])) for l in LENTES)


def marca_svg(prefijo="m", fondo=True):
    """Grupo SVG de la marca (sin <svg>), reutilizable en logo, banner y app."""
    g = []
    if fondo:
        g.append(f'<defs><linearGradient id="{prefijo}c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{CIELO_A}"/><stop offset="1" stop-color="{CIELO_B}"/></linearGradient>'
                 f'<radialGradient id="{prefijo}h" cx=".55" cy=".5" r=".5"><stop offset="0" stop-color="{TERRACOTA}" stop-opacity=".30"/><stop offset="1" stop-color="{TERRACOTA}" stop-opacity="0"/></radialGradient>'
                 f'<linearGradient id="{prefijo}r" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="{TERRACOTA}"/><stop offset="1" stop-color="{MOSTAZA}"/></linearGradient></defs>')
        g.append(f'<rect width="108" height="108" rx="26" fill="url(#{prefijo}c)"/>')
        g.append(f'<circle cx="56" cy="56" r="44" fill="url(#{prefijo}h)"/>')
        g.append("".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{CREMA}" opacity=".6"/>' for x, y, r in ESTRELLAS))
        relleno_rayo = f"url(#{prefijo}r)"
    else:
        relleno_rayo = MOSTAZA
    g.append(f'<path d="{NUBE_D}" fill="{CREMA}"/>')
    g.append(f'<path d="{poli_path(RAYO_BORDE)}" fill="{CIELO_B if fondo else TINTA}"/>')
    g.append(f'<path d="{poli_path(RAYO_CUERPO)}" fill="{relleno_rayo}"/>')
    g.append(f'<path d="{LENTES_D}" fill="{TINTA}"/>')
    g.append(f'<path d="{BRILLOS_D}" fill="{CREMA}" opacity=".85"/>')
    return "".join(g)


def escribir(ruta, texto):
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(texto)


def svg_logo():
    escribir(os.path.join(DOCS, "logo.svg"), f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">{marca_svg()}</svg>\n')


def svg_banner():
    w, h = 1280, 400
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">'
         f'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{CIELO_A}"/><stop offset="1" stop-color="{CIELO_B}"/></linearGradient>'
         f'<radialGradient id="sol" cx=".82" cy=".25" r=".5"><stop offset="0" stop-color="{MOSTAZA}" stop-opacity=".22"/><stop offset="1" stop-color="{MOSTAZA}" stop-opacity="0"/></radialGradient></defs>'
         f'<rect width="{w}" height="{h}" rx="28" fill="url(#bg)"/><rect width="{w}" height="{h}" rx="28" fill="url(#sol)"/>'
         f'<path d="M0,330 C220,300 380,350 620,318 C860,286 1040,330 1280,296 V400 H0 Z" fill="{TERRACOTA}" opacity=".10"/>'
         f'<path d="M0,356 C260,336 420,372 680,346 C900,324 1080,356 1280,336 V400 H0 Z" fill="{SALVIA}" opacity=".10"/>'
         f'<g transform="translate(96,92) scale(2)">{marca_svg("b")}</g>'
         f'<text x="360" y="196" font-family="Georgia,\'Noto Serif\',serif" font-size="92" fill="{CREMA}">trad<tspan fill="{TERRACOTA}" font-style="italic">IA</tspan><tspan fill="{CREMA}" opacity=".75"> cloud</tspan></text>'
         f'<text x="364" y="252" font-family="system-ui,Roboto,sans-serif" font-size="26" letter-spacing="3" fill="{CREMA}" opacity=".7">TU AGENTE CRIPTO, EN TU PROPIA NUBE</text>'
         f'<text x="364" y="300" font-family="system-ui,Roboto,sans-serif" font-size="21" fill="{SALVIA}">observa · razona con varias IAs · actúa con tus reglas</text>'
         '</svg>\n')
    escribir(os.path.join(DOCS, "banner.svg"), s)


def vector_android():
    """Ícono de la app (VectorDrawable; degradados aproximados con capas sólidas)."""
    est = " ".join(circ_path(x, y, r) for x, y, r in ESTRELLAS)
    v = f'''<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por docs/marca/generar.py: no editar a mano. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="{CIELO_B}" android:pathData="{FONDO_D}"/>
    <path android:fillColor="{CIELO_A}" android:pathData="{rrect_path(0, 0, 108, 64, 26)}"/>
    <path android:fillColor="{TERRACOTA}" android:fillAlpha="0.12" android:pathData="{circ_path(56, 56, 40)}"/>
    <path android:fillColor="{CREMA}" android:fillAlpha="0.6" android:pathData="{est}"/>
    <path android:fillColor="{CREMA}" android:pathData="{NUBE_D}"/>
    <path android:fillColor="{CIELO_B}" android:pathData="{poli_path(RAYO_BORDE)}"/>
    <path android:fillColor="{MOSTAZA}" android:pathData="{poli_path(RAYO_CUERPO)}"/>
    <path android:fillColor="{TINTA}" android:pathData="{LENTES_D}"/>
    <path android:fillColor="{CREMA}" android:fillAlpha="0.85" android:pathData="{BRILLOS_D}"/>
</vector>
'''
    escribir(os.path.join(RES, "ic_launcher.xml"), v)
    # Notificación: silueta blanca de la nube con el rayo calado (evenOdd).
    n = f'''<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por docs/marca/generar.py: no editar a mano. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#FFFFFF" android:pathData="{NUBE_D}"/>
    <path android:fillColor="#FFFFFF" android:pathData="{poli_path(RAYO_CUERPO)}"/>
</vector>
'''
    escribir(os.path.join(RES, "ic_stat_agente.xml"), n)


def _hex(c, al=255):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (al,)


def _degradado(W, H, c1, c2, diagonal=True):
    a, b = _hex(c1), _hex(c2)
    g = Image.new("RGBA", (W, H))
    px = g.load()
    for y in range(H):
        for x in range(0, W, 1):
            t = ((x / W + y / H) / 2) if diagonal else y / H
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
    return g


def png(tam, ruta):
    k = tam / 108 * 3   # supermuestreo ×3
    W = int(108 * k)
    P = lambda pts: [(x * k, y * k) for x, y in pts]
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=26 * k, fill=255)
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    img.paste(_degradado(W, W, CIELO_A, CIELO_B), (0, 0), mask)
    halo = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(halo).ellipse([18 * k, 18 * k, 94 * k, 94 * k], fill=_hex(TERRACOTA, 70))
    halo = halo.filter(ImageFilter.GaussianBlur(14 * k))
    img = Image.alpha_composite(img, Image.composite(halo, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask))
    d = ImageDraw.Draw(img)
    for x, y, r in ESTRELLAS:
        d.ellipse([(x - r) * k, (y - r) * k, (x + r) * k, (y + r) * k], fill=_hex(CREMA, 150))
    for x, y, r in NUBE:
        d.ellipse([(x - r) * k, (y - r) * k, (x + r) * k, (y + r) * k], fill=_hex(CREMA))
    x1, y1, x2, y2, r = BASE
    d.rounded_rectangle([x1 * k, y1 * k, x2 * k, y2 * k], radius=r * k, fill=_hex(CREMA))
    d.polygon(P(RAYO_BORDE), fill=_hex(CIELO_B))
    # Rayo con degradado terracota → mostaza
    capa = Image.new("L", (W, W), 0)
    ImageDraw.Draw(capa).polygon(P(RAYO_CUERPO), fill=255)
    grad = _degradado(W, W, TERRACOTA, MOSTAZA)
    grad = grad.transpose(Image.FLIP_TOP_BOTTOM)
    img.paste(grad, (0, 0), capa)
    d = ImageDraw.Draw(img)
    for l in LENTES:
        d.polygon(P(lente(*l)), fill=_hex(TINTA))
    x1, y1, x2, y2, r = PUENTE
    d.rounded_rectangle([x1 * k, y1 * k, x2 * k, y2 * k], radius=r * k, fill=_hex(TINTA))
    for l in LENTES:
        d.polygon(P(brillo(l[0])), fill=_hex(CREMA, 215))
    img.resize((tam, tam), Image.LANCZOS).save(ruta)


def og(ruta):
    """Imagen para compartir (Open Graph 1200×630): logo + nombre + lema."""
    from PIL import ImageFont
    W, H = 1200, 630
    a, b = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in (CIELO_A, CIELO_B)]
    img = Image.new("RGB", (W, H))
    for y in range(H):
        t = y / (H - 1)
        ImageDraw.Draw(img).line([(0, y), (W, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    img = img.convert("RGBA")
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(halo).ellipse([820, -260, 1420, 340], fill=(224, 122, 95, 60))
    img = Image.alpha_composite(img, halo.filter(ImageFilter.GaussianBlur(90)))
    tmp = os.path.join(DOCS, "marca", "_logo_tmp.png")
    png(300, tmp)
    img.alpha_composite(Image.open(tmp), (90, 165))
    os.remove(tmp)
    F = "/usr/share/fonts/truetype/dejavu/"
    serif, serif_i = ImageFont.truetype(F + "DejaVuSerif.ttf", 104), ImageFont.truetype(F + "DejaVuSerif-Italic.ttf", 104)
    sans, sans_b = ImageFont.truetype(F + "DejaVuSans.ttf", 30), ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 22)
    d = ImageDraw.Draw(img)
    x, y = 440, 210
    for txt, f, col in (("trad", serif, CREMA), ("IA", serif_i, TERRACOTA), (" cloud", serif, CREMA)):
        d.text((x, y), txt, font=f, fill=col)
        x += d.textlength(txt, font=f)
    d.text((446, 355), "Tu agente cripto, en tu propia nube.", font=sans, fill=CREMA)
    d.text((446, 400), "Varias IAs gratis votan · tus claves · tus reglas", font=sans, fill=SALVIA)
    d.text((446, 470), "APP ANDROID · GRATIS · CÓDIGO ABIERTO (MIT)", font=sans_b, fill=MOSTAZA)
    img.convert("RGB").save(ruta, quality=92)


if __name__ == "__main__":
    svg_logo()
    svg_banner()
    vector_android()
    png(512, os.path.join(DOCS, "logo-512.png"))
    png(192, os.path.join(DOCS, "marca", "icono-192.png"))
    og(os.path.join(DOCS, "og.png"))
    print("marca generada")
