"""Genera el logo de Melanite (gema facetada oscura) en SVG y PNG.

Uso: python scripts/icons.py   (requiere Pillow)
Las facetas se definen una sola vez en coordenadas de 0 a 512.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'public'
BG = '#141114'

# vista lateral de una gema talla brillante: corona arriba, pabellón abajo
G = [(64, 196), (160, 196), (256, 196), (352, 196), (448, 196)]   # filetín
T = [(168, 104), (256, 104), (344, 104)]                          # mesa
A = (256, 436)                                                    # culata
FACETS = [
    # corona (más clara: le pega la luz de arriba a la izquierda)
    ([G[0], T[0], G[1]], '#6b2a40'),
    ([T[0], T[1], G[2], G[1]], '#8e3a57'),
    ([T[1], T[2], G[3], G[2]], '#5a2436'),
    ([T[2], G[4], G[3]], '#3e1a27'),
    # pabellón
    ([G[0], G[1], A], '#3a1824'),
    ([G[1], G[2], A], '#2a121b'),
    ([G[2], G[3], A], '#1e0d14'),
    ([G[3], G[4], A], '#14090e'),
]
HIGHLIGHT = ([(180, 112), (244, 112), (206, 150)], '#c2607f')
EDGE = '#a8456a'


def svg(background: bool) -> str:
    polys = ''.join(
        f'<polygon points="{" ".join(f"{x},{y}" for x, y in pts)}" fill="{c}"/>'
        for pts, c in FACETS + [HIGHLIGHT]
    )
    outline = [G[0], T[0], T[2], G[4], A]
    edge = f'<polygon points="{" ".join(f"{x},{y}" for x, y in outline)}" fill="none" stroke="{EDGE}" stroke-width="6" stroke-linejoin="round"/>'
    bg = f'<rect width="512" height="512" rx="112" fill="{BG}"/>' if background else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{bg}{polys}{edge}</svg>\n'


def png(size: int, scale: float, background: bool, radius: bool) -> Image.Image:
    ss = 4  # supersampling para bordes suaves
    big = size * ss
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if background:
        if radius:
            d.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=BG)
        else:
            d.rectangle([0, 0, big, big], fill=BG)
    k = big / 512 * scale
    off = big * (1 - scale) / 2
    tr = lambda pts: [(off + x * k, off + y * k) for x, y in pts]
    for pts, c in FACETS + [HIGHLIGHT]:
        d.polygon(tr(pts), fill=c)
    outline = tr([G[0], T[0], T[2], G[4], A])
    d.line(outline + [outline[0]], fill=EDGE, width=max(1, int(6 * k)), joint='curve')
    return img.resize((size, size), Image.LANCZOS)


def main():
    (OUT / 'icons').mkdir(parents=True, exist_ok=True)
    (OUT / 'favicon.svg').write_text(svg(False), encoding='utf-8')
    (OUT / 'icons' / 'logo.svg').write_text(svg(True), encoding='utf-8')
    png(32, 1.0, False, False).save(OUT / 'icons' / 'icon-32.png')
    png(192, 0.86, True, True).save(OUT / 'icons' / 'icon-192.png')
    png(512, 0.86, True, True).save(OUT / 'icons' / 'icon-512.png')
    # maskable: fondo completo y gema dentro de la zona segura (80 %)
    png(512, 0.66, True, False).save(OUT / 'icons' / 'icon-maskable-512.png')
    # iOS redondea solo: fondo completo sin transparencia
    png(180, 0.8, True, False).convert('RGB').save(OUT / 'apple-touch-icon.png')
    print('íconos generados en', OUT)


if __name__ == '__main__':
    main()
