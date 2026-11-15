"""Part 2 contract: the engineering figure kinds load, and the examples' numbers are what the solver says."""
import json
import pathlib

import circuits
from models import CheckResponse, FigureSpec

EXAMPLES = pathlib.Path(__file__).resolve().parents[2] / "contract" / "examples"


def _figures(name):
    resp = CheckResponse.model_validate(json.loads((EXAMPLES / name).read_text()))
    return resp, [a.figure for a in resp.actions if a.type == "figure"]


def test_circuit_example_matches_the_solver():
    resp, (fig,) = _figures("circuit_figure.json")
    assert fig.kind == "circuit" and fig.circuit.reveal is True
    els = [e.model_dump(exclude={"box"}) for e in fig.circuit.elements]
    sol = circuits.solve_circuit(els)
    assert fig.circuit.solution.currents == sol["currents"]
    assert fig.circuit.solution.node_voltages == sol["node_voltages"]
    assert all(e.box for e in fig.circuit.elements) and {n.id for n in fig.circuit.nodes} == {"n1", "n2", "0"}


def test_hidden_circuit_goes_with_a_red_mark():
    resp, (fig,) = _figures("circuit_hidden.json")
    assert fig.circuit.reveal is False
    assert any(a.type == "circle" and a.color == "red" for a in resp.actions)


def test_fbd_example_has_the_missing_force_expected():
    resp, (fig,) = _figures("fbd.json")
    drawn = {f.label for f in fig.fbd.forces}
    expected = {f.label for f in fig.fbd.expected}
    assert expected - drawn == {"f"} and fig.fbd.surfaces[0].angle_deg == 30


def test_old_figure_kinds_still_load_without_engineering_fields():
    f = FigureSpec.model_validate({"kind": "plot2d", "expressions": ["x^2"], "x_range": [-2, 2]})
    assert f.circuit is None and f.fbd is None
