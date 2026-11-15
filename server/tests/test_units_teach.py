"""check_units as a teach tool: its verdict reaches the guard like verify_step's."""
import teach as teach_mod
from guard import merge
from models import CheckRequest, PageState, ReadLine
from tests.test_teach import FakeClient, _resp


def _line(plain):
    return ReadLine(line_id="L1", problem_id="P1", latex=plain, plain=plain, box=[100, 80, 180, 700],
                    relation="start", confidence="high", source="handwriting")


MARKS = [{"type": "circle", "line_id": "L1", "color": "red", "box": [100, 400, 180, 520]},
         {"type": "note", "line_id": "L1", "color": "red", "box": [100, 80, 180, 700], "text": "What are the units of acceleration?"}]


def _run(plain):
    client = FakeClient([
        _resp(("check_units", {"line_id": "L1", "expression": plain})),
        _resp(("submit_feedback", {"actions": MARKS, "clear_line_ids": [], "hint_updates": []})),
    ])
    lines = [_line(plain)]
    result = teach_mod.teach(client, "m", lines, CheckRequest(image_base64="", mode="auto", state=PageState(page_id="t")))
    return result, merge(PageState(page_id="t"), lines, result)


def test_wrong_units_keep_the_red_mark():
    result, resp = _run("F = 2*kg * 9.8*m/s = 19.6*N")
    assert result.verdicts["L1"] == "incorrect" and "check_units(L1) = incorrect" in result.tool_calls
    assert {a.type for a in resp.actions if a.color == "red"} == {"circle", "note"}


def test_right_units_lose_a_red_circle():
    result, resp = _run("F = 2*kg * 9.8*m/s^2 = 19.6*N")
    assert result.verdicts["L1"] == "correct"
    assert not any(a.type == "circle" and a.color == "red" for a in resp.actions)


def test_tool_is_offered():
    assert "check_units" in [d.name for d in teach_mod._build_config().tools[0].function_declarations]
