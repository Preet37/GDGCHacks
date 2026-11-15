"""3D engineering models: what the model sends is cleaned in code, so the page only gets scenes it can draw."""
import json
import pathlib

from engineering import MAX_PARTS, build_model3d
from models import Action, FigureSpec
from teach import _parse_actions

BRIDGE = json.loads((pathlib.Path(__file__).resolve().parents[2] / "contract/examples/model3d_bridge.json").read_text())


def test_example_reply_is_a_valid_contract_reply():
    for a in BRIDGE["actions"]:
        Action.model_validate(a)
    fig = next(a for a in BRIDGE["actions"] if a["type"] == "figure")["figure"]
    assert build_model3d(fig["model3d"]) is not None


def test_cleans_shapes_loads_and_ids():
    out = build_model3d({"parts": [
        {"id": "Deck", "name": "Deck", "shape": "slab", "at": [0, 0, 5], "size": [100, 10, 1], "load": "bend", "explain": "  carries   cars "},
        {"id": "deck", "name": "Cable", "shape": "cable", "start": [0, 0, 20], "end": [50, 0, 6], "load": "tensile"},
        {"name": "Tower", "shape": "pillar", "at": [0, 0, 10], "size": [2, 2, 20], "load": "compressive"},
        {"name": "Ball", "shape": "sphere", "at": [1, 2], "size": 3},
    ]})
    p = {x["name"]: x for x in out["parts"]}
    assert p["Deck"]["shape"] == "box" and p["Deck"]["load"] == "bending" and p["Deck"]["explain"] == "carries cars"
    assert p["Cable"]["shape"] == "member" and p["Cable"]["load"] == "tension" and p["Cable"]["id"] == "deck_2"
    assert p["Tower"]["shape"] == "cylinder" and p["Tower"]["load"] == "compression" and p["Tower"]["size"] == (2, 2, 20)
    assert p["Ball"]["at"] == (1, 2, 0) and p["Ball"]["size"] == (3, 3, 3) and p["Ball"]["load"] == "none"
    FigureSpec.model_validate({"kind": "model3d", "expressions": [], "x_range": [0, 1], "model3d": out})


def test_drops_what_cannot_be_drawn():
    out = build_model3d({"parts": [
        {"name": "zero member", "shape": "member", "start": [1, 1, 1], "end": [1, 1, 1]},
        {"name": "no centre", "shape": "box", "size": [1, 1, 1]},
        {"name": "flat box", "shape": "box", "at": [0, 0, 0], "size": [1, 0, 1]},
        {"name": "huge", "shape": "box", "at": [1e9, 0, 0], "size": [1, 1, 1]},
        {"name": "nan", "shape": "sphere", "at": [float("nan"), 0, 0], "size": [1, 1, 1]},
        {"name": "teapot", "shape": "teapot", "at": [0, 0, 0], "size": [1, 1, 1]},
        {"name": "ok", "shape": "box", "at": [0, 0, 0], "size": [1, 1, 1]},
    ], "loads": [{"at": [0, 0, 0], "dir": [0, 0, 0], "label": "none"}, {"at": [0, 0, 1], "dir": [0, 0, -1], "label": "Weight"}]})
    assert [p["name"] for p in out["parts"]] == ["ok"]
    assert out["loads"] == [{"at": (0, 0, 1), "dir": (0, 0, -1), "label": "Weight"}]


def test_nothing_drawable_is_none_and_part_count_is_capped():
    assert build_model3d(None) is None and build_model3d({"parts": []}) is None
    many = build_model3d({"parts": [{"name": f"p{i}", "shape": "sphere", "at": [i, 0, 0], "size": [1, 1, 1]} for i in range(90)]})
    assert len(many["parts"]) == MAX_PARTS


def test_tutor_figure_action_is_cleaned_or_dropped():
    good = {"type": "figure", "line_id": "L1", "figure": {"kind": "model3d", "title": "Beam", "model3d": {"parts": [
        {"id": "b", "name": "Beam", "shape": "beam", "start": [0, 0, 0], "end": [4, 0, 0], "load": "bending", "explain": "x"}]}}}
    bad = {"type": "figure", "line_id": "L1", "figure": {"kind": "model3d", "expressions": [], "x_range": [0, 1],
                                                         "model3d": {"parts": [{"name": "?", "shape": "teapot"}]}}}
    acts = _parse_actions([good, bad])
    assert len(acts) == 1 and acts[0].figure.kind == "model3d" and acts[0].figure.model3d.parts[0].shape == "member"
    assert acts[0].figure.expressions == []


def test_model3d_from_the_tutor_comes_as_a_json_string():
    raw = json.dumps({"parts": [{"id": "t", "name": "Tower", "shape": "cylinder", "at": [0, 0, 5], "size": [1, 1, 10],
                                 "load": "compression", "explain": "pushed"}]})
    acts = _parse_actions([{"type": "figure", "line_id": "L1", "figure": {"kind": "model3d", "expressions": [], "x_range": [0, 1], "model3d": raw}},
                           {"type": "figure", "line_id": "L1", "figure": {"kind": "model3d", "expressions": [], "x_range": [0, 1], "model3d": "{not json"}}])
    assert len(acts) == 1 and acts[0].figure.model3d.parts[0].name == "Tower"


def test_schema_keeps_model3d_flat():
    # forced function calling has a limit on schema complexity: a nested model3d schema broke every check (400)
    from teach import _FIGURE
    assert _FIGURE["properties"]["model3d"]["type"] == "string"


def test_realism_fields_are_kept_and_checked():
    out = build_model3d({"parts": [
        {"name": "Front wheel", "shape": "wheel", "at": [0, 1, 0.3], "size": [0.33, 0.33, 0.4], "axis": "y", "material": "tyre"},
        {"name": "Nose", "shape": "cone", "at": [2, 0, 0.3], "size": [0.2, 0.2, 0.8], "axis": "+x", "color": "#FF0000"},
        {"name": "Wing", "shape": "box", "at": [2, 0, 0.1], "size": [0.4, 1.8, 0.05], "rotate": [0, 370, 0], "material": "carbon fiber"},
        {"name": "Cable", "shape": "member", "points": [[0, 0, 10], [5, 0, 6], [5, 0, 6], [10, 0, 10]], "material": "wire"},
        {"name": "Bad", "shape": "box", "at": [0, 0, 0], "size": [1, 1, 1], "axis": "w", "material": "cheese", "color": "red"},
    ]})
    p = {x["name"]: x for x in out["parts"]}
    assert p["Front wheel"]["shape"] == "cylinder" and p["Front wheel"]["axis"] == "y" and p["Front wheel"]["material"] == "rubber"
    assert p["Nose"]["shape"] == "cone" and p["Nose"]["axis"] == "x" and p["Nose"]["color"] == "#ff0000"
    assert p["Wing"]["rotate"] == (0, 10, 0) and p["Wing"]["material"] == "carbon"
    assert p["Cable"]["points"] == [(0, 0, 10), (5, 0, 6), (10, 0, 10)] and p["Cable"]["end"] == (10, 0, 10)
    assert "axis" not in p["Bad"] and "material" not in p["Bad"] and "color" not in p["Bad"]
    FigureSpec.model_validate({"kind": "model3d", "expressions": [], "x_range": [0, 1], "model3d": out})
