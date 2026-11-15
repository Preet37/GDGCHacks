"""POST /api/circuit/solve: the what-if card's free re-solve (no Gemini)."""
import json
import pathlib

import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)
EXAMPLES = pathlib.Path(__file__).resolve().parents[2] / "contract" / "examples"


def _elements():
    fig = next(a for a in json.loads((EXAMPLES / "circuit_figure.json").read_text())["actions"] if a["type"] == "figure")
    return fig["figure"]["circuit"]["elements"]  # boxes included, as the page sends them


def test_divider_from_the_example_with_boxes():
    r = client.post("/api/circuit/solve", json={"elements": _elements()})
    assert r.status_code == 200
    out = r.json()
    assert out["ok"] and out["currents"]["R1"] == pytest.approx(0.003) and out["node_voltages"]["n2"] == pytest.approx(6.0)


def test_changed_value_re_solves():
    els = _elements()
    next(e for e in els if e["id"] == "R2")["value"] = "4k"  # demo E-3
    out = client.post("/api/circuit/solve", json={"elements": els}).json()
    assert out["currents"]["R2"] == pytest.approx(0.0018) and out["node_voltages"]["n2"] == pytest.approx(7.2)


@pytest.mark.parametrize("body,why", [
    ({"elements": [{"id": "V1", "kind": "vsource", "a": "n1", "b": "0", "value": "9"},
                   {"id": "V2", "kind": "vsource", "a": "n1", "b": "0", "value": "5"}]}, "single solution"),  # contradictory
    ({"elements": [{"id": "R1", "kind": "resistor", "a": "n1", "b": "0", "value": "lots"}]}, "value"),
    ({"elements": []}, "empty"),
    ({"elements": "R1"}, "elements"),
    ({}, "elements"),
    ({"elements": [1, 2]}, "object"),
])
def test_broken_input_is_explained_with_200(body, why):
    r = client.post("/api/circuit/solve", json=body)
    assert r.status_code == 200
    assert r.json()["ok"] is False and why in r.json()["detail"]


def test_not_json_is_explained_too():
    r = client.post("/api/circuit/solve", content=b"not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 200 and r.json()["ok"] is False
