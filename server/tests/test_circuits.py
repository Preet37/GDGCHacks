import pytest

from circuits import parse_value, solve_circuit


def R(i, a, b, v):
    return {"id": i, "kind": "resistor", "a": a, "b": b, "value": v}


def Vs(i, a, b, v):
    return {"id": i, "kind": "vsource", "a": a, "b": b, "value": v}


def Is(i, a, b, v):
    return {"id": i, "kind": "isource", "a": a, "b": b, "value": v}


def test_voltage_divider():
    out = solve_circuit([Vs("V1", "in", "0", 9), R("R1", "in", "mid", "1k"), R("R2", "mid", "0", "2k")])
    assert out["ok"]
    assert out["node_voltages"]["mid"] == pytest.approx(6.0)
    assert out["currents"]["R1"] == pytest.approx(0.003)
    # source current flows a->b inside the source: from + to -, i.e. -3 mA when it's delivering
    assert out["currents"]["V1"] == pytest.approx(-0.003)
    assert out["power"]["V1"] == pytest.approx(-0.027)  # delivers 27 mW
    assert out["power"]["R1"] + out["power"]["R2"] == pytest.approx(0.027)


def test_current_source_into_resistor():
    # 2 mA pushed from ground into node n through I1, then through 1k back to ground: V(n) = 2 V
    out = solve_circuit([Is("I1", "0", "n", "2mA"), R("R1", "n", "gnd", "1kΩ")])
    assert out["node_voltages"]["n"] == pytest.approx(2.0)


def test_two_sources_superposition():
    # V1=10 V and V2=5 V through 1k each into a shared 1k load: V(x) = (10 + 5) / 3 = 5 V
    out = solve_circuit([
        Vs("V1", "a", "0", 10), R("R1", "a", "x", 1000),
        Vs("V2", "b", "0", 5), R("R2", "b", "x", 1000),
        R("RL", "x", "0", 1000),
    ])
    assert out["node_voltages"]["x"] == pytest.approx(5.0)
    assert out["currents"]["RL"] == pytest.approx(0.005)


def test_series_parallel():
    # 12 V across 2 ohm + (6 || 3 ohm) = 4 ohm total -> 3 A, middle node at 6 V
    out = solve_circuit([Vs("V1", "1", "0", 12), R("R1", "1", "2", 2), R("R2", "2", "0", 6), R("R3", "2", "0", 3)])
    assert out["currents"]["R1"] == pytest.approx(3.0)
    assert out["node_voltages"]["2"] == pytest.approx(6.0)
    assert out["currents"]["R3"] == pytest.approx(2.0)


def test_balanced_bridge_has_no_middle_current():
    out = solve_circuit([
        Vs("V1", "t", "0", 10),
        R("R1", "t", "l", 100), R("R2", "l", "0", 200),
        R("R3", "t", "r", 100), R("R4", "r", "0", 200),
        R("R5", "l", "r", 50),
    ])
    assert out["currents"]["R5"] == pytest.approx(0.0)


def test_power_balances():
    out = solve_circuit([
        Vs("V1", "a", "0", 5), Is("I1", "0", "b", "10m"),
        R("R1", "a", "b", 220), R("R2", "b", "0", 470),
    ])
    assert sum(out["power"].values()) == pytest.approx(0.0, abs=1e-9)


@pytest.mark.parametrize("els,why", [
    ([R("R1", "a", "b", 10)], "ground"),
    ([Vs("V1", "a", "0", 5), R("R1", "a", "0", 10), R("R2", "x", "y", 10)], "single solution"),  # floating
    ([Vs("V1", "a", "0", 5), Vs("V2", "a", "0", 3)], "single solution"),                         # contradictory
    ([Is("I1", "0", "a", 1), Is("I2", "a", "0", 2)], "single solution"),
    ([R("R1", "a", "0", 0)], "positive"),
    ([{"id": "X", "kind": "diode", "a": "a", "b": "0", "value": 1}], "kind"),
    ([], "empty"),
    ([R("R1", "a", "0", 10), R("R1", "a", "0", 10)], "duplicate"),
    ([R("R1", "a", "0", "lots")], "value"),
])
def test_bad_circuits_explain_instead_of_raising(els, why):
    out = solve_circuit(els)
    assert out["ok"] is False
    assert why in out["detail"]


@pytest.mark.parametrize("raw,expected", [
    (9, 9), ("4.7k", 4700), ("10mA", 0.01), ("2.2 kΩ", 2200), ("1M", 1_000_000), ("100u", 0.0001), ("-5V", -5),
])
def test_parse_value(raw, expected):
    assert float(parse_value(raw)) == pytest.approx(expected)
