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

    client = genai.Client(api_key=api_key)

    t0 = time.perf_counter()
    lines = read.read_page(client, model, image_png, req.state.lines)
    read_ms = _ms(t0)

    t1 = time.perf_counter()
    result = teach.teach(client, model, lines, req)
    teach_ms = _ms(t1)

    resp = merge(req.state, lines, result)
    resp.debug = Debug(model=model, read_ms=read_ms, teach_ms=teach_ms, tool_calls=list(result.tool_calls))
    log.info("read_ms=%d teach_ms=%d lines=%d actions=%d finished=%s",
             read_ms, teach_ms, len(lines), len(resp.actions), result.finished)
    return resp
