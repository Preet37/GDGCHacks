"""compute_step tool that Gemini calls when the student asked the tutor to finish a line.

SymPy works out the line that follows `before` by `relation`. Like verify.py it never guesses and never
raises: anything it can't parse or can't do comes back with an empty result and a reason in `detail`.
"""
import re
import threading

import sympy as sp

from verify import FUNCS, LABEL, ParseError, _clean, equation, is_equation, main_var, parse, value

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


# --- a line that names its own operation: int(4*x, x), ∫ 4x dx, d/dx(x^3), diff(...), derivative of ... ---

_INT_CALL = re.compile(r"^(?:int|integral|integrate|antiderivative)\s*\((.*)\)$", re.I | re.S)
_DIFF_CALL = re.compile(r"^(?:diff|derivative|differentiate)\s*\((.*)\)$", re.I | re.S)
_INT_SIGN = re.compile(r"^∫\s*(.+)$", re.S)
_INT_WORDS = re.compile(r"^(?:the\s+)?(?:integral|antiderivative)\s+of\s+(.+)$", re.I | re.S)
_DIFF_WORDS = re.compile(r"^(?:the\s+)?derivative\s+of\s+(.+)$", re.I | re.S)
_DDX = re.compile(r"^d\s*/\s*d([A-Za-z])\s*(.+)$", re.S)
_TRAILING_DX = re.compile(r"(?:\s+|\s*\*\s*|(?<=\)))d([A-Za-z])$")
_RESPECT = re.compile(r"\s+with\s+respect\s+to\s+([A-Za-z])$", re.I)
_VAR = re.compile(r"^[A-Za-z]$")


def _top_level_args(s: str) -> list[str] | None:
    """Split at commas that are not inside brackets. None if the brackets don't balance."""
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
            if depth < 0:
                return None  # the outer '(...)' closed early: 'int(a) + int(b)' is not one call
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    return None if depth else parts + [cur.strip()]


def _operation(segment: str) -> dict | None:
    seg = segment.strip().rstrip(".").strip()
    if not seg:
        return None
    m = _INT_CALL.match(seg)
    if m:
        args = _top_level_args(m.group(1))
        if not args or not args[0]:
            return None
        expr, var, limits = args[0], None, None
        rest = args[1:]
        if rest and _VAR.match(rest[0]):
            var, rest = rest[0], rest[1:]
        if len(rest) == 2:
            limits = (rest[0], rest[1])
        elif rest:
            return None
        if var is None:
            d = _TRAILING_DX.search(expr)
            if d:
                expr, var = expr[:d.start()], d.group(1)
        return {"kind": "integral", "expr": expr, "var": var, "limits": limits}
    m = _INT_SIGN.match(seg) or _INT_WORDS.match(seg)
    if m:
        expr, var = m.group(1).strip(), None
        r = _RESPECT.search(expr)
        d = _TRAILING_DX.search(expr)
        if r:
            expr, var = expr[:r.start()], r.group(1)
        elif d:
            expr, var = expr[:d.start()], d.group(1)
        return {"kind": "integral", "expr": expr, "var": var, "limits": None} if expr.strip() else None
    m = _DIFF_CALL.match(seg)
    if m:
        args = _top_level_args(m.group(1))
        if not args or not args[0] or len(args) > 2 or (len(args) == 2 and not _VAR.match(args[1])):
            return None
        return {"kind": "derivative", "expr": args[0], "var": args[1] if len(args) == 2 else None, "limits": None}
    m = _DDX.match(seg)
    if m:
        return {"kind": "derivative", "expr": m.group(2).replace("[", "(").replace("]", ")"),
                "var": m.group(1), "limits": None}
    m = _DIFF_WORDS.match(seg)
    if m:
        expr, var = m.group(1).strip(), None
        r = _RESPECT.search(expr)
        if r:
            expr, var = expr[:r.start()], r.group(1)
        return {"kind": "derivative", "expr": expr, "var": var, "limits": None} if expr.strip() else None
    return None


def operation(line: str) -> dict | None:
    """The operation a line asks for by its own notation, or None.

    'int(4*x, x) =' -> {"kind": "integral", "expr": "4*x", "var": "x", "limits": None}. Looks at each side of
    the line's '=' signs, so 'F(x) = int(4*x, x)' is found too.
    """
    for seg in _clean(str(line)).split("="):
        op = _operation(seg)
        if op is not None:
            return op
    return None


def _apply(op: dict) -> dict:
    expr = parse(op["expr"])
    var = sp.Symbol(op["var"]) if op["var"] else (main_var(expr) or sp.Symbol("x"))
    if op["kind"] == "derivative":
        out = sp.diff(expr, var)
        return {"result": _plain(out), "latex": _latex(out), "detail": f"d/d{var}"}
    if op["limits"]:
        out = sp.integrate(expr, (var, parse(op["limits"][0]), parse(op["limits"][1])))
        if _unfinished(out):
            return _empty("couldn't integrate this")
        out = _tidy(out)
        return {"result": _plain(out), "latex": _latex(out), "detail": f"definite integral in {var}"}
    out = sp.integrate(expr, var)
    if _unfinished(out):
        return _empty("couldn't integrate this")
    return {"result": _plain(out) + " + C", "latex": _latex(out) + " + C", "detail": f"integrated in {var}"}


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
    op = operation(before)
    if op is not None:  # the line says what to do with itself, whatever relation it was given
        return _apply(op)
    if relation not in RELATIONS:
        if not before.strip().endswith("="):
            return _empty(f"can't compute relation '{relation}'")
        relation = "simplify"  # an open line that is itself the problem ('3*4 + 2 ='): work out its left side
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

    before: the line to work from in plain calculator syntax, e.g. "g(x) = 6*x^2". It can also be the open
        line itself when that line is the whole problem: "int(4*x, x) =", "d/dx(x^3) =", "3*4 + 2 =".
    relation: one of "derivative", "integral", "simplify", "equals", "solve". Ignored when the line names
        its own operation (int(...), ∫ ... dx, d/dx(...), diff(...), "derivative of ...").
    Returns {"result": plain text, "latex": LaTeX, "detail": str}. `result` is only what goes after the
    open line's "=" (no left side). Empty result = couldn't do it; `detail` says why.
    """
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
