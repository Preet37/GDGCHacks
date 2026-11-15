"""Engineering (Part 2): what a drawn circuit line holds, and the circuit figure built from it in code.

The read step writes a drawn circuit as ONE line whose `plain` is JSON:
    {"circuit": [{"id", "kind", "a", "b", "value", "box"?}, ...], "nodes": [{"id", "at": [y, x]}, ...]}
Positions are 0-1000 over the sent image. Anything malformed is dropped piece by piece (a bad box means no
label for that element), never raised: a misread position must not cost the student their feedback.
"""
import json
import math
import re
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


# ---- free-body diagrams ----

FBD_GREEN = "Nice: these forces balance."


def _angle(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _forces(raw, default_on: str) -> list[dict]:
    out = []
    for i, f in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(f, dict):
            continue
        a = _angle(f.get("angle_deg"))
        if a is None:
            continue
        force = {"id": str(f.get("id") or f"F{i + 1}"), "label": str(f.get("label") or f.get("id") or f"F{i + 1}"),
                 "angle_deg": a % 360, "on": str(f.get("on") or default_on)}
        if f.get("magnitude") not in (None, ""):
            force["magnitude"] = str(f["magnitude"])
        at = _point(f.get("at"))
        if at:
            force["at"] = at
        out.append(force)
    return out


def parse_fbd(plain: str) -> dict | None:
    """The force diagram a line holds ({"fbd": {bodies, surfaces, forces}}), cleaned; None if it isn't one."""
    try:
        data = json.loads(plain)
    except (TypeError, ValueError):
        return None
    fbd = data.get("fbd") if isinstance(data, dict) else None
    if not isinstance(fbd, dict):
        return None
    bodies = []
    for i, b in enumerate(fbd.get("bodies") if isinstance(fbd.get("bodies"), list) else []):
        if isinstance(b, dict):
            body = {"id": str(b.get("id") or f"B{i + 1}"),
                    "shape": b.get("shape") if b.get("shape") in ("box", "point", "beam") else "box"}
            at = _point(b.get("at"))
            if at:
                body["at"] = at
            bodies.append(body)
    if not bodies:
        bodies = [{"id": "B", "shape": "box"}]
    surfaces = [{"id": str(s.get("id") or f"S{i + 1}"), "angle_deg": _angle(s.get("angle_deg"))}
                for i, s in enumerate(fbd.get("surfaces") if isinstance(fbd.get("surfaces"), list) else [])
                if isinstance(s, dict) and _angle(s.get("angle_deg")) is not None]
    return {"bodies": bodies, "surfaces": surfaces, "forces": _forces(fbd.get("forces"), bodies[0]["id"])}


def fbd_lines(lines: list[ReadLine]) -> list[ReadLine]:
    return [l for l in lines if l.plain.lstrip().startswith("{") and parse_fbd(l.plain)]


def expected_forces(raw, drawn: dict) -> list[dict]:
    """The tutor's list of forces that should be on the diagram, cleaned like the drawn ones."""
    return _forces(raw, drawn["bodies"][0]["id"])


def build_fbd_figure(line: ReadLine, expected: list[dict] | None):
    """The clean diagram for a force-diagram line: bodies, surfaces and forces from what was read; `expected` (the
    forces that should be there) only when given, so the page can draw the missing ones dashed."""
    from models import Action
    fbd = parse_fbd(line.plain)
    if fbd is None:
        return None
    if not fbd["surfaces"]:
        fbd.pop("surfaces")
    if expected:
        fbd["expected"] = expected
    title = "Your force diagram"
    return Action(type="figure", line_id=line.line_id, box=line.box, side="right",
                  figure={"kind": "fbd", "expressions": [], "x_range": (0, 1), "title": title, "fbd": fbd})


def fbd_figures(lines: list[ReadLine], actions: list, fbd_info: dict, verdicts: dict, hint_levels: dict,
                prev_lines: list[ReadLine], mode: str, hinted: set | None = None) -> list:
    """`actions` with the force-diagram figures decided and filled in by code (any the model wrote are replaced).

    - help mode at hint level 2 or more: the clean diagram, with the forces that should be there (`expected`, from
      check_forces) so the missing ones are drawn dashed;
    - the diagram checks correct (check_forces: balanced): a green "Nice" note plus the clean diagram.
    Sent only when that problem changed or got a new hint, like the circuit figure."""
    diagrams = {l.line_id for l in fbd_lines(lines)}
    # A whole drawing is not a term to circle: on a force diagram the question is the feedback (a circle around the
    # entire sketch only adds noise). Figures the model wrote are replaced by code's.
    out = [a for a in actions if not (a.type == "figure" and a.figure is not None and a.figure.kind == "fbd")
           and not (a.type in ("circle", "underline") and a.line_id in diagrams)]
    before = {l.line_id: l.plain for l in prev_lines}
    for line in fbd_lines(lines):
        problem = [l for l in lines if l.problem_id == line.problem_id]
        changed = any(before.get(l.line_id) != l.plain for l in problem) or line.problem_id in (hinted or set())
        if not changed:
            continue
        info = fbd_info.get(line.line_id) or {}
        level = hint_levels.get(line.problem_id, 0)
        if verdicts.get(line.line_id) == "correct":
            from models import Action
            if not any(a.type == "note" and a.color == "green" and a.line_id == line.line_id for a in out):
                out.append(Action(type="note", line_id=line.line_id, box=line.box, color="green", side="below", text=FBD_GREEN))
            fig = build_fbd_figure(line, None)
        elif mode == "help" and level >= 2:
            fig = build_fbd_figure(line, info.get("expected"))
        else:
            continue
        if fig is not None:
            out.append(fig)
    return out


def missing_from(drawn: dict, expected: list[dict]) -> list[dict]:
    """Expected forces the student didn't draw (by label, or by direction within 20 degrees), like the page's."""
    near = lambda a, b: abs(((a - b + 540) % 360) - 180) <= 20
    return [e for e in expected if not any(d["label"].strip().lower() == e["label"].strip().lower()
                                           or near(d["angle_deg"], e["angle_deg"]) for d in drawn["forces"])]


def fix_missing_direction(drawn: dict, expected: list[dict], check: dict) -> tuple[list[dict], str] | None:
    """If exactly one expected force is missing and the drawn forces can't balance, point that force where the
    leftover says it must (check_forces' missing_angle_deg). Returns (expected, a note) or None if nothing changed."""
    gone = missing_from(drawn, expected or [])
    angle = check.get("missing_angle_deg")
    if len(gone) != 1 or angle is None or check.get("verdict") != "incorrect":
        return None
    f = gone[0]
    if abs(((f["angle_deg"] - angle + 540) % 360) - 180) <= 5:
        return None
    fixed = [dict(e, angle_deg=round(float(angle), 1)) if e is f else e for e in expected]
    return fixed, f"{f['label']} must point at {round(float(angle))} degrees to balance (not {round(f['angle_deg'])}); use that"


# ---- 3D models ----------------------------------------------------------------------------------------------------
# The model describes a structure (a bridge, a truss, a crane) as parts; code checks every number and drops what can't
# be drawn, so the page only ever gets a scene it can render. Nothing here is graded.

MAX_PARTS = 60
MAX_PATH = 48  # points on one curved member
MAX_LOADS = 8
MAX_COORD = 1000.0
SHAPE_NAMES = {
    "box": "box", "cube": "box", "block": "box", "slab": "box", "deck": "box", "plate": "box",
    "cylinder": "cylinder", "column": "cylinder", "pillar": "cylinder", "pier": "cylinder", "tower": "cylinder",
    "wheel": "cylinder", "axle": "cylinder", "tube": "cylinder", "pipe": "cylinder", "disc": "cylinder", "disk": "cylinder",
    "cone": "cone", "nose": "cone", "spire": "cone",
    "sphere": "sphere", "ball": "sphere", "joint": "sphere", "node": "sphere",
    "member": "member", "beam": "member", "bar": "member", "rod": "member", "cable": "member", "strut": "member",
    "tie": "member", "line": "member", "truss": "member", "hanger": "member",
}
MATERIALS = {"steel", "concrete", "stone", "wood", "carbon", "rubber", "glass", "asphalt", "aluminium", "cable", "paint",
             "water", "earth"}
MATERIAL_NAMES = {"aluminum": "aluminium", "carbon fibre": "carbon", "carbon fiber": "carbon", "carbon_fiber": "carbon",
                  "tarmac": "asphalt", "road": "asphalt", "metal": "steel", "iron": "steel", "brick": "stone",
                  "masonry": "stone", "timber": "wood", "tyre": "rubber", "tire": "rubber", "soil": "earth",
                  "ground": "earth", "wire": "cable", "rope": "cable", "plastic": "paint"}
AXES = {"x", "y", "z", "-x", "-y", "-z"}

LOAD_NAMES = {
    "tension": "tension", "tensile": "tension", "pulled": "tension", "pull": "tension",
    "compression": "compression", "compressive": "compression", "pushed": "compression", "push": "compression",
    "bending": "bending", "bend": "bending", "shear": "bending",
}


def _vec(v) -> tuple[float, float, float] | None:
    if isinstance(v, dict):
        v = [v.get("x"), v.get("y"), v.get("z", 0)]
    if not isinstance(v, (list, tuple)) or len(v) not in (2, 3):
        return None
    try:
        out = [float(x) for x in v] + ([0.0] if len(v) == 2 else [])
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(x) and abs(x) <= MAX_COORD for x in out):
        return None
    return (out[0], out[1], out[2])


def _short(v, n: int) -> str | None:
    if not isinstance(v, str) or not v.strip():
        return None
    v = " ".join(v.split())
    return v if len(v) <= n else v[: n - 1].rstrip() + "…"


def _part(raw, taken: set[str]) -> dict | None:
    if not isinstance(raw, dict):
        return None
    shape = SHAPE_NAMES.get(str(raw.get("shape", "")).strip().lower())
    name = _short(raw.get("name") or raw.get("id"), 40)
    if shape is None or name is None:
        return None
    part: dict = {"name": name, "shape": shape,
                  "load": LOAD_NAMES.get(str(raw.get("load", "")).strip().lower(), "none")}
    size = _vec(raw.get("size")) if raw.get("size") is not None else None
    if shape == "member":
        path = [p for p in (_vec(v) for v in (raw.get("points") or [])[:MAX_PATH]) if p is not None]
        path = [p for i, p in enumerate(path) if i == 0 or math.dist(p, path[i - 1]) > 1e-6]
        if len(path) >= 3:  # a curved member: its ends are the path's ends
            part.update(points=path, start=path[0], end=path[-1])
        else:
            start, end = _vec(raw.get("start") or raw.get("from")), _vec(raw.get("end") or raw.get("to"))
            if start is None or end is None:
                start, end = (path[0], path[-1]) if len(path) == 2 else (None, None)
            if start is None or end is None or math.dist(start, end) < 1e-6:
                return None
            part.update(start=start, end=end)
        if size is not None and size[0] > 0:
            part["size"] = (size[0], 0.0, 0.0)
    else:
        at = _vec(raw.get("at") or raw.get("center") or raw.get("centre"))
        if at is None:
            return None
        if size is None:
            num = raw.get("size")
            size = (float(num),) * 3 if isinstance(num, (int, float)) and math.isfinite(num) else None
        if size is None:
            return None
        size = tuple(abs(x) for x in size)
        if shape == "sphere":
            size = (size[0],) * 3
        elif shape in ("cylinder", "cone"):
            size = (size[0], size[0], size[2] if size[2] > 0 else size[1])
        if min(size) <= 0:
            return None
        part.update(at=at, size=size)
        axis = str(raw.get("axis", "")).strip().lower().replace("+", "")
        if shape in ("cylinder", "cone") and axis in AXES and axis != "z":
            part["axis"] = axis
        rot = _vec(raw.get("rotate")) if raw.get("rotate") is not None else None
        if shape != "sphere" and rot is not None and any(abs(r) > 1e-6 for r in rot):
            part["rotate"] = tuple(((r + 180) % 360) - 180 for r in rot)
    mat = str(raw.get("material", "")).strip().lower()
    mat = MATERIAL_NAMES.get(mat, mat)
    if mat in MATERIALS:
        part["material"] = mat
    color = str(raw.get("color") or raw.get("colour") or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        part["color"] = color.lower()
    explain = _short(raw.get("explain"), 300)
    if explain:
        part["explain"] = explain
    base = re.sub(r"[^a-z0-9_]+", "_", str(raw.get("id") or name).lower()).strip("_") or "part"
    pid, k = base, 2
    while pid in taken:
        pid, k = f"{base}_{k}", k + 1
    taken.add(pid)
    return {"id": pid, **part}


def _load(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    at, d, label = _vec(raw.get("at")), _vec(raw.get("dir") or raw.get("direction")), _short(raw.get("label"), 30)
    if at is None or d is None or label is None or math.hypot(*d) < 1e-9:
        return None
    return {"at": at, "dir": d, "label": label}


def build_model3d(raw) -> dict | None:
    """A clean Model3dFigure dict from what the model sent, or None if nothing in it can be drawn."""
    if not isinstance(raw, dict):
        return None
    taken: set[str] = set()
    parts = [p for p in (_part(r, taken) for r in (raw.get("parts") or [])[: MAX_PARTS * 2]) if p][:MAX_PARTS]
    if not parts:
        return None
    out: dict = {"parts": parts,
                 "loads": [l for l in (_load(r) for r in (raw.get("loads") or [])) if l][:MAX_LOADS]}
    summary = _short(raw.get("summary"), 200)
    if summary:
        out["summary"] = summary
    return out


def model3d_request(raw) -> dict | None:
    """The tutor names what to build ({"subject", "focus"}) and the page has the server build it: an unbuilt model."""
    if not isinstance(raw, dict) or raw.get("parts"):
        return None
    subject = _short(raw.get("subject"), 200)
    if subject is None:
        return None
    out: dict = {"parts": [], "loads": [], "subject": subject}
    focus = _short(raw.get("focus"), 200)
    if focus:
        out["focus"] = focus
    return out
