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
    out = merge(state(), [line("L1"), line("L2")], res, "help")
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
    res = TeachResult(actions=[Action(type="note", line_id="L3", color="red", text="x")], clear_line_ids=["L2"])
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


def test_help_mode_allows_a_blue_hint_on_a_printed_problem():
    printed = line("L1").model_copy(update={"source": "printed"})
    acts = [Action(type="note", line_id="L1", color="blue", side="below", text="Which rule fits a product?"),
            Action(type="speak", line_id="L1", text="which rule fits a product"),
            Action(type="note", line_id="L1", color="red", text="wrong"),
            Action(type="note", line_id="L1", color="black", side="inline", text="$3$"),
            Action(type="circle", line_id="L1", color="red"),
            Action(type="circle", line_id="L1", color="blue"),
            Action(type="underline", line_id="L1", color="green")]
    res = TeachResult(actions=acts, hint_updates=[HintUpdate(problem_id="P1", hint_level=1)])
    out = merge(state(), [printed], res, "help")
    assert [(a.type, a.color) for a in out.actions] == [("note", "blue"), ("speak", None)]
    assert out.state.flagged_line_ids == ["L1"]
    assert out.state.problems[0].hint_level == 1
    # the same actions on an automatic check: nothing is written on printed text
    auto = merge(state(), [printed], res)
    assert [a.type for a in auto.actions] == ["speak"]


def open_line(i="L2"):
    return line(i).model_copy(update={"plain": "g'(x) =", "relation": "derivative"})


def test_open_line_never_gets_a_red_mark():
    res = TeachResult(actions=[Action(type="circle", line_id="L2", color="red"),
                               Action(type="underline", line_id="L2", color="red"),
                               Action(type="note", line_id="L2", color="red", text="unfinished?"),
                               Action(type="note", line_id="L2", color="black", side="inline", text="$12x$")],
                      verdicts={"L2": "incorrect"})
    out = merge(state(), [line("L1"), open_line()], res)
    assert [(a.type, a.side) for a in out.actions] == [("note", "inline")]
    assert out.state.flagged_line_ids == ["L2"]


def test_inline_answer_is_not_sent_again_while_the_line_is_unchanged():
    inline = Action(type="note", line_id="L2", color="black", side="inline", text="$12x$")
    lines = [line("L1"), open_line()]
    st = state(lines=lines, flagged_line_ids=["L2"])
    out = merge(st, lines, TeachResult(actions=[inline]))
    assert out.actions == [] and out.clear_line_ids == []
    assert out.state.flagged_line_ids == ["L2"]            # the answer stays on the page
    # the student changed the line: a new inline answer goes through
    changed = [line("L1"), open_line().model_copy(update={"plain": "g''(x) ="})]
    assert len(merge(st, changed, TeachResult(actions=[inline])).actions) == 1
    # asked for in help mode: goes through too
    assert len(merge(st, lines, TeachResult(actions=[inline]), "help").actions) == 1


def test_auto_check_does_not_repeat_feedback_on_an_unchanged_flagged_line():
    from internal import TeachResult
    from models import Action, PageState, ReadLine
    from guard import merge
    line = ReadLine(line_id="L2", problem_id="P1", latex="g'(x) =", plain="g'(x) =", box=(1, 2, 3, 4),
                    relation="derivative", confidence="high")
    state = PageState(page_id="t", lines=[line], flagged_line_ids=["L2"])
    again = TeachResult(actions=[Action(type="note", line_id="L2", color="black", side="right", text="$12x$", box=line.box)])
    assert merge(state, [line], again, "auto").actions == []
    assert merge(state, [line], again, "auto").state.flagged_line_ids == ["L2"]   # still flagged, not cleared
    assert len(merge(state, [line], again, "help").actions) == 1                   # Help may add a hint
    changed = line.model_copy(update={"plain": "g'(x) = 6*x"})
    assert merge(state, [changed], again, "auto").actions == []                    # no longer open: no answer is written on it
    red = TeachResult(actions=[Action(type="note", line_id="L2", color="red", text="Check the power.", box=line.box)])
    assert merge(state, [line], red, "auto").actions == []
    assert len(merge(state, [changed], red, "auto").actions) == 1                  # the line changed: new feedback is fine


def test_answer_is_only_written_on_an_open_line_or_when_asked_out_loud():
    done = line("L1").model_copy(update={"plain": "int(2*x, x)"})
    answers = TeachResult(actions=[Action(type="note", line_id="L1", color="black", side="inline", text="$x^2 + C$"),
                                   Action(type="note", line_id="L1", color="black", side="right", text="$x^2 + C$"),
                                   Action(type="note", line_id="L1", color="blue", side="inline", text="$x^2 + C$")])
    assert merge(state(), [done], answers).actions == []
    assert merge(state(), [done], answers, "help").actions == []                 # Help tapped, nothing asked
    assert merge(state(), [done], answers, "help", "  ").actions == []
    assert len(merge(state(), [done], answers, "help", "can you finish this?").actions) == 3
    spaced = done.model_copy(update={"plain": "int(2*x, x) =  "})
    assert len(merge(state(), [spaced], answers).actions) == 3


def test_auto_mode_drops_notes_nobody_asked_for():
    lines = [line("L1"), line("L2"), line("L3"), line("L4"), open_line("L5")]
    res = TeachResult(
        actions=[Action(type="note", line_id="L1", color="blue", text="What is the first step to isolate $x$?"),
                 Action(type="note", line_id="L1", color="green", text="Nice start!"),
                 Action(type="circle", line_id="L2", color="red"),
                 Action(type="note", line_id="L2", color="red", text="What is $3 \\cdot 2$?"),
                 Action(type="note", line_id="L2", text="Look at the sign."),          # colour forgotten on a marked line
                 Action(type="figure", line_id="L3"),
                 Action(type="note", line_id="L3", color="blue", text="Here is the graph."),
                 Action(type="ask", line_id="L4", color="blue", text="Did you mean $x^2$?", options=["x^2", "x_2"]),
                 Action(type="note", line_id="L5", color="black", side="inline", text="$12x$"),
                 Action(type="note", line_id="L5", color="blue", text="Which rule fits here?")],  # compute came back empty
        verdicts={"L2": "incorrect"})
    out = merge(state(), lines, res)
    assert [(a.type, a.line_id, a.color) for a in out.actions] == [
        ("circle", "L2", "red"), ("note", "L2", "red"), ("note", "L2", None), ("figure", "L3", None),
        ("note", "L3", "blue"), ("ask", "L4", "blue"), ("note", "L5", "black"), ("note", "L5", "blue")]
    assert "L1" not in out.state.flagged_line_ids
    # Help was tapped: hints and green confirmations go through
    assert len(merge(state(), lines, res, "help").actions) == len(res.actions)
