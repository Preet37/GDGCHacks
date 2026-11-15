"""Narrow a line's box to the part of the line the tutor pointed at.

The teach step never sees the image, only each line's text and box. It names the wrong part as `focus`
(characters copied from the line's `plain`), and this estimates where those characters sit inside the
line's box by their position in the text. It is an estimate: handwriting is not evenly spaced.
"""
import re

_SKIP = re.compile(r"[\s*]")  # spaces and the multiplication sign are not written as their own glyphs


def _norm(s: str) -> str:
    return _SKIP.sub("", s or "").replace("**", "^")


def focus_box(plain: str, box, focus: str, pad: float = 0.03, min_frac: float = 0.12):
    """Returns [ymin, xmin, ymax, xmax] around `focus` inside `box`, or None if it can't be placed."""
    text, part = _norm(plain), _norm(focus)
    if not text or not part or len(part) >= len(text):
        return None
    i = text.rfind(part)  # the last match: mistakes are usually on the right-hand side
    if i < 0:
        return None
    ymin, xmin, ymax, xmax = box
    w = xmax - xmin
    if w <= 0:
        return None
    a, b = i / len(text), (i + len(part)) / len(text)
    if b - a < min_frac:  # never thinner than a couple of characters
        mid = (a + b) / 2
        a, b = mid - min_frac / 2, mid + min_frac / 2
    a, b = max(0.0, a - pad), min(1.0, b + pad)
    return [ymin, int(round(xmin + a * w)), ymax, int(round(xmin + b * w))]
