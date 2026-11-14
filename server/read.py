"""Step 1: read the handwritten page into ReadLine[] with one structured Gemini call."""
import json
import logging
import re
from pathlib import Path

from google.genai import types
from pydantic import ValidationError

from models import ReadLine

log = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent / "prompts" / "read.md"
PRINTED_PREFIX = "\\text{[printed]}"  # read.md tells Gemini to start printed worksheet lines with this

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
                },
                "required": ["line_id", "problem_id", "latex", "plain", "box", "relation", "confidence"],
            },
        }
    },
    "required": ["lines"],
}


def is_printed(line: ReadLine) -> bool:
    return line.latex.lstrip().startswith(PRINTED_PREFIX)


def _mime(image: bytes) -> str:
    if image[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image[:4] == b"RIFF" and image[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _thinking_config(model: str) -> types.ThinkingConfig:
    # Gemini 2.x takes a token budget (0 = off); Gemini 3+ takes a level (MINIMAL is the lowest).
    if re.search(r"gemini-(1|2)\.", model or ""):
        return types.ThinkingConfig(thinking_budget=0)
    return types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL)


def _build_config(model: str, thinking: bool) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        temperature=0.1,
        response_mime_type="application/json",
        response_json_schema=RESPONSE_SCHEMA,
        thinking_config=_thinking_config(model) if thinking else None,
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


def parse_lines(text: str, prev_lines: list[ReadLine]) -> list[ReadLine]:
    """Turn the model's JSON into ReadLines. Malformed lines are dropped, not fatal."""
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
        if is_printed(line):
            line.relation = "other"
        out.append(line)

    # Ids must be unique: a repeated line_id gets the next unused one.
    used: set[str] = set()
    next_n = _max_num([l.line_id for l in prev_lines + out], "L")
    for line in out:
        if line.line_id in used:
            next_n += 1
            line.line_id = f"L{next_n}"
        used.add(line.line_id)
    return out


def read_page(client, model: str, image_png: bytes, prev_lines: list[ReadLine]) -> list[ReadLine]:
    prompt = PROMPT_PATH.read_text(encoding="utf-8")  # read every call so prompt edits need no restart
    prev_json = json.dumps({"previous_lines": [l.model_dump(mode="json") for l in prev_lines]})
    contents = [
        types.Part.from_bytes(data=image_png, mime_type=_mime(image_png)),
        prompt,
        prev_json,
    ]
    try:
        resp = client.models.generate_content(model=model, contents=contents, config=_build_config(model, True))
    except Exception as e:
        # Some models reject a thinking setting; retry once without it rather than failing the read.
        if "think" not in str(e).lower():
            raise
        log.warning("read: thinking config rejected (%s), retrying without it", e)
        resp = client.models.generate_content(model=model, contents=contents, config=_build_config(model, False))
    return parse_lines(getattr(resp, "text", None) or "", prev_lines)
