"""The circuit figure is decided and filled in by code in guard.merge, from the read netlist + solve_circuit."""
import json
import pathlib

import pytest

from guard import merge
from internal import HintUpdate, TeachResult
from models import Action, PageState, ProblemState, ReadLine

DATA = pathlib.Path(__file__).resolve().parent / "data"
CIRCUIT = ReadLine.model_validate(next(l for l in json.loads((DATA / "circuit_series_read.json").read_text())
                                       if l["plain"].startswith("{")))  # a real read: V1 9V, R1 1k, R2 2k


def answer(plain, line_id="L2"):
    return ReadLine(line_id=line_id, problem_id=CIRCUIT.problem_id, latex=plain, plain=plain,
                    box=[760, 150, 820, 300], relation="other", confidence="high", source="handwriting")


def run(lines, verdicts=None, actions=None, prev=None, level=0, hint_updates=None, mode="auto", question=None):
    state = PageState(page_id="t", lines=prev or [], problems=[ProblemState(problem_id=CIRCUIT.problem_id, hint_level=level)])
    result = TeachResult(actions=actions or [], verdicts=verdicts or {}, hint_updates=hint_updates or [])
    return merge(state, lines, result, mode, question)


def figures(resp):
    return [a for a in resp.actions if a.type == "figure" and a.figure.kind == "circuit"]


RED = [Action(type="circle", line_id="L2", box=[760, 150, 820, 300], color="red"),
       Action(type="note", line_id="L2", box=[760, 150, 820, 300], color="red", text="What is the total resistance in the loop?")]


def test_wrong_answer_keeps_the_red_mark_and_hides_the_numbers():
    resp = run([CIRCUIT, answer("I = 9*mA")], verdicts={"L2": "incorrect"}, actions=RED)
    assert {(a.type, a.color) for a in resp.actions if a.color == "red"} == {("circle", "red"), ("note", "red")}
    (fig,) = figures(resp)
    assert fig.figure.circuit.reveal is False and fig.line_id == CIRCUIT.line_id
    assert fig.figure.circuit.solution is None  # not even in the data


def test_right_answer_reveals_the_solved_circuit_on_the_drawing():
    (fig,) = figures(run([CIRCUIT, answer("I = 3*mA")], verdicts={"L2": "correct"}))
    c = fig.figure.circuit
    assert c.reveal is True
    assert c.solution.currents["R1"] == pytest.approx(0.003) and c.solution.node_voltages["n2"] == pytest.approx(6.0)
    assert {e.id: e.box is not None for e in c.elements} == {"V1": True, "R1": True, "R2": True}
    assert {n.id for n in c.nodes} == {"n1", "n2", "0"}


def test_no_answer_and_no_request_means_no_figure():
    assert figures(run([CIRCUIT])) == []


def test_hint_level_3_reveals_even_without_an_answer():
    (fig,) = figures(run([CIRCUIT], level=2, hint_updates=[HintUpdate(problem_id=CIRCUIT.problem_id, hint_level=3)], mode="help"))
    assert fig.figure.circuit.reveal is True


def test_asking_to_simulate_shows_the_card_with_numbers_hidden():
    (fig,) = figures(run([CIRCUIT, answer("simulate", "L3")]))
    assert fig.figure.circuit.reveal is False
    (fig,) = figures(run([CIRCUIT], mode="help", question="what if R2 was bigger?"))
    assert fig.figure.circuit.reveal is False


def test_nothing_changed_means_no_resend():
    lines = [CIRCUIT, answer("I = 3*mA")]
    assert figures(run(lines, verdicts={"L2": "correct"}, prev=lines)) == []


def test_the_models_circuit_contents_are_replaced_by_code():
    fake = Action(type="figure", line_id=CIRCUIT.line_id, box=CIRCUIT.box,
                  figure={"kind": "circuit", "expressions": [], "x_range": (0, 1), "circuit": {
                      "elements": [{"id": "R9", "kind": "resistor", "a": "x", "b": "0", "value": "1"}], "reveal": True}})
    (fig,) = figures(run([CIRCUIT, answer("I = 9*mA")], verdicts={"L2": "incorrect"}, actions=[fake]))
    assert [e.id for e in fig.figure.circuit.elements] == ["V1", "R1", "R2"] and fig.figure.circuit.reveal is False


def test_the_circuit_line_is_not_flagged_by_its_figure():
    resp = run([CIRCUIT, answer("I = 3*mA")], verdicts={"L2": "correct"})
    assert CIRCUIT.line_id not in resp.state.flagged_line_ids


def test_explain_mode_adds_no_circuit_figure():
    assert figures(run([CIRCUIT, answer("I = 3*mA")], verdicts={"L2": "correct"}, mode="explain")) == []


def test_a_solve_request_is_not_an_answer():
    assert figures(run([CIRCUIT, answer("solve", "L3")])) == []
