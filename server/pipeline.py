"""run_check: read the page, teach, then guard and merge."""
import contextvars
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone

from images import decode_png
from models import CheckRequest, CheckResponse, Debug

log = logging.getLogger("tutor.pipeline")

# ---- GET /api/debug/recent: what the server saw and did for the last few requests. Never the image. ----

RECENT: deque = deque(maxlen=30)
_entry: contextvars.ContextVar = contextvars.ContextVar("tutor_recent_entry", default=None)


def begin(req: CheckRequest) -> dict:
    """Start the summary of one request. Whoever handles the request fills it in as it goes."""
    entry = {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": req.mode,
        "page_id": req.state.page_id,
        "help_box": list(req.help_box) if req.help_box else None,
        "question": req.question,
        "state_in": {"lines": len(req.state.lines), "flagged_line_ids": list(req.state.flagged_line_ids),
                     "problems": [p.model_dump() for p in req.state.problems]},
    }
    RECENT.append(entry)
    _entry.set(entry)
    return entry


def finish(entry: dict, t0: float, error: BaseException | None = None) -> None:
    entry["total_ms"] = _ms(t0)
    if error is not None:
        entry["error"] = f"{type(error).__name__}: {error}"[:300]
    _entry.set(None)


def recent() -> list[dict]:
    """Newest first."""
    return list(reversed(RECENT))


def _action_summary(a) -> dict:
    out = {k: v for k, v in (("type", a.type), ("color", a.color), ("side", a.side), ("text", a.text),
                             ("line_id", a.line_id)) if v is not None}
    if a.options:
        out["options"] = list(a.options)
    if a.steps:
        out["steps"] = list(a.steps)
    if a.figure is not None:
        out["figure"] = a.figure.model_dump(exclude_none=True)
    if a.lesson is not None:
        out["lesson"] = {"title": a.lesson.title, "steps": [
            {"say": s.say, "write": s.write, "caption": s.caption,
             "visual": s.visual.model_dump(exclude_none=True) if s.visual else None} for s in a.lesson.steps]}
    return out


def _line_summary(l) -> dict:
    return {"id": l.line_id, "problem": l.problem_id, "plain": l.plain, "relation": l.relation,
            "source": l.source or "handwriting", "confidence": l.confidence, "box": list(l.box)}


class ConfigError(RuntimeError):
    pass


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


def _trace(req, image_png, lines, result, resp) -> None:
    """Debug only: with TRACE_DIR set, save each request's image and what the pipeline did with it."""
    d = os.environ.get("TRACE_DIR")
    if not d:
        return
    try:
        import json
        os.makedirs(d, exist_ok=True)
        stem = os.path.join(d, time.strftime("%H%M%S") + "-" + req.mode)
        with open(stem + ".png", "wb") as f:
            f.write(image_png)
        with open(stem + ".json", "w") as f:
            json.dump({
                "mode": req.mode, "help_box": req.help_box, "question": req.question,
                "state_in": {"problems": [p.model_dump() for p in req.state.problems],
                             "flagged": req.state.flagged_line_ids},
                "lines": [l.model_dump(mode="json") for l in lines],
                "tool_calls": result.tool_calls, "finished": result.finished,
                "actions_from_model": [a.model_dump(mode="json", exclude_none=True) for a in result.actions],
                "actions_sent": [a.model_dump(mode="json", exclude_none=True) for a in resp.actions],
                "clear": resp.clear_line_ids,
            }, f, indent=1)
    except Exception as e:  # tracing must never break a check
        log.warning("trace failed: %s", e)


def run_check(req: CheckRequest) -> CheckResponse:
    entry = _entry.get()
    if entry is not None:  # main.py started the summary and will finish it
        return _run_check(req, entry)
    entry, t0 = begin(req), time.perf_counter()
    try:
        resp = _run_check(req, entry)
    except BaseException as e:
        finish(entry, t0, e)
        raise
    finish(entry, t0)
    return resp


def _run_check(req: CheckRequest, entry: dict) -> CheckResponse:
    image_png = decode_png(req.image_base64)  # raises images.ImageError on bad input

    api_key = os.environ.get("GEMINI_API_KEY")
    model = os.environ.get("GEMINI_MODEL")
    if not api_key:
        raise ConfigError("GEMINI_API_KEY is not set")
    if not model:
        raise ConfigError("GEMINI_MODEL is not set (put a Gemini Flash model name in server/.env)")

    # Lazy imports so this module imports before read.py / teach.py exist.
    from google import genai
    import memory
    import read
    import teach
    from guard import merge

    from google.genai import types
    # 15 s cap per Gemini call (retried twice) so a stuck request fails as a 502 instead of hanging the page.
    # A lesson is a much longer answer than a few marks (six to nine narrated steps), so Teach me gets three times that.
    explaining = req.mode == "explain"
    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=45000 if explaining else 15000))

    t0 = time.perf_counter()
    lines = read.read_page(client, model, image_png, req.state.lines)
    read_ms = _ms(t0)
    entry.update(model=model, read_ms=read_ms, lines=[_line_summary(l) for l in lines])

    t1 = time.perf_counter()
    if explaining:  # Teach me: one lesson instead of marks
        import explain
        result = explain.explain(client, model, lines, req)
    else:
        result = teach.teach(client, model, lines, req)
    teach_ms = _ms(t1)  # in explain mode this is the time the explain step took

    entry.update(teach_ms=teach_ms, finished=result.finished, tool_calls=list(result.tool_calls),
                 actions_from_model=[_action_summary(a) for a in result.actions],
                 clear_from_model=list(result.clear_line_ids),
                 hint_updates_from_model=[h.model_dump() for h in result.hint_updates])

    page_id = req.state.page_id
    resp = merge(req.state, lines, result, req.mode, req.question, memory.marked(page_id), memory.solved(page_id))
    memory.remember(page_id, req.mode, lines, resp.actions, resp.clear_line_ids)
    resp.debug = Debug(model=model, read_ms=read_ms, teach_ms=teach_ms, tool_calls=list(result.tool_calls))
    entry.update(actions_sent=[_action_summary(a) for a in resp.actions], clear_line_ids=list(resp.clear_line_ids),
                 flagged_line_ids=list(resp.state.flagged_line_ids),
                 problems=[p.model_dump() for p in resp.state.problems])
    _trace(req, image_png, lines, result, resp)
    log.info("read_ms=%d %s=%d lines=%d actions=%d finished=%s",
             read_ms, "explain_ms" if explaining else "teach_ms", teach_ms, len(lines), len(resp.actions),
             result.finished)
    return resp
