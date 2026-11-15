"""compute_step tool that Gemini calls when the student asked the tutor to finish a line.

SymPy works out the line that follows `before` by `relation`. Like verify.py it never guesses and never
raises: anything it can't parse or can't do comes back with an empty result and a reason in `detail`.
"""
import re
import threading

import sympy as sp

from verify import FUNCS, LABEL, ParseError, equation, is_equation, main_var, value

RELATIONS = ("derivative", "integral", "simplify", "equals", "solve")
TIMEOUT_S = 4.0  # SymPy can grind on hard integrals; the request must not hang on it


def _empty(detail: str) -> dict:
    return {"result": "", "latex": "", "detail": detail[:200]}


def _plain(expr: sp.Expr) -> str:
    return sp.sstr(expr).replace("**", "^")


def _latex(expr: sp.Expr) -> str:
    return sp.latex(expr, ln_notation=True)


_WORD = re.compile(r"[A-Za-z]{2,}")


def _closed(line: str) -> str:
    """'3*4 + 2 =' -> '3*4 + 2': an open line is its left side. A bare label ('f(x) =') has no math in it."""
    line = line.strip()
    was_open = line.endswith("=")
    while line.endswith("="):
        line = line[:-1].rstrip()
    return "" if was_open and LABEL.match(line) else line


def _has_words(line: str) -> bool:
    """Plain syntax writes every product with '*', so a run of letters that is not a function name is a word."""
    return any(w not in FUNCS and not re.fullmatch(r"d[A-Za-z]", w) for w in _WORD.findall(line))


def _unfinished(expr) -> bool:
    return expr.has(sp.Integral, sp.Derivative, sp.nan, sp.zoo, sp.oo)


def _tidy(expr: sp.Expr) -> sp.Expr:
    """The simplest of a few cheap forms, so 2*x + 4*x comes back as 6*x and (x+1)^2 - x^2 as 2*x + 1."""
    forms = [expr]
    for f in (sp.simplify, sp.expand, sp.factor):
        try:
            forms.append(f(expr))
        except Exception:
            pass
    return min(forms, key=sp.count_ops)


def _solve(before: str) -> dict:
    eq = equation(before) if is_equation(before) else value(before)
    var = main_var(eq)
    if var is None:
        return _empty("no variable to solve for")
    sols = sp.solve(eq, var)
    if not sols or not isinstance(sols, list) or any(not isinstance(s, sp.Expr) or _unfinished(s) for s in sols):
        return _empty(f"couldn't solve for {var}")
    sols = sorted(set(sols), key=sp.default_sort_key)
    return {
        "result": " or ".join(_plain(s) for s in sols),
        "latex": r" \text{ or } ".join(_latex(s) for s in sols),
        "detail": f"value(s) of {var}; the line already says '{var} ='",
    }


def _compute(before: str, relation: str) -> dict:
    before = _closed(before)
    if not before:
        return _empty("nothing to work from")
    if _has_words(before):
        return _empty("this line is words, not math")
    if relation == "solve" or (relation in ("equals", "simplify") and is_equation(before)):
        return _solve(before)

    expr = value(before)
    if relation == "derivative":
        var = main_var(expr)
        out = sp.diff(expr, var) if var is not None else sp.Integer(0)
        detail = f"d/d{var}" if var is not None else "the derivative of a constant"
        return {"result": _plain(out), "latex": _latex(out), "detail": detail}

    if relation == "integral":
        var = main_var(expr) or sp.Symbol("x")
        out = sp.integrate(expr, var)
        if _unfinished(out):
            return _empty("couldn't integrate this")
        return {"result": _plain(out) + " + C", "latex": _latex(out) + " + C", "detail": f"integrated in {var}"}

    out = _tidy(expr)
    if _unfinished(out):
        return _empty("couldn't work this out")
    return {"result": _plain(out), "latex": _latex(out), "detail": "simplified"}


def compute_step(before: str, relation: str) -> dict:
    """Work out the line that follows `before` by `relation`.

    before: the previous line of the problem in plain calculator syntax, e.g. "g(x) = 6*x^2".
    relation: one of "derivative", "integral", "simplify", "equals", "solve".
    Returns {"result": plain text, "latex": LaTeX, "detail": str}. `result` is only what goes after the
    open line's "=" (no left side). Empty result = couldn't do it; `detail` says why.
    """
    if relation not in RELATIONS:
        return _empty(f"can't compute relation '{relation}'")
    box: dict = {}

    def run():
        try:
            box["out"] = _compute(str(before), relation)
        except ParseError as e:
            box["out"] = _empty(f"couldn't parse: {e}")
        except Exception as e:  # SymPy raises many kinds
            box["out"] = _empty(f"compute error: {type(e).__name__}")

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(TIMEOUT_S)
    return box.get("out") or _empty("took too long to work out")
