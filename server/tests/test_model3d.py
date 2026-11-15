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
