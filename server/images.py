"""Decode the page image from the request and shrink it for Gemini."""
import base64
import binascii
import io

from PIL import Image, UnidentifiedImageError

MAX_SIDE = 1280


class ImageError(ValueError):
    """The request's image could not be used. Message is safe to show to the client."""


def decode_png(image_base64: str, max_side: int = MAX_SIDE) -> bytes:
    """Base64 (optionally a data: URL) -> PNG bytes with longest side <= max_side."""
    if not image_base64 or not image_base64.strip():
        raise ImageError("image_base64 is empty")
    data = image_base64.strip()
    if data.startswith("data:"):
        _, sep, data = data.partition(",")
        if not sep:
            raise ImageError("data: URL has no comma")
    try:
        raw = base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError) as e:
        raise ImageError(f"image_base64 is not valid base64: {e}") from e
    if not raw:
        raise ImageError("image_base64 decoded to nothing")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise ImageError("image_base64 is not a readable image") from e

    if img.mode not in ("RGB", "RGBA", "L", "LA"):
        img = img.convert("RGBA")
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=False)
    return out.getvalue()
