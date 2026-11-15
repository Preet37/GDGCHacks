"""One place for calling Gemini: picks the lowest thinking setting the model accepts and retries when it is busy."""
import contextvars
import logging
import re
import threading
import time

from google.genai import types

log = logging.getLogger("tutor.gemini")

_working: dict[str, int] = {}  # model -> index into its thinking options that the API accepted


# --- token counts -------------------------------------------------------------------------------------
# Every call's usage is added to TOTALS (per model, since the server started) and, when a request is
# collecting (pipeline.begin), to that request's own list. Shown at GET /api/debug/usage and /recent.
FIELDS = ("calls", "in", "cached", "image_in", "out", "think", "audio_out")
TOTALS: dict[str, dict[str, int]] = {}
_totals_lock = threading.Lock()
_sink: contextvars.ContextVar = contextvars.ContextVar("tutor_usage_sink", default=None)


def collect() -> list:
    """Start collecting the calls of the request running in this context. Returns the list they are added to."""
    calls: list = []
    _sink.set(calls)
    return calls


def _modality(details, name: str) -> int:
    total = 0
    for d in details or []:
        kind = getattr(d, "modality", None)
        kind = getattr(kind, "name", None) or str(kind or "")
        if kind.upper().endswith(name):
            total += int(getattr(d, "token_count", 0) or 0)
    return total


def usage_of(resp, model: str) -> dict:
    """One call's token counts: in (all input), cached (part of `in` billed at the cache rate), image_in
    (part of `in`), out (the answer), think (thinking, billed as output), audio_out (part of `out`)."""
    u = getattr(resp, "usage_metadata", None)
    n = lambda name: int(getattr(u, name, 0) or 0)  # noqa: E731
    return {
        "model": model,
        "in": n("prompt_token_count"),
        "cached": n("cached_content_token_count"),
        "image_in": _modality(getattr(u, "prompt_tokens_details", None), "IMAGE"),
        "out": n("candidates_token_count"),
        "think": n("thoughts_token_count"),
        "audio_out": _modality(getattr(u, "candidates_tokens_details", None), "AUDIO"),
    }


def record(resp, model: str) -> dict:
    call = usage_of(resp, model)
    with _totals_lock:
        t = TOTALS.setdefault(model, dict.fromkeys(FIELDS, 0))
        t["calls"] += 1
        for k in FIELDS[1:]:
            t[k] += call[k]
    sink = _sink.get()
    if sink is not None:
        sink.append(call)
    return call


def summary(calls: list) -> dict:
    """The calls of one request added up."""
    out = dict.fromkeys(FIELDS, 0)
    out["calls"] = len(calls)
    for c in calls:
        for k in FIELDS[1:]:
            out[k] += c.get(k, 0)
    return out


def totals() -> dict:
    with _totals_lock:
        return {m: dict(t) for m, t in TOTALS.items()}


def thinking_options(model: str) -> list:
    """Lowest thinking first. None means: send no thinking setting at all."""
    if re.search(r"gemini-(1|2)\.", model or ""):
        return [types.ThinkingConfig(thinking_budget=0), None]
    return [types.ThinkingConfig(thinking_level="minimal"), types.ThinkingConfig(thinking_level="low"), None]


def generate(client, model: str, contents, make_config, busy_retries: int = 2):
    """make_config(thinking_config_or_None) -> GenerateContentConfig."""
    options = thinking_options(model)
    i = _working.get(model, 0)
    busy = 0
    while True:
        try:
            resp = client.models.generate_content(model=model, contents=contents, config=make_config(options[i]))
            _working[model] = i
            try:
                record(resp, model)
            except Exception:  # counting must never break a call
                log.debug("usage not recorded", exc_info=True)
            return resp
        except Exception as e:
            msg = str(e).lower()
            if "think" in msg and i + 1 < len(options):
                log.warning("%s rejected thinking option %d, trying the next", model, i)
                i += 1
                continue
            if any(k in msg for k in ("503", "unavailable", "overloaded", "504", "deadline", "timed out", "timeout")) and busy < busy_retries:
                busy += 1
                log.warning("%s busy, retry %d", model, busy)
                time.sleep(0.6 * busy)
                continue
            raise
