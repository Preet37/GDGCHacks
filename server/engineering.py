"""Engineering (Part 2): what a drawn circuit line holds, and the circuit figure built from it in code.

The read step writes a drawn circuit as ONE line whose `plain` is JSON:
    {"circuit": [{"id", "kind", "a", "b", "value", "box"?}, ...], "nodes": [{"id", "at": [y, x]}, ...]}
Positions are 0-1000 over the sent image. Anything malformed is dropped piece by piece (a bad box means no
label for that element), never raised: a misread position must not cost the student their feedback.
"""
import json
from typing import Any

from models import ReadLine


def _box(v: Any) -> list[int] | None:
    """A valid [ymin, xmin, ymax, xmax] in 0-1000 (corners put in order), else None."""
    if not isinstance(v, (list, tuple)) or len(v) != 4:
        return None
    try:
        y0, x0, y1, x1 = (max(0, min(1000, int(round(float(n))))) for n in v)
    except (TypeError, ValueError):
        return None
    y0, y1 = min(y0, y1), max(y0, y1)
    x0, x1 = min(x0, x1), max(x0, x1)
    return [y0, x0, y1, x1] if y1 > y0 and x1 > x0 else None


def _point(v: Any) -> list[int] | None:
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        return None
    try:
        return [max(0, min(1000, int(round(float(n))))) for n in v]
    except (TypeError, ValueError):
        return None


def parse_circuit(plain: str) -> tuple[list[dict], list[dict]] | None:
    """(elements, nodes) from a circuit line's `plain`, or None if it isn't a circuit.
    Elements keep the solver's keys plus a cleaned `box`; nodes keep `id` and a cleaned `at`."""
    try:
        data = json.loads(plain)
    except (TypeError, ValueError):
        return None
    raw = data.get("circuit") if isinstance(data, dict) else data if isinstance(data, list) else None
    if not isinstance(raw, list):
        return None
    elements = []
    for e in raw:
        if not isinstance(e, dict):
            continue
        el = {k: str(e[k]) for k in ("id", "kind", "a", "b", "value") if e.get(k) is not None}
        b = _box(e.get("box"))
        if b:
            el["box"] = b
        elements.append(el)
    nodes = []
    for n in (data.get("nodes") if isinstance(data, dict) else None) or []:
        if isinstance(n, dict) and n.get("id") is not None:
            at = _point(n.get("at"))
            if at:
                nodes.append({"id": str(n["id"]), "at": at})
    return elements, nodes


def circuit_lines(lines: list[ReadLine]) -> list[ReadLine]:
    """The lines that hold a drawn circuit."""
    return [l for l in lines if l.plain.lstrip().startswith("{") and parse_circuit(l.plain)]
