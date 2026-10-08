#!/usr/bin/env python3
"""Genera la marca de TradIA Cloud desde una sola geometría (viewBox 108):
logo.svg, banner.svg, ícono Android (vector), ícono de notificación y PNG.
Uso: python3 docs/marca/generar.py"""
import os
from PIL import Image, ImageDraw, ImageFilter

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(RAIZ, "docs")
RES = os.path.join(RAIZ, "app/android/app/src/main/res/drawable")

# Paleta «atardecer indie»
CIELO_A, CIELO_B = "#2E2443", "#18131F"   # degradado del fondo
CREMA, TERRACOTA, MOSTAZA, SALVIA = "#F4EBDD", "#E07A5F", "#F2B544", "#8FB9A8"

SOL = (73, 42, 11)
NUBE = [(38, 62, 12), (55, 52, 16), (72, 61, 11)]      # círculos (cx, cy, r)
BASE = (26, 61, 83, 76, 7.5)                            # rectángulo redondeado x1,y1,x2,y2,r
LINEA = [(33, 70), (44, 64), (52, 68), (63, 58), (73, 54)]
PUNTO = (73, 54, 3.6)
ESTRELLAS = [(24, 30, 1.3), (33, 22, .9), (88, 26, 1.1), (90, 80, .8), (18, 84, .9)]


def circ_path(cx, cy, r):
    return f"M{cx - r:g},{cy:g} a{r:g},{r:g} 0 1,0 {2 * r:g},0 a{r:g},{r:g} 0 1,0 {-2 * r:g},0 Z"


def rrect_path(x1, y1, x2, y2, r):
    return (f"M{x1 + r:g},{y1:g} H{x2 - r:g} A{r:g},{r:g} 0 0 1 {x2:g},{y1 + r:g} V{y2 - r:g} A{r:g},{r:g} 0 0 1 {x2 - r:g},{y2:g} "
            f"H{x1 + r:g} A{r:g},{r:g} 0 0 1 {x1:g},{y2 - r:g} V{y1 + r:g} A{r:g},{r:g} 0 0 1 {x1 + r:g},{y1:g} Z")


NUBE_D = " ".join([circ_path(*c) for c in NUBE] + [rrect_path(*BASE)])
LINEA_D = "M" + " L".join(f"{x:g},{y:g}" for x, y in LINEA)
FONDO_D = rrect_path(0, 0, 108, 108, 26)


def marca_svg(prefijo="m", fondo=True):
    """Grupo SVG de la marca (sin <svg>), reutilizable en logo, banner y app."""
    g = []
    if fondo:
        g.append(f'<defs><linearGradient id="{prefijo}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{CIELO_A}"/><stop offset="1" stop-color="{CIELO_B}"/></linearGradient>'
                 f'<radialGradient id="{prefijo}h"><stop offset="0" stop-color="{MOSTAZA}" stop-opacity=".35"/><stop offset="1" stop-color="{MOSTAZA}" stop-opacity="0"/></radialGradient></defs>')
        g.append(f'<rect width="108" height="108" rx="26" fill="url(#{prefijo}c)"/>')
        g.append("".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{CREMA}" opacity=".55"/>' for x, y, r in ESTRELLAS))
        g.append(f'<circle cx="{SOL[0]}" cy="{SOL[1]}" r="22" fill="url(#{prefijo}h)"/>')
    g.append(f'<circle cx="{SOL[0]}" cy="{SOL[1]}" r="{SOL[2]}" fill="{MOSTAZA}"/>')
    g.append(f'<path d="{NUBE_D}" fill="{CREMA}"/>')
    g.append(f'<path d="{LINEA_D}" fill="none" stroke="{TERRACOTA}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>')
    g.append(f'<circle cx="{PUNTO[0]}" cy="{PUNTO[1]}" r="{PUNTO[2]}" fill="{TERRACOTA}" stroke="{CREMA}" stroke-width="1.6"/>')
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
    """Ícono de la app (VectorDrawable: sin degradados para no depender de aapt:attr)."""
    est = " ".join(circ_path(x, y, r) for x, y, r in ESTRELLAS)
    v = f'''<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por docs/marca/generar.py: no editar a mano. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="{CIELO_B}" android:pathData="{FONDO_D}"/>
    <path android:fillColor="{CIELO_A}" android:pathData="{rrect_path(0, 0, 108, 70, 26)}"/>
    <path android:fillColor="{CREMA}" android:fillAlpha="0.55" android:pathData="{est}"/>
    <path android:fillColor="{MOSTAZA}" android:fillAlpha="0.16" android:pathData="{circ_path(SOL[0], SOL[1], 18)}"/>
    <path android:fillColor="{MOSTAZA}" android:pathData="{circ_path(*SOL)}"/>
    <path android:fillColor="{CREMA}" android:pathData="{NUBE_D}"/>
    <path android:strokeColor="{TERRACOTA}" android:strokeWidth="4.2" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="{LINEA_D}"/>
    <path android:fillColor="{TERRACOTA}" android:strokeColor="{CREMA}" android:strokeWidth="1.6" android:pathData="{circ_path(*PUNTO)}"/>
</vector>
'''
    escribir(os.path.join(RES, "ic_launcher.xml"), v)
    # Notificación: silueta blanca (Android solo usa el alfa).
    n = f'''<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por docs/marca/generar.py: no editar a mano. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#FFFFFF" android:pathData="{circ_path(SOL[0], SOL[1] - 4, 13)}"/>
    <path android:fillColor="#FFFFFF" android:pathData="{NUBE_D}"/>
</vector>
'''
    escribir(os.path.join(RES, "ic_stat_agente.xml"), n)


def png(tam, ruta):
    k = tam / 108 * 4   # supermuestreo ×4
    W = int(108 * k)
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    # Fondo con degradado vertical
    grad = Image.new("RGBA", (1, W))
    a, b = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in (CIELO_A, CIELO_B)]
    for y in range(W):
        t = y / (W - 1)
        grad.putpixel((0, y), tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,))
    grad = grad.resize((W, W))
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=26 * k, fill=255)
    img.paste(grad, (0, 0), mask)
    hex2 = lambda c, al=255: tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (al,)
    # Halo del sol (difuminado)
    halo = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(halo).ellipse([(SOL[0] - 17) * k, (SOL[1] - 17) * k, (SOL[0] + 17) * k, (SOL[1] + 17) * k], fill=hex2(MOSTAZA, 70))
    halo = halo.filter(ImageFilter.GaussianBlur(6 * k))
    img = Image.alpha_composite(img, Image.composite(halo, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask))
    d = ImageDraw.Draw(img)
    for x, y, r in ESTRELLAS:
        d.ellipse([(x - r) * k, (y - r) * k, (x + r) * k, (y + r) * k], fill=hex2(CREMA, 140))
    x, y, r = SOL
    d.ellipse([(x - r) * k, (y - r) * k, (x + r) * k, (y + r) * k], fill=hex2(MOSTAZA))
    for x, y, r in NUBE:
        d.ellipse([(x - r) * k, (y - r) * k, (x + r) * k, (y + r) * k], fill=hex2(CREMA))
    x1, y1, x2, y2, r = BASE
    d.rounded_rectangle([x1 * k, y1 * k, x2 * k, y2 * k], radius=r * k, fill=hex2(CREMA))
    pts = [(x * k, y * k) for x, y in LINEA]
    d.line(pts, fill=hex2(TERRACOTA), width=int(4.2 * k), joint="curve")
    for px, py in (pts[0], pts[-1]):
        rr = 2.1 * k
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=hex2(TERRACOTA))
    x, y, r = PUNTO
    d.ellipse([(x - r - .8) * k, (y - r - .8) * k, (x + r + .8) * k, (y + r + .8) * k], fill=hex2(CREMA))
    d.ellipse([(x - r + .8) * k, (y - r + .8) * k, (x + r - .8) * k, (y + r - .8) * k], fill=hex2(TERRACOTA))
    img.resize((tam, tam), Image.LANCZOS).save(ruta)


if __name__ == "__main__":
    svg_logo()
    svg_banner()
    vector_android()
    png(512, os.path.join(DOCS, "logo-512.png"))
    png(192, os.path.join(DOCS, "marca", "icono-192.png"))
    print("marca generada")
