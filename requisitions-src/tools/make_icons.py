"""Makes the app icons of the requisitions app: the Pump Group mark on white with a blue band and a check-list
mark, so it is told apart from the site board's icon (hazard stripes) on a home screen.
Usage: python3 make_icons.py <site board icon-512.png> <out folder>"""
import sys
from PIL import Image, ImageDraw

SRC, OUT = sys.argv[1], sys.argv[2]
BLUE, CYAN, WHITE = (6, 95, 151), (0, 171, 227), (255, 255, 255)
S = 4                                               # drawn 4x and scaled down, for clean edges
base = Image.open(SRC).convert('RGB')
mark = base.crop((56, 40, 456, 410))                # the mark, without the site board's stripes


def glyph(d, cx, cy, h, col=WHITE):
    """two ticked lines: a check list"""
    bar, gap, tick = h * 0.20, h * 0.34, h * 0.30
    w = h * 1.9
    for i in (-1, 1):
        y = cy + i * gap / 2 + (i * bar / 2)
        x0 = cx - w / 2
        d.line([(x0, y), (x0 + tick * 0.38, y + tick * 0.36), (x0 + tick, y - tick * 0.42)], fill=col, width=max(2, int(bar * 0.8)), joint='curve')
        d.rounded_rectangle([x0 + tick * 1.55, y - bar / 2, cx + w / 2, y + bar / 2], radius=bar / 2, fill=col)


def icon(size, maskable=False):
    n = size * S
    im = Image.new('RGB', (n, n), WHITE)
    d = ImageDraw.Draw(im)
    if maskable:                                    # everything that matters inside the middle 80%
        mw = int(n * 0.50); mh = int(mw * mark.height / mark.width)
        im.paste(mark.resize((mw, mh), Image.LANCZOS), ((n - mw) // 2, int(n * 0.19)))
        y0, y1 = int(n * 0.66), int(n * 0.83)
    else:
        mw = int(n * 0.74); mh = int(mw * mark.height / mark.width)
        im.paste(mark.resize((mw, mh), Image.LANCZOS), ((n - mw) // 2, int(n * 0.05)))
        y0, y1 = int(n * 0.77), n
    d.rectangle([0, y0, n, y1], fill=BLUE)
    d.rectangle([0, y0, n, y0 + max(2, int(n * 0.022))], fill=CYAN)
    glyph(d, n / 2, (y0 + y1) / 2 + n * 0.008, (y1 - y0) * 0.62)
    return im.resize((size, size), Image.LANCZOS)


icon(512).save(OUT + '/icon-512.png', optimize=True)
icon(192).save(OUT + '/icon-192.png', optimize=True)
icon(180).save(OUT + '/apple-touch-icon.png', optimize=True)
icon(512, True).save(OUT + '/icon-maskable-512.png', optimize=True)
icon(64).resize((32, 32), Image.LANCZOS).save(OUT + '/favicon-32.png', optimize=True)
print('icons made in', OUT)
