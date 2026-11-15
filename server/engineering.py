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


# ---- the circuit figure (x-ray labels + what-if card), built in code ----

EXPLORE_WORDS = ("simulate", "explore", "what if", "what-if")


def _asks_to_explore(text: str | None) -> bool:
    t = (text or "").lower()
    return any(w in t for w in EXPLORE_WORDS)


def _answers(problem: list[ReadLine], circuit: ReadLine) -> list[ReadLine]:
    """The student's answer lines about a circuit: their own lines in its problem, not the drawing itself, not a
    line left open after '=', not a request (to explore, or to "solve" it for them)."""
    import solution
    return [l for l in problem if l.line_id != circuit.line_id and l.source != "printed"
            and not l.plain.strip().endswith("=") and not _asks_to_explore(l.plain) and not solution.is_request(l)]


def build_circuit_figure(circuit: ReadLine, reveal: bool):
    """The `figure` action for a circuit line: elements and node positions from what was read, the solution from
    solve_circuit. Nothing in it comes from the model."""
    import circuits
    from models import Action
    parsed = parse_circuit(circuit.plain)
    if parsed is None:
        return None
    elements, nodes = parsed
    fig = {"elements": elements, "reveal": bool(reveal)}
    if nodes:
        fig["nodes"] = nodes
    sol = circuits.solve_circuit([{k: v for k, v in e.items() if k != "box"} for e in elements])
    if not sol.get("ok"):
        fig["reveal"] = False  # nothing to reveal; the card explains the problem when it re-solves
    elif reveal:
        # Only a revealed figure carries the numbers: a hidden one must not hand over the answer, not even in the data.
        fig["solution"] = {k: sol[k] for k in ("node_voltages", "currents", "element_voltages", "power") if k in sol}
    return Action(type="figure", line_id=circuit.line_id, box=circuit.box, side="right",
                  figure={"kind": "circuit", "expressions": [], "x_range": (0, 1), "title": "Your circuit",
                          "circuit": fig})


def circuit_figures(lines: list[ReadLine], actions: list, verdicts: dict, hint_levels: dict, prev_lines: list[ReadLine],
                    question: str | None = None, hinted: set | None = None) -> list:
    """`actions` with the circuit figures decided and filled in by code.

    A circuit figure is shown when the student has written an answer about the circuit, the problem reached hint
    level 3, or they wrote or said "simulate" / "explore" / "what if". Its numbers are revealed only after a
    correct answer (checked by solve_circuit) or at hint level 3, so a wrong answer never gets the solution.
    It is (re)sent only when something in that problem changed, so a check doesn't redraw the card for nothing
    (which would also reset the student's what-if edits). Any circuit figure the model wrote is replaced."""
    out = [a for a in actions if not (a.type == "figure" and a.figure is not None and a.figure.kind == "circuit")]
    before = {l.line_id: l.plain for l in prev_lines}
    for circuit in circuit_lines(lines):
        problem = [l for l in lines if l.problem_id == circuit.problem_id]
        answers = _answers(problem, circuit)
        level = hint_levels.get(circuit.problem_id, 0)
        explore = any(_asks_to_explore(l.plain) for l in problem) or _asks_to_explore(question)
        if not (answers or level >= 3 or explore):
            continue
        changed = (any(before.get(l.line_id) != l.plain for l in problem)
                   or circuit.problem_id in (hinted or set()) or _asks_to_explore(question))
        if not changed:
            continue
        right = [a for a in answers if verdicts.get(a.line_id) == "correct"]
        wrong = [a for a in answers if verdicts.get(a.line_id) == "incorrect"]
        reveal = level >= 3 or (bool(right) and not wrong)
        fig = build_circuit_figure(circuit, reveal)
        if fig is not None:
            out.append(fig)
    return out
