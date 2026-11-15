import os
import pathlib

import pytest
from dotenv import load_dotenv
from google.genai import types

import teach as teach_mod
import verify
from models import CheckRequest, PageState, ReadLine


def _lines(second: str = "f'(x) = 6*x + 1"):
    return [
        ReadLine(line_id="L1", problem_id="P1", latex="f(x) = 3x^2 + 2x", plain="f(x) = 3*x^2 + 2*x",
                 box=(120, 80, 180, 420), relation="start", confidence="high"),
        ReadLine(line_id="L2", problem_id="P1", latex=second.replace("*", ""), plain=second,
                 box=(200, 80, 260, 400), relation="derivative", confidence="high"),
    ]


def _req(mode="auto"):
    return CheckRequest(image_base64="", mode=mode, state=PageState(page_id="t"))


def _resp(*calls):
    parts = [types.Part(function_call=types.FunctionCall(name=n, args=a)) for n, a in calls]
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts))])


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.models = self

    def generate_content(self, model, contents, config):
        self.calls.append(list(contents))
        assert config.tool_config.function_calling_config.mode == "ANY"
        return self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]


VERIFY_ARGS = {"before": "f(x) = 3*x^2 + 2*x", "after": "f'(x) = 6*x + 1", "relation": "derivative",
               "before_line_id": "L1", "after_line_id": "L2"}
CIRCLE = {"type": "circle", "box": [200, 300, 260, 400], "line_id": "L2", "color": "red"}
NOTE = {"type": "note", "box": [200, 300, 260, 400], "line_id": "L2", "color": "red", "side": "right",
        "text": "What is the derivative of $2x$?"}


@pytest.fixture
def incorrect(monkeypatch):
    monkeypatch.setattr(verify, "verify_step", lambda b, a, r: {"verdict": "incorrect", "detail": "x"})


def test_verify_then_submit(incorrect):
    client = FakeClient([
        _resp(("verify_step", VERIFY_ARGS)),
        _resp(("submit_feedback", {"actions": [CIRCLE, NOTE], "clear_line_ids": [],
                                   "hint_updates": [{"problem_id": "P1", "hint_level": 1}]})),
    ])
    r = teach_mod.teach(client, "fake", _lines(), _req())
    assert r.finished
    assert [a.type for a in r.actions] == ["circle", "note"]
    assert r.verdicts == {"L2": "incorrect"}
    assert r.tool_calls[0] == "verify_step(L1->L2, derivative) = incorrect"
    assert r.hint_updates[0].hint_level == 1
    # second request carries the function response back to the model
    last = client.calls[1][-1]
    assert last.parts[0].function_response.response["verdict"] == "incorrect"


def test_round_limit():
    client = FakeClient([_resp(("verify_step", VERIFY_ARGS))])
    r = teach_mod.teach(client, "fake", _lines(), _req())
    assert r.finished is False
    assert r.actions == []
    assert len(client.calls) == teach_mod.MAX_ROUNDS


def test_invalid_action_dropped():
    bad = [{"type": "explode"}, {"type": "circle", "box": [1, 2, 3]}, {"type": "note", "color": "purple"}]
    client = FakeClient([_resp(("submit_feedback", {"actions": bad + [NOTE], "clear_line_ids": ["L9"],
                                                    "hint_updates": [{"problem_id": "P1", "hint_level": 7}]}))])
    r = teach_mod.teach(client, "fake", _lines(), _req())
    assert len(r.actions) == 1 and r.actions[0].type == "note"
    assert r.clear_line_ids == ["L9"]
    assert r.hint_updates == []


def test_multiple_calls_one_turn(incorrect):
    lines = _lines() + [ReadLine(line_id="L3", problem_id="P1", latex="f'(1) = 7", plain="f'(1) = 7",
                                 box=(280, 80, 340, 300), relation="equals", confidence="high")]
    v2 = {"before": "f'(x) = 6*x + 1", "after": "f'(1) = 7", "relation": "equals"}  # no ids: matched by text
    client = FakeClient([
        _resp(("verify_step", VERIFY_ARGS), ("verify_step", v2)),
        _resp(("submit_feedback", {"actions": [CIRCLE], "clear_line_ids": [], "hint_updates": []})),
    ])
    r = teach_mod.teach(client, "fake", lines, _req())
    assert r.verdicts == {"L2": "incorrect", "L3": "incorrect"}
    assert r.tool_calls[1] == "verify_step(L2->L3, equals) = incorrect"
    assert len(client.calls[1][-1].parts) == 2


def test_verify_and_submit_same_turn(incorrect):
    client = FakeClient([_resp(("verify_step", VERIFY_ARGS),
                               ("submit_feedback", {"actions": [CIRCLE], "clear_line_ids": [], "hint_updates": []}))])
    r = teach_mod.teach(client, "fake", _lines(), _req())
    assert r.finished and r.verdicts == {"L2": "incorrect"} and len(r.actions) == 1


def test_verify_contract():
    # the real checker lives in verify.py (tests in test_verify.py); teach only relies on this shape
    out = verify.verify_step("x", "x", "equals")
    assert set(out) == {"verdict", "detail"}
    assert out["verdict"] in ("correct", "incorrect", "unknown")


load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")
live = pytest.mark.skipif(not (os.environ.get("GEMINI_API_KEY") and os.environ.get("GEMINI_MODEL")),
                          reason="needs GEMINI_API_KEY and GEMINI_MODEL")


def _live_client():
    from google import genai
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"]), os.environ["GEMINI_MODEL"]


@live
def test_live_wrong_derivative(incorrect):
    client, model = _live_client()
    r = teach_mod.teach(client, model, _lines("f'(x) = 6*x + 1"), _req())
    print(r.tool_calls, r.actions)
    assert r.finished
    assert any(a.line_id == "L2" and a.color == "red" and a.type in ("circle", "note") for a in r.actions)


@live
def test_live_correct_work(monkeypatch):
    monkeypatch.setattr(verify, "verify_step", lambda b, a, r: {"verdict": "correct", "detail": "ok"})
    client, model = _live_client()
    r = teach_mod.teach(client, model, _lines("f'(x) = 6*x + 2"), _req())
    print(r.tool_calls, r.actions)
    assert r.finished
    assert not any(a.color == "red" for a in r.actions)
