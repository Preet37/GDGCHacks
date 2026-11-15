"""check_forces tool (engineering, Part 2): do the forces on a body balance (or equal m*a)?

Each force has a direction (degrees counter-clockwise from +x) and a magnitude that is a number with units
("19.6 N"), an expression in the givens ("m*g", "m*g*cos(30)"), or unknown (drawn, but no value written). The code
solves sum(F) = m*a for the unknown magnitudes as a linear system with SymPy:
- solvable with every magnitude >= 0: balanced, and the magnitudes it found are returned (hint 3 uses them);
- not solvable: the forces can't balance; `leftover` is the net force nothing on the diagram can cancel. The missing
  force points the opposite way (on a ramp at rest with only gravity and normal: up the slope, i.e. friction).
Which forces SHOULD be on the diagram is the tutor's call (`expected`); this only checks arithmetic. Never raises.
"""
import math
import re

import sympy as sp

TOL = 0.01  # relative to the largest force
_UNIT = re.compile(r"\s*(?:\*\s*)?(?:N|newtons?|kN)\s*$", re.I)


class _Unreadable(Exception):
    pass


def _deg(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError) as e:
        raise _Unreadable(f"angle {v!r} isn't a number of degrees") from e


def _givens(raw: dict | None) -> dict:
    """{"m": "2 kg", "g": 9.8, "theta": "30", "mu": "0.3"} -> {Symbol: number}. Units on givens are dropped (SI assumed),
    angles stay in degrees (cos/sin below take degrees)."""
    out = {}
    for k, v in (raw or {}).items():
        name = re.sub(r"[^A-Za-z0-9_]", "", str(k).replace("θ", "theta").replace("μ", "mu"))
        if not name:
            continue
        m = re.match(r"\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)", str(v))
        if m:
            out[sp.Symbol(name)] = sp.nsimplify(m.group(1), rational=True)
    return out


_DEG = {"cos": lambda x: sp.cos(x * sp.pi / 180), "sin": lambda x: sp.sin(x * sp.pi / 180),
        "tan": lambda x: sp.tan(x * sp.pi / 180)}


def _magnitude(raw, givens: dict):
    """A force's magnitude as a number, or None if it wasn't written (an unknown to solve for)."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    if isinstance(raw, (int, float)):
        return sp.nsimplify(raw, rational=True)
    text = _UNIT.sub("", str(raw)).replace("·", "*").replace("×", "*").replace("^", "**")
    text = text.replace("θ", "theta").replace("μ", "mu").replace("°", "")
    text = re.sub(r"(\d)\s*([A-Za-z(])", r"\1*\2", text)  # 2g -> 2*g, mg stays a name until expanded below
    text = re.sub(r"(?<=[\w)])\s+(?=[\w(])", "*", text.strip())  # "mg sin(30)" -> "mg*sin(30)"
    try:
        expr = sp.sympify(text, locals={**_DEG, **{str(s): s for s in givens}})
    except Exception as e:
        raise _Unreadable(f"can't read magnitude {raw!r}") from e
    expr = expr.subs(givens)
    # "mg" written as one word: m*g when both are given
    for sym in list(expr.free_symbols):
        name = str(sym)
        if len(name) > 1 and all(sp.Symbol(c) in givens for c in name):
            expr = expr.subs(sym, sp.Mul(*[givens[sp.Symbol(c)] for c in name]))
    if expr.free_symbols:
        raise _Unreadable(f"magnitude {raw!r} needs {', '.join(sorted(map(str, expr.free_symbols)))}")
    return sp.nsimplify(sp.N(expr, 15), rational=True)


def _label_magnitude(label: str, givens: dict):
    """The size a label names, when it is an expression in the givens ("mg", "m*g", "2mg"); else None."""
    try:
        return _magnitude(label, givens) if givens else None
    except _Unreadable:
        return None


def any_known(forces: list[dict], givens: dict) -> bool:
    for f in forces:
        try:
            if _magnitude(f.get("magnitude"), givens) is not None:
                return True
        except _Unreadable:
            pass
        if _label_magnitude(str(f.get("label") or ""), givens) is not None:
            return True
    return False


def _accel(accel, givens: dict) -> tuple:
    """(ax, ay) from {"x":..,"y":..}, {"magnitude":.., "angle_deg":..}, a number (with `angle_deg`), or nothing (at rest)."""
    if accel in (None, "", 0, "0"):
        return sp.Integer(0), sp.Integer(0)
    if isinstance(accel, dict):
        if "x" in accel or "y" in accel:
            return _magnitude(accel.get("x", 0), givens) or 0, _magnitude(accel.get("y", 0), givens) or 0
        mag = _magnitude(accel.get("magnitude", 0), givens) or 0
        a = _deg(accel.get("angle_deg", 0))
        return mag * sp.cos(a * sp.pi / 180), mag * sp.sin(a * sp.pi / 180)
    raise _Unreadable("acceleration should be {x, y} or {magnitude, angle_deg}")


def _num(x) -> float:
    f = float(sp.N(x))
    return 0.0 if abs(f) < 1e-12 else round(f, 6)


def _balance(forces: list[dict], givens: dict, ax, ay, mass) -> dict:
    """Solve sum(F) = m*a for the forces without a magnitude."""
    if not forces:
        raise _Unreadable("no forces")
    known_x = known_y = sp.Integer(0)
    unknown = []  # (label, symbol, cos, sin)
    biggest = 0.0
    for i, f in enumerate(forces):
        label = str(f.get("label") or f.get("id") or f"F{i + 1}")
        a = _deg(f.get("angle_deg"))
        c, s = sp.cos(sp.nsimplify(a) * sp.pi / 180), sp.sin(sp.nsimplify(a) * sp.pi / 180)
        mag = _magnitude(f.get("magnitude"), givens)
        if mag is None:
            mag = _label_magnitude(label, givens)  # an arrow labelled "mg" with m and g given is fully known
        if mag is None:
            sym = sp.Symbol(f"F_{i}")
            unknown.append((label, sym, c, s))
        else:
            known_x += mag * c
            known_y += mag * s
            biggest = max(biggest, abs(float(mag)))
    if not any_known(forces, givens) and (ax, ay) == (0, 0):
        raise _Unreadable("no force has a size (write one, or give m and g), so there is nothing to balance")
    need_x = mass * ax - known_x
    need_y = mass * ay - known_y
    syms = [u[1] for u in unknown]
    eqs = [sum(u[1] * u[2] for u in unknown) - need_x, sum(u[1] * u[3] for u in unknown) - need_y]
    solved = {}
    if syms:
        sol = sp.solve(eqs, syms, dict=True)
        if sol:
            # an under-determined system (more unknowns than equations) leaves some free: pick 0 for those
            pick = {s: (sol[0].get(s, 0)) for s in syms}
            pick = {s: sp.sympify(v).subs({t: 0 for t in syms}) for s, v in pick.items()}
            if all(float(sp.N(v)) >= -1e-9 for v in pick.values()):
                solved = {label: _num(pick[sym]) for label, sym, _, _ in unknown}
                biggest = max([biggest] + [abs(v) for v in solved.values()])
                return {"balanced": True, "solved": solved, "leftover": {"x": 0.0, "y": 0.0}, "scale": biggest}
    # can't balance (or only with a negative magnitude): the leftover is what the best fit can't cancel
    if syms:
        A = sp.Matrix([[u[2] for u in unknown], [u[3] for u in unknown]])
        b = sp.Matrix([need_x, need_y])
        x = (A.T * A).pinv() * A.T * b
        x = sp.Matrix([max(sp.N(v), 0) for v in x])  # a pushing force can't pull
        fit = A * x
        solved = {label: _num(x[i]) for i, (label, *_rest) in enumerate(unknown)}
    else:
        fit = sp.Matrix([0, 0])
    left = sp.Matrix([need_x, need_y]) - fit  # what is still needed
    lx, ly = -_num(left[0]), -_num(left[1])   # net force on the body beyond m*a
    biggest = max([biggest] + [abs(v) for v in solved.values()] + [1e-12])
    balanced = math.hypot(lx, ly) <= TOL * biggest
    return {"balanced": balanced, "solved": solved, "leftover": {"x": lx, "y": ly}, "scale": biggest}


def check_forces(forces: list[dict], givens: dict | None = None, accel=None, expected: list[dict] | None = None) -> dict:
    """{"verdict", "detail", "balanced", "leftover", "missing_angle_deg", "solved", "expected"?}.

    `forces`: as drawn (label, angle_deg, magnitude?). `givens`: {"m": "2 kg", "g": 9.8, ...}. `accel`: None = at rest.
    `expected`: the tutor's full list of forces that should be there; checked the same way, its solved magnitudes
    are what hint 3 can show. Verdict: correct = the drawn forces balance; incorrect = they can't; unknown = unreadable."""
    try:
        g = _givens(givens)
        mass = g.get(sp.Symbol("m"), sp.Integer(1))
        ax, ay = _accel(accel, g)
        drawn = _balance(list(forces or []), g, ax, ay, mass)
        out = {"balanced": drawn["balanced"], "leftover": drawn["leftover"], "solved": drawn["solved"]}
        lx, ly = drawn["leftover"]["x"], drawn["leftover"]["y"]
        if drawn["balanced"]:
            out.update(verdict="correct", detail="the drawn forces balance" + (" (= m*a)" if (ax, ay) != (0, 0) else ""))
        else:
            missing = (math.degrees(math.atan2(-ly, -lx)) + 360) % 360
            out.update(verdict="incorrect", missing_angle_deg=round(missing, 1),
                       detail=f"the drawn forces can't balance: {math.hypot(lx, ly):.3g} N is left over at "
                              f"{(missing + 180) % 360:.0f} degrees, so a force of that size at {missing:.0f} degrees is missing")
        if expected:
            exp = _balance(list(expected), g, ax, ay, mass)
            out["expected"] = {"balanced": exp["balanced"], "solved": exp["solved"], "leftover": exp["leftover"]}
        return out
    except _Unreadable as e:
        return {"verdict": "unknown", "detail": str(e), "balanced": None, "leftover": None, "solved": {}}
    except Exception as e:  # never break the teach loop
        return {"verdict": "unknown", "detail": f"forces error: {type(e).__name__}", "balanced": None, "leftover": None,
                "solved": {}}
