"""Engineering (Part 2): build a 3D model of a structure or machine for the page's model card.

The tutor's reply only names what to build (`subject`), so the answer note comes back fast; the page then asks
POST /api/model3d, and this one Gemini call (structured JSON output, more thinking than a check) writes the parts.
engineering.build_model3d cleans the result like any model. Never raises: {ok: false, detail} instead."""
import json
import logging
import os
import pathlib

from google import genai
from google.genai import types

import engineering
import gemini

log = logging.getLogger("tutor.model3d")
PROMPT_PATH = pathlib.Path(__file__).resolve().parent / "prompts" / "model3d.md"
BUDGET_S = 45.0
MIN_PARTS = 15  # fewer than this is sent back once for more detail

_V3 = {"type": "array", "items": {"type": "number"}}
SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "parts": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "name": {"type": "string"},
                "shape": {"type": "string", "enum": ["box", "cylinder", "cone", "sphere", "member"]},
                "at": _V3, "size": _V3, "rotate": _V3, "start": _V3, "end": _V3,
                "points": {"type": "array", "items": _V3},
                "axis": {"type": "string", "enum": ["x", "y", "z", "-x", "-y", "-z"]},
                "material": {"type": "string", "enum": sorted(engineering.MATERIALS)},
                "color": {"type": "string"},
                "load": {"type": "string", "enum": ["tension", "compression", "bending", "none"]},
                "explain": {"type": "string"},
            },
            "required": ["id", "name", "shape", "material", "load", "explain"],
        }},
        "loads": {"type": "array", "items": {
            "type": "object",
            "properties": {"at": _V3, "dir": _V3, "label": {"type": "string"}},
            "required": ["at", "dir", "label"],
        }},
    },
    "required": ["title", "summary", "parts", "loads"],
}


def _config(thinking) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=PROMPT_PATH.read_text(),
        response_mime_type="application/json",
        response_json_schema=SCHEMA,
        # a model needs its coordinates worked out: "low" instead of a check's "minimal" (None = the model's default)
        thinking_config=types.ThinkingConfig(thinking_level="low") if thinking is not None else None,
        temperature=0.3,
    )


def build(subject: str, focus: str | None = None, client=None, model: str | None = None) -> dict:
    """{"ok": True, "model": Model3dFigure dict, "title"} or {"ok": False, "detail"}."""
    subject = " ".join(str(subject or "").split())[:200]
    if not subject:
        return {"ok": False, "detail": "nothing to build"}
    model = model or os.environ.get("GEMINI_MODEL")
    if client is None:
        key = os.environ.get("GEMINI_API_KEY")
        if not key or not model:
            return {"ok": False, "detail": "the server has no Gemini key or model"}
        client = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=int(BUDGET_S * 1000)))
    gemini.set_deadline(BUDGET_S)
    ask = f"Build: {subject}." + (f" The student asked: {focus}" if focus else "")
    contents: list = [types.Content(role="user", parts=[types.Part.from_text(text=ask)])]
    best = None
    try:
        for attempt in range(2):
            resp = gemini.generate(client, model, contents, _config)
            try:
                raw = json.loads(resp.text or "")
            except ValueError:
                raw = None
            built = engineering.build_model3d(raw) if isinstance(raw, dict) else None
            if built and (best is None or len(built["parts"]) > len(best[0]["parts"])):
                best = (built, raw)
            if built and len(built["parts"]) >= MIN_PARTS:
                break
            if attempt == 0:  # once: ask for the detail that was missing
                n = len(built["parts"]) if built else 0
                said = resp.candidates[0].content if resp.candidates else types.Content(
                    role="model", parts=[types.Part.from_text(text=resp.text or "")])
                again = types.Content(role="user", parts=[types.Part.from_text(
                    text=f"Only {n} usable parts. Write the whole model again with at least 25 parts, following every rule.")])
                contents += [said, again]
    except Exception as e:  # out of time, quota, a bad reply: the card says so and offers to try again
        log.warning("model3d build failed: %s", e)
        if best is None:
            return {"ok": False, "detail": "couldn't build the model this time"}
    finally:
        gemini.set_deadline(None)
    if best is None:
        return {"ok": False, "detail": "couldn't build a model of that"}
    built, raw = best
    title = " ".join(str(raw.get("title") or subject).split())[:60]
    return {"ok": True, "model": built, "title": title}
