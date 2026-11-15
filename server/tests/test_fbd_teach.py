"""check_forces through teach + guard: the clean diagram (missing force dashed) at hint 2+, green + diagram when it balances."""
import json
import pathlib

import teach as teach_mod
from guard import merge
from internal import HintUpdate
from models import Action, CheckRequest, PageState, ProblemState, ReadLine
from tests.test_teach import FakeClient, _resp

EX = json.loads((pathlib.Path(__file__).resolve().parents[2] / "contract" / "examples" / "fbd.json").read_text())
FBD = ReadLine.model_validate(EX["lines"][0])        # block on a 30 degree ramp: mg and N drawn, no friction
AT_REST = ReadLine.model_validate(EX["lines"][1])
EXPECTED = [{"label": "mg", "angle_deg": 270, "magnitude": "m*g"}, {"label": "N", "angle_deg": 120},
            {"label": "f", "angle_deg": 30}]
CALL = ("check_forces", {"fbd_line_id": "L1", "givens": [{"name": "m", "value": "2 kg"}, {"name": "g", "value": "9.8"}],
                         "expected": EXPECTED})


def _run(lines, note, mode="help", level=0, new_level=None):
    hint = [{"problem_id": "P1", "hint_level": new_level}] if new_level is not None else []
    client = FakeClient([_resp(CALL), _resp(("submit_feedback", {"actions": [note] if note else [], "clear_line_ids": [],
                                                                  "hint_updates": hint}))])
    state = PageState(page_id="t", problems=[ProblemState(problem_id="P1", hint_level=level)])
    result = teach_mod.teach(client, "m", lines, CheckRequest(image_base64="", mode=mode, state=state))
    return result, merge(state, lines, result, mode)


def fbd_figs(resp):
    return [a for a in resp.actions if a.type == "figure" and a.figure.kind == "fbd"]


def hint(text):
    return {"type": "note", "line_id": "L1", "color": "blue", "box": FBD.box, "side": "right", "text": text}


def test_hint_1_is_words_only_no_diagram():
    result, resp = _run([FBD, AT_REST], hint("What keeps the block from sliding down the ramp?"), level=0, new_level=1)
    assert result.verdicts["L1"] == "incorrect" and "check_forces(L1) = incorrect" in result.tool_calls
    assert fbd_figs(resp) == []


def test_hint_2_draws_the_clean_diagram_with_friction_expected():
    _, resp = _run([FBD, AT_REST], hint("Here's your diagram with the missing force dashed. Which way must it point?"),
                   level=1, new_level=2)
    (fig,) = fbd_figs(resp)
    f = fig.figure.fbd
    assert {x.label for x in f.forces} == {"mg", "N"}                 # what the student drew, from the read line
    assert {x.label for x in f.expected} == {"mg", "N", "f"}          # friction is the one to draw dashed
    assert f.surfaces[0].angle_deg == 30


def test_the_expected_magnitudes_are_there_for_hint_3():
    result, _ = _run([FBD, AT_REST], hint("Friction: f = mg sin 30 = 9.8 N"), level=2, new_level=3)
    assert abs(result.fbd["L1"]["check"]["expected"]["solved"]["f"] - 9.8) < 0.01


def test_a_balanced_diagram_gets_green_and_the_clean_diagram_even_in_auto():
    plain = json.loads(FBD.plain)
    plain["fbd"]["forces"].append({"id": "F3", "label": "f", "angle_deg": 30, "on": "B"})
    full = FBD.model_copy(update={"plain": json.dumps(plain)})
    result, resp = _run([full, AT_REST], None, mode="auto")
    assert result.verdicts["L1"] == "correct"
    assert any(a.type == "note" and a.color == "green" for a in resp.actions)
    (fig,) = fbd_figs(resp)
    assert fig.figure.fbd.expected is None  # nothing missing, nothing dashed


def test_the_model_cannot_write_the_diagram_itself():
    fake = Action(type="figure", line_id="L1", box=FBD.box, figure={"kind": "fbd", "expressions": [], "x_range": (0, 1),
                  "fbd": {"bodies": [{"id": "Z", "shape": "point"}], "forces": []}})
    state = PageState(page_id="t", problems=[ProblemState(problem_id="P1", hint_level=0)])
    from internal import TeachResult
    resp = merge(state, [FBD, AT_REST], TeachResult(actions=[fake]), "auto")
    assert fbd_figs(resp) == []  # not at hint 2+ and not balanced: no diagram at all, and never the model's


def test_tool_is_offered():
    assert "check_forces" in [d.name for d in teach_mod._build_config().tools[0].function_declarations]


def test_no_circle_around_a_whole_force_diagram_but_the_question_stays():
    note = {"type": "note", "line_id": "L1", "color": "red", "box": FBD.box, "side": "right",
            "text": "What keeps the block from sliding down the ramp?"}
    result, resp = _run([FBD, AT_REST], note, mode="auto")
    assert result.verdicts["L1"] == "incorrect"
    assert not any(a.type == "circle" for a in resp.actions)
    assert any(a.type == "note" and a.color == "red" for a in resp.actions)
