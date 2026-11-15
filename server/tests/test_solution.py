"""Full solve: a worked solution is only written when asked for, and only out of steps the checker accepts."""
import json
import pathlib

import memory
import solution
import teach as teach_mod
from guard import merge
from internal import TeachResult
from models import Action, CheckRequest, CheckResponse, PageState, ReadLine
from tests.test_teach import FakeClient, _resp


def L(i, plain, box, relation="solve", problem="P1", source=None):
    return ReadLine(line_id=i, problem_id=problem, latex=plain, plain=plain, box=box, relation=relation,
                    confidence="high", source=source)


PROBLEM = L("L1", "3*x^2 - 3 = 0", (150, 80, 230, 420), "start")
SOLVE = L("L2", "solve", (150, 460, 220, 620), "other")


def S(latex, plain, relation="solve"):
    return {"latex": latex, "plain": plain, "relation": relation}


GOOD = [S("3x^2 = 3", "3*x^2 = 3"), S("x^2 = 1", "x^2 = 1"), S("x = \\pm 1", "x = 1 or x = -1")]


def _req(mode="auto", question=None, state=None):
    return CheckRequest(image_base64="", mode=mode, question=question, state=state or PageState(page_id="t"))


def _submit(*actions, **extra):
    return _resp(("submit_feedback", {"actions": list(actions), "clear_line_ids": [], "hint_updates": [], **extra}))


def _sol(steps, line_id="L1"):
    return {"type": "solution", "line_id": line_id, "box": [0, 0, 10, 10], "color": "black", "steps": steps}


def _run(responses, lines, req=None):
    req = req or _req()
    client = FakeClient(responses)
    r = teach_mod.teach(client, "fake", lines, req)
    out = merge(req.state, lines, r, req.mode, req.question, memory.marked("t"), memory.solved("t"))
    return client, r, out


def test_written_solve_gives_a_verified_solution():
    client, r, out = _run([_submit(_sol(GOOD, line_id="L2"))], [PROBLEM, SOLVE])  # pointed at the word: moved to the problem
    assert len(client.calls) == 1
    [a] = out.actions
    assert (a.type, a.line_id, a.color, a.box) == ("solution", "L1", "black", PROBLEM.box)
    assert a.steps == ["3x^2 = 3", "x^2 = 1", "x = \\pm 1"] and a.text is None and a.side is None
    assert "solution(L1 from L1): S1=correct, S2=correct, S3=correct" in r.tool_calls
    assert out.state.flagged_line_ids == ["L1"]


def test_wrong_step_is_sent_back_once_then_fixed():
    bad = [GOOD[0], S("x^2 = 2", "x^2 = 2"), S("x = \\pm\\sqrt{2}", "x = sqrt(2) or x = -sqrt(2)")]
    client, r, out = _run([_submit(_sol(bad)), _submit(_sol(GOOD))], [PROBLEM, SOLVE])
    assert len(client.calls) == 2
    reply = client.calls[1][-1].parts[0].function_response.response
    assert reply["ok"] is False and "step 2" in reply["fix_and_submit_again"] and "x^2 = 2" in reply["fix_and_submit_again"]
    assert "submit_feedback sent back: a solution step did not pass the check" in r.tool_calls
    assert out.actions[0].steps == ["3x^2 = 3", "x^2 = 1", "x = \\pm 1"] and len(out.actions) == 1


def test_wrong_step_twice_is_cut_with_a_blue_note():
    bad = [GOOD[0], S("x^2 = 2", "x^2 = 2"), S("x = \\pm\\sqrt{2}", "x = sqrt(2) or x = -sqrt(2)")]
    client, r, out = _run([_submit(_sol(bad))], [PROBLEM, SOLVE])  # the fake repeats its last reply
    assert len(client.calls) == 2
    sol, note = out.actions
    assert sol.type == "solution" and sol.steps == ["3x^2 = 3"]          # nothing the checker called wrong is shown
    assert (note.type, note.color, note.line_id, note.text) == ("note", "blue", "L1", solution.CUT_NOTE)
    assert any("cut after S1" in c and "S2=incorrect" in c for c in r.tool_calls)


def test_first_step_wrong_twice_leaves_no_solution():
    client, r, out = _run([_submit(_sol([S("3x^2 = 4", "3*x^2 = 4"), S("x^2 = 4/3", "x^2 = 4/3")]))], [PROBLEM, SOLVE])
    assert [a.type for a in out.actions] == ["note"] and out.actions[0].text == solution.DROP_NOTE
    assert any("dropped" in c and "first step incorrect" in c for c in r.tool_calls)


def test_a_missing_root_counts_as_wrong():
    assert solution.judge("x^2 = 1", "x = 1", "solve")["verdict"] == "incorrect"
    assert solution.judge("x^2 = 1", solution.expand_pm("x = ±1"), "solve")["verdict"] == "correct"


def test_no_request_no_solution():
    client, r, out = _run([_submit(_sol(GOOD))], [PROBLEM])
    assert r.actions and r.actions[0].type == "solution"     # the steps were fine...
    assert out.actions == [] and out.state.flagged_line_ids == []   # ...but nobody asked
    # help without a question, and a copied instruction, are not requests either
    _, _, out = _run([_submit(_sol(GOOD), solution_requested=True)], [PROBLEM], _req("help"))
    assert not any(a.type == "solution" for a in out.actions)
    _, _, out = _run([_submit(_sol(GOOD))], [PROBLEM, L("L2", "solve for x", (150, 460, 220, 620), "other")])
    assert out.actions == []


def test_request_words():
    for words in ("solve", "Solve it", "solve this!", "work it out", "show steps", "\\text{show the steps}", "solve please"):
        assert solution.is_request(L("L9", words, (0, 0, 10, 10), "other")), words
    for words in ("solve for x", "x = 2", "graph this", "find x", "resolve"):
        assert not solution.is_request(L("L9", words, (0, 0, 10, 10), "other")), words
    assert not solution.is_request(L("L9", "solve", (0, 0, 10, 10), "other", source="printed"))


def test_request_belongs_to_the_nearest_problem_when_read_as_its_own():
    other = L("L3", "2*x + 5 = 11", (600, 80, 680, 420), "start", problem="P2")
    stray = SOLVE.model_copy(update={"problem_id": "P9"})
    assert solution.requested_problems([PROBLEM, stray, other]) == {"P1"}
    assert solution.requested_problems([PROBLEM, SOLVE, other]) == {"P1"}
    _, _, out = _run([_submit(_sol([S("2x = 6", "2*x = 6"), S("x = 3", "x = 3")], line_id="L3"))], [PROBLEM, stray, other])
    # "solve" was written by P1, not P2: the P2 solution is dropped, and P1's request is answered with a note
    assert [(a.type, a.color, a.line_id) for a in out.actions] == [("note", "blue", SOLVE.line_id)]


def test_continues_from_the_students_last_correct_line():
    lines = [PROBLEM, L("L2", "3*x^2 = 3", (260, 80, 340, 420)), L("L3", "solve", (260, 460, 330, 620), "other")]
    client, r, out = _run([_submit(_sol(GOOD[1:], line_id="L1"))], lines)
    [a] = out.actions
    assert (a.line_id, a.box, a.steps) == ("L2", lines[1].box, ["x^2 = 1", "x = \\pm 1"])
    assert "solution(L2 from L2): S1=correct, S2=correct" in r.tool_calls


def test_wrong_last_line_keeps_its_red_mark_and_the_solution_starts_before_it():
    lines = [PROBLEM, L("L2", "3*x^2 = 3", (260, 80, 340, 420)), L("L3", "x^2 = 3", (370, 80, 450, 420)),
             L("L4", "solve", (370, 460, 440, 620), "other")]
    verify = ("verify_step", {"before": "3*x^2 = 3", "after": "x^2 = 3", "relation": "solve",
                              "before_line_id": "L2", "after_line_id": "L3"})
    circle = {"type": "circle", "line_id": "L3", "box": [370, 80, 450, 420], "color": "red"}
    note = {"type": "note", "line_id": "L3", "box": [370, 80, 450, 420], "color": "red", "text": "What is $3 / 3$?"}
    client, r, out = _run([_resp(verify), _submit(circle, note, _sol(GOOD[1:], line_id="L3"))], lines)
    assert [(a.type, a.line_id, a.color) for a in out.actions] == [
        ("circle", "L3", "red"), ("note", "L3", "red"), ("solution", "L3", "black")]
    assert out.actions[2].steps == ["x^2 = 1", "x = \\pm 1"] and out.actions[2].box == lines[2].box
    assert "solution(L3 from L2): S1=correct, S2=correct" in r.tool_calls
    # the wrong line is found here too when the model did not check it; steps built on it fail
    built_on_it = [S("x = \\pm\\sqrt{3}", "x = sqrt(3) or x = -sqrt(3)")]
    _, r, out = _run([_submit(_sol(built_on_it, line_id="L3"))], lines)
    assert not any(a.type == "solution" for a in out.actions)


def test_spoken_request_in_help_mode():
    req = _req("help", "can you take care of this one for me?")
    _, r, out = _run([_submit(_sol(GOOD), solution_requested=True)], [PROBLEM], req)
    assert [a.type for a in out.actions] == ["solution"] and r.solution_requested
    # the flag alone is not trusted on an automatic check, and without the flag these words are not a request
    _, _, out = _run([_submit(_sol(GOOD), solution_requested=True)], [PROBLEM])
    assert out.actions == []
    _, _, out = _run([_submit(_sol(GOOD))], [PROBLEM], req)
    assert not any(a.type == "solution" for a in out.actions)
    # plain request words are recognised even if the model forgot the flag
    _, _, out = _run([_submit(_sol(GOOD))], [PROBLEM], _req("help", "Solve this for me"))
    assert [a.type for a in out.actions] == ["solution"]


def test_uncheckable_steps_only_for_a_spoken_request():
    word = L("L1", "A train leaves at 3 pm going 60 mph. When does it arrive 90 miles away?", (150, 80, 230, 900), "start")
    steps = [S("t = \\frac{90}{60}", "time = distance / speed = 90/60"), S("t = 1.5 \\text{ h}", "1.5 hours, so 4:30 pm")]
    _, r, out = _run([_submit(_sol(steps), solution_requested=True)], [word], _req("help", "show me the steps"))
    assert [a.type for a in out.actions] == ["solution"] and len(out.actions[0].steps) == 2
    assert any("unchecked steps allowed (spoken request in help mode)" in c and "S1=unknown" in c for c in r.tool_calls)
    client, r, out = _run([_submit(_sol(steps))], [word, SOLVE])   # written request, automatic check
    assert len(client.calls) == 2                                   # sent back once to write checkable steps
    assert not any(a.type == "solution" for a in out.actions)
    assert any("dropped" in c and "no step could be checked" in c for c in r.tool_calls)


def test_unknown_steps_are_kept_and_recorded():
    steps = [GOOD[0], S("x^2 = 1 \\text{ (divide)}", "x^2 = 1 after dividing by three"), GOOD[2]]
    _, r, out = _run([_submit(_sol(steps))], [PROBLEM, SOLVE])
    assert len(out.actions[0].steps) == 3
    assert "solution(L1 from L1): S1=correct, S2=unknown, S3=correct" in r.tool_calls   # S3 checked against S1


def test_derivative_then_rewrite_chain():
    f = L("L1", "f(x) = x^2*(x + 1)", (150, 80, 230, 420), "start")
    steps = [S("f(x) = x^3 + x^2", "f(x) = x^3 + x^2", "equals"),
             S("f'(x) = 3x^2 + 2x", "f'(x) = 3*x^2 + 2*x", "derivative"),
             S("f'(x) = x(3x + 2)", "f'(x) = x*(3*x + 2)", "simplify")]
    _, r, out = _run([_submit(_sol(steps))], [f, SOLVE])
    assert len(out.actions[0].steps) == 3 and "solution(L1 from L1): S1=correct, S2=correct, S3=correct" in r.tool_calls
    wrong = [steps[0], S("f'(x) = 3x^2 + x", "f'(x) = 3*x^2 + x", "derivative")]
    _, r, out = _run([_submit(_sol(wrong))], [f, SOLVE])
    assert out.actions[0].steps == ["f(x) = x^3 + x^2"]


def test_steps_are_tidied():
    raw = ["$3x^2 = 3$", "", "  ", {"latex": "\\(x^2 = 1\\)"}, 7] + [f"x = {i}" for i in range(12)]
    [a] = teach_mod._parse_actions([_sol(raw) | {"text": "here you go", "side": "below", "color": "blue"}], [PROBLEM])
    assert a.steps[:2] == ["3x^2 = 3", "x^2 = 1"] and len(a.steps) == 8
    assert (a.text, a.side, a.color, a.box) == (None, None, "black", PROBLEM.box)
    assert teach_mod._parse_actions([_sol([]), _sol(["$ $"]), _sol(GOOD, line_id="L7")], [PROBLEM]) == []
    # steps on anything else are dropped
    [n] = teach_mod._parse_actions([{"type": "note", "line_id": "L1", "text": "hi", "steps": ["x"]}], [PROBLEM])
    assert n.steps is None
    assert solution.to_plain("x = \\pm \\frac{1}{2}") == "x = ± ((1)/(2))"


def test_no_repeat_and_the_word_is_never_marked():
    lines = [PROBLEM, SOLVE]
    sol = Action(type="solution", line_id="L1", box=PROBLEM.box, color="black", steps=["x = 1"])
    res = TeachResult(actions=[sol, Action(type="circle", line_id="L2", color="red"),
                               Action(type="note", line_id="L2", color="red", text="?")])
    first = merge(PageState(page_id="t"), lines, res, "auto", None, {}, {})
    assert [(a.type, a.line_id) for a in first.actions] == [("solution", "L1")]
    memory.remember("t", "auto", lines, first.actions, [])
    assert memory.solved("t") == {"L1": PROBLEM.plain}
    again = merge(first.state, lines, res, "auto", None, memory.marked("t"), memory.solved("t"))
    assert again.actions == []
    # a line flagged for something else (a hint) still gets the solution once it is asked for
    hinted = PageState(page_id="t", lines=lines, flagged_line_ids=["L1"])
    assert [a.type for a in merge(hinted, lines, res, "auto", None, {}, {}).actions] == ["solution"]
    assert merge(hinted, lines, res, "auto", None, None, None).actions == []   # nothing known: no repeat


def test_circuit_solution_needs_solve_circuit():
    net = {"circuit": [{"id": "V1", "kind": "vsource", "a": "n1", "b": "0", "value": "9"},
                       {"id": "R1", "kind": "resistor", "a": "n1", "b": "0", "value": "3k"}]}
    lines = [L("L1", json.dumps(net), (100, 80, 400, 500), "other"), L("L2", "solve", (420, 80, 480, 200), "other")]
    steps = [S("I = 3\\,\\text{mA}", "I = 3 mA"), S("P = 27\\,\\text{mW}", "P = 27 mW")]
    call = ("solve_circuit", {"circuit_line_id": "L1", "elements": net["circuit"]})
    _, r, out = _run([_resp(call), _submit(_sol(steps))], lines)
    assert [a.type for a in out.actions] == ["solution"] and len(out.actions[0].steps) == 2
    assert any("circuit, 2 steps from solve_circuit" in c for c in r.tool_calls)
    client, r, out = _run([_submit(_sol(steps))], lines)       # never called the solver: sent back, then dropped
    assert len(client.calls) == 2 and not any(a.type == "solution" for a in out.actions)


def test_schema_and_contract_example():
    assert "solution" in teach_mod._ACTION["properties"]["type"]["enum"]
    assert teach_mod._ACTION["properties"]["steps"]["maxItems"] == 8
    assert "solution_requested" in teach_mod.SUBMIT_DECL.parameters_json_schema["properties"]
    example = pathlib.Path(__file__).resolve().parents[2] / "contract" / "examples" / "solution.json"
    resp = CheckResponse.model_validate(json.loads(example.read_text()))
    [a] = resp.actions
    assert a.type == "solution" and a.steps == ["3x^2 = 3", "x^2 = 1", "x = \\pm 1"] and a.color == "black"
    # the example's own steps pass the checker from its problem line, with the fallback LaTeX reading
    checks = solution.check_chain(resp.lines[0].plain, solution.norm_steps(a.steps))
    assert [c["verdict"] for c in checks] == ["correct", "correct", "correct"]
    assert solution.requested_problems(resp.lines) == {"P1"}


def test_printed_integral_problem_is_solved_and_checked():
    """'1. Evaluate int(4*x^3 + 2*x) dx' on a worksheet: the integral is the math, and a tidied-up second
    step labelled "integral" is the same answer, not an integral of the step before."""
    import compute
    import solution
    assert solution.math_part("1. Evaluate int(4*x^3 + 2*x) dx") == "int(4*x^3 + 2*x) dx"
    assert solution.math_part("Evaluate int(cos(x)) dx") == "int(cos(x)) dx"
    assert solution.math_part("int(cos(x)) dx") == "int(cos(x)) dx"
    assert solution.math_part("3. Sketch the graph of y = x^2 - 4 and mark its roots.") == ""
    assert compute.operation("int(cos(x)) dx") == {"kind": "integral", "expr": "cos(x)", "var": "x", "limits": None}
    assert compute.operation("int(a) + int(b) dx") is None
    base = "int(4*x^3 + 2*x) dx"
    steps = [{"plain": "4*x^4/4 + 2*x^2/2 + C", "relation": "integral"}, {"plain": "x^4 + x^2 + C", "relation": "integral"}]
    assert [c["verdict"] for c in solution.check_chain(base, steps)] == ["correct", "correct"]
    assert [c["verdict"] for c in solution.check_chain("int(cos(x)) dx", [{"plain": "sin(x) + C", "relation": "integral"}])] == ["correct"]
    wrong = [{"plain": "4*x^4/4 + 2*x^2/2 + C", "relation": "integral"}, {"plain": "x^4 + 2*x^2 + C", "relation": "integral"}]
    assert [c["verdict"] for c in solution.check_chain(base, wrong)] == ["correct", "incorrect"]
    assert solution.check_chain("int(cos(x)) dx", [{"plain": "-sin(x) + C", "relation": "integral"}])[0]["verdict"] == "incorrect"
