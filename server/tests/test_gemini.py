import pytest
import gemini


class _Models:
    def __init__(self, errors):
        self.errors, self.configs = list(errors), []

    def generate_content(self, model, contents, config):
        self.configs.append(config)
        if self.errors:
            raise RuntimeError(self.errors.pop(0))
        return "ok"


class _Client:
    def __init__(self, errors):
        self.models = _Models(errors)


def test_falls_back_through_thinking_options(monkeypatch):
    monkeypatch.setattr(gemini, "_working", {})
    c = _Client(["Thinking level MINIMAL is not supported", "Thinking level LOW is not supported"])
    assert gemini.generate(c, "gemini-9-flash", ["x"], lambda t: t) == "ok"
    assert c.models.configs[-1] is None           # ended with no thinking setting
    c2 = _Client([])
    gemini.generate(c2, "gemini-9-flash", ["x"], lambda t: t)
    assert c2.models.configs == [None]            # remembered for the next call


def test_retries_when_busy_then_gives_up(monkeypatch):
    monkeypatch.setattr(gemini, "_working", {})
    monkeypatch.setattr(gemini.time, "sleep", lambda s: None)
    assert gemini.generate(_Client(["503 UNAVAILABLE"]), "m", ["x"], lambda t: t) == "ok"
    with pytest.raises(RuntimeError):
        gemini.generate(_Client(["503 UNAVAILABLE"] * 5), "m", ["x"], lambda t: t)
