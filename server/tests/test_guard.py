from guard import merge
from internal import HintUpdate, TeachResult
from models import Action, PageState, ProblemState, ReadLine


def line(i, p="P1"):
    return ReadLine(line_id=i, problem_id=p, latex="a", plain="a", box=(0, 0, 10, 10),
                    relation="other", confidence="high")


def test_marks_on_printed_lines_dropped():
    printed = line("L1").model_copy(update={"source": "printed"})
    res = TeachResult(
        actions=[Action(type="circle", line_id="L1", color="red"),
                 Action(type="underline", line_id="L1", color="green"),
                 Action(type="note", line_id="L1", text="hi"),
                 Action(type="speak", line_id="L1", text="read the problem again"),
                 Action(type="note", line_id="L2", text="check this")],
        verdicts={"L2": "incorrect"})
    out = merge(state(), [printed, line("L2")], res)
    assert [(a.type, a.line_id) for a in out.actions] == [("speak", "L1"), ("note", "L2")]
    assert out.state.flagged_line_ids == ["L1", "L2"]
    assert out.lines[0].source == "printed"


def state(**kw):
    return PageState(page_id="pg", **kw)


def test_red_circle_on_correct_line_dropped():
    res = TeachResult(
        actions=[Action(type="circle", line_id="L1", color="red"),
                 Action(type="underline", line_id="L1", color="red"),
                 Action(type="note", line_id="L1", text="hi"),
                 Action(type="circle", line_id="L2", color="red")],
        verdicts={"L1": "correct", "L2": "incorrect"})
    out = merge(state(), [line("L1"), line("L2")], res)
    kinds = [(a.type, a.line_id) for a in out.actions]
    assert ("circle", "L1") not in kinds and ("underline", "L1") not in kinds
    assert ("note", "L1") in kinds and ("circle", "L2") in kinds


def test_hint_updates_applied_and_created():
    st = state(problems=[ProblemState(problem_id="P1", hint_level=1)])
    res = TeachResult(hint_updates=[HintUpdate(problem_id="P1", hint_level=2),
                                    HintUpdate(problem_id="P2", hint_level=3)])
    out = merge(st, [line("L1")], res)
    levels = {p.problem_id: p.hint_level for p in out.state.problems}
    assert levels == {"P1": 2, "P2": 3}
    assert st.problems[0].hint_level == 1  # input not mutated


def test_hint_levels_clamped():
    res = TeachResult.model_construct(actions=[], clear_line_ids=[], tool_calls=[], verdicts={}, finished=True,
                                      hint_updates=[HintUpdate.model_construct(problem_id="P1", hint_level=7),
                                                    HintUpdate.model_construct(problem_id="P2", hint_level=-2)])
    out = merge(state(), [], res)
    levels = {p.problem_id: p.hint_level for p in out.state.problems}
    assert levels == {"P1": 3, "P2": 0}


def test_flagged_and_clear_bookkeeping():
    st = state(flagged_line_ids=["L1", "L2", "L9"])
    res = TeachResult(actions=[Action(type="note", line_id="L3", text="x")], clear_line_ids=["L2"])
    lines = [line("L1"), line("L2"), line("L3")]
    out = merge(st, lines, res)
    assert out.state.flagged_line_ids == ["L1", "L3"]
    assert set(out.clear_line_ids) == {"L2", "L9"}
    assert [l.line_id for l in out.state.lines] == ["L1", "L2", "L3"]
    assert out.lines == out.state.lines
    assert out.state.page_id == "pg"


def test_unfinished_returns_no_actions():
    st = state(flagged_line_ids=["L1"], problems=[ProblemState(problem_id="P1", hint_level=1)])
    res = TeachResult(actions=[Action(type="circle", line_id="L2", color="red")],
                      hint_updates=[HintUpdate(problem_id="P1", hint_level=2)],
                      clear_line_ids=["L1"], finished=False)
    out = merge(st, [line("L1"), line("L2")], res)
    assert out.actions == []
    assert out.state.flagged_line_ids == ["L1"]
    assert out.state.problems[0].hint_level == 1
