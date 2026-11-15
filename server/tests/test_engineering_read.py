"""Reading a drawn circuit: element boxes and node positions survive parsing, junk degrades quietly."""
import json

from engineering import circuit_lines, parse_circuit
from models import ReadLine


def test_parses_elements_boxes_and_nodes():
    plain = json.dumps({"circuit": [
        {"id": "V1", "kind": "vsource", "a": "n1", "b": "0", "value": "9", "box": [347, 78, 452, 189]},
        {"id": "R1", "kind": "resistor", "a": "n1", "b": "n2", "value": "1k", "box": [153, 328, 234, 467]},
    ], "nodes": [{"id": "n1", "at": [194, 222]}, {"id": "0", "at": [645, 400]}]})
    elements, nodes = parse_circuit(plain)
    assert [e["id"] for e in elements] == ["V1", "R1"] and elements[1]["box"] == [153, 328, 234, 467]
    assert nodes == [{"id": "n1", "at": [194, 222]}, {"id": "0", "at": [645, 400]}]


def test_old_style_line_without_positions_still_works():
    elements, nodes = parse_circuit(json.dumps({"circuit": [{"id": "R1", "kind": "resistor", "a": "a", "b": "0", "value": "1k"}]}))
    assert elements == [{"id": "R1", "kind": "resistor", "a": "a", "b": "0", "value": "1k"}] and nodes == []


def test_bad_positions_are_dropped_not_raised():
    plain = json.dumps({"circuit": [
        {"id": "R1", "kind": "resistor", "a": "a", "b": "0", "value": "1k", "box": [10, 20]},       # too short
        {"id": "R2", "kind": "resistor", "a": "a", "b": "0", "value": "2k", "box": [500, 600, 400, 700]},  # corners swapped: fixed
        {"id": "R3", "kind": "resistor", "a": "a", "b": "0", "value": "3k", "box": [5, 5, 5, 5]},   # empty
        {"id": "R4", "kind": "resistor", "a": "a", "b": "0", "value": "4k", "box": [0, 0, 2000, 50]},  # clamped
        "junk",
    ], "nodes": [{"id": "a", "at": ["x", 3]}, {"at": [1, 2]}, {"id": "0", "at": [999, 1]}]})
    elements, nodes = parse_circuit(plain)
    boxes = {e["id"]: e.get("box") for e in elements}
    assert boxes == {"R1": None, "R2": [400, 600, 500, 700], "R3": None, "R4": [0, 0, 1000, 50]}
    assert nodes == [{"id": "0", "at": [999, 1]}]


def test_not_a_circuit():
    assert parse_circuit("f(x) = 3*x^2") is None and parse_circuit('{"fbd": {}}') is None


def test_finds_circuit_lines():
    L = lambda i, p: ReadLine(line_id=i, problem_id="P1", latex=p, plain=p, box=[0, 0, 1, 1], relation="other", confidence="high")
    lines = [L("L1", json.dumps({"circuit": [], "nodes": []})), L("L2", "I = 3*mA")]
    assert [l.line_id for l in circuit_lines(lines)] == ["L1"]


# A real read of tests/data/circuit_series.png (9 V source, R1 = 1k on top, R2 = 2k on the right), stored so this
# runs offline. Symbol centres [y, x] (0-1000) measured from the drawing itself.
import pathlib  # noqa: E402

DATA = pathlib.Path(__file__).resolve().parent / "data"
SYMBOLS = {"V1": (397, 133), "R1": (194, 397), "R2": (398, 667)}
WIRES = {"n1": [(194, 133, 194, 333)], "n2": [(194, 460, 194, 667)], "0": [(645, 133, 645, 667)]}  # (y0, x0, y1, x1)


def test_stored_read_puts_each_box_on_its_symbol():
    lines = json.loads((DATA / "circuit_series_read.json").read_text())
    circuit = next(l for l in lines if l["plain"].startswith("{"))
    elements, nodes = parse_circuit(circuit["plain"])
    assert {e["id"] for e in elements} == set(SYMBOLS)
    for e in elements:
        y0, x0, y1, x1 = e["box"]
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        ty, tx = SYMBOLS[e["id"]]
        assert abs(cy - ty) <= 50 and abs(cx - tx) <= 50, (e["id"], e["box"])  # within 5% of the image


def test_stored_read_puts_each_node_on_its_wire():
    lines = json.loads((DATA / "circuit_series_read.json").read_text())
    _, nodes = parse_circuit(next(l for l in lines if l["plain"].startswith("{"))["plain"])
    assert {n["id"] for n in nodes} == set(WIRES)
    for n in nodes:
        y, x = n["at"]
        assert any(abs(y - wy0) <= 40 and wx0 - 20 <= x <= wx1 + 20 for wy0, wx0, _, wx1 in WIRES[n["id"]]), n
