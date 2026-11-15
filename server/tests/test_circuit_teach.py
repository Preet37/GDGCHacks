"""solve_circuit as a teach-step tool: claims become verdicts, and the guard uses them like verify_step's."""
import json
import os
import pathlib

import pytest
from dotenv import load_dotenv

import teach as teach_mod
from guard import merge
from models import CheckRequest, PageState, ReadLine
from tests.test_teach import FakeClient, _resp

NETLIST = [
    {"id": "V1", "kind": "vsource", "a": "n1", "b": "0", "value": "9"},
    {"id": "R1", "kind": "resistor", "a": "n1", "b": "n2", "value": "1k"},
    {"id": "R2", "kind": "resistor", "a": "n2", "b": "0", "value": "2k"},
]


def _lines(answer_plain="I = 9mA"):
    return [
        ReadLine(line_id="L1", problem_id="P1", latex=r"\text{circuit: } V_1 = 9V, R_1 = 1k\Omega, R_2 = 2k\Omega",
                 plain=json.dumps({"circuit": NETLIST}), box=[100, 100, 400, 600], relation="other", confidence="high",
                 source="handwriting"),
        ReadLine(line_id="L2", problem_id="P1", latex="I = " + answer_plain.split("= ")[1], plain=answer_plain,
                 box=[450, 100, 520, 400], relation="other", confidence="high", source="handwriting"),
    ]


def _req(mode="auto"):
    return CheckRequest(image_base64="", mode=mode, state=PageState(page_id="t"))


MARKS = [{"type": "circle", "line_id": "L2", "color": "red", "box": [450, 100, 520, 400]},
         {"type": "note", "line_id": "L2", "color": "red", "box": [450, 100, 520, 400], "text": "Which resistors does $I$ go through?"}]


def _run(claim_value):
    claim = {"line_id": "L2", "quantity": "current", "element": "R1", "value": claim_value}
    client = FakeClient([
        _resp(("solve_circuit", {"circuit_line_id": "L1", "claims": [claim]})),  # no elements: taken from L1's plain
        _resp(("submit_feedback", {"actions": MARKS, "clear_line_ids": [], "hint_updates": []})),
    ])
    lines = _lines(f"I = {claim_value}")
    result = teach_mod.teach(client, "m", lines, _req())
    return result, merge(PageState(page_id="t"), lines, result)


def test_wrong_answer_verdict_keeps_the_red_marks():
    result, resp = _run("9mA")  # used 1k only; real current is 3 mA
    assert result.verdicts["L2"] == "incorrect"
    assert any("solve_circuit(L1) = ok; L2=incorrect" in c for c in result.tool_calls)
    assert {a.type for a in resp.actions if a.color == "red"} == {"circle", "note"}


def test_right_answer_guard_drops_a_wrong_red_circle():
    result, resp = _run("3mA")
    assert result.verdicts["L2"] == "correct"
    assert not any(a.type == "circle" and a.color == "red" for a in resp.actions)


def test_unsolvable_circuit_reports_and_sets_no_verdict():
    contradictory = [NETLIST[0], {"id": "V2", "kind": "vsource", "a": "n1", "b": "0", "value": "5"}]
    out = teach_mod._run_circuit({"circuit_line_id": "L1", "elements": contradictory,
                                  "claims": [{"line_id": "L2", "quantity": "current", "element": "R1", "value": 1}]},
                                 _lines(), teach_mod.TeachResult())
    assert out["ok"] is False


def test_tool_is_offered_to_gemini():
    names = [d.name for d in teach_mod._build_config().tools[0].function_declarations]
    assert "solve_circuit" in names


load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")
live = pytest.mark.skipif(not (os.environ.get("GEMINI_API_KEY") and os.environ.get("GEMINI_MODEL")),
                          reason="needs GEMINI_API_KEY and GEMINI_MODEL")


def _live_client():
    from google import genai
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"]), os.environ["GEMINI_MODEL"]


@live
def test_live_wrong_circuit_answer_gets_marked():
    client, model = _live_client()
    lines = _lines("I = 9mA")
    r = teach_mod.teach(client, model, lines, _req())
    print(r.tool_calls, r.actions)
    assert any(c.startswith("solve_circuit") for c in r.tool_calls)
    resp = merge(PageState(page_id="t"), lines, r)
    assert any(a.line_id == "L2" and a.color == "red" for a in resp.actions)


@live
def test_live_right_circuit_answer_is_left_alone():
    client, model = _live_client()
    lines = _lines("I = 3mA")
    r = teach_mod.teach(client, model, lines, _req())
    print(r.tool_calls, r.actions)
    resp = merge(PageState(page_id="t"), lines, r)
    assert not any(a.color == "red" for a in resp.actions)
