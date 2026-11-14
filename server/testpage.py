"""Draws a test page that looks handwritten, for live tests and bench.py. Falls back to the default font off macOS."""
import io
from PIL import Image, ImageDraw, ImageFont

HAND_FONTS = ["/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf", "/System/Library/Fonts/Noteworthy.ttc"]


def hand_font(size: int):
    for p in HAND_FONTS:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def page(lines: list[str], size=(1000, 600), font_size=64, top=110, gap=170, ink=(20, 30, 90)) -> bytes:
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    f = hand_font(font_size)
    for i, text in enumerate(lines):
        d.text((60 + 9 * (i % 2), top + gap * i), text, fill=ink, font=f)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
