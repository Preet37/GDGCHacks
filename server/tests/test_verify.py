import pytest

from verify import verify_step


def v(before, after, relation):
    return verify_step(before, after, relation)["verdict"]


# The brief's acceptance case
def test_wrong_derivative_is_incorrect():
    assert v("f(x) = 3*x^2 + 2*x", "f'(x) = 6*x + 1", "derivative") == "incorrect"


def test_right_derivative_is_correct():
    assert v("f(x) = 3*x^2 + 2*x", "f'(x) = 6*x + 2", "derivative") == "correct"


@pytest.mark.parametrize("before,after,rel,expected", [
    # equals / simplify
    ("(x+1)^2", "x^2 + 2*x + 1", "equals", "correct"),
    ("(x+1)^2", "x^2 + 1", "equals", "incorrect"),
    ("y = 2*(x - 3)", "y = 2*x - 6", "simplify", "correct"),
    ("y = 2*(x - 3)", "y = 2*x - 3", "simplify", "incorrect"),
    ("sin(x)^2 + cos(x)^2", "1", "simplify", "correct"),
    ("(x^2 - 1)/(x - 1)", "x + 1", "simplify", "correct"),
    # implicit multiplication and unicode the reader might produce
    ("f(x) = 3x² + 2x", "f'(x) = 6x + 2", "derivative", "correct"),
    ("2(x − 3)", "2x − 6", "equals", "correct"),
    # derivative
    ("f(x) = x*sin(x)", "f'(x) = sin(x) + x*cos(x)", "derivative", "correct"),
    ("f(x) = x*sin(x)", "f'(x) = cos(x)", "derivative", "incorrect"),
    ("g(t) = exp(2*t)", "g'(t) = 2*exp(2*t)", "derivative", "correct"),
    ("d/dx(x^3)", "3*x^2", "equals", "correct"),
    ("y = ln(x)", "dy/dx = 1/x", "derivative", "correct"),
    # integral (constant allowed)
    ("4*x", "2*x^2 + C", "integral", "correct"),
    ("4*x", "2*x^2", "integral", "correct"),
    ("4*x", "4*x^2 + C", "integral", "incorrect"),
    ("cos(x)", "sin(x) + C", "integral", "correct"),
    ("cos(x)", "-sin(x) + C", "integral", "incorrect"),
    # solve: equation steps and final answers
    ("2*x + 5 = 11", "2*x = 6", "solve", "correct"),
    ("2*x + 5 = 11", "2*x = 16", "solve", "incorrect"),
    ("2*x + 5 = 11", "x = 3", "solve", "correct"),
    ("2*x + 5 = 11", "x = 8", "solve", "incorrect"),
    ("x^2 - 5*x + 6 = 0", "x = 2, x = 3", "solve", "correct"),
    ("x^2 - 5*x + 6 = 0", "x = 2 or x = 4", "solve", "incorrect"),
    ("3*x - 7 = 2", "3*x = -5", "equals", "incorrect"),   # sign error, labeled as equals
    ("3*x - 7 = 2", "3*x = 9", "equals", "correct"),
])
def test_relations(before, after, rel, expected):
    assert v(before, after, rel) == expected


def test_missing_root_is_noted():
    out = verify_step("x^2 = 4", "x = 2", "solve")
    assert out["verdict"] == "correct"
    assert "x = -2" in out["detail"]


@pytest.mark.parametrize("before,after,rel", [
    ("f(x) = 3*x^2", "f'(x) = 6*x", "other"),
    ("f(x) = 3*x^2", "f'(x) = 6*x", "start"),
    ("f(x) = 3*x^^2", "f'(x) = 6*x", "derivative"),      # parse error
    ("", "x", "equals"),
    ("the area is", "big", "equals"),
])
def test_unknown_instead_of_guessing(before, after, rel):
    assert v(before, after, rel) == "unknown"


def test_never_raises_and_shape():
    out = verify_step("((", "))", "derivative")
    assert set(out) == {"verdict", "detail"}
    assert out["verdict"] == "unknown"
