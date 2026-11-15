"""Your turn: a lesson ends with a practice problem, the page writes it down, and work under it is checked."""
import base64
import io
import json
import pathlib

from fastapi.testclient import TestClient
from google.genai import types
from PIL import Image

import explain as explain_mod
import guard
import memory
import practice
import teach as teach_mod
from guard import merge
from models import CheckRequest, CheckResponse, GivenLine, PageState, ReadLine

EXAMPLE = pathlib.Path(__file__).resolve().parents[2] / "contract" / "examples" / "lesson.json"
GIVEN = GivenLine(box=(400, 80, 450, 420), latex="g(x) = x^3 - 5x", plain="g(x) = x^3 - 5*x")


def _line(i, plain, box, relation="start", problem="P1", source=None, confidence="high"):
    return ReadLine(line_id=i, problem_id=problem, latex=plain, plain=plain, box=box, relation=relation,
                    confidence=confidence, source=source)


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
        return self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]


def _req(mode="auto", **kw):
    kw.setdefault("state", PageState(page_id="t"))
    return CheckRequest(image_base64="", mode=mode, **kw)


def _submit(*actions):
    return _resp(("submit_feedback", {"actions": list(actions), "clear_line_ids": [], "hint_updates": []}))


# The student's own problem (P1), then the practice problem the page wrote, then their work under it.
OWN = [_line("L1", "f(x) = x^2", (100, 80, 160, 400)), _line("L2", "f'(x) = 2*x", (180, 80, 240, 400), "derivative")]


def _page(*work, tasks=None, given=(GIVEN,), read_given=True):
    """What the reader returns (it reads the practice text off the image too) merged with the given lines."""
    read = list(OWN)
    if read_given:
        read.append(_line("L3", "g(x) = x^3 - 5x", (402, 82, 448, 418), "other", "P2", "printed"))
    for n, (plain, relation, problem) in enumerate(work):
        y = 470 + 70 * n
        read.append(_line(f"L{4 + n}", plain, (y, 80, y + 50, 420), relation, problem))
    return practice.merge_given(read, list(given), tasks)


def _run(lines, *responses, mode="auto", state=None, question=None):
    req = _req(mode, state=state or PageState(page_id="t"), question=question)
    client = FakeClient(list(responses))
    result = teach_mod.teach(client, "fake", lines, req)
    return merge(req.state, lines, result, mode, question, {}, {}), result, client


# ---- the lesson carries a practice problem ----

PLOT = {"kind": "plot2d", "expressions": ["x^2"], "x_range": [-3, 3]}
STEPS = [{"say": "Here is your curve.", "visual": PLOT},
         {"say": "Watch the tangent slide.", "visual": dict(PLOT, marks=[{"type": "tangent", "x": -2, "to_x": 2}])},
         {"say": "The slope keeps changing."}, {"say": "Bring the power down.", "write": "f(x) = x^2"},
         {"say": "So the derivative is two x.", "write": "f'(x) = 2x"},
         {"say": "Now you try. What is the derivative of x to the fourth?", "caption": "Try it"}]
GOOD = {"prompt": "Your turn: find the derivative.", "problem": "$g(x) = x^3 - 5x$", "plain": "g(x) = x^3 - 5*x",
        "relation": "derivative", "ask": "g'(x) ="}


def _lesson(practice_arg):
    args = {"title": "Why the derivative of x² is 2x", "steps": STEPS, "line_id": "L2"}
    if practice_arg is not None:
        args["practice"] = practice_arg
    return _resp(("submit_lesson", args))


def test_lesson_carries_a_checked_practice_problem():
    client = FakeClient([_lesson(GOOD)])
    r = explain_mod.explain(client, "fake", list(OWN), _req("explain"))
    lesson = r.actions[0].lesson
    assert len(client.calls) == 1 and r.practice_relation == "derivative"
    assert lesson.practice.model_dump() == {"prompt": "Your turn: find the derivative.", "problem": "g(x) = x^3 - 5x",
                                            "plain": "g(x) = x^3 - 5*x", "ask": "g'(x) ="}
    assert "practice(g(x) = x^3 - 5*x, derivative)" in r.tool_calls
    # the last step shows that same problem, so the spoken ending and the page match
    assert lesson.steps[-1].caption == "Your turn: find the derivative. $g(x) = x^3 - 5x$"
    # the schema asks for it
    schema = explain_mod.SUBMIT_DECL.parameters_json_schema
    assert "practice" in schema["required"] and schema["properties"]["practice"]["required"] == [
        "prompt", "problem", "plain", "relation"]


def test_invalid_practice_is_sent_back_once_then_dropped():
    for bad, why in (({**GOOD, "problem": "h(x) = x^2", "plain": "h(x) = x^2"}, "already worked"),   # the student's own problem
                     ({**GOOD, "plain": "find the slope of the curve"}, "does not parse"),
                     ({**GOOD, "problem": "x^2 + 1 = 0 \\cdot x", "plain": "sin(x) = 2 + exp(x)", "relation": "solve"}, "compute_step could not"),
                     (None, "is missing")):
        client = FakeClient([_lesson(bad)])
        r = explain_mod.explain(client, "fake", list(OWN), _req("explain"))
        assert r.finished and len(client.calls) == 2, why                  # sent back once, not twice
        assert why in str(client.calls[1][-1].parts[0].function_response.response)
        lesson = r.actions[0].lesson
        assert lesson.practice is None and len(lesson.steps) == 6 and r.practice_relation is None   # the lesson still goes out
        assert lesson.steps[-1].caption == "Try it"
    # sent back and fixed: the practice goes out
    client = FakeClient([_lesson({**GOOD, "plain": "f(x) = x^2"}), _lesson(GOOD)])
    r = explain_mod.explain(client, "fake", list(OWN), _req("explain"))
    assert len(client.calls) == 2 and r.actions[0].lesson.practice.plain == "g(x) = x^3 - 5*x"


def test_practice_checks_in_code():
    check = lambda p, **kw: explain_mod.check_practice(p, list(OWN), **kw)
    assert check({**GOOD, "relation": "other"})[:2] == (check({**GOOD, "relation": "other"})[0], None)
    assert check({**GOOD, "relation": "other"})[0] is not None           # nothing compute.py does: allowed, unchecked
    assert check({"prompt": "Your turn.", "problem": "2x + 6 = 14", "plain": "2*x + 6 = 14", "relation": "solve"})[1] == "solve"
    assert check({"prompt": "Your turn.", "problem": "\\int 6x\\,dx", "plain": "int(6*x, x)", "relation": "integral"})[0]
    assert check({**GOOD, "plain": "g(x) = x*x", "problem": "g(x) = x \\cdot x"})[0] is None   # same math, other name
    assert check("x^3")[0] is None and check({"prompt": "p"})[0] is None


def test_contract_example_has_a_practice_problem():
    resp = CheckResponse.model_validate(json.loads(EXAMPLE.read_text()))
    lesson = next(a.lesson for a in resp.actions if a.type == "lesson")
    assert lesson.practice.prompt and lesson.practice.problem and lesson.practice.ask.endswith("=")
    own = [l for l in resp.lines if l.problem_id == resp.lines[0].problem_id]
    checked, relation, problems = explain_mod.check_practice(lesson.practice.model_dump(), own, lesson=lesson)
    assert checked == lesson.practice and problems == []                 # it passes the server's own check
    CheckRequest.model_validate({"image_base64": "", "mode": "auto", "state": {"page_id": "p"},
                                 "given": [{"box": [1, 2, 3, 4], "latex": "g(x) = x^3", "plain": "g(x) = x^3"}]})


# ---- given lines: merged, de-duplicated, and the work under them grouped ----

def test_given_lines_are_merged_and_deduplicated():
    lines = _page(("g'(x) = 3*x^2 - 5", "start", "P3"))
    assert [l.line_id for l in lines] == ["L1", "L2", lines[2].line_id, "L4"]       # the reader's copy (L3) is gone
    g, work = lines[2], lines[3]
    assert practice.is_given(g) and g.line_id.startswith("G") and g.problem_id == "P" + g.line_id
    assert (g.source, g.relation, g.confidence, g.box, g.plain) == ("printed", "start", "high", (400, 80, 450, 420),
                                                                    "g(x) = x^3 - 5*x")
    # the line right under it joins its problem; it is no longer a `start`, and nothing guessed its relation
    assert (work.problem_id, work.relation) == (g.problem_id, "other")
    assert [l.problem_id for l in lines[:2]] == ["P1", "P1"]                       # the student's own problem is untouched
    # the relation the practice was set with is used when the server remembers it
    assert _page(("g'(x) = 3*x^2 - 5", "start", "P3"), tasks={practice.key(GIVEN.plain): "derivative"})[3].relation == "derivative"
    # the same text gives the same id on the next request, wherever it sits and whatever the state carried
    moved = GivenLine(box=(300, 80, 350, 420), latex=GIVEN.latex, plain="g(x)=x^3-5*x")
    assert practice.given_lines([moved])[0].line_id == g.line_id
    twice = practice.given_lines([GIVEN, moved])
    assert len({l.line_id for l in twice}) == 2 and twice[0].box[0] == 300
    # nothing given: lines pass through, and a reader line cannot pose as a given one
    fake = _line("G12", "x", (10, 10, 20, 20), "other", "P9", "printed")
    out = practice.merge_given([fake, OWN[0]], None)
    assert [l.line_id for l in out] == ["L2", "L1"] and not practice.problems(out)


def test_work_is_grouped_by_geometry_only():
    # the reader grouped the work with the text it read at the given line's spot (P2): kept, later lines too
    lines = _page(("g'(x) = 3*x^(3-1) - 5", "derivative", "P2"), ("g'(x) = 3*x^2 - 5", "simplify", "P2"))
    g = lines[2]
    assert [l.problem_id for l in lines[3:]] == [g.problem_id] * 2 and [l.relation for l in lines[3:]] == ["derivative", "simplify"]
    # a second problem the student starts further down is not swallowed: the next problem ends the practice
    lines = _page(("g'(x) = 3*x^2 - 5", "start", "P3"), ("h(x) = 7*x", "start", "P4"), ("h'(x) = 7", "derivative", "P4"))
    assert [l.problem_id for l in lines[3:]] == [lines[2].problem_id, "P4", "P4"]
    # handwriting far below the given line is not its work
    far = _line("L9", "y = 4*x", (800, 80, 850, 400), "start", "P5")
    lines = practice.merge_given(OWN + [far], [GIVEN])
    assert lines[-1].problem_id == "P5" and lines[2].line_id.startswith("G") and practice.work(lines, lines[2]) == []
    # nor is handwriting in another column, or a line with another problem's line nearer above it
    side = _line("L9", "y = 4*x", (470, 600, 520, 900), "start", "P5")
    assert practice.merge_given(OWN + [side], [GIVEN])[-1].problem_id == "P5"
    # two practice problems: each keeps the work under it
    second = GivenLine(box=(600, 80, 650, 420), latex="h(x) = 4x^2", plain="h(x) = 4*x^2")
    read = OWN + [_line("L4", "g'(x) = 3*x^2 - 5", (470, 80, 520, 420), "start", "P3"),
                  _line("L5", "h'(x) = 8*x", (670, 80, 720, 420), "derivative", "P3")]
    lines = practice.merge_given(read, [second, GIVEN])
    g1, g2 = [l for l in lines if practice.is_given(l)]
    assert [(l.line_id, l.problem_id) for l in lines[2:]] == [
        (g1.line_id, g1.problem_id), ("L4", g1.problem_id), (g2.line_id, g2.problem_id), ("L5", g2.problem_id)]


# ---- checking the work ----

def test_work_under_a_given_line_is_verified_against_it():
    lines = _page(("g'(x) = 3*x^2 - 5", "derivative", "P3"))
    g = lines[2]
    resp, result, client = _run(lines, _submit())          # the model checks nothing itself
    assert result.tool_calls[0] == f"verify_step({g.line_id}->L4, derivative) = correct"
    assert result.verdicts == {"L4": "correct"}
    assert [(a.type, a.color, a.line_id) for a in resp.actions] == [("note", "green", "L4")]   # written in code
    sent = json.loads(client.calls[0][0].parts[0].text)
    assert [l.get("given") for l in sent["lines"]] == [None, None, True, None]
    (p,) = sent["practice"]
    assert p["given_line_id"] == g.line_id and p["work_line_ids"] == ["L4"] and p["checks"][0]["verdict"] == "correct"
    assert p["checks"][0]["follows_from"] == g.line_id and "green note" in p["last_line"]
    # the server's verdict stands even if the model re-checks the line against something else
    wrong = _page(("g'(x) = 3*x^2 - 5*x", "derivative", "P3"))
    again = ("verify_step", {"before": "3*x^2 - 5*x", "after": "g'(x) = 3*x^2 - 5*x", "relation": "equals",
                             "before_line_id": "L1", "after_line_id": "L4"})
    resp, result, _ = _run(wrong, _resp(again), _submit())
    assert result.verdicts["L4"] == "incorrect"
    # a page with no practice problem sends no `practice` and no `given` keys
    _, _, client = _run(list(OWN), _submit())
    sent = json.loads(client.calls[0][0].parts[0].text)
    assert "practice" not in sent and all("given" not in l for l in sent["lines"])


def _note(line_id, color, text, **kw):
    return {"type": "note", "line_id": line_id, "color": color, "side": "right", "text": text,
            "box": [470, 80, 520, 420], **kw}


def test_correct_final_answer_gets_one_green_note_in_auto():
    lines = _page(("g'(x) = 3*x^2 - 5", "derivative", "P3"))
    praise = [_note("L4", "green", "Correct. You've got it."), _note("L2", "green", "Nice work!"),
              _note(lines[2].line_id, "green", "Good problem!")]
    resp, _, _ = _run(lines, _submit(*praise))
    assert [(a.type, a.color, a.line_id, a.text) for a in resp.actions] == [("note", "green", "L4", "Correct. You've got it.")]
    assert resp.state.flagged_line_ids == ["L4"]
    # not said twice while the line is unchanged
    resp2, _, _ = _run(lines, _submit(*praise), state=resp.state)
    assert resp2.actions == []
    # a correct step that is not the last line gets nothing; neither does praise while the last line is open
    lines = _page(("g'(x) = 3*x^(3-1) - 5", "derivative", "P3"), ("g'(x) = 3*x^2 - 5", "simplify", "P3"))
    resp, result, _ = _run(lines, _submit(_note("L4", "green", "Good start!"), _note("L5", "green", "Correct!")))
    assert result.verdicts == {"L4": "correct", "L5": "correct"} and [a.line_id for a in resp.actions] == ["L5"]
    lines = _page(("g'(x) = 3*x^2 - 5", "derivative", "P3"), ("g''(x) =", "derivative", "P3"))
    assert _run(lines, _submit(_note("L4", "green", "Correct!")))[0].actions == []
    # an equation is only answered when the last line gives the value
    eq = GivenLine(box=(400, 80, 450, 420), latex="2x + 6 = 14", plain="2*x + 6 = 14")
    lines = _page(("2*x = 8", "solve", "P3"), given=(eq,), read_given=False)
    assert _run(lines, _submit(_note("L4", "green", "Correct!")))[0].actions == []
    lines = _page(("2*x = 8", "solve", "P3"), ("x = 4", "solve", "P3"), given=(eq,), read_given=False)
    assert [a.line_id for a in _run(lines, _submit(_note("L5", "green", "Correct!")))[0].actions] == ["L5"]
    # the exception is only for practice: the same praise on the student's own correct work is still dropped
    assert _run(list(OWN), _submit(_note("L2", "green", "Correct!")))[0].actions == []


def test_wrong_step_gets_the_red_mark_and_no_praise():
    lines = _page(("g'(x) = 3*x^2 - 5*x", "derivative", "P3"))
    g = lines[2]
    circle = {"type": "circle", "line_id": "L4", "color": "red", "box": [470, 80, 520, 420], "focus": "5*x"}
    resp, result, _ = _run(lines, _submit(
        circle, _note("L4", "red", "What is the derivative of $5x$?"), _note("L4", "green", "Correct!"),
        {"type": "circle", "line_id": g.line_id, "color": "red", "box": list(g.box)},      # never the given line
        _note(g.line_id, "red", "Is this right?")))
    assert result.verdicts["L4"] == "incorrect"
    assert [(a.type, a.color, a.line_id) for a in resp.actions] == [("circle", "red", "L4"), ("note", "red", "L4")]
    assert resp.actions[0].box[1] > 80                                             # narrowed to the wrong part
    assert practice.status(lines, result.verdicts) == [
        {"problem": "g(x) = x^3 - 5*x", "latex": "g(x) = x^3 - 5x", "problem_id": g.problem_id, "lines": 1, "correct": False}]


def test_open_line_under_practice_is_not_finished():
    lines = _page(("g'(x) =", "derivative", "P3"))
    g = lines[2]
    compute_call = ("compute_step", {"before": g.plain, "relation": "derivative", "before_line_id": g.line_id,
                                     "after_line_id": "L4"})
    answer = _note("L4", "black", "$3 x^{2} - 5$", side="inline")
    resp, result, client = _run(lines, _resp(compute_call), _submit(answer))
    assert resp.actions == [] and resp.state.flagged_line_ids == []
    assert f"compute_step({g.line_id}->L4, derivative) = refused (practice)" in result.tool_calls
    assert client.calls[1][-1].parts[0].function_response.response["result"] == ""
    # the guard alone stops it too, in help mode as well
    from internal import TeachResult
    from models import Action
    res = TeachResult(actions=[Action(type="note", line_id="L4", color="black", side="inline", text="$3x^2 - 5$")])
    assert merge(PageState(page_id="t"), lines, res, "help", "what does this equal?").actions == []
    # the same open line under the student's own problem is still finished
    own = list(OWN[:1]) + [_line("L2", "f'(x) =", (180, 80, 240, 400), "derivative")]
    resp, _, _ = _run(own, _submit({**answer, "line_id": "L2"}))
    assert [(a.type, a.side) for a in resp.actions] == [("note", "inline")]


def test_solve_under_practice_is_refused():
    lines = _page(("g'(x) = 3*x^2", "derivative", "P3"), ("solve", "other", "P3"))
    g = lines[2]
    assert lines[4].problem_id == g.problem_id
    steps = [{"latex": "g'(x) = 3x^2 - 5", "plain": "g'(x) = 3*x^2 - 5", "relation": "derivative"}]
    resp, result, client = _run(lines, _submit({"type": "solution", "line_id": "L4", "color": "black", "steps": steps}))
    assert len(client.calls) == 1                                                  # not sent back to be fixed either
    # their line is wrong and the model said nothing about it: the server marks it, and turns the request down
    assert [(a.type, a.color, a.line_id, a.text) for a in resp.actions] == [
        ("circle", "red", "L4", None), ("note", "red", "L4", guard.CHECK_AGAIN), ("note", "blue", "L5", practice.TRY_FIRST)]
    assert any(c.startswith("practice: 1 action") for c in result.tool_calls)
    # not repeated on the next automatic check, and the model's own blue refusal is used when it sends one
    assert _run(lines, _submit(), state=resp.state)[0].actions == []
    resp, _, _ = _run(lines, _submit(_note("L4", "blue", "Have a go first, then tap Help.")))
    assert [(a.line_id, a.text) for a in resp.actions] == [("L4", "Have a go first, then tap Help.")]
    # asked out loud in help mode: no solution either; the reply is sent back for a hint instead
    hint = _note("L4", "blue", "The power comes down in front and drops by one. Try that on each term.")
    resp, result, client = _run(lines, _submit({"type": "solution", "line_id": "L4", "steps": steps}), _submit(hint),
                                mode="help", question="solve this for me")
    assert len(client.calls) == 2 and [a.type for a in resp.actions] == ["note"] and resp.actions[0].color == "blue"
    # a "solve" under the student's own problem still gets its solution
    own = [_line("L1", "2*x + 6 = 14", (100, 80, 160, 400)), _line("L2", "solve", (100, 450, 160, 560), "other")]
    sol = {"type": "solution", "line_id": "L1", "steps": [{"latex": "2x = 8", "plain": "2*x = 8", "relation": "solve"},
                                                          {"latex": "x = 4", "plain": "x = 4", "relation": "solve"}]}
    assert [a.type for a in _run(own, _submit(sol))[0].actions] == ["solution"]


def test_help_on_practice_gives_a_hint_by_the_given_line():
    lines = _page()
    g = lines[2]
    hint = _note(g.line_id, "blue", "A derivative measures steepness. Each power of x comes down in front.")
    resp, _, _ = _run(lines, _resp(("submit_feedback", {"actions": [hint], "clear_line_ids": [], "hint_updates": [
        {"problem_id": g.problem_id, "hint_level": 1}]})), mode="help")
    assert [(a.type, a.color, a.line_id) for a in resp.actions] == [("note", "blue", g.line_id)]
    assert [p.model_dump() for p in resp.state.problems] == [{"problem_id": g.problem_id, "hint_level": 1}]


# ---- end to end: the lesson sets it, the next check grades it, the server remembers ----

def _png():
    buf = io.BytesIO(); Image.new("RGB", (200, 100), "white").save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_pipeline_sets_grades_and_remembers_practice(monkeypatch):
    import main, read
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    monkeypatch.setenv("GEMINI_MODEL", "fake-model")
    page = {"read": list(OWN), "model": _lesson(GOOD), "prev": None}

    def read_page(client, model, png, prev):
        page["prev"] = prev
        return page["read"]
    monkeypatch.setattr(read, "read_page", read_page)
    monkeypatch.setattr(teach_mod.gemini, "generate", lambda client, model, contents, cfg: page["model"])
    http = TestClient(main.app)
    post = lambda **kw: http.post("/api/check", json={"image_base64": _png(), **kw})

    # Teach me: the lesson sets the practice problem
    r = post(mode="explain", state={"page_id": "pg"}).json()
    assert r["actions"][0]["lesson"]["practice"]["plain"] == "g(x) = x^3 - 5*x"
    assert memory.practice("pg") == [{"problem": "g(x) = x^3 - 5*x", "latex": "g(x) = x^3 - 5x", "relation": "derivative",
                                      "status": "set", "lines": 0, "checks": 0, "answered_correctly": False}]

    # the page wrote it down and the student answered under it; the reader calls their line a new `start`
    given = [GIVEN.model_dump()]
    page["read"] = OWN + [_line("L3", "g(x) = x^3 - 5x", (402, 82, 448, 418), "other", "P2", "printed"),
                          _line("L4", "g'(x) = 3*x^2 - 5*x", (470, 80, 520, 420), "start", "P3")]
    page["model"] = _submit({"type": "circle", "line_id": "L4", "color": "red", "focus": "5*x"},
                            _note("L4", "red", "What is the derivative of $5x$?"))
    r = post(mode="auto", given=given, state=r["state"]).json()
    gid = r["lines"][2]["line_id"]
    assert gid.startswith("G") and [l["line_id"] for l in r["lines"]] == ["L1", "L2", gid, "L4"]
    assert r["lines"][3]["relation"] == "derivative" and r["lines"][3]["problem_id"] == "P" + gid   # known from the lesson
    assert [(a["type"], a["color"]) for a in r["actions"]] == [("circle", "red"), ("note", "red")]
    assert memory.practice("pg")[0]["status"] == "attempted"

    # they fix it: the given line keeps its id, the reader is not shown it, and the green note goes out in auto
    page["read"] = OWN + [_line("L4", "g'(x) = 3*x^2 - 5", (470, 80, 520, 420), "derivative", "P" + gid)]
    page["model"] = _resp(("submit_feedback", {"actions": [_note("L4", "green", "Correct. You've got it.")],
                                               "clear_line_ids": ["L4"], "hint_updates": []}))
    r = post(mode="auto", given=given, state=r["state"]).json()
    assert [l.line_id for l in page["prev"]] == ["L1", "L2", "L4"]
    assert [l["line_id"] for l in r["lines"]] == ["L1", "L2", gid, "L4"]
    assert [(a["type"], a["color"], a["line_id"]) for a in r["actions"]] == [("note", "green", "L4")]
    assert memory.practice("pg")[0]["answered_correctly"] is True and memory.practice("pg")[0]["checks"] == 2

    recent = http.get("/api/debug/recent").json()["requests"]
    assert recent[0]["practice"][0]["status"] == "correct" and recent[0]["given"][0]["plain"] == GIVEN.plain
    assert recent[2]["practice"][0]["status"] == "set" and recent[2]["given"] == []
    assert recent[2]["actions_sent"][0]["lesson"]["practice"]["ask"] == "g'(x) ="


# ---- the verdict is known in code, so the reply does not depend on the model sending it ----

def test_green_note_is_written_in_code_once_and_not_for_halfway_steps():
    # the live failure: g(x) = 4x^2 + 5x, the answer written under it, and the model sends nothing
    g = GivenLine(box=(400, 80, 450, 420), latex="g(x) = 4x^2 + 5x", plain="g(x) = 4*x^2 + 5*x")
    lines = _page(("g'(x) = 8*x + 5", "derivative", "P3"), given=(g,), read_given=False)
    resp, result, _ = _run(lines, _submit())
    assert result.tool_calls == [f"verify_step({lines[2].line_id}->L4, derivative) = correct", "submit_feedback(0/0 actions kept)"]
    assert [(a.type, a.color, a.line_id, a.side, a.text) for a in resp.actions] == [
        ("note", "green", "L4", "right", guard.WELL_DONE)]
    assert resp.actions[0].box == (470, 80, 520, 420) and resp.state.flagged_line_ids == ["L4"]
    # once per page state: the unchanged, already-flagged line gets nothing new, from the server or the model
    assert _run(lines, _submit(), state=resp.state)[0].actions == []
    assert _run(lines, _submit(_note("L4", "green", "Yes!")), state=resp.state)[0].actions == []
    assert _run(lines, _submit(), state=resp.state, mode="help")[0].actions == []
    # the model's own green note is the one that is used, and there is still only one
    assert [a.text for a in _run(lines, _submit(_note("L4", "green", "Yes, that's it!")))[0].actions] == ["Yes, that's it!"]
    # ... also when it put its praise on another line of that problem
    resp, _, _ = _run(lines, _submit(_note(lines[2].line_id, "green", "Nicely done!")))
    assert [(a.line_id, a.text) for a in resp.actions] == [("L4", "Nicely done!")]
    # a correct step that does not give the value yet gets nothing; the final line does
    eq = GivenLine(box=(400, 80, 450, 420), latex="2x + 6 = 14", plain="2*x + 6 = 14")
    half = _page(("2*x = 8", "solve", "P3"), given=(eq,), read_given=False)
    resp, result, _ = _run(half, _submit())
    assert result.verdicts == {"L4": "correct"} and resp.actions == []
    # (in help mode praise for the halfway step would read as "solved": it is shown as a hint instead)
    resp, _, _ = _run(half, _submit(_note("L4", "green", "Good so far. Now divide both sides by 2.")), mode="help")
    assert [(a.color, a.line_id) for a in resp.actions] == [("blue", "L4")]
    full = _page(("2*x = 8", "solve", "P3"), ("x = 4", "solve", "P3"), given=(eq,), read_given=False)
    assert [(a.color, a.line_id) for a in _run(full, _submit())[0].actions] == [("green", "L5")]
    # an open last line, or a wrong line above the last one: no green note
    still = _page(("2*x = 8", "solve", "P3"), ("x =", "solve", "P3"), given=(eq,), read_given=False)
    assert _run(still, _submit())[0].actions == []
    slip = _page(("2*x = 20", "solve", "P3"), ("x = 10", "solve", "P3"), given=(eq,), read_given=False)
    assert all(a.color != "green" for a in _run(slip, _submit())[0].actions)
    # the student's own correct work (no practice problem) still gets nothing
    assert _run(list(OWN), _submit())[0].actions == []


def test_silent_model_still_gets_the_mistake_marked():
    lines = _page(("g'(x) = 3*x^2 - 5*x", "derivative", "P3"))
    resp, result, _ = _run(lines, _submit())
    assert result.verdicts == {"L4": "incorrect"}
    assert [(a.type, a.color, a.line_id, a.text) for a in resp.actions] == [
        ("circle", "red", "L4", None), ("note", "red", "L4", guard.CHECK_AGAIN)]
    assert resp.actions[0].box == (470, 80, 520, 420) and resp.state.flagged_line_ids == ["L4"]
    # not again while the line is unchanged
    assert _run(lines, _submit(), state=resp.state)[0].actions == []
    # the model marked it: its mark is the only one
    circle = {"type": "circle", "line_id": "L4", "color": "red", "box": [470, 80, 520, 420]}
    resp, _, _ = _run(lines, _submit(circle, _note("L4", "red", "What is the derivative of $5x$?")))
    assert [(a.type, a.text) for a in resp.actions] == [("circle", None), ("note", "What is the derivative of $5x$?")]
    resp, _, _ = _run(lines, _submit(_note("L4", "red", "What is the derivative of $5x$?")))
    # the model sent only the question; the checker agrees the line is wrong, so the circle is added in code
    assert [(a.type, a.text) for a in resp.actions] == [("note", "What is the derivative of $5x$?"), ("circle", None)]
    # help mode is the model's to answer: nothing is added there
    hint = _note("L4", "blue", "The derivative of a term like 5x is just the number in front. Try that term again.")
    assert [a.color for a in _run(lines, _submit(hint), mode="help")[0].actions] == ["blue"]


# ---- the answer written on the ask line's own row (the page invites it: `g'(x) =` then the student's ink) ----

STATEMENT = GivenLine(box=(690, 109, 800, 640), latex="g(x) = 4x^2 + 5x", plain="g(x) = 4*x^2 + 5*x")
ASK = GivenLine(box=(818, 109, 940, 496), latex="g'(x) =", plain="g'(x) =")
SID = practice.given_lines([STATEMENT])[0].line_id
AID = practice.given_lines([ASK])[0].line_id
ROW_OWN = [_line("L1", "f(x) = x^2", (100, 109, 200, 500)), _line("L2", "f'(x) = 2*x", (220, 109, 320, 500), "derivative")]


def _row_page(*read, given=(STATEMENT, ASK), tasks=None):
    return practice.merge_given(ROW_OWN + list(read), list(given), tasks)


def _sent(resp):
    return [(a.type, a.color, a.line_id) for a in resp.actions]


def test_answer_on_the_ask_row_read_as_one_line_is_the_practice_answer():
    # the live case: the reader returned the tutor's `g'(x) =` and the student's `8x + 5` as one line, L4
    merged = _line("L4", "g'(x) = 8*x + 5", (822, 109, 936, 850), "derivative", "P2")
    lines = _row_page(merged)
    assert [(l.line_id, l.problem_id) for l in lines] == [("L1", "P1"), ("L2", "P1"), (SID, "P" + SID), ("L4", "P" + SID)]
    assert list(practice.problems(lines)) == ["P" + SID] and practice.problems(lines)["P" + SID].line_id == SID
    assert [l.line_id for l in practice.work(lines, lines[2])] == ["L4"] and lines[3].relation == "derivative"
    resp, result, _ = _run(lines, _submit())
    assert result.tool_calls[0] == f"verify_step({SID}->L4, derivative) = correct"
    assert practice.done(lines, result.verdicts) == {"P" + SID: "L4"}
    assert _sent(resp) == [("note", "green", "L4")] and resp.actions[0].text == guard.WELL_DONE
    # a short answer leaves most of the row's box inside the ask line's box: still the answer, not a duplicate
    short = _row_page(_line("L4", "g'(x) = 8*x + 5", (822, 109, 936, 560), "start", "P2"))
    assert [(l.line_id, l.plain, l.relation) for l in short[3:]] == [("L4", "g'(x) = 8*x + 5", "derivative")]
    # the reader also returned the tutor's two lines as printed text: those are the given lines again
    printed = [_line("L3", "g(x) = 4x^2 + 5x", (692, 110, 798, 640), "start", "P2", "printed"),
               _line("L5", "g'(x) =", (820, 110, 938, 490), "other", "P2", "printed")]
    again = _row_page(printed[0], printed[1], _line("L4", "8*x + 5", (822, 520, 936, 850), "start", "P2"))
    assert [(l.line_id, l.plain) for l in again[2:]] == [(SID, STATEMENT.plain), ("L4", "g'(x) = 8*x + 5")]


def test_answer_on_the_ask_row_read_as_only_the_right_hand_part():
    for plain in ("8*x + 5", "= 8*x + 5"):
        lines = _row_page(_line("L4", plain, (826, 520, 934, 850), "start", "P2"))
        assert [(l.line_id, l.problem_id, l.plain, l.relation, l.box) for l in lines[2:]] == [
            (SID, "P" + SID, STATEMENT.plain, "start", STATEMENT.box),
            ("L4", "P" + SID, "g'(x) = 8*x + 5", "derivative", (826, 520, 934, 850))]
        resp, result, _ = _run(lines, _submit())
        assert result.tool_calls[0] == f"verify_step({SID}->L4, derivative) = correct"
        assert _sent(resp) == [("note", "green", "L4")] and resp.actions[0].box == (826, 520, 934, 850)
        assert practice.status(lines, result.verdicts) == [
            {"problem": STATEMENT.plain, "latex": STATEMENT.latex, "problem_id": "P" + SID, "lines": 1, "correct": True}]
    # the reader split the student's ink in two: one answer line, under the first piece's id
    lines = _row_page(_line("L4", "8*x", (826, 520, 934, 650), "start", "P2"), _line("L5", "+ 5", (826, 670, 934, 760), "other", "P2"))
    assert [(l.line_id, l.plain, l.box) for l in lines[3:]] == [("L4", "g'(x) = 8*x + 5", (826, 520, 934, 760))]
    # the id and the problem stay the same from the half-written answer to the finished one
    half = _row_page(_line("L4", "8*x +", (826, 520, 934, 700), "start", "P2"))
    assert [(l.line_id, l.problem_id) for l in half[2:]] == [(l.line_id, l.problem_id) for l in lines[2:]]


def test_wrong_answer_on_the_ask_row_is_marked():
    for read in (_line("L4", "g'(x) = 8*x", (822, 109, 936, 700), "derivative", "P2"),
                 _line("L4", "8*x", (826, 520, 934, 700), "start", "P2")):
        lines = _row_page(read)
        resp, result, _ = _run(lines, _submit())
        assert result.verdicts == {"L4": "incorrect"} and practice.done(lines, result.verdicts) == {}
        assert _sent(resp) == [("circle", "red", "L4"), ("note", "red", "L4")]


def test_answer_written_below_the_ask_line_still_works():
    below = _line("L4", "g'(x) = 8*x + 5", (960, 109, 995, 600), "start", "P2")
    lines = _row_page(below)
    assert [(l.line_id, l.problem_id, l.relation) for l in lines[2:]] == [
        (SID, "P" + SID, "start"), (AID, "P" + SID, "other"), ("L4", "P" + SID, "derivative")]
    resp, result, _ = _run(lines, _submit())
    assert result.tool_calls[0] == f"verify_step({SID}->L4, derivative) = correct"
    assert _sent(resp) == [("note", "green", "L4")]
    # the answer on the row and a further step under it: the last line is the one that finishes the problem
    lines = _row_page(_line("L4", "8*x + 5", (826, 520, 934, 850), "start", "P2"),
                      _line("L5", "g'(x) = 5 + 8*x", (955, 109, 995, 600), "simplify", "P2"))
    assert [(l.line_id, l.problem_id) for l in lines[2:]] == [(SID, "P" + SID), ("L4", "P" + SID), ("L5", "P" + SID)]
    resp, result, _ = _run(lines, _submit())
    assert result.verdicts == {"L4": "correct", "L5": "correct"} and _sent(resp) == [("note", "green", "L5")]


def test_untouched_ask_line_does_nothing():
    reads = ([],                                                                           # the reader skipped the tutor's text
             [_line("L4", "g'(x) =", (820, 105, 938, 530), "other", "P2")],               # read it again, a bit wide
             [_line("L4", "g'(x)", (820, 109, 938, 525), "start", "P2")],                  # ... and without the '='
             [_line("L4", "g`(x) =", (820, 109, 938, 700), "start", "P2")])                # ... or with a far too wide box
    for read in reads:
        lines = _row_page(*read)
        assert [l.line_id for l in lines] == ["L1", "L2", SID, AID], read
        assert practice.work(lines, lines[2]) == [] and all(l.source == "printed" for l in lines[2:])
        compute_call = ("compute_step", {"before": STATEMENT.plain, "relation": "derivative",
                                         "before_line_id": SID, "after_line_id": AID})
        resp, result, _ = _run(lines, _resp(compute_call), _submit(
            _note(AID, "green", "Correct!"), {"type": "circle", "line_id": AID, "color": "red", "box": list(ASK.box)},
            {"type": "note", "line_id": AID, "color": "blue", "side": "inline", "text": "8x + 5", "box": list(ASK.box)}))
        assert resp.actions == [] and result.verdicts == {} and practice.done(lines, result.verdicts) == {}
        assert practice.status(lines, {})[0]["lines"] == 0


def test_two_practice_problems_with_ask_lines_stay_separate():
    s2 = GivenLine(box=(400, 109, 480, 640), latex="h(x) = x^3", plain="h(x) = x^3")
    a2 = GivenLine(box=(495, 109, 575, 480), latex="h'(x) =", plain="h'(x) =")
    s2_id, a2_id = (l.line_id for l in practice.given_lines([s2, a2]))
    read = [_line("L3", "3*x^2", (500, 500, 572, 700), "start", "P2"), _line("L4", "8*x", (826, 520, 934, 700), "start", "P2")]
    lines = _row_page(*read, given=(STATEMENT, ASK, s2, a2))
    assert [(l.line_id, l.problem_id, l.plain) for l in lines[2:]] == [
        (s2_id, "P" + s2_id, "h(x) = x^3"), ("L3", "P" + s2_id, "h'(x) = 3*x^2"),
        (SID, "P" + SID, STATEMENT.plain), ("L4", "P" + SID, "g'(x) = 8*x")]
    assert list(practice.problems(lines)) == ["P" + s2_id, "P" + SID]
    resp, result, _ = _run(lines, _submit())
    assert result.verdicts == {"L3": "correct", "L4": "incorrect"}
    assert practice.done(lines, result.verdicts) == {"P" + s2_id: "L3"}
    assert _sent(resp) == [("circle", "red", "L4"), ("note", "red", "L4"), ("note", "green", "L3")]
    # only the first is answered: the second keeps its untouched ask line
    lines = _row_page(read[0], given=(STATEMENT, ASK, s2, a2))
    assert [l.line_id for l in lines[2:]] == [s2_id, "L3", SID, AID] and a2_id not in [l.line_id for l in lines]
    assert _sent(_run(lines, _submit())[0]) == [("note", "green", "L3")]
