# Genera los iconos de la PWA: python tools/make-icons.py
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'icons'
EMOJI_FONT = 'C:/Windows/Fonts/seguiemj.ttf'
BG_IN = (74, 30, 10)
BG_OUT = (12, 6, 3)


def background(size, rounded):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    grad = Image.new('RGBA', (size, size))
    px = grad.load()
    c = size / 2
    for y in range(size):
        for x in range(size):
            t = min(1.0, ((x - c) ** 2 + (y - c * 1.15) ** 2) ** 0.5 / (size * 0.7))
            px[x, y] = tuple(int(BG_IN[i] + (BG_OUT[i] - BG_IN[i]) * t) for i in range(3)) + (255,)
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    if rounded:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=255)
    else:
        d.rectangle((0, 0, size, size), fill=255)
    img.paste(grad, (0, 0), mask)
    return img


def flame(size, scale):
    font = ImageFont.truetype(EMOJI_FONT, 480)
    glyph = Image.new('RGBA', (720, 720), (0, 0, 0, 0))
    ImageDraw.Draw(glyph).text((360, 360), '🔥', font=font, embedded_color=True, anchor='mm')
    glyph = glyph.crop(glyph.getbbox())
    target = int(size * scale)
    w, h = glyph.size
    k = target / max(w, h)
    return glyph.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)


def make(size, name, rounded=True, scale=0.62):
    img = background(size, rounded)
    f = flame(size, scale)
    img.alpha_composite(f, ((size - f.width) // 2, (size - f.height) // 2))
    img.save(OUT / name)


OUT.mkdir(exist_ok=True)
make(192, 'icon-192.png')
make(512, 'icon-512.png')
make(512, 'icon-maskable-512.png', rounded=False, scale=0.5)
make(180, 'apple-touch-icon.png', rounded=False, scale=0.6)
print('Iconos en', OUT)
