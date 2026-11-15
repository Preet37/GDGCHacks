import pytest
import sympy as sp

import compute
from compute import compute_step
from verify import parse, verify_step


def same(result: str, expected: str) -> bool:
    return sp.simplify(parse(result) - parse(expected)) == 0


@pytest.mark.parametrize("before, relation, expected", [
    ("g(x) = 6*x^2", "derivative", "12*x"),
    ("f(x) = x*sin(x)", "derivative", "sin(x) + x*cos(x)"),
    ("y = 7", "derivative", "0"),
    ("2*x + 4*x", "simplify", "6*x"),
    ("(x^2 - 1)/(x - 1)", "simplify", "x + 1"),
    ("(x + 1)^2 - x^2", "equals", "2*x + 1"),
    ("3*4 + 2 =", "equals", "14"),
    ("2*x + 5 = 11", "solve", "3"),
])
def test_right_answers(before, relation, expected):
    out = compute_step(before, relation)
    assert same(out["result"], expected), out
    assert out["latex"] and set(out) == {"result", "latex", "detail"}


def test_finish_line_example():
    out = compute_step("g(x) = 6*x^2", "derivative")
    assert out["result"] == "12*x" and out["latex"] == "12 x"


def test_integral_has_constant_and_checks_out():
    out = compute_step("f(x) = 3*x^2 + 2*x", "integral")
    assert out["result"].endswith("+ C") and out["latex"].endswith("+ C")
    assert same(out["result"], "x^3 + x^2 + C")
    assert verify_step("f(x) = 3*x^2 + 2*x", "F(x) = " + out["result"], "integral")["verdict"] == "correct"


def test_solve_gives_every_solution_without_the_left_side():
    out = compute_step("x^2 - 4 = 0", "solve")
    assert out["result"] == "-2 or 2" and "=" not in out["result"]
    assert r"\text{ or }" in out["latex"]


@pytest.mark.parametrize("before, relation", [
    ("graph this", "derivative"),      # words
    ("f(x) =", "derivative"),          # a label with no math
    ("", "simplify"),
    ("((", "simplify"),                # unparseable
    ("x^2", "other"),                  # not a relation it can compute
    ("x^2", "start"),
    ("exp(x^x)", "integral"),          # no closed form
    ("5 = 5", "solve"),                # nothing to solve for
])
def test_unknown_is_empty_never_raises(before, relation):
    out = compute_step(before, relation)
    assert out["result"] == "" and out["latex"] == "" and out["detail"]


def test_gives_up_when_sympy_takes_too_long(monkeypatch):
    import threading
    monkeypatch.setattr(compute, "TIMEOUT_S", 0.05)
    monkeypatch.setattr(compute, "_compute", lambda b, r: threading.Event().wait(1) or {})
    assert compute_step("x", "simplify")["result"] == ""


@pytest.mark.parametrize("line, relation, expected", [
    ("int(4*x, x) =", "simplify", "2*x^2 + C"),        # the trace: a one-line problem, relation start, no line before
    ("int(4*x, x) =", "start", "2*x^2 + C"),
    ("integral(3*x^2) =", "equals", "x^3 + C"),
    ("∫ 2x dx", "integral", "x^2 + C"),
    ("integral of 2*x dx =", "start", "x^2 + C"),
    ("F(x) = int(2*x, x) =", "integral", "x^2 + C"),
    ("int(2*x, x, 0, 3) =", "simplify", "9"),
    ("d/dx(x^3) =", "derivative", "3*x^2"),           # not differentiated twice
    ("d/dx x^3 =", "simplify", "3*x^2"),
    ("diff(x*sin(x), x) =", "other", "sin(x) + x*cos(x)"),
    ("derivative of x^2 =", "start", "2*x"),
    ("3*4 + 2 =", "start", "14"),                     # plain arithmetic left of the '='
    ("(x + 1)^2 - x^2 =", "other", "2*x + 1"),
])
def test_open_line_that_is_the_problem(line, relation, expected):
    out = compute_step(line, relation)
    assert same(out["result"], expected), out
    assert out["latex"]


def test_operation_is_read_from_the_line():
    assert compute.operation("int(4*x, x) =") == {"kind": "integral", "expr": "4*x", "var": "x", "limits": None}
    assert compute.operation("d/dt(t^2)")["var"] == "t"
    assert compute.operation("int(x) + int(2*x)") is None
    assert compute.operation("f(x) = 3*x^2") is None and compute.operation("interest = 5") is None
