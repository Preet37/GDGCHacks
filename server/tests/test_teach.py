import os
import pathlib

import pytest
from dotenv import load_dotenv
from google.genai import types

import teach as teach_mod
from guard import merge
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


# --- finishing a line the student left open -------------------------------------------------------

def _open_lines():
    return [
        ReadLine(line_id="L1", problem_id="P1", latex="g(x) = 6x^2", plain="g(x) = 6*x^2",
                 box=(150, 80, 230, 420), relation="start", confidence="high"),
        ReadLine(line_id="L2", problem_id="P1", latex="g'(x) =", plain="g'(x) =",
                 box=(260, 80, 340, 300), relation="derivative", confidence="high"),
    ]


COMPUTE_ARGS = {"before": "g(x) = 6*x^2", "relation": "derivative", "before_line_id": "L1", "after_line_id": "L2"}
INLINE = {"type": "note", "line_id": "L2", "box": [260, 80, 340, 300], "color": "black", "side": "inline",
          "text": "$12 x$"}


def _submit(*actions, hints=()):
    return _resp(("submit_feedback", {"actions": list(actions), "clear_line_ids": [], "hint_updates": list(hints)}))


def test_tools_and_schema_cover_finishing_a_line():
    tools = teach_mod._build_config().tools[0].function_declarations
    assert [t.name for t in tools] == ["verify_step", "compute_step", "solve_circuit", "submit_feedback"]
    assert "inline" in teach_mod._ACTION["properties"]["side"]["enum"]
    assert "black" in teach_mod._ACTION["properties"]["color"]["enum"]


def test_open_line_flow():
    client = FakeClient([_resp(("compute_step", COMPUTE_ARGS)), _submit(INLINE)])
    r = teach_mod.teach(client, "fake", _open_lines(), _req())
    assert r.finished and r.verdicts == {}
    assert r.tool_calls == ["compute_step(L1->L2, derivative) = 12*x", "submit_feedback(1/1 actions kept)"]
    reply = client.calls[1][-1].parts[0].function_response
    assert reply.name == "compute_step" and reply.response["latex"] == "12 x"
    (a,) = r.actions
    assert (a.type, a.side, a.color, a.line_id, a.text, a.box) == \
        ("note", "inline", "black", "L2", "$12 x$", (260, 80, 340, 300))
    # end to end through the guard: the answer is sent once, and the line is never treated as a mistake
    out = merge(PageState(page_id="t"), _open_lines(), r)
    assert [x.side for x in out.actions] == ["inline"] and out.state.flagged_line_ids == ["L2"]


def test_spoken_question_flow():
    """Help mode, "can you finish this?": the line need not end with '='."""
    lines = _open_lines()
    lines[1] = lines[1].model_copy(update={"latex": "g'(x)", "plain": "g'(x)"})
    req = CheckRequest(image_base64="", mode="help", question="can you finish this?",
                       state=PageState(page_id="t", lines=lines, flagged_line_ids=["L2"]))
    client = FakeClient([_resp(("compute_step", COMPUTE_ARGS)), _submit(INLINE)])
    r = teach_mod.teach(client, "fake", lines, req)
    assert '"question": "can you finish this?"' in client.calls[0][0].parts[0].text
    assert r.tool_calls[0] == "compute_step(L1->L2, derivative) = 12*x"
    assert r.hint_updates == []
    out = merge(req.state, lines, r, "help", req.question)      # asked for out loud: sent even though L2 already had feedback
    assert [(x.side, x.color, x.text) for x in out.actions] == [("inline", "black", "$12 x$")]


def test_compute_came_back_empty_model_hints_instead():
    args = dict(COMPUTE_ARGS, before="graph this")
    hint = {"type": "note", "line_id": "L2", "box": [260, 80, 340, 300], "color": "blue", "side": "right",
            "text": "Which rule handles a power of $x$?"}
    client = FakeClient([_resp(("compute_step", args)), _submit(hint)])
    r = teach_mod.teach(client, "fake", _open_lines(), _req())
    assert r.tool_calls[0] == "compute_step(L1->L2, derivative) = nothing"
    assert client.calls[1][-1].parts[0].function_response.response["result"] == ""
    assert [(a.color, a.side) for a in r.actions] == [("blue", "right")]


def test_compute_uses_the_line_when_the_model_sends_only_ids():
    client = FakeClient([_resp(("compute_step", dict(COMPUTE_ARGS, before=""))), _submit(INLINE)])
    r = teach_mod.teach(client, "fake", _open_lines(), _req())
    assert r.tool_calls[0] == "compute_step(L1->L2, derivative) = 12*x"


def test_compute_bug_does_not_break_the_request(monkeypatch):
    monkeypatch.setattr(teach_mod.compute, "compute_step", lambda b, r: 1 / 0)
    client = FakeClient([_resp(("compute_step", COMPUTE_ARGS)), _submit()])
    r = teach_mod.teach(client, "fake", _open_lines(), _req())
    assert r.finished and r.tool_calls[0].endswith("= nothing")


def test_open_line_is_never_verified_or_marked_wrong(monkeypatch):
    def boom(*a):
        raise AssertionError("verify_step must not run on an open line")
    monkeypatch.setattr(verify, "verify_step", boom)
    args = {"before": "g(x) = 6*x^2", "after": "g'(x) =", "relation": "derivative",
            "before_line_id": "L1", "after_line_id": "L2"}
    red = [{"type": "circle", "line_id": "L2", "box": [260, 80, 340, 300], "color": "red", "focus": "="},
           {"type": "underline", "line_id": "L2", "box": [260, 80, 340, 300], "color": "red"},
           {"type": "note", "line_id": "L2", "box": [260, 80, 340, 300], "color": "red", "side": "right",
            "text": "This line is not finished."}]
    client = FakeClient([_resp(("verify_step", args)), _submit(*red)])
    r = teach_mod.teach(client, "fake", _open_lines(), _req())
    assert r.verdicts == {}
    assert r.tool_calls[0] == "verify_step(L1->L2, derivative) = skipped (open line)"
    assert client.calls[1][-1].parts[0].function_response.response["verdict"] == "unknown"
    out = merge(PageState(page_id="t"), _open_lines(), r)
    assert out.actions == [] and out.state.flagged_line_ids == []


def test_inline_shape_fixes():
    raw = [dict(INLINE, color="red", box=[0, 0, 5, 5]),                      # wrong colour, made-up box
           {"type": "ask", "line_id": "L1", "side": "inline", "text": "Did you mean $6x^2$?"},
           dict(INLINE, line_id="L9")]                                        # no such line
    a, b, c = teach_mod._parse_actions(raw, _open_lines())
    assert (a.color, a.box, a.side) == ("black", (260, 80, 340, 300), "inline")
    assert b.side == "right" and c.side == "right"


def _one_line_problem():
    return [ReadLine(line_id="L1", problem_id="P1", latex="\\int 4x\\,dx =", plain="int(4*x, x) =",
                     box=(150, 80, 230, 420), relation="start", confidence="high")]


def test_one_line_problem_is_finished_from_itself():
    """From an iPad trace: the open line is the whole problem, so the model points compute_step at it."""
    answer = dict(INLINE, line_id="L1", side="right", text="$2 x^{2} + C$")   # the model asked for the margin
    for args in ({"before": "int(4*x, x) =", "relation": "simplify", "before_line_id": "L1", "after_line_id": "L1"},
                 {"before": "", "relation": "simplify", "before_line_id": "L1", "after_line_id": "L1"},
                 {"before": "f(x) =", "relation": "integral", "before_line_id": "L0", "after_line_id": "L1"}):
        client = FakeClient([_resp(("compute_step", args)), _submit(answer)])
        r = teach_mod.teach(client, "fake", _one_line_problem(), _req())
        assert r.tool_calls[0].endswith("= 2*x^2 + C"), r.tool_calls
        (a,) = r.actions
        assert (a.side, a.color, a.box) == ("inline", "black", (150, 80, 230, 420))   # written on the line, not the margin


def test_black_note_goes_inline_only_on_an_open_line():
    lines = _lines()
    (a,) = teach_mod._parse_actions([dict(INLINE, side="right")], lines)   # L2 is a finished line
    assert a.side == "right"


def test_students_own_answer_under_an_integral_is_checked_not_finished():
    """From an iPad trace: `∫ 2x dx`, then their own wrong `= 2x^2 + C`. The answer must not be handed over."""
    lines = [ReadLine(line_id="L1", problem_id="P1", latex="\\int 2x\\,dx", plain="int(2*x, x)",
                      box=(100, 80, 160, 400), relation="start", confidence="high"),
             ReadLine(line_id="L2", problem_id="P1", latex="= 2x^2 + C", plain="= 2*x^2 + C",
                      box=(180, 80, 240, 400), relation="integral", confidence="high")]
    check = {"before": "int(2*x, x)", "after": "= 2*x^2 + C", "relation": "equals",
             "before_line_id": "L1", "after_line_id": "L2"}
    gave_away = dict(INLINE, line_id="L1", box=[100, 80, 160, 400], text="$x^{2} + C$")
    client = FakeClient([_resp(("verify_step", check)), _submit(gave_away, dict(CIRCLE), dict(NOTE))])
    r = teach_mod.teach(client, "fake", lines, _req())
    assert r.verdicts == {"L2": "incorrect"}                    # int(...) is checked as an integral
    out = merge(PageState(page_id="t"), lines, r)
    assert [(a.type, a.line_id, a.color) for a in out.actions] == [("circle", "L2", "red"), ("note", "L2", "red")]
    # the right answer checks out
    lines[1] = lines[1].model_copy(update={"plain": "= x^2 + C"})
    r = teach_mod.teach(FakeClient([_resp(("verify_step", dict(check, after="= x^2 + C"))), _submit()]), "fake", lines, _req())
    assert r.verdicts == {"L2": "correct"}


def test_figure_window_is_fixed_on_submit():
    fig = {"type": "figure", "line_id": "L1", "box": [150, 80, 230, 420], "side": "right",
           "figure": {"kind": "plot2d", "expressions": ["x^2 - 4"], "x_range": [-5, 5]}}
    surf = {"type": "figure", "line_id": "L1", "figure": {"kind": "surface3d", "expressions": ["x*y"], "y_range": [-2, 2]}}
    bad = {"type": "figure", "line_id": "L1", "figure": {"kind": "plot2d", "expressions": ["?? (("], "x_range": [-5, 5]}}
    client = FakeClient([_submit(fig, surf, bad)])
    a, b, c = teach_mod.teach(client, "fake", _open_lines(), _req()).actions
    assert a.figure.y_range[0] < -4 and a.figure.y_range[1] > 20
    assert b.figure.x_range == (-2, 2)
    assert c.figure.y_range is None


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
