"""Explain step ("Teach me"): Gemini writes one short narrated, animated lesson about the problem in view.

Same shape as teach.py: text only, function calling. Gemini may call compute_step and verify_step so the
worked math is computed rather than guessed, then finishes with submit_lesson. How to teach lives in
prompts/explain.md. The code here only picks the problem, checks the student's lines up front, and makes
whatever comes back safe to play: speech-safe narration, plots with a window, marks that sit on the plot.
"""
import json
import logging
import math
import pathlib
import re
from typing import Any

import gemini
import sympy as sp
from google.genai import types
from pydantic import ValidationError

import compute
import practice as practice_mod
import solution
import teach
import verify
from figures import _function, fix_figure
from internal import TeachResult
import memory
from target import pick_line
from models import Action, CheckRequest, Lesson, LessonStep, LessonVisual, Practice, ReadLine
from verify import LABEL, ParseError, equation, is_equation, is_zero, split_line, value

log = logging.getLogger(__name__)

PROMPT_PATH = pathlib.Path(__file__).resolve().parent / "prompts" / "explain.md"
MAX_ROUNDS = 5
MIN_STEPS, MAX_STEPS = 6, 9
PLAYABLE_STEPS = 3  # a lesson shorter than MIN_STEPS is sent back once; after that this many steps will do
MAX_MARKS = 6
SLACK = 0.25  # a mark this share of the x range outside it is pulled to the edge; further out it is dropped

MARK_TYPES = ("point", "tangent", "secant", "area", "vline", "hline", "label")
COLORS = ("red", "green", "blue", "black")

# ---- JSON schema for submit_lesson: Lesson, LessonStep, LessonVisual, LessonMark from contract/contract.ts ----

_PAIR = {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}

_MARK = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": list(MARK_TYPES)},
        "expr": {"type": "integer", "description": "index into this visual's expressions (default 0)"},
        "x": {"type": "number", "description": "point/tangent/vline/label: where. secant/area: left end"},
        "x2": {"type": "number", "description": "secant/area: right end"},
        "y": {"type": "number", "description": "hline: its height. label: height, if not on the curve"},
        "to_x": {"type": "number", "description": "animate x from `x` to here while the step plays"},
        "to_x2": {"type": "number", "description": "animate x2 from `x2` to here while the step plays"},
        "text": {"type": "string", "description": "label only: a few plain words"},
        "color": {"type": "string", "enum": list(COLORS)},
    },
    "required": ["type"],
}

_VISUAL = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["plot2d", "surface3d"]},
        "expressions": {"type": "array", "items": {"type": "string"},
                        "description": "math.js syntax in x, e.g. 'x^2 - 4', '2*x + 6'. No 'y =' prefix. "
                                       "surface3d: one expression in x and y"},
        "x_range": _PAIR,
        "y_range": _PAIR,
        "x_log": {"type": "boolean", "description": "true = logarithmic x axis (x_range must be positive): "
                                                    "frequency plots, anything spanning several powers of ten"},
        "marks": {"type": "array", "items": _MARK, "description": "plot2d only: drawn on top of the plot"},
    },
    "required": ["kind", "expressions", "x_range"],
}

_STEP = {
    "type": "object",
    "properties": {
        "say": {"type": "string", "description": "narration, read aloud: two or three sentences of plain spoken words, "
                                                 "no LaTeX, no symbols, up to about 45 words"},
        "write": {"type": "string", "description": "one line of worked math for this step, LaTeX, no $"},
        "caption": {"type": "string", "description": "short on-screen text, plain words, inline math in $...$"},
        "visual": _VISUAL,
    },
    "required": ["say"],
}

PRACTICE_RELATIONS = compute.RELATIONS + ("other",)

_PRACTICE = {
    "type": "object",
    "description": "Your turn: one fresh problem of the same kind as the one just taught, for the student to "
                   "solve by hand under their work. Not their own problem, not the lesson's worked example",
    "properties": {
        "prompt": {"type": "string", "description": "what to do, plain words, no math: 'Your turn: find the derivative.'"},
        "problem": {"type": "string", "description": "the problem as one line of LaTeX, no $ and no words: 'g(x) = x^3 - 5x'"},
        "plain": {"type": "string", "description": "the same line in calculator syntax: 'g(x) = x^3 - 5*x'"},
        "relation": {"type": "string", "enum": list(PRACTICE_RELATIONS),
                     "description": "what the student must do to it; `other` only if it is none of the rest"},
        "ask": {"type": "string", "description": "optional: the line the student completes, LaTeX, ending in '=': \"g'(x) =\""},
    },
    "required": ["prompt", "problem", "plain", "relation"],
}

VERIFY_DECL = types.FunctionDeclaration(
    name="verify_step",
    description="Check with real math whether line `after` follows from line `before` by `relation`. Use it to "
                "check a line of your own worked math before you put it in `write`.",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "before": {"type": "string", "description": "the earlier line, plain calculator syntax"},
            "after": {"type": "string", "description": "the line being checked, plain calculator syntax"},
            "relation": {"type": "string", "enum": ["equals", "simplify", "derivative", "integral", "solve"]},
        },
        "required": ["before", "after", "relation"],
    },
)

COMPUTE_DECL = types.FunctionDeclaration(
    name="compute_step",
    description="Work out with real math what follows from `before` by `relation`. Returns `result` (plain) and "
                "`latex`. Use it for every result you show in a `write` line. Empty result = couldn't.",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "before": {"type": "string", "description": "what to work from, plain calculator syntax: 'x^3', "
                                                        "'2*x + 6 = 14', 'int(4*x, x)'"},
            "relation": {"type": "string", "enum": list(compute.RELATIONS)},
        },
        "required": ["before", "relation"],
    },
)

SUBMIT_DECL = types.FunctionDeclaration(
    name="submit_lesson",
    description="Finish: send the lesson for the page to play. Call exactly once.",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "short, says what the lesson shows"},
            "steps": {"type": "array", "items": _STEP, "minItems": MIN_STEPS, "maxItems": MAX_STEPS},
            "practice": _PRACTICE,
            "line_id": {"type": "string", "description": "the line of the student's problem to place the lesson beside"},
        },
        "required": ["title", "steps", "practice"],
    },
)


def _build_config(thinking=None) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=PROMPT_PATH.read_text(),  # loaded per call so prompt edits apply live
        tools=[types.Tool(function_declarations=[COMPUTE_DECL, VERIFY_DECL, SUBMIT_DECL])],
        tool_config=types.ToolConfig(function_calling_config=types.FunctionCallingConfig(mode="ANY")),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        thinking_config=thinking,
        temperature=0.4,
    )


# ---- which problem the student is looking at (the same rule as help mode: target.pick_line) ----

def pick_target(lines: list[ReadLine], help_box=None) -> tuple[list[ReadLine], ReadLine | None, ReadLine | None]:
    """(the lines of the problem to explain, the line to place the lesson beside, the line pointed at).

    The target is the line `help_box` lies on or sits nearest to, printed lines included; else the latest
    handwritten line; else the first printed line in view. The anchor is that problem's last handwritten
    line, or the target itself if the problem has no handwriting yet.
    """
    chosen = pick_line(lines, help_box)
    if chosen is None:
        return [], None, None
    problem = [l for l in lines if l.problem_id == chosen.problem_id]
    own = [l for l in problem if l.source != "printed"]
    return problem, (own[-1] if own else chosen), chosen


def pick_problem(lines: list[ReadLine], help_box=None) -> tuple[list[ReadLine], ReadLine | None]:
    return pick_target(lines, help_box)[:2]


def _check_problem(problem: list[ReadLine], lines: list[ReadLine], result: TeachResult) -> list[dict]:
    """verify_step on each line of the student's work, so the lesson knows where it went wrong."""
    checks = []
    own = [l for l in problem if l.source != "printed" or practice_mod.is_given(l)]  # a practice problem's work starts from its given line
    for before, after in zip(own, own[1:]):
        if after.relation in ("start", "other") or teach.is_open(after.plain):
            continue
        out = teach._run_verify({"before": before.plain, "after": after.plain, "relation": after.relation,
                                 "before_line_id": before.line_id, "after_line_id": after.line_id}, lines, result)
        checks.append({"line_id": after.line_id, "follows_from": before.line_id, "relation": after.relation, **out})
    return checks


LINEAR = ("derivative", "integral")  # done term by term, so a lesson can explain each piece
MAX_TERMS = 6


def _precompute(problem: list[ReadLine], target: ReadLine | None, result: TeachResult) -> list[dict]:
    """Work out with the math engine, before Gemini starts, what a lesson about `target` will need: the right
    result of the target's step and, for a derivative or integral of a sum, each term's. Gemini otherwise asks
    for these one tool round at a time (1-3 s each). General by relation, nothing topic-specific."""
    if target is None or target.source == "printed" or target.relation not in compute.RELATIONS:
        return []
    own = [l for l in problem if l.source != "printed"]
    i = next((k for k, l in enumerate(own) if l.line_id == target.line_id), None)
    if i is None:
        return []
    before = own[i - 1] if i > 0 else target  # a one-line problem (int(4*x, x) =) carries its own math
    done = []
    try:
        out = compute.compute_step(before.plain, target.relation)
        if out.get("result"):
            done.append({"what": f"{target.relation} of {before.line_id} ({before.plain})",
                         "result": out["result"], "latex": out.get("latex", "")})
            if target.relation in LINEAR and before is not target:
                expr = verify.value(before.plain)
                terms = sp.Add.make_args(sp.expand(expr))
                if 1 < len(terms) <= MAX_TERMS:
                    for term in terms:
                        part = compute.compute_step(compute._plain(term), target.relation)
                        if part.get("result"):
                            done.append({"what": f"{target.relation} of the term {compute._plain(term)}",
                                         "result": part["result"], "latex": part.get("latex", "")})
    except Exception:  # precomputing is only a shortcut; Gemini can still call the tools
        log.exception("explain precompute failed")
    if done:
        result.tool_calls.append(f"precompute({target.line_id}, {target.relation}) = {done[0]['result']}"
                                 + (f" +{len(done) - 1} terms" if len(done) > 1 else ""))
    return done


def _page_json(lines: list[ReadLine], req: CheckRequest, problem: list[ReadLine], anchor: ReadLine,
               checks: list[dict], target: ReadLine | None = None, math_done: list[dict] | None = None) -> str:
    def brief(l: ReadLine) -> dict:
        return {"line_id": l.line_id, "problem_id": l.problem_id, "latex": l.latex, "plain": l.plain,
                "relation": l.relation, "source": l.source or "handwriting"}
    ids = {l.line_id for l in problem}
    target = target or anchor
    at = next((i for i, l in enumerate(lines) if l.line_id == target.line_id), len(lines))
    return json.dumps({
        "target_line_id": target.line_id,
        "problem": [brief(l) for l in problem],
        "checks": checks,
        "math_already_done": {
            "results": math_done or [],
            "note": ("Worked out and checked by the math engine already. Use these results as they are; do not call "
                     "compute_step or verify_step for them again. If nothing else needs computing, go straight to "
                     "submit_lesson."),
        } if math_done else None,
        "anchor_line_id": anchor.line_id,
        "question": req.question,
        "recent": memory.recent_turns(req.state.page_id) or None,
        "other_lines_on_the_page": [dict(brief(l), where="above the target" if i < at else "below the target")
                                    for i, l in enumerate(lines) if l.line_id not in ids],
    }, indent=1)


# ---- narration the page can read aloud ----

_SPEAKABLE = {"pi", "theta", "alpha", "beta", "gamma", "delta", "lambda", "mu", "sigma", "omega", "phi",
              "sin", "cos", "tan", "sec", "csc", "cot", "ln", "log", "exp", "lim"}
_COMMAND_WORDS = {"cdot": " times ", "times": " times ", "div": " divided by ", "pm": " plus or minus ",
                  "le": " is at most ", "leq": " is at most ", "ge": " is at least ", "geq": " is at least ",
                  "ne": " is not ", "neq": " is not ", "approx": " is about ", "to": " goes to ",
                  "rightarrow": " goes to ", "infty": " infinity ", "int": " the integral of ",
                  "sqrt": " the square root of ", "sum": " the sum of "}
_SYMBOL_WORDS = {"²": " squared", "³": " cubed", "√": " the square root of ", "π": " pi ", "∫": " the integral of ",
                 "×": " times ", "·": " times ", "÷": " divided by ", "≤": " is at most ", "≥": " is at least ",
                 "≠": " is not ", "≈": " is about ", "→": " goes to ", "∞": " infinity ", "−": "-", "–": "-",
                 "′": "'", "θ": " theta ", "ω": " omega ", "Ω": " omega ", "α": " alpha ", "β": " beta ", "γ": " gamma ",
                 "δ": " delta ", "Δ": " delta ", "λ": " lambda ", "μ": " mu ", "σ": " sigma ", "τ": " tau ",
                 "φ": " phi ", "ζ": " zeta ", "°": " degrees ", "±": " plus or minus "}


def speech_safe(text: Any) -> str:
    """Narration as plain spoken words: no '$', no backslashes, no LaTeX commands, no bare math symbols."""
    s = str(text or "")
    for sym, word in _SYMBOL_WORDS.items():
        s = s.replace(sym, word)
    for _ in range(3):  # nested fractions and roots, inside out
        s = re.sub(r"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r" \1 over \2 ", s)
        s = re.sub(r"\\sqrt\s*\{([^{}]*)\}", r" the square root of \1 ", s)
    s = re.sub(r"\\([A-Za-z]+)",
               lambda m: _COMMAND_WORDS.get(m.group(1), f" {m.group(1)} " if m.group(1) in _SPEAKABLE else " "), s)
    s = re.sub(r"\^\s*(?:\{\s*2\s*\}|2(?!\d|\.\d))", " squared", s)
    s = re.sub(r"\^\s*(?:\{\s*3\s*\}|3(?!\d|\.\d))", " cubed", s)
    s = re.sub(r"\^\s*\{([^{}]*)\}", r" to the power \1", s)
    s = re.sub(r"\^\s*(-?\w+)", r" to the power \1", s)
    s = re.sub(r"\b([A-Za-z])''\(\s*([A-Za-z])\s*\)", r"\1 double prime of \2", s)
    s = re.sub(r"\b([A-Za-z])'\(\s*([A-Za-z])\s*\)", r"\1 prime of \2", s)
    s = re.sub(r"\b([fghFGH])\(\s*([A-Za-z])\s*\)", r"\1 of \2", s)
    s = re.sub(r"(\d)\s*/\s*(\d)", r"\1 over \2", s)
    s = re.sub(r"(?<=\S)\s+-\s+(?=\S)", " minus ", s)
    s = re.sub(r"(?<![\w)])-(?=[\d(A-Za-z])", "negative ", s)
    for sym, word in (("=", " equals "), ("+", " plus "), ("*", " times "), ("<", " is less than "),
                      (">", " is greater than ")):
        s = s.replace(sym, word)
    s = re.sub(r"[$\\{}_^|~`]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"\s+([,.;:!?])", r"\1", s)


# ---- visuals: a window that shows the curve, marks that sit on the plot ----

def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _expression(e: Any) -> list[str]:
    """One expression as the page can plot it. An equation becomes its two sides (two curves that cross)."""
    left, right = split_line(str(e))
    right = re.sub(r"\bln\(", "log(", right.replace("**", "^"))
    if left is None or LABEL.match(left) or not left:
        return [right] if right else []
    return [re.sub(r"\bln\(", "log(", left.replace("**", "^")), right]


def _value(f, x: float) -> float | None:
    try:
        return _num(f(x))
    except Exception:
        return None


def _into(v: float | None, lo: float, hi: float, always: bool = False) -> float | None:
    """v if it is on the plot, the nearest edge if it is just off it (or `always`), else None."""
    if v is None:
        return None
    if lo <= v <= hi:
        return v
    if always or min(abs(v - lo), abs(v - hi)) <= SLACK * (hi - lo):
        return min(max(v, lo), hi)
    return None


def _clean_mark(m: Any, fns: list, index: dict, x_range, y_range: list) -> dict | None:
    if not isinstance(m, dict) or m.get("type") not in MARK_TYPES:
        return None
    kind = m["type"]
    lo, hi = x_range
    out: dict = {"type": kind}
    if m.get("color") in COLORS:
        out["color"] = m["color"]

    x, x2, y = _into(_num(m.get("x")), lo, hi), _into(_num(m.get("x2")), lo, hi), _num(m.get("y"))
    to_x, to_x2 = _into(_num(m.get("to_x")), lo, hi, True), _into(_num(m.get("to_x2")), lo, hi, True)

    on_curve = kind in ("point", "tangent", "secant", "area") or (kind == "label" and y is None)
    if on_curve:
        try:
            i = index.get(int(m.get("expr") or 0))
        except (TypeError, ValueError):
            i = None
        if i is None:
            return None  # points at an expression this visual does not have
        out["expr"] = i
        f = fns[i]

    if kind in ("point", "tangent", "vline", "label"):
        if x is None:
            return None
        out["x"] = x
        if to_x is not None and kind != "label" and to_x != x:
            out["to_x"] = to_x
    if kind in ("secant", "area"):
        if x is None or x2 is None:
            return None
        if to_x is not None and to_x != x:
            out["to_x"] = to_x
        if to_x2 is not None and to_x2 != x2:
            out["to_x2"] = to_x2
        if kind == "secant":
            gap = 0.01 * (hi - lo)
            if abs(x2 - x) < gap:
                return None  # two points on top of each other have no line through them
            end_x, end_x2 = out.get("to_x", x), out.get("to_x2", x2)
            if abs(end_x2 - end_x) < gap:  # a secant closing in stops just short, so it still has a slope
                out["to_x2"] = end_x + (gap if x2 > x else -gap)
        out["x"], out["x2"] = x, x2
    if kind == "hline":
        if y is None:
            return None
    if kind == "label":
        text = str(m.get("text") or "").strip()
        if not text:
            return None
        out["text"] = speech_safe(text)[:60]

    if on_curve:  # the curve has to exist where the mark starts and where it ends up
        spots = [out.get("x"), out.get("to_x")] + ([out.get("x2"), out.get("to_x2")] if kind == "secant" else [])
        if any(_value(f, v) is None for v in spots if v is not None):
            return None
    if y is not None and kind in ("hline", "label"):
        ylo, yhi = y_range
        if not ylo <= y <= yhi:
            if min(abs(y - ylo), abs(y - yhi)) > (yhi - ylo):
                return None  # far off the plot: showing it would squash the curve
            pad = 0.05 * (yhi - ylo)
            y_range[0], y_range[1] = min(ylo, y - pad), max(yhi, y + pad)
        out["y"] = y
    return out


def clean_visual(raw: Any) -> LessonVisual | None:
    """A visual the page can draw, or None. Never raises."""
    try:
        if not isinstance(raw, dict) or raw.get("kind") not in ("plot2d", "surface3d"):
            return None
        given = raw.get("expressions")
        given = [given] if isinstance(given, str) else list(given or [])
        if raw["kind"] == "surface3d":
            exprs = [x for e in given[:1] for x in _expression(e)[-1:]]
            if not exprs:
                return None
            spec = fix_figure({"kind": "surface3d", "expressions": exprs,
                               "x_range": raw.get("x_range"), "y_range": raw.get("y_range")})
            return LessonVisual.model_validate(spec)

        exprs, fns, index = [], [], {}  # index: the model's expression number -> ours, after dropping bad ones
        for i, e in enumerate(given):
            for part in _expression(e):
                try:
                    f = _function(part)
                except Exception:
                    continue
                index.setdefault(i, len(exprs))
                exprs.append(part)
                fns.append(f)
        if not exprs:
            return None
        spec = fix_figure({"kind": "plot2d", "expressions": exprs, "x_range": raw.get("x_range"),
                           "y_range": raw.get("y_range"), "x_log": raw.get("x_log") is True})
        xr, yr = spec.get("x_range"), spec.get("y_range")
        if not xr or not yr or not xr[0] < xr[1] or not yr[0] < yr[1]:
            return None  # no window that shows the curve
        yr = list(yr)
        marks = []
        for m in raw.get("marks") if isinstance(raw.get("marks"), list) else []:
            mark = _clean_mark(m, fns, index, xr, yr)
            if mark is not None and len(marks) < MAX_MARKS:
                marks.append(mark)
        return LessonVisual.model_validate({"kind": "plot2d", "expressions": exprs, "x_range": xr, "y_range": yr,
                                            "x_log": True if spec.get("x_log") else None, "marks": marks})
    except Exception as e:
        log.warning("dropping lesson visual %s: %s", raw, e)
        return None


def _text(v: Any) -> str | None:
    s = str(v).strip() if isinstance(v, (str, int, float)) else ""
    return s or None


def build_lesson(args: dict) -> tuple[Lesson | None, list[str]]:
    """(the lesson made safe to play, what was wrong with it). None if there is nothing playable."""
    problems: list[str] = []
    steps: list[LessonStep] = []
    raw_steps = args.get("steps") if isinstance(args.get("steps"), list) else []
    for n, raw in enumerate(raw_steps, 1):
        say = speech_safe(raw.get("say")) if isinstance(raw, dict) else ""
        if not say:
            problems.append(f"step {n} has no `say`")
            continue
        write = _text(raw.get("write"))
        if write:
            write = write.strip("$").strip() or None
        visual = None
        if raw.get("visual") is not None:
            visual = clean_visual(raw["visual"])
            if visual is None:
                problems.append(f"step {n}: the visual could not be drawn (use math.js expressions in x)")
        try:
            steps.append(LessonStep(say=say, write=write, caption=_text(raw.get("caption")), visual=visual))
        except ValidationError as e:
            problems.append(f"step {n} is not valid: {e.errors()[0].get('msg', '')}")
    if len(raw_steps) > MAX_STEPS:
        problems.append(f"only the first {MAX_STEPS} steps are played")
    steps = steps[:MAX_STEPS]
    if not steps:
        return None, problems or ["no steps"]
    if len(steps) < MIN_STEPS:
        problems.append(f"a lesson needs {MIN_STEPS} to {MAX_STEPS} steps, this has {len(steps)}")
    if not any(s.visual for s in steps):
        problems.append("no step has a visual")
    return Lesson(title=_text(args.get("title")) or "Step by step", steps=steps), problems


# ---- Your turn: the practice problem that ends the lesson ----

def _math_text(plain: str) -> str:
    """The math of a problem line as text. A line that names its own operation ('int(6*x, x)') is math too."""
    plain = (plain or "").strip()
    return plain if compute.operation(plain) is not None else solution.math_part(plain)


def _math(plain: str):
    """The math of a problem line as SymPy (an equation as lhs - rhs), or None if it does not parse."""
    text = _math_text(plain)
    if not text:
        return None
    try:
        op = compute.operation(text)
        if op is not None:
            return value(op["expr"])
        return equation(text) if is_equation(text) else value(text)
    except ParseError:
        return None
    except Exception:  # SymPy raises many kinds
        return None


def _same_problem(a: str, b: str) -> bool:
    """True if two problem lines are the same problem: the same text, or the same math under another name
    ('g(x) = x^2' and 'f(x) = x^2')."""
    if practice_mod.key(a) == practice_mod.key(b):
        return True
    ta, tb = _math_text(a), _math_text(b)
    if not ta or not tb or is_equation(ta) != is_equation(tb):
        return False
    oa, ob = compute.operation(ta), compute.operation(tb)
    if (oa is None) != (ob is None) or (oa is not None and oa["kind"] != ob["kind"]):
        return False
    ma, mb = _math(a), _math(b)
    if ma is None or mb is None or ma.free_symbols != mb.free_symbols:
        return False
    try:
        return is_zero(ma - mb) is True
    except Exception:
        return False


def check_practice(raw: Any, problem: list[ReadLine], target: ReadLine | None = None,
                   lesson: Lesson | None = None) -> tuple[Practice | None, str | None, list[str]]:
    """(the practice problem if it can be set, what it asks the student to do, what is wrong with it).

    It can be set when its `plain` parses as math, it is not the student's own problem (nor the line the
    lesson's worked example starts from), and, when it names something compute.py does (derivative, integral,
    solve, simplify), compute_step works it out: then the checker can grade the student's answer."""
    if not isinstance(raw, dict):
        return None, None, ["`practice` is missing: every lesson ends with a practice problem (prompt, problem, plain, relation)"]
    prompt = teach.plain_note(_text(raw.get("prompt")) or "").replace("$", "").strip() or "Your turn."
    problem_latex = solution.clean_latex(_text(raw.get("problem")) or "")
    plain = (_text(raw.get("plain")) or "").replace("$", "").strip() or solution.to_plain(problem_latex)
    relation = raw.get("relation") if raw.get("relation") in compute.RELATIONS else None
    ask = solution.clean_latex(_text(raw.get("ask")) or "") or None
    if not problem_latex or not plain:
        return None, None, ["`practice` needs `problem` (LaTeX) and `plain` (calculator syntax)"]
    if _math(plain) is None:
        return None, None, [f"practice `plain` does not parse as math: `{plain}`. One expression or equation in "
                            "calculator syntax, `*` for every product, no words"]
    theirs = [l.plain for l in problem if l.relation == "start" or l.source == "printed"]
    theirs += [l.plain for l in (target, problem[0] if problem else None) if l is not None]
    if lesson is not None:  # the line the worked example starts from
        theirs += [solution.to_plain(s.write) for s in lesson.steps[:-1] if s.write][:1]
    if any(t and _same_problem(plain, t) for t in theirs):
        return None, None, [f"practice `{plain}` is the problem the lesson already worked. Give a fresh one of "
                            "the same kind: change the numbers"]
    if relation is not None or compute.operation(plain) is not None:
        out = compute.compute_step(plain, relation or "simplify")
        if not out.get("result"):
            return None, None, [f"compute_step could not work out the practice problem `{plain}` by `{relation}` "
                                f"({out.get('detail', '')}), so the student's answer could not be checked. Pick a "
                                "simpler one that compute_step can do"]
    try:
        return Practice(prompt=prompt, problem=problem_latex, plain=plain, ask=ask), relation, []
    except ValidationError as e:
        return None, None, [f"practice is not valid: {e.errors()[0].get('msg', '')}"]


def _hand_over(lesson: Lesson) -> Lesson:
    """The last step puts the practice problem on screen, so what is said, shown and written on the page match."""
    p, last = lesson.practice, lesson.steps[-1]
    if p is None or practice_mod.key(p.problem) in practice_mod.key(last.caption or ""):
        return lesson
    last = last.model_copy(update={"caption": f"{p.prompt} ${p.problem}$"})
    return lesson.model_copy(update={"steps": lesson.steps[:-1] + [last]})


def _moves(lesson: Lesson) -> bool:
    """True if any mark in the lesson is animated."""
    return any(m.to_x is not None or m.to_x2 is not None
               for st in lesson.steps if st.visual and st.visual.marks for m in st.visual.marks)


def _action(lesson: Lesson, line_id: Any, problem: list[ReadLine], anchor: ReadLine) -> Action:
    line = next((l for l in problem if l.line_id == line_id and l.source != "printed"), anchor)
    return Action(type="lesson", line_id=line.line_id, box=line.box, side="right", lesson=lesson)


_POINTING = frozenset("""teach me this that it these those explain how do does i we walk through please can could you
    would a an the lesson course class make create give build start show on about for of to with and in step by
    understand get dont don't not help what is are why my problem question one again more now just so""".split())


def names_subject(question: str | None) -> bool:
    """True when what was said names a subject of its own ("a course on Formula One racing"), not just
    "teach me this". Two words that are not pointing-or-asking words are enough."""
    words = re.findall(r"[a-z0-9']+", (question or "").lower())
    return len([w for w in words if w not in _POINTING]) >= 2


def explain(client, model: str, lines: list[ReadLine], req: CheckRequest) -> TeachResult:
    result = TeachResult()
    problem, anchor, target = pick_target(lines, req.help_box)
    if anchor is None:
        result.finished = False
        result.tool_calls.append("explain: nothing on the page to explain")
        return result
    checks = _check_problem(problem, lines, result)
    result.tool_calls.append(f"target({target.line_id}, problem {target.problem_id})")
    # a lesson asked for by name ("a course on Formula One racing") is about that subject: the nearest line's
    # math would only pull the lesson back to the wrong thing
    math_done = [] if names_subject(req.question) else _precompute(problem, target, result)
    contents: list = [types.Content(role="user", parts=[types.Part.from_text(
        text=_page_json(lines, req, problem, anchor, checks, target, math_done))])]
    fallback: tuple | None = None  # a short or picture-less lesson, used if nothing better comes
    asked_for_motion = asked_for_length = asked_for_practice = False

    def done(lesson: Lesson, line_id: Any, relation: str | None = None) -> TeachResult:
        result.actions = [_action(_hand_over(lesson), line_id, problem, anchor)]
        result.practice_relation = relation if lesson.practice is not None else None
        result.finished = True
        return result

    for _ in range(MAX_ROUNDS):
        response = gemini.generate(client, model, contents, _build_config)
        calls = response.function_calls or []
        cand = response.candidates[0].content if response.candidates else None

        if not calls:
            if cand is not None:
                contents.append(cand)
            contents.append(types.Content(role="user", parts=[types.Part.from_text(
                text="Respond only by calling compute_step, verify_step or submit_lesson.")]))
            continue

        contents.append(cand if cand is not None else types.Content(
            role="model", parts=[types.Part(function_call=c) for c in calls]))

        replies = []
        for call in calls:
            args = dict(call.args or {})
            if call.name == "verify_step":
                out = teach._run_verify(args, lines, result)
            elif call.name == "compute_step":
                out = teach._run_compute(args, lines, result)
            elif call.name == "submit_lesson":
                lesson, problems = build_lesson(args)
                n = len(lesson.steps) if lesson else 0
                relation, practice_problems = None, []
                if lesson is not None:
                    lesson.practice, relation, practice_problems = check_practice(args.get("practice"), problem, target, lesson)
                    result.tool_calls.append(f"practice({lesson.practice.plain}, {relation or 'unchecked'})" if lesson.practice
                                             else f"practice dropped: {practice_problems[0]}")
                result.tool_calls.append(f"submit_lesson({n} steps" + (f"; {'; '.join(problems)}" if problems else "") + ")")
                enough = n >= MIN_STEPS or (asked_for_length and n >= PLAYABLE_STEPS)
                asked_for_length = asked_for_length or (lesson is not None and PLAYABLE_STEPS <= n < MIN_STEPS)
                good = lesson is not None and enough and any(s.visual for s in lesson.steps)
                again = []
                if good and not _moves(lesson) and not asked_for_motion:
                    # Asked once only: a still lesson is better than a slow one.
                    asked_for_motion = True
                    again.append(
                        "nothing moves: give one or two steps a mark with to_x or to_x2 (a tangent or point sliding "
                        "along the curve, a secant closing in, an area growing) and tell the student to watch it")
                if good and lesson.practice is None and not asked_for_practice:
                    # Sent back once; after that the lesson goes out without a practice problem.
                    asked_for_practice = True
                    again += practice_problems + ["keep the lesson as it is, fix `practice`, and make the last step's "
                                                  "`say` and `caption` state that same problem"]
                if again:
                    fallback = (lesson, args.get("line_id"), relation)
                    problems = problems + again
                    good = False
                if good:
                    return done(lesson, args.get("line_id"), relation)
                if lesson is not None and n >= 2 and (fallback is None or n > len(fallback[0].steps)):
                    fallback = (lesson, args.get("line_id"), relation)
                if lesson is not None and lesson.practice is None and not asked_for_practice:
                    asked_for_practice = True  # whatever else is being fixed, the practice problem is asked for with it
                    problems = problems + practice_problems
                out = {"ok": False, "fix_and_submit_again": problems}
            else:
                out = {"error": f"unknown function {call.name}"}
            replies.append(types.Part(function_response=types.FunctionResponse(
                id=call.id, name=call.name, response=out)))
        contents.append(types.Content(role="user", parts=replies))

    if fallback is not None:
        return done(*fallback)
    result.finished = False
    result.actions = []
    return result
