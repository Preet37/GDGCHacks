"""POST /api/glyphs: a tight box around every handwritten character, so the page can learn the student's hand."""
import json
import logging
import os
import time
import unicodedata
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from google.genai import types

import gemini
from images import ImageError, decode_png
from models import GlyphBox, GlyphsRequest, GlyphsResponse

log = logging.getLogger("tutor.glyphs")

router = APIRouter()

PROMPT_PATH = Path(__file__).parent / "prompts" / "glyphs.md"
MAX_GLYPHS = 400
# Anything smaller than this (in 0-1000 units, both ways) is not a box around a character.
MIN_SIDE = 2
# A single character never covers this much of the image both ways (unless the image is one character).
MAX_SHARE = 900

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "glyphs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "char": {"type": "string"},
                    "box": {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4},
                },
                "required": ["char", "box"],
            },
        }
    },
    "required": ["glyphs"],
}

# How the model may spell a character -> the one character the page uses.
ALIASES = {
    "−": "-", "–": "-", "—": "-", "‐": "-",
    "′": "'", "’": "'", "‘": "'", "`": "'", "´": "'",
    "×": "*", "·": "*", "⋅": "*",
    "÷": "/", "∕": "/", "⁄": "/",
    "\\pm": "±", "+-": "±", "+/-": "±",
    "\\int": "∫", "\\sqrt": "√", "\\pi": "π", "\\sum": "Σ", "∑": "Σ", "\\infty": "∞",
    "²": "2", "³": "3", "¹": "1", "⁰": "0", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
}


def mock_mode() -> bool:
    return os.environ.get("MOCK") == "1" or not os.environ.get("GEMINI_API_KEY")


def _build_config(thinking) -> types.GenerateContentConfig:
    # Placing a box per character needs a little more care than reading a line: "minimal" thinking drops
    # dashes and equals signs, so the lowest setting used here is "low" (GLYPHS_THINKING overrides it).
    level = os.environ.get("GLYPHS_THINKING", "low")
    if thinking is not None and getattr(thinking, "thinking_level", None) is not None and level:
        thinking = types.ThinkingConfig(thinking_level=level)
    return types.GenerateContentConfig(
        temperature=0.0,
        response_mime_type="application/json",
        response_json_schema=RESPONSE_SCHEMA,
        thinking_config=thinking,
    )


def clean_char(raw) -> str | None:
    """The one character an entry stands for, or None if it isn't a single character."""
    if not isinstance(raw, str):
        return None
    s = raw.strip().strip("$").strip()
    s = ALIASES.get(s, s)
    if len(s) != 1:
        s = unicodedata.normalize("NFKC", s)
        s = ALIASES.get(s, s)
    if len(s) != 1 or s.isspace() or not s.isprintable() or s in "^_{}\\":
        return None
    return s


def fix_box(raw) -> tuple[int, int, int, int] | None:
    """Clamp to 0-1000 and put the corners in order. None if it is not a usable box."""
    try:
        vals = [int(round(float(v))) for v in raw]
    except (TypeError, ValueError):
        return None
    if len(vals) != 4:
        return None
    y0, x0, y1, x1 = (min(1000, max(0, v)) for v in vals)
    y0, y1 = min(y0, y1), max(y0, y1)
    x0, x1 = min(x0, x1), max(x0, x1)
    # a dash is flat and a 1 is thin, so only a box that is tiny both ways is thrown out
    if max(y1 - y0, x1 - x0) < MIN_SIDE:
        return None
    return (y0, x0, y1, x1)


def parse_glyphs(text: str) -> list[GlyphBox]:
    """The model's JSON -> GlyphBoxes. Bad entries are dropped, never fatal."""
    try:
        data = json.loads(text or "")
    except json.JSONDecodeError:
        log.warning("glyphs: response was not JSON: %.200s", text)
        return []
    raw = data.get("glyphs") if isinstance(data, dict) else data
    if not isinstance(raw, list):
        return []
    out: list[GlyphBox] = []
    seen: set[tuple] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        char = clean_char(item.get("char"))
        box = fix_box(item.get("box"))
        if char is None or box is None:
            continue
        if (char, box) in seen:  # the model repeating itself
            continue
        seen.add((char, box))
        out.append(GlyphBox(char=char, box=box))
        if len(out) >= MAX_GLYPHS:
            break
    # a "character" that fills the whole picture, next to others, is a misread (a box around a line or the page)
    if len(out) > 1:
        out = [g for g in out if not (g.box[2] - g.box[0] >= MAX_SHARE and g.box[3] - g.box[1] >= MAX_SHARE)]
    return out


def find_glyphs(client, model: str, image_png: bytes) -> list[GlyphBox]:
    prompt = PROMPT_PATH.read_text(encoding="utf-8")  # read every call so prompt edits need no restart
    contents = [types.Part.from_bytes(data=image_png, mime_type="image/png"), prompt]
    resp = gemini.generate(client, model, contents, _build_config)
    return parse_glyphs(getattr(resp, "text", None) or "")


def _client():
    from google import genai
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options=types.HttpOptions(timeout=30000))


@router.post("/api/glyphs", response_model=GlyphsResponse)
def glyphs(req: GlyphsRequest):
    t0 = time.perf_counter()
    try:
        image_png = decode_png(req.image_base64)
    except ImageError as e:
        log.warning("glyphs bad image: %s", e)
        return JSONResponse(status_code=400, content={"error": "bad_image", "detail": str(e)})
    if mock_mode():
        return GlyphsResponse(glyphs=[])
    model = os.environ.get("GLYPHS_MODEL") or os.environ.get("GEMINI_MODEL") or "gemini-3.5-flash-lite"
    try:
        found = find_glyphs(_client(), model, image_png)
    except Exception as e:  # learning the handwriting is optional: never an error the page has to handle
        log.warning("glyphs failed: %s: %.200s", type(e).__name__, e)
        return GlyphsResponse(glyphs=[])
    log.info("glyphs model=%s n=%d ms=%d", model, len(found), int((time.perf_counter() - t0) * 1000))
    return GlyphsResponse(glyphs=found)
