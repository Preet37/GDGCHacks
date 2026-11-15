"""run_check: read the page, teach, then guard and merge."""
import logging
import os
import time

from images import decode_png
from models import CheckRequest, CheckResponse, Debug

log = logging.getLogger("tutor.pipeline")


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
    image_png = decode_png(req.image_base64)  # raises images.ImageError on bad input

    api_key = os.environ.get("GEMINI_API_KEY")
    model = os.environ.get("GEMINI_MODEL")
    if not api_key:
        raise ConfigError("GEMINI_API_KEY is not set")
    if not model:
        raise ConfigError("GEMINI_MODEL is not set (put a Gemini Flash model name in server/.env)")

    # Lazy imports so this module imports before read.py / teach.py exist.
    from google import genai
    import read
    import teach
    from guard import merge

    from google.genai import types
    # 15 s cap per Gemini call (retried twice) so a stuck request fails as a 502 instead of hanging the page.
    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=15000))

    t0 = time.perf_counter()
    lines = read.read_page(client, model, image_png, req.state.lines)
    read_ms = _ms(t0)

    t1 = time.perf_counter()
    result = teach.teach(client, model, lines, req)
    teach_ms = _ms(t1)

    resp = merge(req.state, lines, result, req.mode)
    resp.debug = Debug(model=model, read_ms=read_ms, teach_ms=teach_ms, tool_calls=list(result.tool_calls))
    _trace(req, image_png, lines, result, resp)
    log.info("read_ms=%d teach_ms=%d lines=%d actions=%d finished=%s",
             read_ms, teach_ms, len(lines), len(resp.actions), result.finished)
    return resp
