"""check_units tool (engineering, Part 2): do the two sides of a physics line have the same units and value?

`F = 2*kg * 9.8*m/s = 19.6*N` -> incorrect: the middle side is kg*m/s (a momentum), the right side is N
(kg*m/s^2). Every side with a number and units is converted to SI base units with sympy.physics.units; all such
sides must have the same dimension and, when they have numbers, the same value (1% tolerance). A side that is only
a name (`F`, `a`) is skipped. Anything it can't read is `unknown`; it never raises, so it can't break the teach loop.
"""
import re

import sympy as sp
from sympy.physics import units as u
from sympy.physics.units import convert_to

TOL = 0.01
BASE = [u.kilogram, u.meter, u.second, u.ampere, u.kelvin, u.mole, u.candela]

# Unit names as students write them -> sympy units. Prefixed forms are listed whole, so "m" in "mA" is never metres.
_BASE_UNITS = {
    "kg": u.kilogram, "g": u.gram, "mg": u.milligram,
    "m": u.meter, "km": u.kilometer, "cm": u.centimeter, "mm": u.millimeter, "um": u.micrometer, "µm": u.micrometer,
    "s": u.second, "ms": u.millisecond, "us": u.microsecond, "µs": u.microsecond, "min": u.minute, "h": u.hour,
    "N": u.newton, "kN": 1000 * u.newton,
    "J": u.joule, "kJ": 1000 * u.joule,
    "W": u.watt, "kW": 1000 * u.watt, "mW": u.watt / 1000,
    "Pa": u.pascal, "kPa": 1000 * u.pascal,
    "Hz": u.hertz, "kHz": 1000 * u.hertz, "MHz": 10**6 * u.hertz,
    "V": u.volt, "kV": 1000 * u.volt, "mV": u.volt / 1000,
    "A": u.ampere, "mA": u.ampere / 1000, "uA": u.ampere / 10**6, "µA": u.ampere / 10**6,
    "ohm": u.ohm, "Ω": u.ohm, "kΩ": 1000 * u.ohm, "kohm": 1000 * u.ohm, "MΩ": 10**6 * u.ohm,
    "C": u.coulomb, "F": u.farad, "uF": u.farad / 10**6, "µF": u.farad / 10**6,
    "K": u.kelvin, "mol": u.mole,
}
_TOKEN = re.compile(r"[A-Za-zΩµ]+")


class _Unreadable(Exception):
    pass


def _parse_side(side: str):
    """A side of the equation -> (SI magnitude, SI unit expression), or None if it is just a name (no number)."""
    s = side.strip().replace("·", "*").replace("×", "*").replace("−", "-").replace("^", "**").replace("²", "**2")
    if not s:
        raise _Unreadable("empty side")
    names = _TOKEN.findall(s)
    if not re.search(r"\d", s):
        return None  # a label like F or a_net: nothing to check
    local = {}
    for i, name in enumerate(dict.fromkeys(names)):
        if name not in _BASE_UNITS:
            raise _Unreadable(f"'{name}' is not a unit I know")
        local[name] = sp.Symbol(f"__u{i}")
    # implicit multiplication between a number and a unit: "9.8m/s**2" -> "9.8*m/s**2"
    s = re.sub(r"(\d)\s*([A-Za-zΩµ(])", r"\1*\2", s)
    s = re.sub(r"\)\s*([A-Za-zΩµ\d(])", r")*\1", s)
    for name in sorted(local, key=len, reverse=True):
        s = re.sub(rf"(?<![A-Za-zΩµ_]){re.escape(name)}(?![A-Za-zΩµ_])", str(local[name]), s)
    try:
        expr = sp.sympify(s, locals={str(v): v for v in local.values()})
    except Exception as e:
        raise _Unreadable(f"can't read '{side.strip()}'") from e
    expr = expr.subs({v: _BASE_UNITS[k] for k, v in local.items()})
    si = convert_to(expr, BASE)
    number, unit = si.as_coeff_Mul()
    return float(number), sp.simplify(unit)


NAMED = [("N", u.newton), ("J", u.joule), ("W", u.watt), ("V", u.volt), ("Ω", u.ohm), ("Pa", u.pascal),
         ("C", u.coulomb), ("Hz", u.hertz), ("m/s", u.meter / u.second), ("m/s^2", u.meter / u.second**2)]


def _show(unit) -> str:
    """'kg*m/s^2' -> 'N (kg*m/s^2)': the name a student would know, when there is one."""
    base = _base_text(unit)
    for name, named in NAMED:
        if sp.simplify(convert_to(named, BASE) / unit) == 1 and name != base:
            return f"{name} ({base})"
    return base


def _base_text(unit) -> str:
    text = str(unit).replace("kilogram", "kg").replace("meter", "m").replace("second", "s").replace("ampere", "A")
    text = text.replace("kelvin", "K").replace("mole", "mol").replace("candela", "cd").replace("**", "^")
    return "no units" if text == "1" else text


def check_units(expression: str) -> dict:
    """{"verdict": "correct" | "incorrect" | "unknown", "detail": str} for one line with units."""
    try:
        sides = [p for p in str(expression).split("=")]
        if len(sides) < 2:
            return {"verdict": "unknown", "detail": "no '=' to compare"}
        measured = []  # (side text, magnitude, unit)
        for side in sides:
            q = _parse_side(side)
            if q is not None:
                measured.append((side.strip(), *q))
        if len(measured) < 2:
            return {"verdict": "unknown", "detail": "fewer than two sides with numbers and units"}
        first_text, first_mag, first_unit = measured[0]
        for text, mag, unit in measured[1:]:
            if sp.simplify(unit / first_unit) != 1:
                return {"verdict": "incorrect",
                        "detail": f"units differ: '{first_text}' is {_show(first_unit)}, '{text}' is {_show(unit)}"}
            if abs(mag - first_mag) > TOL * max(abs(mag), abs(first_mag), 1e-12):
                return {"verdict": "incorrect",
                        "detail": f"same units ({_show(unit)}) but the values differ: {first_mag:g} vs {mag:g}"}
        return {"verdict": "correct", "detail": f"every side is {_show(first_unit)} and they agree"}
    except _Unreadable as e:
        return {"verdict": "unknown", "detail": str(e)}
    except Exception as e:  # never break the teach loop
        return {"verdict": "unknown", "detail": f"units error: {type(e).__name__}"}
