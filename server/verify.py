"""verify_step tool that Gemini calls during the teach step.

Stub for now. Parsh replaces the body with a SymPy checker later. Keep the signature exactly as is.
"""


def verify_step(before: str, after: str, relation: str) -> dict:
    """Check whether `after` follows from `before` by `relation`.

    before, after: lines in plain calculator syntax, e.g. "f(x) = 3*x^2 + 2*x".
    relation: one of "equals", "simplify", "derivative", "integral", "solve", "other".
    Returns {"verdict": "correct" | "incorrect" | "unknown", "detail": str}.
    """
    return {"verdict": "unknown", "detail": "checker not built yet"}
