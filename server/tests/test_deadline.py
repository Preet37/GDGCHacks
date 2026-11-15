"""One time budget per check: a slow Gemini is not retried round after round (a Help press once took 233 s)."""
import time

import pytest

import gemini


class _SlowModels:
    def __init__(self, delay):
        self.delay, self.calls, self.timeouts = delay, 0, []

    def generate_content(self, model, contents, config):
        self.calls += 1
        self.timeouts.append(config.http_options.timeout if config.http_options else None)
        time.sleep(self.delay)
        raise RuntimeError("504 Deadline exceeded")


class _Client:
    def __init__(self, delay):
        self.models = _SlowModels(delay)


def _config(thinking):
    from google.genai import types
    return types.GenerateContentConfig(thinking_config=thinking)


def test_retries_stop_when_the_budget_is_used_up():
    c = _Client(0.4)
    gemini.set_deadline(1.5)
    t0 = time.monotonic()
    try:
        with pytest.raises(Exception):
            gemini.generate(c, "gemini-3.5-flash", [], _config, busy_retries=10)
    finally:
        gemini.set_deadline(None)
    assert time.monotonic() - t0 < 2.0
    assert c.models.calls <= 2
    assert all(t is not None and t <= 1500 for t in c.models.timeouts)  # each call only gets what is left


def test_no_budget_used_up_raises_out_of_time_before_calling():
    c = _Client(0)
    gemini.set_deadline(0.5)
    try:
        with pytest.raises(gemini.OutOfTime):
            gemini.generate(c, "gemini-3.5-flash", [], _config)
    finally:
        gemini.set_deadline(None)
    assert c.models.calls == 0


def test_without_a_budget_nothing_changes():
    c = _Client(0)
    with pytest.raises(RuntimeError):
        gemini.generate(c, "gemini-3.5-flash", [], _config, busy_retries=2)
    assert c.models.calls == 3 and c.models.timeouts == [None, None, None]
