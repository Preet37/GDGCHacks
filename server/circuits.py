"""solve_circuit tool for engineering notebook mode: DC nodal analysis with SymPy.

A circuit is a netlist. Each element connects two nodes, SPICE style:
  {"id": "R1", "kind": "resistor", "a": "n1", "b": "0", "value": "4.7k"}
  {"id": "V1", "kind": "vsource",  "a": "n1", "b": "0", "value": 9}       # V(a) - V(b) = value
  {"id": "I1", "kind": "isource",  "a": "0",  "b": "n2", "value": "2m"}   # value amps flow from a, through the source, to b
Node "0" (or "gnd"/"ground") is ground. Every reported current is the current flowing from `a` to `b`
through that element (for a source: in at `a`, out at `b`).
Nothing here knows about any specific circuit; it is general modified nodal analysis.
"""
import re

import sympy as sp

GROUND = {"0", "gnd", "ground", "GND"}
SI = {"T": 12, "G": 9, "M": 6, "k": 3, "K": 3, "": 0, "m": -3, "u": -6, "µ": -6, "μ": -6, "n": -9, "p": -12}
KINDS = {"resistor", "vsource", "isource"}


class CircuitError(Exception):
    pass


def parse_value(v) -> sp.Rational:
    """9, "9", "4.7k", "10mA", "2.2 kΩ", "1M" -> exact rational."""
    if isinstance(v, (int, float)):
        return sp.nsimplify(v, rational=True)
    text = str(v).replace("*", " ")  # the read step's calculator syntax writes "9*mA"
    m = re.fullmatch(r"\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([TGMkKmuµμnp]?)\s*(?:Ω|ohms?|V|A|v|a|W|w)?\s*", text)
    if not m:
        raise CircuitError(f"can't read value {v!r}")
    return sp.nsimplify(m.group(1), rational=True) * sp.Integer(10) ** SI[m.group(2)]


def _node(n) -> str:
    n = str(n).strip()
    return "0" if n in GROUND else n


def _num(x: sp.Expr) -> float:
    f = float(x)
    return 0.0 if abs(f) < 1e-15 else round(f, 9)


def _pick_ground(parts: list) -> str:
    for _, kind, _, b, _ in parts:
        if kind == "vsource":
            return b
    degree: dict[str, int] = {}
    for _, _, a, b, _ in parts:
        for n in (a, b):
            degree[n] = degree.get(n, 0) + 1
    return max(sorted(degree), key=lambda n: degree[n])


def solve_circuit(elements: list[dict]) -> dict:
    """Solve a DC circuit. Returns
    {"ok": True, "node_voltages": {node: volts}, "element_voltages", "currents": {id: amps a->b},
     "power": {id: watts absorbed}, "ground_chosen"?: node (only when no ground was marked)}
    or {"ok": False, "detail": why}."""
    try:
        return _solve(elements)
    except CircuitError as e:
        return {"ok": False, "detail": str(e)}
    except Exception as e:  # never break the teach loop
        return {"ok": False, "detail": f"solver error: {type(e).__name__}"}


def _solve(elements: list[dict]) -> dict:
    if not elements:
        raise CircuitError("empty circuit")
    parts = []
    seen = set()
    for i, el in enumerate(elements):
        kind = str(el.get("kind", "")).lower()
        if kind not in KINDS:
            raise CircuitError(f"element {i}: kind must be one of {sorted(KINDS)}")
        eid = str(el.get("id") or f"{kind[0].upper()}{i + 1}")
        if eid in seen:
            raise CircuitError(f"duplicate id {eid}")
        seen.add(eid)
        a, b = _node(el.get("a", "")), _node(el.get("b", ""))
        if not a or not b:
            raise CircuitError(f"{eid}: needs nodes a and b")
        val = parse_value(el.get("value"))
        if kind == "resistor" and val <= 0:
            raise CircuitError(f"{eid}: resistance must be positive")
        parts.append((eid, kind, a, b, val))

    ground_chosen = None
    if "0" not in {n for _, _, a, b, _ in parts for n in (a, b)}:
        # No ground marked: pick one. Currents and element voltages don't depend on the choice, only
        # node voltages do. Prefer the '-' side of the first voltage source (where a student would put
        # ground), else the node with the most connections.
        ground_chosen = _pick_ground(parts)
        parts = [(eid, kind, "0" if a == ground_chosen else a, "0" if b == ground_chosen else b, val)
                 for eid, kind, a, b, val in parts]
    nodes = sorted({n for _, _, a, b, _ in parts for n in (a, b)} - {"0"})

    V = {n: sp.Symbol(f"V_{n}") for n in nodes}
    V["0"] = sp.Integer(0)
    branch = {eid: sp.Symbol(f"I_{eid}") for eid, kind, *_ in parts if kind == "vsource"}

    def current(eid, kind, a, b, val):
        if kind == "resistor":
            return (V[a] - V[b]) / val
        if kind == "isource":
            return val
        return branch[eid]

    # KCL at every non-ground node: sum of currents leaving = 0 (each entry is an expression equal to 0;
    # plain expressions, because sp.Eq would collapse a constant row like 1 = 0 to False)
    eqs = []
    for n in nodes:
        leaving = 0
        for p in parts:
            eid, kind, a, b, val = p
            if a == n:
                leaving += current(*p)
            if b == n:
                leaving -= current(*p)
        eqs.append(sp.sympify(leaving))
    for eid, kind, a, b, val in parts:
        if kind == "vsource":
            eqs.append(V[a] - V[b] - val)

    unknowns = [V[n] for n in nodes] + list(branch.values())
    A, rhs = sp.linear_eq_to_matrix(eqs, unknowns)
    if A.rank() < len(unknowns) or A.rank() < A.row_join(rhs).rank():
        raise CircuitError("circuit has no single solution (a floating node, a loop of voltage sources, "
                           "or current sources in series)")
    sol = dict(zip(unknowns, A.LUsolve(rhs)))

    volts = {n: _num(sol[V[n]]) for n in nodes}
    volts["0"] = 0.0
    currents, power, across = {}, {}, {}
    for p in parts:
        eid, kind, a, b, val = p
        i = current(*p).subs(sol)
        vab = (V[a] - V[b]).subs(sol)
        currents[eid] = _num(i)
        across[eid] = _num(vab)
        # absorbed power with current entering at a: for sources, i flows a->b inside, so absorbed = vab * i
        power[eid] = _num(vab * i)
    out = {"ok": True, "node_voltages": volts, "element_voltages": across, "currents": currents, "power": power}
    if ground_chosen is not None:
        volts[ground_chosen] = volts.pop("0")
        out["ground_chosen"] = ground_chosen  # node voltages are measured from this node
    return out


# ---- checking a student's claimed values against the solved circuit -------------------------------

CLAIM_TOL = 0.01  # 1% relative, with a small absolute floor for values near zero


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= max(CLAIM_TOL * max(abs(a), abs(b)), 1e-9)


def check_claim(solution: dict, claim: dict) -> dict:
    """Compare one value the student wrote with the solved circuit.

    claim: {"quantity": "voltage"|"current"|"power", "element"?: id, "node"?: name, "value": "4 V"}
      voltage + node    -> that node's voltage to ground
      voltage + element -> voltage across the element, V(a) - V(b)
      current + element -> current through it (a -> b)
      power + element   -> power it absorbs
    Signs: students often pick the other reference direction, so a value that matches in size but not
    in sign is "correct" with a note in `detail`. Returns {"verdict", "detail", "expected"}.
    """
    try:
        q = str(claim.get("quantity", "")).lower()
        claimed = float(parse_value(claim.get("value")))
        el, node = claim.get("element"), claim.get("node")
        if q == "voltage" and node is not None:
            expected = solution["node_voltages"].get(_node(node))
            what = f"V({node})"
        elif q == "voltage" and el is not None:
            expected = solution["element_voltages"].get(str(el))
            what = f"voltage across {el}"
        elif q == "current" and el is not None:
            expected = solution["currents"].get(str(el))
            what = f"current through {el}"
        elif q == "power" and el is not None:
            expected = solution["power"].get(str(el))
            what = f"power of {el}"
        else:
            return {"verdict": "unknown", "detail": "claim needs quantity plus element (or node for a voltage)", "expected": None}
        if expected is None:
            return {"verdict": "unknown", "detail": f"no {what} in this circuit", "expected": None}
        if _close(claimed, expected):
            return {"verdict": "correct", "detail": f"{what} matches", "expected": expected}
        if _close(abs(claimed), abs(expected)):
            return {"verdict": "correct", "detail": f"{what} matches in size; sign depends on the chosen direction",
                    "expected": expected}
        return {"verdict": "incorrect", "detail": f"{what} does not match the circuit", "expected": expected}
    except CircuitError as e:
        return {"verdict": "unknown", "detail": str(e), "expected": None}
    except Exception as e:
        return {"verdict": "unknown", "detail": f"claim error: {type(e).__name__}", "expected": None}
