"""check_units: same dimension and (when given) the same value on every side, SymPy units, never raises."""
import pytest

from units import check_units


def v(e):
    return check_units(e)["verdict"]


def test_demo_e4_wrong_units_for_acceleration():
    out = check_units("F = 2*kg * 9.8*m/s = 19.6*N")
    assert out["verdict"] == "incorrect"
    assert "N (kg*m/s^2)" in out["detail"]  # names the unit the student should know


@pytest.mark.parametrize("expr,verdict", [
    ("F = 2*kg * 9.8*m/s^2 = 19.6*N", "correct"),       # right dimension, right number
    ("F = 5 kg * 9.8 m/s^2 = 49 N", "correct"),          # spaces instead of *
    ("F = 5 kg * 9.8 m/s^2 = 50 N", "incorrect"),        # right dimension, wrong number (2% off)
    ("F = 5 kg * 9.8 m/s^2 = 49.2 N", "correct"),        # within 1%
    ("V = 3 mA * 2 kΩ = 6 V", "correct"),                # prefixes: milli, kilo
    ("V = 3 mA * 2 kΩ = 6 A", "incorrect"),              # wrong unit
    ("P = 9 V * 3 mA = 27 mW", "correct"),
    ("d = 60 km/h * 2 h = 120 km", "correct"),
    ("v = 10 m/s = 36 km/h", "correct"),                 # unit conversion
    ("E = 2 kg * (3 m/s)^2 / 2 = 9 J", "correct"),
    ("F = 2 kg * 9.8 m/s^2 = 19.6", "incorrect"),        # units left off the answer
])
def test_relations(expr, verdict):
    assert v(expr) == verdict


@pytest.mark.parametrize("expr", ["x = 3 apples = 2", "F = m*a", "49 N", "", "F = ((", "a = 3 furlongs/fortnight = 1 m/s"])
def test_unreadable_is_unknown_never_raises(expr):
    assert v(expr) == "unknown"


def test_detail_names_volts():
    assert "V (" in check_units("V = 3 mA * 2 kΩ = 6 A")["detail"]
