"""Teach me: the explain step with Gemini faked, and what the guard does with a lesson."""
import json
import pathlib

from google.genai import types

import explain as explain_mod
from explain import build_lesson, clean_visual, pick_problem, speech_safe
from guard import merge
from internal import HintUpdate
from models import CheckRequest, CheckResponse, PageState, ProblemState, ReadLine

EXAMPLE = pathlib.Path(__file__).resolve().parents[2] / "contract" / "examples" / "lesson.json"


def _line(i, plain, box, relation="start", problem="P1", source=None):
    return ReadLine(line_id=i, problem_id=problem, latex=plain, plain=plain, box=box, relation=relation,
                    confidence="high", source=source)


def _lines(answer="= 2*x^2 + C"):
    return [_line("L1", "int(2*x, x)", (100, 80, 160, 400)),
            _line("L2", answer, (180, 80, 240, 400), "integral")]


def _req(**kw):
    kw.setdefault("state", PageState(page_id="t"))
    return CheckRequest(image_base64="", mode="explain", **kw)


def _resp(*calls):
    parts = [types.Part(function_call=types.FunctionCall(name=n, args=a)) for n, a in calls]
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts))])


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.configs = []
        self.models = self

    def generate_content(self, model, contents, config):
        self.calls.append(list(contents))
        self.configs.append(config)
        return self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]


PLOT = {"kind": "plot2d", "expressions": ["2*x"], "x_range": [-1, 4]}
STEPS = [
    {"say": "An integral adds up area. Here is the line $y = 2x$.", "caption": "The line $y = 2x$", "visual": PLOT},
    {"say": "Watch the area grow as we move right.", "visual": dict(PLOT, marks=[
        {"type": "area", "x": 0, "x2": 0.5, "to_x2": 3, "color": "blue"},
        {"type": "point", "expr": 4, "x": 1},                     # no such expression
        {"type": "vline", "x": 40},                               # far off the plot
        {"type": "tangent", "x": 4.5, "color": "purple"}])},      # just off the edge, bad colour
    {"write": "x^2 + C"},                                         # no narration: dropped
    {"say": "That area is \\frac{1}{2} base times height, which is x^2.", "write": "$\\int 2x\\,dx = x^{2} + C$"},
    {"say": "So the answer is x squared plus C.", "visual": {"kind": "plot2d", "expressions": ["?? (("], "x_range": [0, 1]}},
]
SUBMIT = ("submit_lesson", {"title": "Why the integral of 2x is x²", "steps": STEPS, "line_id": "L2"})


def test_tool_call_then_submit():
    client = FakeClient([_resp(("compute_step", {"before": "int(2*x, x)", "relation": "integral"})), _resp(SUBMIT)])
    r = explain_mod.explain(client, "fake", _lines(), _req())
    assert r.finished and r.hint_updates == [] and r.clear_line_ids == []
    # the student's own lines were checked before the model was asked, and it was told about the mistake
    assert r.tool_calls[0] == "verify_step(L1->L2, integral) = incorrect"
    sent = json.loads(client.calls[0][0].parts[0].text)
    assert sent["checks"][0]["line_id"] == "L2" and sent["checks"][0]["verdict"] == "incorrect"
    assert [l["line_id"] for l in sent["problem"]] == ["L1", "L2"] and sent["anchor_line_id"] == "L2"
    # tools: compute and verify to do the math, submit_lesson to finish
    cfg = client.configs[0]
    assert [t.name for t in cfg.tools[0].function_declarations] == ["compute_step", "verify_step", "submit_lesson"]
    assert cfg.tool_config.function_calling_config.mode == "ANY"
    assert r.tool_calls[1] == "compute_step(?->?, integral) = x^2 + C"
    assert client.calls[1][-1].parts[0].function_response.response["latex"] == "x^{2} + C"
    # one lesson action, anchored to the student's line
    (a,) = r.actions
    assert (a.type, a.line_id, a.box, a.side) == ("lesson", "L2", (180, 80, 240, 400), "right")
    assert a.lesson.title == "Why the integral of 2x is x²"
    assert len(a.lesson.steps) == 4                               # the step with no `say` was dropped


def test_lesson_is_made_safe_to_play():
    lesson, problems = build_lesson(SUBMIT[1])
    s1, s2, s3, s4 = lesson.steps
    # y_range is always there and shows the curve
    assert s1.visual.y_range[0] <= -2 and s1.visual.y_range[1] >= 8
    # marks: the area stays, the bad index and the far-off line go, the near miss is pulled onto the plot
    assert [(m.type, m.x, m.color) for m in s2.visual.marks] == [("area", 0, "blue"), ("tangent", 4, None)]
    assert s2.visual.marks[0].to_x2 == 3
    # narration is speech safe; the written math keeps its LaTeX but loses the dollars
    assert s1.say == "An integral adds up area. Here is the line y equals 2x."
    assert s3.say == "That area is 1 over 2 base times height, which is x squared."
    assert s3.write == "\\int 2x\\,dx = x^{2} + C"
    assert s1.caption == "The line $y = 2x$"
    for s in lesson.steps:
        assert not set("$\\{}^_=") & set(s.say)
    # a visual that can't be drawn is dropped, the step is kept (the page keeps the previous picture)
    assert s4.visual is None and any("step 5" in p for p in problems)


def test_speech_safe():
    assert speech_safe("The slope of $x^2$ is $2x$.") == "The slope of x squared is 2x."
    assert speech_safe(r"$\frac{d}{dx} x^{3} = 3x^{2}$") == "d over dx x cubed equals 3x squared"
    assert speech_safe("f'(x) = 2*x + 1") == "f prime of x equals 2 times x plus 1"
    assert speech_safe("It's a step-by-step idea, isn't it?") == "It's a step-by-step idea, isn't it?"
    assert speech_safe(r"\sqrt{x} \cdot \pi") == "the square root of x times pi"
    assert speech_safe("x - 4 and -3") == "x minus 4 and negative 3"
    assert speech_safe(None) == ""


def test_steps_capped_at_seven_and_title_defaulted():
    lesson, _ = build_lesson({"steps": [{"say": f"step {i}"} for i in range(10)]})
    assert len(lesson.steps) == 7 and lesson.title
    assert build_lesson({"steps": "nope"})[0] is None


def test_visual_rules():
    # an equation becomes its two sides; a label prefix is removed; marks follow their expression
    v = clean_visual({"kind": "plot2d", "expressions": ["y = bad ((", "2*x + 6 = 14"], "x_range": [0, 8],
                      "marks": [{"type": "point", "expr": 1, "x": 4, "color": "green"},
                                {"type": "point", "expr": 0, "x": 4},
                                {"type": "hline", "y": 14}, {"type": "hline", "y": 900},
                                {"type": "label", "expr": 1, "x": 4, "text": "they meet here"}, {"type": "label", "expr": 1, "x": 4},
                                {"type": "secant", "x": 2, "x2": 2}, {"type": "sparkle", "x": 1}]})
    assert v.expressions == ["2*x + 6", "14"]
    assert [(m.type, m.expr) for m in v.marks] == [("point", 0), ("hline", None), ("label", 0)]
    assert v.y_range[0] < 6 and v.y_range[1] > 22
    # a secant that closes all the way stops just short of its first point
    v = clean_visual({"kind": "plot2d", "expressions": ["x^2"], "x_range": [-3, 3],
                      "marks": [{"type": "secant", "x": 1, "x2": 2.5, "to_x2": 1}]})
    assert 1 < v.marks[0].to_x2 < 1.2
    # a mark where the curve does not exist is dropped
    v = clean_visual({"kind": "plot2d", "expressions": ["log(x)"], "x_range": [-2, 5],
                      "marks": [{"type": "tangent", "x": -1}, {"type": "tangent", "x": 1, "to_x": 4}]})
    assert [(m.x, m.to_x) for m in v.marks] == [(1, 4)]
    # surfaces get both ranges and no marks
    v = clean_visual({"kind": "surface3d", "expressions": ["x^2 + y^2"], "x_range": [-2, 2], "marks": [{"type": "point", "x": 0}]})
    assert v.y_range == (-2, 2) and v.marks is None
    assert clean_visual({"kind": "pie"}) is None and clean_visual("x^2") is None


def test_short_lesson_is_sent_back_then_accepted_as_a_last_resort():
    short = ("submit_lesson", {"title": "t", "steps": STEPS[:2]})
    client = FakeClient([_resp(short), _resp(SUBMIT)])
    r = explain_mod.explain(client, "fake", _lines(), _req())
    assert len(r.actions[0].lesson.steps) == 4 and len(client.calls) == 2
    assert client.calls[1][-1].parts[0].function_response.response["ok"] is False
    # the model never does better: the two-step lesson is still played
    r = explain_mod.explain(FakeClient([_resp(short)]), "fake", _lines(), _req())
    assert r.finished and len(r.actions[0].lesson.steps) == 2


def test_failure_is_empty_and_unfinished():
    client = FakeClient([_resp(("compute_step", {"before": "x^2", "relation": "derivative"}))])
    r = explain_mod.explain(client, "fake", _lines(), _req())
    assert r.finished is False and r.actions == [] and len(client.calls) == explain_mod.MAX_ROUNDS
    r = explain_mod.explain(FakeClient([_resp(("submit_lesson", {"title": "t", "steps": []}))]), "fake", _lines(), _req())
    assert r.finished is False and r.actions == []
    empty = explain_mod.explain(FakeClient([]), "fake", [], _req())   # nothing on the page: Gemini is not called
    assert empty.finished is False and empty.actions == []


def test_problem_picking_follows_help_mode():
    printed = _line("L0", "Solve 3*x = 12", (20, 80, 60, 600), "other", "P0", "printed")
    p1 = _lines()
    p2 = [_line("L3", "2*x + 6 = 14", (500, 80, 560, 400), problem="P2"),
          _line("L4", "2*x = 8", (580, 80, 640, 400), "solve", "P2")]
    page = [printed] + p1 + p2
    assert pick_problem(page)[1].line_id == "L4"                               # the latest handwritten line
    assert pick_problem(page, (90, 50, 250, 500))[1].line_id == "L2"           # what the student selected
    assert pick_problem(page, (10, 50, 70, 700))[1].line_id == "L0"            # a printed problem they selected
    assert pick_problem([printed])[1].line_id == "L0"                          # only a printed problem in view
    assert pick_problem(page, (900, 900, 950, 950))[1].line_id == "L4"         # selection hit nothing
    assert pick_problem([]) == ([], None)
    # the model can't move the lesson to another problem
    client = FakeClient([_resp(("submit_lesson", dict(SUBMIT[1], line_id="L1")))])
    assert explain_mod.explain(client, "fake", page, _req()).actions[0].line_id == "L4"


def test_lesson_survives_the_guard_and_changes_nothing_else():
    lines = _lines()
    state = PageState(page_id="t", lines=lines, flagged_line_ids=["L1"],
                      problems=[ProblemState(problem_id="P1", hint_level=1)])
    r = explain_mod.explain(FakeClient([_resp(SUBMIT)]), "fake", lines, _req(state=state))
    r.hint_updates = [HintUpdate(problem_id="P1", hint_level=3)]   # even if something tried to
    r.clear_line_ids = ["L1"]
    out = merge(state, lines, r, "explain")
    assert [a.type for a in out.actions] == ["lesson"] and out.actions[0].lesson == r.actions[0].lesson
    assert out.state.problems[0].hint_level == 1                   # hint levels unchanged
    assert out.state.flagged_line_ids == ["L1"] and out.clear_line_ids == []   # L2 is not flagged by the lesson
    # so the next automatic check can still mark the mistake on L2
    from internal import TeachResult
    from models import Action
    red = TeachResult(actions=[Action(type="circle", line_id="L2", color="red"),
                               Action(type="note", line_id="L2", color="red", text="What does the power rule divide by?")],
                      verdicts={"L2": "incorrect"})
    assert len(merge(out.state, lines, red, "auto").actions) == 2
    # a failed explain sends nothing and still changes nothing
    r.finished = False
    failed = merge(state, lines, r, "explain")
    assert failed.actions == [] and failed.state.problems[0].hint_level == 1
    # a lesson never rides along on a normal check
    r.finished = True
    assert merge(state, lines, r, "auto").actions == []


def test_contract_example_validates():
    resp = CheckResponse.model_validate(json.loads(EXAMPLE.read_text()))
    (a,) = resp.actions
    assert a.type == "lesson" and 3 <= len(a.lesson.steps) <= 7
    assert a.lesson.steps[2].visual.marks[0].to_x2 == 1.02
    # the example passes through the cleaner unchanged in substance
    raw = json.loads(EXAMPLE.read_text())["actions"][0]["lesson"]
    lesson, problems = build_lesson(raw)
    assert problems == [] and len(lesson.steps) == 5
    assert [s.say for s in lesson.steps] == [s["say"] for s in raw["steps"]]
    assert [[m.type for m in s.visual.marks] for s in lesson.steps] == \
        [[m["type"] for m in s["visual"]["marks"]] for s in raw["steps"]]
    assert all(s.visual.y_range for s in lesson.steps)


def test_pipeline_explain_mode(monkeypatch):
    import base64, io
    from fastapi.testclient import TestClient
    from PIL import Image
    import main, read, teach
    buf = io.BytesIO(); Image.new("RGB", (200, 100), "white").save(buf, "PNG")
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    monkeypatch.setenv("GEMINI_MODEL", "fake-model")
    monkeypatch.setattr(read, "read_page", lambda client, model, png, prev: _lines())
    monkeypatch.setattr(teach, "teach", lambda *a: (_ for _ in ()).throw(AssertionError("teach must not run")))
    monkeypatch.setattr(explain_mod.gemini, "generate", lambda client, model, contents, cfg: _resp(SUBMIT))
    r = TestClient(main.app).post("/api/check", json={
        "image_base64": base64.b64encode(buf.getvalue()).decode(), "mode": "explain",
        "state": {"page_id": "t", "problems": [{"problem_id": "P1", "hint_level": 2}]}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [a["type"] for a in body["actions"]] == ["lesson"]
    assert body["actions"][0]["lesson"]["steps"][0]["visual"]["y_range"]
    assert body["state"]["flagged_line_ids"] == [] and body["state"]["problems"][0]["hint_level"] == 2
    assert set(body["debug"]) == {"model", "read_ms", "teach_ms", "tool_calls"}
    assert body["debug"]["tool_calls"][-1].startswith("submit_lesson(4 steps")
