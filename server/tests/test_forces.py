"""check_forces: sum the components with SymPy, solve for unknown magnitudes, report what can't balance."""
import pytest

from forces import check_forces

G = {"m": "2 kg", "g": 9.8}
MG = {"label": "mg", "angle_deg": 270, "magnitude": "m*g"}
N_RAMP = {"label": "N", "angle_deg": 120}   # normal to a 30 degree ramp rising to the right
F_UP = {"label": "f", "angle_deg": 30}      # friction up the slope


def test_demo_e5_ramp_at_rest_missing_friction():
    out = check_forces([MG, N_RAMP], G, None, expected=[MG, N_RAMP, F_UP])
    assert out["verdict"] == "incorrect" and out["balanced"] is False
    assert out["missing_angle_deg"] == pytest.approx(30.0)  # the missing force points up the slope
    assert (out["leftover"]["x"] ** 2 + out["leftover"]["y"] ** 2) ** 0.5 == pytest.approx(9.8, rel=1e-3)  # m g sin 30
    exp = out["expected"]
    assert exp["balanced"] is True
    assert exp["solved"]["f"] == pytest.approx(9.8, rel=1e-3) and exp["solved"]["N"] == pytest.approx(16.974, rel=1e-3)


def test_ramp_at_rest_with_friction_balances():
    out = check_forces([MG, N_RAMP, F_UP], G)
    assert out["verdict"] == "correct" and out["solved"]["f"] == pytest.approx(9.8, rel=1e-3)


def test_ramp_accelerating_down_without_friction_equals_m_a():
    out = check_forces([MG, N_RAMP], G, {"magnitude": 4.9, "angle_deg": 210})  # a = g sin 30 down the slope
    assert out["verdict"] == "correct" and out["solved"]["N"] == pytest.approx(16.974, rel=1e-3)


def test_ramp_accelerating_with_the_wrong_acceleration_does_not_balance():
    assert check_forces([MG, N_RAMP], G, {"magnitude": 2.0, "angle_deg": 210})["verdict"] == "incorrect"


def test_flat_floor_and_a_written_magnitude_is_checked():
    assert check_forces([MG, {"label": "N", "angle_deg": 90}], G)["solved"]["N"] == pytest.approx(19.6)
    wrong = check_forces([MG, {"label": "N", "angle_deg": 90, "magnitude": "15 N"}], G)
    assert wrong["verdict"] == "incorrect" and wrong["leftover"]["y"] == pytest.approx(-4.6)
    right = check_forces([MG, {"label": "N", "angle_deg": 90, "magnitude": "19.6 N"}], G)
    assert right["verdict"] == "correct"


def test_hanging_mass_accelerating_up_solves_tension():
    out = check_forces([MG, {"label": "T", "angle_deg": 90}], G, {"x": 0, "y": 2})
    assert out["solved"]["T"] == pytest.approx(23.6)


def test_expressions_in_givens_and_mg_as_one_word():
    forces = [{"label": "W", "angle_deg": 270, "magnitude": "mg"},
              {"label": "N", "angle_deg": 120, "magnitude": "m*g*cos(30)"},
              {"label": "f", "angle_deg": 30, "magnitude": "mg sin(30)"}]
    assert check_forces(forces, {"m": 2, "g": 9.8})["verdict"] == "correct"


def test_a_pushing_force_cannot_pull():
    # the only way to balance would be a negative normal force: not balanced
    out = check_forces([{"label": "w", "angle_deg": 90, "magnitude": "10 N"}, {"label": "N", "angle_deg": 90}], {})
    assert out["verdict"] == "incorrect"


@pytest.mark.parametrize("forces,givens", [
    ([{"label": "x", "angle_deg": "up"}], G),
    ([{"label": "W", "angle_deg": 270, "magnitude": "m*q"}], {"m": 2}),
    ([], G),
])
def test_unreadable_is_unknown(forces, givens):
    assert check_forces(forces, givens)["verdict"] == "unknown"


def test_an_arrow_labelled_mg_counts_as_m_times_g():
    out = check_forces([{"label": "mg", "angle_deg": 270}, {"label": "N", "angle_deg": 90}], G)
    assert out["verdict"] == "correct" and out["solved"]["N"] == pytest.approx(19.6)


def test_nothing_with_a_size_is_unknown_not_a_fake_balance():
    out = check_forces([{"label": "W", "angle_deg": 270}, {"label": "N", "angle_deg": 90}], {})
    assert out["verdict"] == "unknown" and "nothing to balance" in out["detail"]
