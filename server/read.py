"""Step 1: read the handwritten page into ReadLine[] with one structured Gemini call."""
import json
import logging
import re
from pathlib import Path

import gemini
from google.genai import types
from pydantic import ValidationError

from models import ReadLine

log = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent / "prompts" / "read.md"
# Old way of marking printed lines (a latex prefix). Still accepted from the model, then turned into source="printed".
LEGACY_PRINTED_RE = re.compile(r"^\s*\\text\{\s*\[printed\]\s*(?P<rest>[^{}]*)\}\s*")

RELATIONS = ["start", "equals", "simplify", "derivative", "integral", "solve", "other"]

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "line_id": {"type": "string"},
                    "problem_id": {"type": "string"},
                    "latex": {"type": "string"},
                    "plain": {"type": "string"},
                    "box": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "minItems": 4,
                        "maxItems": 4,
                    },
                    "relation": {"type": "string", "enum": RELATIONS},
                    "confidence": {"type": "string", "enum": ["high", "low"]},
                    "source": {"type": "string", "enum": ["handwriting", "printed"]},
                },
                "required": ["line_id", "problem_id", "latex", "plain", "box", "relation", "confidence"],
            },
        }
    },
    "required": ["lines"],
}


def is_printed(line: ReadLine) -> bool:
    return line.source == "printed"


def _strip_legacy_marker(line: ReadLine) -> None:
    """If the model still used the old `\\text{[printed]} ` latex marker, remove it and set source instead."""
    m = LEGACY_PRINTED_RE.match(line.latex)
    if not m:
        return
    inner = m.group("rest").strip()  # covers `\text{[printed] words}` as well as `\text{[printed]} words`
    rest = line.latex[m.end():]
    line.latex = ((f"\\text{{{inner}}} " if inner else "") + rest).strip()
    line.plain = re.sub(r"^\s*\[printed\]\s*", "", line.plain)
    line.source = "printed"


def _mime(image: bytes) -> str:
    if image[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image[:4] == b"RIFF" and image[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _build_config(thinking) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        temperature=0.1,
        response_mime_type="application/json",
        response_json_schema=RESPONSE_SCHEMA,
        thinking_config=thinking,
    )


def _fix_box(raw) -> tuple[int, int, int, int]:
    vals = [int(round(float(v))) for v in raw]
    if len(vals) != 4:
        raise ValueError("box needs 4 numbers")
    y0, x0, y1, x1 = (min(1000, max(0, v)) for v in vals)
    y0, y1 = min(y0, y1), max(y0, y1)
    x0, x1 = min(x0, x1), max(x0, x1)
    return (y0, x0, y1, x1)


def _max_num(ids, prefix: str) -> int:
    best = 0
    for i in ids:
        m = re.fullmatch(prefix + r"(\d+)", i or "")
        if m:
            best = max(best, int(m.group(1)))
    return best


def own_ink(lines: list[ReadLine]) -> list[ReadLine]:
    """The page said there is no worksheet in the image, so nothing in it is print: every line is the
    student's handwriting, whatever the reader called it. A line that was called printed lost its relation
    (printed lines are always "other"); the first line of a problem is its `start` again."""
    out, seen = [], set()
    for l in lines:
        if l.source == "printed":
            update = {"source": "handwriting"}
            if l.problem_id not in seen and l.relation == "other":
                update["relation"] = "start"
            l = l.model_copy(update=update)
        seen.add(l.problem_id)
        out.append(l)
    return out


def parse_lines(text: str, prev_lines: list[ReadLine], has_worksheet: bool | None = None) -> list[ReadLine]:
    """Turn the model's JSON into ReadLines. Malformed lines are dropped, not fatal.
    `has_worksheet` False = the page sent no worksheet: no line is printed (see own_ink)."""
    try:
        data = json.loads(text or "")
    except json.JSONDecodeError:
        log.warning("read: response was not JSON: %.200s", text)
        return []
    raw_lines = data.get("lines") if isinstance(data, dict) else data
    if not isinstance(raw_lines, list):
        return []

    out: list[ReadLine] = []
    for raw in raw_lines:
        if not isinstance(raw, dict):
            continue
        try:
            item = dict(raw)
            item["box"] = _fix_box(item.get("box"))
            for key in ("line_id", "problem_id", "latex", "plain"):
                if isinstance(item.get(key), str):
                    item[key] = item[key].strip()
            line = ReadLine.model_validate(item)
        except (ValidationError, ValueError, TypeError) as e:
            log.warning("read: dropped malformed line %r: %s", raw, e)
            continue
        if not line.line_id or not line.problem_id:
            continue
        _strip_legacy_marker(line)
        if is_printed(line) and has_worksheet is not False:
            line.relation = "other"
        out.append(line)
    if has_worksheet is False:
        out = own_ink(out)

    # Ids must be unique: a repeated line_id gets the next unused one.
    used: set[str] = set()
    next_n = _max_num([l.line_id for l in prev_lines + out], "L")
    for line in out:
        if line.line_id in used:
            next_n += 1
            line.line_id = f"L{next_n}"
        used.add(line.line_id)
    return out


def read_page(client, model: str, image_png: bytes, prev_lines: list[ReadLine],
              has_worksheet: bool | None = None) -> list[ReadLine]:
    """`has_worksheet` is what the page said about the image: False = no imported worksheet in it, so every
    line is handwriting (the reader is told, and the label is set in code); None = unknown, the reader decides."""
    prompt = PROMPT_PATH.read_text(encoding="utf-8")  # read every call so prompt edits need no restart
    context: dict = {"previous_lines": [l.model_dump(mode="json") for l in prev_lines]}
    if has_worksheet is False:
        prev_lines = own_ink(prev_lines)
        context = {"previous_lines": [l.model_dump(mode="json") for l in prev_lines], "has_worksheet": False}
    elif has_worksheet:
        context["has_worksheet"] = True
    prev_json = json.dumps(context)
    contents = [
        types.Part.from_bytes(data=image_png, mime_type=_mime(image_png)),
        prompt,
        prev_json,
    ]
    resp = gemini.generate(client, model, contents, _build_config)
    return parse_lines(getattr(resp, "text", None) or "", prev_lines, has_worksheet)
