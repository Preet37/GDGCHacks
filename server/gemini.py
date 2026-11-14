"""One place for calling Gemini: picks the lowest thinking setting the model accepts and retries when it is busy."""
import logging
import re
import time

from google.genai import types

log = logging.getLogger("tutor.gemini")

_working: dict[str, int] = {}  # model -> index into its thinking options that the API accepted


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
