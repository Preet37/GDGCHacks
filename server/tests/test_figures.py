import math

import pytest

from figures import fix_figure
from models import FigureSpec


def plot(expr, x_range=(-5, 5), **kw):
    return fix_figure({"kind": "plot2d", "expressions": [expr], "x_range": list(x_range), **kw})


def test_parabola_gets_a_window_that_shows_the_vertex_and_roots():
    spec = plot("x^2 - 4")
    lo, hi = spec["y_range"]
    assert lo < -4 and hi >= 21                 # vertex at -4 with room below, arms on screen
    assert lo > -10 and hi < 30                 # padded by about 10%, not more
    FigureSpec.model_validate(spec)


def test_bad_given_windows_are_replaced_good_ones_kept():
    assert plot("x^2 - 4", y_range=[0, 10])["y_range"][0] < -4          # clipped the vertex
    assert plot("x^2 - 4", y_range=[10, -6])["y_range"][0] < -4         # upside down
    assert plot("x^2 - 4", y_range=[-1000, 1000])["y_range"][1] < 30    # curve squashed flat
    assert plot("x^2 - 4", y_range=[100, 200])["y_range"][0] < -4       # curve off screen
    assert plot("x^2 - 4", y_range=[-6, 10])["y_range"] == [-6, 10]     # shows roots and vertex: left alone


@pytest.mark.parametrize("expr, x_range", [("1/x", (-5, 5)), ("tan(x)", (-6.3, 6.3)), ("1/(x - 1)^2", (-5, 5))])
def test_asymptote_does_not_flatten_the_plot(expr, x_range):
    lo, hi = plot(expr, x_range)["y_range"]
    assert math.isfinite(lo) and math.isfinite(hi) and lo < hi
    assert hi - lo < 30


def test_turning_point_is_not_trimmed_as_an_outlier():
    lo, hi = plot("exp(-x^2)")["y_range"]
    assert lo < 0 and hi > 1


def test_constant_gets_some_height():
    lo, hi = plot("3")["y_range"]
    assert lo < 3 < hi and hi - lo >= 1


def test_mathjs_syntax():
    assert plot("2x + 1")["y_range"] == plot("2*x + 1")["y_range"]
    assert plot("y = x^2")["y_range"] == plot("x^2")["y_range"]
    assert plot("sqrt(x)")["y_range"][1] > 2          # undefined for x < 0: those points are skipped
    assert plot("cbrt(x)", (-8, 8))["y_range"][0] < -2
    two = fix_figure({"kind": "plot2d", "expressions": ["sin(x)", "x^2"], "x_range": [-2, 2]})["y_range"]
    assert two[0] < -1 and two[1] > 4


@pytest.mark.parametrize("spec", [
    None, "x^2", 7, {}, {"kind": "plot2d"}, {"kind": "pie", "expressions": ["x"], "x_range": [0, 1]},
    {"kind": "plot2d", "expressions": ["garbage(("], "x_range": [-5, 5]},
    {"kind": "plot2d", "expressions": ["a*x + b"], "x_range": [-5, 5]},
    {"kind": "plot2d", "expressions": ["__import__('os').system('true')"], "x_range": [-5, 5]},
    {"kind": "plot2d", "expressions": [None, 3], "x_range": [-5, 5]},
    {"kind": "plot2d", "expressions": ["x"], "x_range": [2, 2]},
    {"kind": "surface3d", "expressions": ["x*y"], "x_range": "?", "y_range": None},
])
def test_garbage_never_raises_and_adds_no_window(spec):
    out = fix_figure(spec)
    if isinstance(spec, dict) and spec.get("kind") == "plot2d":
        assert out.get("y_range") == spec.get("y_range")
        assert out.get("expressions") == spec.get("expressions")
    elif not isinstance(spec, dict) or spec.get("kind") != "surface3d":
        assert out == spec


def test_code_is_not_evaluated(tmp_path):
    target = tmp_path / "made"
    plot(f"__import__('pathlib').Path('{target}').touch()")
    plot(f"open('{target}', 'w')")
    assert not target.exists()


def test_bad_ranges_are_repaired():
    out = fix_figure({"kind": "plot2d", "expressions": "x", "x_range": ["a", "b"], "y_range": "nope"})
    assert out["expressions"] == ["x"] and out["x_range"] == [-10, 10] and out["y_range"] == [-12, 12]
    assert plot("x", (5, -5))["x_range"] == [-5, 5]


def test_garbage_with_upside_down_window_is_turned_over():
    assert plot("garbage((", y_range=[5, -5])["y_range"] == [-5, 5]


def test_surface_gets_both_ranges():
    base = {"kind": "surface3d", "expressions": ["x^2 + y^2"]}
    assert fix_figure({**base, "x_range": [-3, 3]})["y_range"] == [-3, 3]
    assert fix_figure({**base, "y_range": [-2, 2]})["x_range"] == [-2, 2]
    kept = fix_figure({**base, "x_range": [-3, 3], "y_range": [0, 1]})
    assert kept["x_range"] == [-3, 3] and kept["y_range"] == [0, 1]
    FigureSpec.model_validate(fix_figure({**base, "x_range": [-3, 3]}))


def test_log_axis_is_sampled_in_every_decade():
    from figures import _sample
    # evenly spaced samples would put 99.9% of the points above x = 1 and miss the left of the plot
    ys = _sample(lambda x: x, 0.001, 1000, True)
    assert sum(1 for y in ys if y < 1) == sum(1 for y in ys if y > 1) and abs(ys[0] - 0.001) < 1e-12
    bode = {"kind": "plot2d", "expressions": ["20*log10(abs(1/(x*sqrt(x^2 + 25))))"], "x_range": [0.01, 1000], "x_log": True}
    out = fix_figure(dict(bode))
    lo, hi = out["y_range"]
    assert out["x_log"] is True and hi > 26 and lo < -120            # +26 dB at 0.01, -120 dB at 1000: both on the plot
    assert fix_figure(dict(bode, y_range=[0, 1]))["y_range"] == out["y_range"]      # a bad window is still replaced
    # x_range must be positive on a log axis
    assert fix_figure(dict(bode, x_range=[0, 100]))["x_range"] == [0.1, 100.0]
    assert fix_figure(dict(bode, x_range=[-5, 100]))["x_range"] == [0.1, 100.0]
    assert "x_log" not in fix_figure(dict(bode, x_range=[-10, -1]))                 # no positive part: a plain axis
    assert "x_log" not in fix_figure({"kind": "plot2d", "expressions": ["x^2"], "x_range": [-3, 3], "x_log": False})
