"""verify_step tool that Gemini calls during the teach step.

SymPy checks whether one written line follows from the previous one. It never guesses: anything it
can't parse or doesn't know how to check comes back "unknown", and the tutor treats that cautiously.
Keep the signature exactly as is.
"""
import random
import re

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)
TOL = 1e-6
SAMPLES = 8

# Names allowed in a line; everything else single-letter becomes a Symbol.
FUNCS = {
    name: getattr(sp, name)
    for name in ("sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan",
                 "sinh", "cosh", "tanh", "exp", "log", "sqrt", "Abs", "pi", "E")
}
FUNCS.update({"ln": sp.log, "e": sp.E, "abs": sp.Abs, "arcsin": sp.asin, "arccos": sp.acos, "arctan": sp.atan})

# A left side that names a result rather than being math: f(x), f'(x), y, dy/dx, F(x)
LABEL = re.compile(r"^\s*(?:[A-Za-z]'*\s*\(\s*[A-Za-z]\s*\)|[A-Za-z]'+|y|d[A-Za-z]*\s*/\s*d[A-Za-z]+)\s*$")


class ParseError(Exception):
    pass


def _clean(s: str) -> str:
    s = s.strip().rstrip(".")
    for a, b in (("−", "-"), ("–", "-"), ("·", "*"), ("×", "*"), ("÷", "/"), ("²", "^2"), ("³", "^3"), ("π", "pi")):
        s = s.replace(a, b)
    return s


def _replace_ddx(s: str) -> str:
    """d/dx(expr) -> Derivative(expr, x), with balanced parentheses."""
    out = ""
    while True:
        m = re.search(r"d\s*/\s*d([A-Za-z])\s*\(", s)
        if not m:
            return out + s
        depth, i = 1, m.end()
        while i < len(s) and depth:
            depth += {"(": 1, ")": -1}.get(s[i], 0)
            i += 1
        if depth:
            raise ParseError("unbalanced parentheses")
        inner = s[m.end():i - 1]
        out += s[:m.start()] + f"Derivative({inner}, {m.group(1)})"
        s = s[i:]


def parse(s: str) -> sp.Expr:
    s = _replace_ddx(_clean(s))
    if not s:
        raise ParseError("empty")
    try:
        expr = parse_expr(s, local_dict=dict(FUNCS, Derivative=sp.Derivative), transformations=TRANSFORMS, evaluate=True)
    except Exception as e:  # SymPy raises many kinds
        raise ParseError(str(e)) from e
    if not isinstance(expr, sp.Expr):
        raise ParseError("not an expression")
    return expr.doit()


def split_line(line: str) -> tuple[str | None, str]:
    """'f(x) = 3x^2' -> ('f(x)', '3x^2'); '3x^2' -> (None, '3x^2'). Only the first '=' splits."""
    line = _clean(line).replace("==", "=")
    if "=" not in line:
        return None, line
    left, right = line.split("=", 1)
    return left.strip(), right.strip()


def is_equation(line: str) -> bool:
    """True if the line is a real equation (2x + 5 = 11), not a labeled expression (f(x) = ...)."""
    left, _ = split_line(line)
    return left is not None and not LABEL.match(left)


def value(line: str) -> sp.Expr:
    """The math of a line: right side of a labeled line, else the whole thing."""
    left, right = split_line(line)
    return parse(right if left is not None else line)


def equation(line: str) -> sp.Expr:
    """lhs - rhs of an equation line."""
    left, right = split_line(line)
    return parse(left) - parse(right)


def main_var(*exprs: sp.Expr) -> sp.Symbol | None:
    syms = set().union(*(e.free_symbols for e in exprs))
    syms = {s for s in syms if s.name not in ("C", "c", "K")}  # integration constants
    for name in ("x", "t", "y", "z", "u", "n"):
        for s in syms:
            if s.name == name:
                return s
    return sorted(syms, key=lambda s: s.name)[0] if syms else None


def numeric_zero(expr: sp.Expr) -> bool | None:
    """Spot-check expr == 0 at random points. True/False, or None if it couldn't be evaluated."""
    syms = sorted(expr.free_symbols, key=lambda s: s.name)
    rng = random.Random(1234)
    ok = 0
    for _ in range(SAMPLES * 3):
        point = {s: rng.uniform(-3, 3) for s in syms}
        try:
            v = complex(expr.evalf(subs=point))
        except Exception:
            continue
        if v != v or abs(v) == float("inf"):  # nan / inf
            continue
        if abs(v) > TOL * max(1.0, abs(v)):
            return False
        ok += 1
        if ok >= SAMPLES:
            return True
    return True if ok >= 3 else None


def is_zero(expr: sp.Expr) -> bool | None:
    """Symbolic check first (cheap forms), numeric spot check as backup."""
    try:
        for f in (sp.expand, sp.cancel, sp.trigsimp):
            if f(expr) == 0:
                return True
    except Exception:
        pass
    return numeric_zero(expr)


def verdict(zero: bool | None, ok: str, bad: str) -> dict:
    if zero is True:
        return {"verdict": "correct", "detail": ok}
    if zero is False:
        return {"verdict": "incorrect", "detail": bad}
    return {"verdict": "unknown", "detail": "couldn't evaluate these expressions"}


def solution_set(eq: sp.Expr, var: sp.Symbol) -> set | None:
    try:
        sols = sp.solve(eq, var)
    except Exception:
        return None
    return {sp.nsimplify(s) for s in sols}


def check_solve(before: str, after: str) -> dict:
    eq = equation(before) if is_equation(before) else value(before)
    # after may be "x = 3", "x = 3, x = -1", "x = 3 or x = -1", or another equation ("2x = 6")
    parts = [p for p in re.split(r",|;|\bor\b|\band\b", after) if p.strip()]
    var = main_var(eq)
    if var is None:
        return {"verdict": "unknown", "detail": "no variable to solve for"}

    claimed = []
    for p in parts:
        left, right = split_line(p)
        if left is None:
            break
        lhs = parse(left)
        if lhs != var:
            break
        claimed.append(parse(right))
    else:
        bad = [c for c in claimed if is_zero(eq.subs(var, c)) is False]
        if bad:
            return {"verdict": "incorrect", "detail": f"{var} = {bad[0]} does not satisfy the equation"}
        expected = solution_set(eq, var)
        missing = sorted(expected - {sp.nsimplify(c) for c in claimed}, key=str) if expected else []
        detail = "every value satisfies the equation"
        if missing:
            detail += f"; also a solution: {', '.join(f'{var} = {m}' for m in missing)}"
        return {"verdict": "correct", "detail": detail}

    # an intermediate equation: same solutions as before?
    return check_equations(before, after)


def check_equations(before: str, after: str) -> dict:
    a, b = equation(before), equation(after)
    var = main_var(a, b)
    if var is None:
        return {"verdict": "unknown", "detail": "no variable"}
    sa, sb = solution_set(a, var), solution_set(b, var)
    if sa is None or sb is None:
        return {"verdict": "unknown", "detail": "couldn't solve the equations"}
    if sa == sb:
        return {"verdict": "correct", "detail": "same solutions as the line before"}
    return {"verdict": "incorrect", "detail": "this equation has different solutions than the line before"}


def verify_step(before: str, after: str, relation: str) -> dict:
    """Check whether `after` follows from `before` by `relation`.

    before, after: lines in plain calculator syntax, e.g. "f(x) = 3*x^2 + 2*x".
    relation: one of "equals", "simplify", "derivative", "integral", "solve", "other".
    Returns {"verdict": "correct" | "incorrect" | "unknown", "detail": str}.
    """
    try:
        if relation == "solve":
            return check_solve(before, after)

        if relation in ("equals", "simplify"):
            if is_equation(before) and is_equation(after):
                return check_equations(before, after)
            return verdict(is_zero(value(before) - value(after)),
                           "both sides are equal", "this is not equal to the line before")

        if relation == "derivative":
            b, a = value(before), value(after)
            var = main_var(b, a)
            if var is None:
                return {"verdict": "unknown", "detail": "no variable to differentiate by"}
            d = sp.diff(b, var)
            return verdict(is_zero(d - a), f"matches d/d{var}",
                           f"the derivative of the line before is not this (d/d{var})")

        if relation == "integral":
            b, a = value(before), value(after)
            var = main_var(b, a)
            if var is None:
                return {"verdict": "unknown", "detail": "no variable to integrate by"}
            return verdict(is_zero(sp.diff(a, var) - b), f"its derivative gives back the line before (d/d{var})",
                           "differentiating this does not give back the line before")

        return {"verdict": "unknown", "detail": f"no checker for relation '{relation}'"}
    except ParseError as e:
        return {"verdict": "unknown", "detail": f"couldn't parse: {e}"[:200]}
    except Exception as e:  # never break the teach loop
        return {"verdict": "unknown", "detail": f"checker error: {type(e).__name__}"}
