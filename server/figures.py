"""Make sure every figure the tutor sends has a window that shows the curve.

fix_figure takes a raw figure spec (a dict, as the model sent it) and returns it with sensible ranges.
It never raises: on any failure the spec comes back as it was.
"""
import logging
import math
import re

import sympy as sp
from sympy.parsing.sympy_parser import parse_expr

from verify import FUNCS, TRANSFORMS, split_line

log = logging.getLogger(__name__)

SAMPLES = 400
PAD = 0.10          # room above and below the curve, as a share of its height
FENCE = 3.0         # values further than this many quartile-spreads from the middle half are outliers
DEFAULT_X = [-10.0, 10.0]

def _root(v, n):
    """Real n-th root: odd roots of negative numbers are negative, as math.js draws them."""
    n = sp.sympify(n)
    if n.is_Integer and n % 2 == 1:
        return sp.sign(v) * sp.Abs(v) ** (sp.Integer(1) / n)
    return v ** (sp.Integer(1) / n)


# math.js names that SymPy spells differently (log(x) is the natural log in both).
_MATHJS = dict(FUNCS, log10=lambda v: sp.log(v, 10), log2=lambda v: sp.log(v, 2), cbrt=lambda v: _root(v, 3), sign=sp.sign,
               nthRoot=lambda v, n=2: _root(v, n),
               floor=sp.floor, ceil=sp.ceiling, PI=sp.pi)


_SAFE = re.compile(r"^[0-9A-Za-z_ .+\-*/^(),]+$")


def _range(v):
    """A [lo, hi] pair of finite numbers, or None."""
    try:
        lo, hi = (float(x) for x in v)
    except (TypeError, ValueError):
        return None
    return [lo, hi] if math.isfinite(lo) and math.isfinite(hi) else None


def _function(expression: str):
    """math.js expression in x -> a plain Python function of x."""
    left, right = split_line(str(expression))  # tolerate a 'y =' or 'f(x) =' prefix
    if not _SAFE.match(right) or "__" in right:  # parse_expr evaluates its input: math characters only
        raise ValueError("not a math expression")
    expr = parse_expr(right, local_dict=_MATHJS, transformations=TRANSFORMS, evaluate=True)
    x = sp.Symbol("x")
    if not isinstance(expr, sp.Expr) or expr.free_symbols - {x}:
        raise ValueError("not a function of x")
    return sp.lambdify(x, expr, modules=["math", {"Abs": abs, "sign": lambda v: (v > 0) - (v < 0)}])


def _sample(f, lo: float, hi: float, log_x: bool = False) -> list[float]:
    """Values at evenly spaced x (evenly spaced on a log axis when `log_x`: the same number of samples in
    every decade). Points where the function is undefined or not finite are left out."""
    ys = []
    for i in range(SAMPLES + 1):
        t = i / SAMPLES
        try:
            y = float(f(lo * (hi / lo) ** t if log_x else lo + (hi - lo) * t))
        except Exception:  # division by zero, sqrt of a negative, overflow, complex result
            continue
        if math.isfinite(y):
            ys.append(y)
    return ys


def _quantile(sorted_vals: list[float], q: float) -> float:
    pos = q * (len(sorted_vals) - 1)
    i = int(pos)
    j = min(i + 1, len(sorted_vals) - 1)
    return sorted_vals[i] + (sorted_vals[j] - sorted_vals[i]) * (pos - i)


def _fence(ys: list[float]) -> tuple[float, float]:
    """Bounds outside which a value is an outlier (the spike beside an asymptote)."""
    s = sorted(ys)
    q1, q3 = _quantile(s, 0.25), _quantile(s, 0.75)
    spread = q3 - q1
    if spread <= 0:
        return s[0], s[-1]
    return q1 - FENCE * spread, q3 + FENCE * spread


def _must_show(ys: list[float], lo: float, hi: float) -> list[float]:
    """Heights the window has to include: turning points, and the x-axis if the curve crosses it.

    A turning point is a local high or low that the curve reaches smoothly. The spike beside an asymptote
    also looks like a local high in the samples, but there the neighbouring values are far apart.
    """
    if len(ys) < 3:
        return []
    mid = sorted(ys)[len(ys) // 2]
    keep = []
    for a, b, c in zip(ys, ys[1:], ys[2:]):
        if (b - a) * (c - b) < 0:
            step = max(abs(b - a), abs(c - b))
            if lo <= b <= hi or step <= 0.1 * abs(b - mid):
                keep.append(b)
    if any(a * b <= 0 for a, b in zip(ys, ys[1:]) if lo <= a <= hi and lo <= b <= hi):
        keep.append(0.0)
    return keep


def _nice(v: float, span: float) -> float:
    digits = max(0, 2 - int(math.floor(math.log10(span)))) if span > 0 else 2
    return round(v, digits)


def _window(expressions, x_range, log_x: bool = False):
    """(y_range that shows the curves, heights it must include, the kept sample values), or None."""
    curves = [_sample(_function(e), x_range[0], x_range[1], log_x) for e in expressions]
    every = [y for ys in curves for y in ys]
    if len(every) < 3:
        return None
    lo_f, hi_f = _fence(every)
    kept = [y for y in every if lo_f <= y <= hi_f]
    need = [h for ys in curves for h in _must_show(ys, lo_f, hi_f)]
    lo, hi = min(kept + need), max(kept + need)
    if hi - lo < 1e-9 * max(1.0, abs(lo)):  # a flat line: give it a little height
        half = max(1.0, abs(lo) * 0.5)
        lo, hi = lo - half, hi + half
    else:
        pad = (hi - lo) * PAD
        lo, hi = lo - pad, hi + pad
    return [_nice(lo, hi - lo), _nice(hi, hi - lo)], need, kept


def _shows_curve(y_range, need: list[float], kept: list[float]) -> bool:
    lo, hi = y_range
    inside = sum(1 for y in kept if lo <= y <= hi)
    if inside < 0.5 * len(kept):
        return False  # most of the curve is off the plot
    if (max(kept) - min(kept)) < 0.05 * (hi - lo) and max(kept) - min(kept) > 0:
        return False  # the curve is squashed into a sliver of the window
    return all(lo <= h <= hi for h in need)


def _fix_plot2d(spec: dict) -> dict:
    x_range = _range(spec.get("x_range")) or list(DEFAULT_X)
    if x_range[0] > x_range[1]:
        x_range.reverse()
    if x_range[0] == x_range[1]:
        return spec
    out = dict(spec, x_range=x_range)
    log_x = spec.get("x_log") is True
    out.pop("x_log", None)
    if log_x and x_range[1] > 0:  # a log axis needs a positive range; one that starts at or below 0 gets three decades
        if x_range[0] <= 0:
            x_range[0] = x_range[1] / 1000.0
        out["x_log"] = True
    else:
        log_x = False

    given = _range(spec.get("y_range")) if spec.get("y_range") is not None else None
    usable = given is not None and given[0] < given[1]
    try:
        found = _window(out["expressions"], x_range, log_x)
    except Exception as e:
        log.info("figure window not computed for %s: %s", spec.get("expressions"), e)
        found = None
    if found is None:
        if given is not None and given[0] > given[1]:
            out["y_range"] = [given[1], given[0]]  # at least turn an upside-down range the right way up
        return out
    window, need, kept = found
    if not (usable and _shows_curve(given, need, kept)):
        out["y_range"] = window
    return out


def _fix_surface3d(spec: dict) -> dict:
    xr, yr = _range(spec.get("x_range")), _range(spec.get("y_range"))
    if xr is None and yr is None:
        xr = [-5.0, 5.0]
    xr, yr = xr or list(yr), yr or list(xr)
    return dict(spec, x_range=sorted(xr), y_range=sorted(yr))


def fix_figure(spec):
    """Returns the figure spec with ranges that show the figure. Anything unexpected: the spec unchanged."""
    try:
        if not isinstance(spec, dict):
            return spec
        fixed = dict(spec)
        if isinstance(fixed.get("expressions"), str):
            fixed["expressions"] = [fixed["expressions"]]
        if fixed.get("kind") == "plot2d":
            return _fix_plot2d(fixed)
        if fixed.get("kind") == "surface3d":
            return _fix_surface3d(fixed)
        return spec
    except Exception as e:
        log.warning("fix_figure failed, leaving the spec alone: %s", e)
        return spec
