"""Teach step: Gemini with function calling decides what feedback to draw.

Text only (the page was already read). Gemini calls verify_step on lines (and compute_step when the
student asked for a line to be finished, solve_circuit for a drawn circuit), then finishes by calling submit_feedback. Teaching behavior lives in prompts/tutor.md, not here.
"""
import json
import logging
import pathlib
import re
from typing import Any

import gemini
from focus import focus_box
from google.genai import types
from pydantic import ValidationError

import circuits
import compute
import engineering
import forces
import units
import memory
import practice
import solution
import verify
from figures import fix_figure
from internal import HintUpdate, TeachResult
from models import Action, CheckRequest, ReadLine
from target import pick_line

log = logging.getLogger(__name__)

PROMPT_PATH = pathlib.Path(__file__).resolve().parent / "prompts" / "tutor.md"
MAX_ROUNDS = 5

_BOX = {
    "type": "array",
    "items": {"type": "integer"},
    "minItems": 4,
    "maxItems": 4,
    "description": "[ymin, xmin, ymax, xmax], each 0-1000, copied from or inside a line's box",
}

_FIGURE = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["plot2d", "surface3d", "circuit", "fbd", "model3d"],
                 "description": "circuit / fbd: just ask for it (kind, expressions [], x_range [0, 1]); code fills it in. "
                                "model3d: a 3D structure to turn and tap; `model3d` names it (expressions [], x_range [0, 1])"},
        "expressions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "math.js syntax, e.g. 'x^2 - 4'. surface3d: one expression in x and y",
        },
        "x_range": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
        "y_range": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
        "x_log": {"type": "boolean", "description": "true = logarithmic x axis (x_range must be positive)"},
        "title": {"type": "string"},
        # A JSON string, not a nested schema: with function calling forced (mode ANY) Gemini compiles every tool schema
        # for constrained decoding, and a nested model3d schema pushed the tool set over its limit (every check got
        # a 400 INVALID_ARGUMENT). engineering.build_model3d parses and cleans it.
        "model3d": {
            "type": "string",
            "description": "kind model3d only: a JSON object {\"subject\": what to build and its main size, "
                           "\"focus\": what the student asked}. The server builds the model. See 3D models",
        },
    },
    "required": ["kind", "expressions", "x_range"],
}

_STEPS = {
    "type": "array",
    "maxItems": solution.MAX_STEPS,
    "description": "solution only: the worked steps in order, 2 to 8, ending with the final answer. Only when the "
                   "student asked for the whole solution. The server checks every step before it is shown",
    "items": {
        "type": "object",
        "properties": {
            "latex": {"type": "string", "description": "the whole line as a student would write it, LaTeX, no $ and no words: '3x^2 = 3'"},
            "plain": {"type": "string", "description": "the same whole line in calculator syntax, for the checker: '3*x^2 = 3'. Several answers as 'x = 1 or x = -1'"},
            "relation": {"type": "string", "enum": list(solution.STEP_RELATIONS),
                         "description": "how this step follows from the step before it (the first step: from the line it continues)"},
        },
        "required": ["latex", "plain", "relation"],
    },
}

_ACTION = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["circle", "underline", "note", "figure", "ask", "speak", "solution"]},
        "box": _BOX,
        "line_id": {"type": "string", "description": "the line this action is about"},
        "color": {"type": "string", "enum": ["red", "green", "blue", "black"],
                  "description": "black only for an inline note that finishes the student's line"},
        "text": {"type": "string", "description": "note/ask/speak text. Plain words, inline math in $...$, Greek letters as symbols (ω, not \\omega). A mistake note: one short question, under 15 words. A help-mode hint: up to about 35 words that explain"},
        "side": {"type": "string", "enum": ["right", "below", "inline"],
                 "description": "inline (note only): written straight after the end of the line"},
        "options": {"type": "array", "items": {"type": "string"}, "description": "ask only: choices"},
        "focus": {"type": "string", "description": "circle/underline only: the smallest wrong part of the line, copied exactly from that line's `plain` (e.g. '+ 1'). The server narrows the box to it."},
        "figure": _FIGURE,
        "steps": _STEPS,
    },
    "required": ["type"],
}

VERIFY_DECL = types.FunctionDeclaration(
    name="verify_step",
    description=(
        "Check with real math whether line `after` follows from line `before` by `relation`. "
        "Call this for every new non-start line before judging it."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "before": {"type": "string", "description": "previous line of the same problem, plain syntax"},
            "after": {"type": "string", "description": "the line being checked, plain syntax"},
            "relation": {
                "type": "string",
                "enum": ["equals", "simplify", "derivative", "integral", "solve", "other"],
            },
            "before_line_id": {"type": "string"},
            "after_line_id": {"type": "string"},
        },
        "required": ["before", "after", "relation", "before_line_id", "after_line_id"],
    },
)

COMPUTE_DECL = types.FunctionDeclaration(
    name="compute_step",
    description=(
        "Work out with real math what follows from line `before` by `relation`. Only for finishing a line "
        "the student asked you to finish (a line left open after '=', or a spoken request), or for the steps "
        "of a full solution they asked for. Returns "
        "`result` (plain) and `latex`: what to write after the open line's '='. Empty result = couldn't. "
        "When the open line is the whole problem ('int(4*x, x) =', 'd/dx(x^3) =', '3*4 + 2 ='), pass that "
        "line itself as `before`, with its id as both before_line_id and after_line_id."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "before": {"type": "string", "description": "the line to work from, plain syntax: usually the line before the open one, or the open line itself when it carries the math"},
            "relation": {"type": "string", "enum": list(compute.RELATIONS)},
            "before_line_id": {"type": "string"},
            "after_line_id": {"type": "string", "description": "the open line being finished"},
        },
        "required": ["before", "relation", "before_line_id", "after_line_id"],
    },
)

_ELEMENT = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "description": "label from the drawing, e.g. 'R1', 'V1'"},
        "kind": {"type": "string", "enum": sorted(circuits.KINDS)},
        "a": {"type": "string", "description": "node name; '0' is ground"},
        "b": {"type": "string", "description": "node name; '0' is ground"},
        "value": {"type": "string", "description": "ohms / volts / amps, e.g. '4.7k', '9', '2mA'"},
    },
    "required": ["id", "kind", "a", "b", "value"],
}

CIRCUIT_DECL = types.FunctionDeclaration(
    name="solve_circuit",
    description=(
        "Solve a DC circuit drawn on the page with real nodal analysis, and check values the student wrote. "
        "vsource: V(a) - V(b) = value. isource: value amps flow from a through the source to b. Returns node "
        "voltages, element voltages and currents (a->b), power, and a verdict per claim."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "circuit_line_id": {"type": "string", "description": "the line holding the circuit's netlist"},
            "elements": {"type": "array", "items": _ELEMENT,
                         "description": "the netlist; copy it from the circuit line's `plain`"},
            "claims": {
                "type": "array",
                "description": "values the student wrote about this circuit, one per answer line",
                "items": {
                    "type": "object",
                    "properties": {
                        "line_id": {"type": "string", "description": "the student's answer line"},
                        "quantity": {"type": "string", "enum": ["voltage", "current", "power"]},
                        "element": {"type": "string", "description": "element id (voltage across it, current through it, its power)"},
                        "node": {"type": "string", "description": "voltage only: node name, measured to ground"},
                        "value": {"type": "string", "description": "the value as written, e.g. '4 V', '2mA'"},
                    },
                    "required": ["line_id", "quantity", "value"],
                },
            },
        },
        "required": ["circuit_line_id"],
    },
)

UNITS_DECL = types.FunctionDeclaration(
    name="check_units",
    description=(
        "Check a physics line that has units (e.g. 'F = 2*kg * 9.8*m/s^2 = 19.6*N'): every side with a number and "
        "units must have the same dimension and, when numbers are given, the same value (1%). Call it for every line "
        "with units. Returns verdict correct / incorrect / unknown and a detail naming the units of each side."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "line_id": {"type": "string", "description": "the line being checked"},
            "expression": {"type": "string", "description": "that line's plain text, units included"},
        },
        "required": ["line_id", "expression"],
    },
)

_FORCE = {
    "type": "object",
    "properties": {
        "label": {"type": "string", "description": "'mg', 'N', 'f', 'T'"},
        "angle_deg": {"type": "number", "description": "direction, degrees counter-clockwise from +x (right)"},
        "magnitude": {"type": "string", "description": "if known: '19.6 N', 'm*g', 'm*g*cos(30)'; leave out to solve for it"},
    },
    "required": ["label", "angle_deg"],
}

FORCES_DECL = types.FunctionDeclaration(
    name="check_forces",
    description=(
        "Check a drawn force diagram with real component sums. The forces as drawn are taken from the diagram line "
        "itself. Give the givens (m, g, angles, mu...), the acceleration if it isn't at rest, and `expected`: every "
        "force that SHOULD act on the body (yours to decide). Returns whether the drawn forces balance (or equal m*a), "
        "the leftover force and the direction a missing force must point, and the magnitudes solved for `expected`."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "fbd_line_id": {"type": "string", "description": "the line holding the force diagram"},
            "givens": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string", "description": "'m', 'g', 'theta', 'mu'"},
                "value": {"type": "string", "description": "'2 kg', '9.8', '30'"}}, "required": ["name", "value"]}},
            "accel": {"type": "object", "description": "leave out if at rest or moving at constant speed",
                      "properties": {"magnitude": {"type": "string"}, "angle_deg": {"type": "number"}}},
            "expected": {"type": "array", "items": _FORCE},
        },
        "required": ["fbd_line_id", "expected"],
    },
)

SUBMIT_DECL = types.FunctionDeclaration(
    name="submit_feedback",
    description="Finish: send the feedback to draw on the page. Call exactly once, after verifying.",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "actions": {"type": "array", "items": _ACTION},
            "clear_line_ids": {"type": "array", "items": {"type": "string"}},
            "hint_updates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "problem_id": {"type": "string"},
                        "hint_level": {"type": "integer", "minimum": 0, "maximum": 3},
                    },
                    "required": ["problem_id", "hint_level"],
                },
            },
            "solution_requested": {
                "type": "boolean",
                "description": "true only when `question` (help mode) asks you in the student's own words to solve "
                               "the problem or show its steps. Leave false otherwise",
            },
        },
        "required": ["actions", "clear_line_ids", "hint_updates"],
    },
)


def _build_config(thinking=None) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=PROMPT_PATH.read_text(),  # loaded per call so prompt edits apply live
        tools=[types.Tool(function_declarations=[VERIFY_DECL, COMPUTE_DECL, CIRCUIT_DECL, UNITS_DECL, FORCES_DECL, SUBMIT_DECL])],
        tool_config=types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(mode="ANY")
        ),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        thinking_config=thinking,
        temperature=0.2,
    )


def _check_practice(lines: list[ReadLine], result: TeachResult) -> list[dict]:
    """Your turn: the student's work under each tutor-written problem line, checked here against that line
    (first line against the given line, then each line against the one before), so it does not depend on the
    model remembering to. A first line whose relation is not known is left for the model to check."""
    out = []
    for pid, given in practice.problems(lines).items():
        mine = practice.work(lines, given)
        checks, prev = [], given
        for l in mine:
            if is_open(l.plain) or not practice._is_math(l):
                continue
            if l.relation not in ("start", "other"):
                v = _run_verify({"before": practice.math_text(prev.plain), "after": l.plain,
                                 "relation": l.relation, "before_line_id": prev.line_id,
                                 "after_line_id": l.line_id}, lines, result)
                checks.append({"line_id": l.line_id, "follows_from": prev.line_id, "relation": l.relation, **v})
            prev = l
        finished = practice.done(lines, result.verdicts).get(pid)
        out.append({"problem_id": pid, "given_line_id": given.line_id, "work_line_ids": [l.line_id for l in mine],
                    "checks": checks,
                    "last_line": ("no work yet" if not mine else "left open: the student is still working"
                                  if is_open(mine[-1].plain) else f"{finished} checked correct: if it is the final "
                                  "answer, send the green note" if finished else "not confirmed as a correct final answer")})
    return out


def _page_json(lines: list[ReadLine], req: CheckRequest, practice_checks: list[dict] | None = None) -> str:
    extra = {}
    if practice_checks:
        extra["practice"] = practice_checks
    if req.mode == "help":
        # What the student is pointing at (their selection, or their latest ink), and what Help already told them.
        target = pick_line(lines, req.help_box)
        extra["target"] = {"line_id": target.line_id, "problem_id": target.problem_id} if target else None
        extra["previous_hints"] = memory.previous_hints(req.state.page_id, req.state.problems)
    return json.dumps(
        {
            "mode": req.mode,
            "help_box": list(req.help_box) if req.help_box else None,
            "question": req.question,
            **extra,
            "lines": [dict(l.model_dump(), given=True) if practice.is_given(l) else l.model_dump() for l in lines],
            "previous_lines": [l.model_dump() for l in req.state.lines],
            "problems": [p.model_dump() for p in req.state.problems],
            "flagged_line_ids": req.state.flagged_line_ids,
        },
        indent=1,
    )


def _resolve_ids(args: dict, lines: list[ReadLine]) -> tuple[str, str]:
    """Line ids for a verify_step call: use the ids Gemini passed, else match by plain text."""
    ids = {l.line_id for l in lines}
    after_id = args.get("after_line_id") if args.get("after_line_id") in ids else None
    if after_id is None:
        after_txt = str(args.get("after", "")).replace(" ", "")
        after_id = next((l.line_id for l in lines if l.plain.replace(" ", "") == after_txt), None)
    before_id = args.get("before_line_id") if args.get("before_line_id") in ids else None
    if before_id is None and after_id is not None:
        after = next(l for l in lines if l.line_id == after_id)
        same = [l for l in lines if l.problem_id == after.problem_id]
        idx = same.index(after)
        before_id = same[idx - 1].line_id if idx > 0 else None
    return before_id or "?", after_id or "?"


def is_open(plain: str) -> bool:
    """A line the student stopped right after '=' (`g'(x) =`): unfinished, so there is nothing to check yet."""
    return (plain or "").strip().endswith("=")


def _run_verify(args: dict, lines: list[ReadLine], result: TeachResult) -> dict:
    before, after = str(args.get("before", "")), str(args.get("after", ""))
    relation = str(args.get("relation", "other"))
    before_id, after_id = _resolve_ids(args, lines)
    after_line = next((l for l in lines if l.line_id == after_id), None)
    if is_open(after) or (after_line is not None and is_open(after_line.plain)):
        result.tool_calls.append(f"verify_step({before_id}->{after_id}, {relation}) = skipped (open line)")
        if after_id in practice.line_ids(lines):
            return {"verdict": "unknown", "detail": "this line is unfinished (nothing after '='). It is practice "
                                                    "the student is still doing: do not mark it and do not finish it."}
        return {"verdict": "unknown", "detail": "this line is unfinished (nothing after '='). That is not a "
                                                "mistake: do not mark it. Use compute_step to finish it."}
    # A line that names its own operation ('int(2*x, x)', 'd/dx(x^3)') is checked as that operation on what is inside it.
    op = compute.operation(before) if "=" not in before.strip().rstrip("= ") else None
    if op is not None and not op["limits"]:
        before, relation = op["expr"], op["kind"]
    try:
        out = verify.verify_step(before, after, relation)
        verdict = out.get("verdict")
        if verdict not in ("correct", "incorrect", "unknown"):
            verdict = "unknown"
        out = {"verdict": verdict, "detail": str(out.get("detail", ""))}
    except Exception as e:  # a checker bug must never break the request
        log.exception("verify_step failed")
        out = {"verdict": "unknown", "detail": f"checker error: {e}"}
    result.tool_calls.append(f"verify_step({before_id}->{after_id}, {relation}) = {out['verdict']}")
    if after_id != "?":
        # If a line is verified twice, keep the strongest signal: correct wins (guard drops red marks).
        prev = result.verdicts.get(after_id)
        if prev != "correct":
            result.verdicts[after_id] = out["verdict"]
    return out


def _run_compute(args: dict, lines: list[ReadLine], result: TeachResult, hands_off: frozenset = frozenset()) -> dict:
    """`hands_off`: ids of lines that must not be worked out for the student (practice, outside Help)."""
    relation = str(args.get("relation", ""))
    before_id, after_id = _resolve_ids(args, lines)
    if after_id in hands_off or before_id in hands_off:
        result.tool_calls.append(f"compute_step({before_id}->{after_id}, {relation}) = refused (practice)")
        return {"result": "", "latex": "", "detail": "this is a practice problem the tutor set: the student works "
                                                     "it out. Do not finish the line or write its answer."}
    before = str(args.get("before") or "")
    if not before.strip():  # the model gave only the id: use that line's text
        before = next((l.plain for l in lines if l.line_id == before_id), "")
    try:
        out = compute.compute_step(before, relation)
        if not out.get("result"):
            # The open line may be the whole problem ('int(4*x, x) ='): work from the line being finished.
            own = next((l.plain for l in lines if l.line_id == after_id), "")
            if is_open(own) and own.strip() != before.strip():
                again = compute.compute_step(own, relation)
                out = again if again.get("result") else out
        out = {k: str(out.get(k, "")) for k in ("result", "latex", "detail")}
    except Exception as e:  # compute_step should never raise; a bug there must not break the request
        log.exception("compute_step failed")
        out = {"result": "", "latex": "", "detail": f"compute error: {e}"}
    result.tool_calls.append(f"compute_step({before_id}->{after_id}, {relation}) = {out['result'] or 'nothing'}")
    return out


def _netlist_from_line(line: ReadLine | None) -> list:
    """The read step writes a drawn circuit as JSON in `plain`: {"circuit": [elements...]}."""
    if line is None:
        return []
    try:
        data = json.loads(line.plain)
    except (TypeError, ValueError):
        return []
    els = data.get("circuit") if isinstance(data, dict) else data
    return els if isinstance(els, list) else []


def _run_units(args: dict, lines: list[ReadLine], result: TeachResult) -> dict:
    """check_units on a line; its verdict counts like verify_step's (the guard drops red marks on a correct line)."""
    ids = {l.line_id for l in lines}
    line_id = str(args.get("line_id", ""))
    expression = str(args.get("expression") or next((l.plain for l in lines if l.line_id == line_id), ""))
    try:
        out = units.check_units(expression)
    except Exception as e:  # check_units shouldn't raise; a bug there must not break the request
        log.exception("check_units failed")
        out = {"verdict": "unknown", "detail": f"units error: {e}"}
    result.tool_calls.append(f"check_units({line_id}) = {out['verdict']}")
    if line_id in ids and result.verdicts.get(line_id) != "correct":  # same rule as verify_step: correct wins
        result.verdicts[line_id] = out["verdict"]
    return out


def _run_forces(args: dict, lines: list[ReadLine], result: TeachResult) -> dict:
    """check_forces on a drawn force diagram. The drawn forces come from the read line (never from the model); the
    model gives the givens and the forces it expects. The verdict counts like verify_step's, and the expected forces
    are kept so the guard can draw the missing ones dashed."""
    line_id = str(args.get("fbd_line_id", ""))
    line = next((l for l in lines if l.line_id == line_id), None)
    drawn = engineering.parse_fbd(line.plain) if line is not None else None
    if drawn is None:
        result.tool_calls.append(f"check_forces({line_id}) = no force diagram on that line")
        return {"verdict": "unknown", "detail": "that line is not a force diagram"}
    givens = {str(g.get("name")): str(g.get("value")) for g in args.get("givens") or [] if isinstance(g, dict)}
    expected = engineering.expected_forces(args.get("expected"), drawn)
    try:
        out = forces.check_forces(drawn["forces"], givens, args.get("accel") or None, expected or None)
        # The one force the student left out: its direction comes from the physics (where the leftover must be
        # cancelled), not from the model, so the dashed arrow can't point the wrong way.
        fixed = engineering.fix_missing_direction(drawn, expected, out)
        if fixed is not None:
            expected, note = fixed
            out = forces.check_forces(drawn["forces"], givens, args.get("accel") or None, expected)
            out["direction_note"] = note
    except Exception as e:  # check_forces shouldn't raise; a bug there must not break the request
        log.exception("check_forces failed")
        out = {"verdict": "unknown", "detail": f"forces error: {e}"}
    result.fbd[line_id] = {"expected": expected, "check": out}
    result.tool_calls.append(f"check_forces({line_id}) = {out['verdict']}")
    if result.verdicts.get(line_id) != "correct":
        result.verdicts[line_id] = out["verdict"]
    return out


def _run_circuit(args: dict, lines: list[ReadLine], result: TeachResult) -> dict:
    line_id = str(args.get("circuit_line_id", ""))
    elements = args.get("elements") or _netlist_from_line(next((l for l in lines if l.line_id == line_id), None))
    sol = circuits.solve_circuit(list(elements) if isinstance(elements, list) else [])
    if not sol.get("ok"):
        result.tool_calls.append(f"solve_circuit({line_id}) = failed: {sol.get('detail')}")
        return {"ok": False, "detail": sol.get("detail", ""),
                "claims": "not checked: fix or re-read the netlist, and do not mark answers wrong"}
    checked = []
    ids = {l.line_id for l in lines}
    for c in args.get("claims") or []:
        if not isinstance(c, dict):
            continue
        out = circuits.check_claim(sol, c)
        cid = str(c.get("line_id", ""))
        checked.append({"line_id": cid, **out})
        if cid in ids and result.verdicts.get(cid) != "correct":  # same rule as verify_step: correct wins
            result.verdicts[cid] = out["verdict"]
    verdicts = ", ".join(f"{c['line_id']}={c['verdict']}" for c in checked) or "no claims"
    result.tool_calls.append(f"solve_circuit({line_id}) = ok; {verdicts}")
    return {**sol, "claims": checked}


def _clean_box(v: Any) -> Any:
    if isinstance(v, (list, tuple)):
        try:
            return [max(0, min(1000, int(round(float(x))))) for x in v]
        except (TypeError, ValueError):
            return v
    return v


def _blue_beside_models(actions: list[Action]) -> list[Action]:
    """The answer that comes with a 3D model is an explanation, not a mistake: a note there with no colour is blue
    (the page draws a colourless note red)."""
    modelled = {a.line_id for a in actions if a.type == "figure" and a.figure is not None and a.figure.kind == "model3d"}
    return [a.model_copy(update={"color": "blue"}) if a.type == "note" and a.color is None and a.line_id in modelled
            else a for a in actions]


def _parse_actions(raw: Any, lines: list[ReadLine] | None = None) -> list[Action]:
    by_id = {l.line_id: l for l in (lines or [])}
    actions = []
    for a in raw if isinstance(raw, list) else []:
        if not isinstance(a, dict):
            continue
        a = {k: v for k, v in a.items() if v is not None}
        focus = a.pop("focus", None)  # server-only field, not part of the contract
        if "box" in a:
            a["box"] = _clean_box(a["box"])
        if "figure" in a:
            a["figure"] = fix_figure(a["figure"])  # give every graph a window that shows the curve
            if isinstance(a["figure"], dict) and a["figure"].get("kind") == "model3d":
                raw = a["figure"].get("model3d")
                if isinstance(raw, str):
                    try:
                        raw = json.loads(raw)
                    except ValueError:
                        raw = None
                model = engineering.model3d_request(raw) or engineering.build_model3d(raw)
                if model is None:
                    continue  # nothing in it can be drawn, and nothing to build
                a["figure"] = {**a["figure"], "model3d": model, "expressions": [], "x_range": [0, 1]}
        if "steps" in a:  # the model sends {latex, plain, relation}; the page gets the LaTeX lines
            steps = a.pop("steps")
            if a.get("type") == "solution":
                a["steps"] = [s["latex"] for s in solution.norm_steps(steps)]
        line = by_id.get(a.get("line_id"))
        if focus and line is not None and a.get("type") in ("circle", "underline"):
            # Always start from the line's own box, so a box the model made up can't move the mark.
            a["box"] = focus_box(line.plain, list(line.box), str(focus)) or list(line.box)
        try:
            actions.append(Action.model_validate(a))
        except ValidationError as e:
            log.warning("dropping invalid action %s: %s", a, e)
    return _blue_beside_models(_tidy(actions, by_id))


_GREEK = {"alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε", "zeta": "ζ",
          "eta": "η", "theta": "θ", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π",
          "rho": "ρ", "sigma": "σ", "tau": "τ", "phi": "φ", "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
          "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Pi": "Π", "Sigma": "Σ", "Phi": "Φ",
          "Psi": "Ψ", "Omega": "Ω"}
_WORD_SYMBOLS = {"cdot": "·", "times": "×", "div": "÷", "pm": "±", "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥",
                 "ne": "≠", "neq": "≠", "approx": "≈", "to": "→", "rightarrow": "→", "infty": "∞", "sqrt": "√",
                 "angle": "∠", "circ": "°", "degree": "°"}


def plain_note(text: str) -> str:
    """Notes are shown as plain text. Greek letters become symbols everywhere; outside `$...$` no LaTeX
    command is left behind (math stays inside `$...$`, which the page knows how to show)."""
    s = re.sub(r"\\([A-Za-z]+)", lambda m: _GREEK.get(m.group(1), m.group(0)), text or "")
    parts = re.split(r"(\$[^$]*\$)", s)
    for i in range(0, len(parts), 2):  # the pieces outside $...$
        t = parts[i]
        if "\\" not in t:
            continue
        t = re.sub(r"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"\1/\2", t)
        t = re.sub(r"\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}", r"\1", t)
        t = re.sub(r"\\([A-Za-z]+)", lambda m: _WORD_SYMBOLS.get(m.group(1), m.group(1)), t)
        parts[i] = t.replace("\\", "")
    return "".join(parts)


def _tidy(actions: list[Action], by_id: dict) -> list[Action]:
    """Shape fixes that hold for any subject: marks carry no words, and words are never lost or empty."""
    noted = {a.line_id for a in actions if a.type == "note" and a.line_id}
    out: list[Action] = []
    for a in actions:
        if a.type in ("note", "ask", "speak") and not (a.text or "").strip():
            continue  # nothing to show or say
        if a.type == "solution":
            # Worked steps under a line of the student's work, in their ink colour: no words, placed by the line's real box.
            line = by_id.get(a.line_id)
            steps = [t for t in (solution.clean_latex(s) for s in a.steps or []) if t][:solution.MAX_STEPS]
            if line is None or not steps:
                continue
            out.append(a.model_copy(update={"steps": steps, "color": "black", "box": line.box, "text": None,
                                            "side": None, "options": None, "figure": None}))
            continue
        if a.type in ("note", "ask") and "\\" in (a.text or ""):
            a = a.model_copy(update={"text": plain_note(a.text)})
        if a.type == "note" and a.color == "black" and is_open(getattr(by_id.get(a.line_id), "plain", "")):
            a = a.model_copy(update={"side": "inline"})  # an answer to an open line is always written on that line
        if a.side == "inline":
            line = by_id.get(a.line_id)
            if a.type != "note" or line is None:
                a = a.model_copy(update={"side": "right"})  # only a note can continue a line, and it needs the line
            else:
                # It continues the student's own line: their ink colour, placed by the line's real box.
                a = a.model_copy(update={"color": "black", "box": line.box})
        if a.type in ("circle", "underline", "figure") and a.text:
            # The page draws a mark without words. If the model put the hint on the mark and sent no
            # note for that line, move the words into a note beside the whole line.
            if a.line_id not in noted:
                line = by_id.get(a.line_id)
                fig = a.type == "figure"  # words on a graph are an explanation: blue, under the line, graph stays put
                out.append(Action(type="note", line_id=a.line_id, color=a.color or ("blue" if fig else None),
                                  side="below" if fig else (a.side or "right"),
                                  text=a.text, box=line.box if line is not None else a.box))
                noted.add(a.line_id)
            a = a.model_copy(update={"text": None} if a.type == "figure" else {"text": None, "side": None})
        out.append(a)
    return out


def _apply_submit(args: dict, result: TeachResult, lines: list[ReadLine] | None = None) -> None:
    result.actions = _parse_actions(args.get("actions"), lines)
    result.clear_line_ids = [str(x) for x in (args.get("clear_line_ids") or []) if isinstance(x, (str, int))]
    hints = []
    for h in args.get("hint_updates") or []:
        try:
            hints.append(HintUpdate.model_validate(h))
        except ValidationError as e:
            log.warning("dropping invalid hint update %s: %s", h, e)
    result.hint_updates = hints
    result.solution_requested = args.get("solution_requested") is True
    n = len(args.get("actions") or [])
    result.tool_calls.append(f"submit_feedback({len(result.actions)}/{n} actions kept)")


def _explains(text: str) -> bool:
    """True if the words tell the student something: at least one sentence that is not a question."""
    sentences = [t for t in re.split(r"(?<=[.!?])\s+", (text or "").strip()) if t]
    return any(not t.rstrip().endswith("?") and len(t.split()) >= 3 for t in sentences)


FORCE_NAMES = {"f": "friction", "fr": "friction", "ff": "friction", "friction": "friction", "t": "tension",
               "tension": "tension", "n": "normal", "normal": "normal", "fn": "normal", "fa": "applied",
               "applied": "applied", "w": "weight", "mg": "weight", "weight": "weight"}


def named_too_soon(actions: list[Action], lines: list[ReadLine], result: TeachResult, levels: dict) -> str | None:
    """Hint level 1 on a force diagram asks about the missing force without naming it (naming it is level 2). A note
    that names it anyway is sent back once. `levels`: problem_id -> the hint level this reply sets."""
    by_id = {l.line_id: l for l in lines}
    for line_id, fbd in result.fbd.items():
        line = by_id.get(line_id)
        if line is None or levels.get(line.problem_id) != 1:
            continue
        drawn = engineering.parse_fbd(line.plain)
        if not drawn:
            continue
        words = {FORCE_NAMES.get(e["label"].strip().lower(), e["label"].strip().lower())
                 for e in engineering.missing_from(drawn, fbd.get("expected") or [])}
        words = {w for w in words if len(w) > 2}
        for a in actions:
            text = (a.text or "").lower() if a.type == "note" else ""
            hit = next((w for w in words if re.search(rf"\b{re.escape(w)}", text)), None)
            if hit:
                return (f"This is hint level 1: the note names the missing force (\"{hit}\"). Level 1 must not name "
                        "it: describe what it has to do instead (what keeps the block from sliding, what the surface "
                        "does), so the student finds it. Keep everything else and submit again.")
    return None


def help_gap(actions: list[Action], req: CheckRequest) -> str | None:
    """What is missing from a reply to a Help tap, or None. Help must tell the student something: an empty
    reply, or one made only of questions, is sent back once to be fixed."""
    if req.mode != "help":
        return None
    told = any((a.type == "note" and a.color != "red" and (a.color == "black" or a.side == "inline" or _explains(a.text)))
               or a.type in ("figure", "solution") for a in actions)
    if told:
        return None
    asked = (req.question or "").strip()
    return ("The student tapped Help" + (f" and asked: \"{asked}\"" if asked else "") + ". This reply does not tell "
            "them anything: it has no hint note, or its notes are only questions. Send a blue hint `note` that "
            + ("answers their question directly in one or two plain sentences first, then, if useful, one thing to try."
               if asked else "explains in plain words (see Help mode: each level says more than the last).")
            + " Keep any red circle on a real mistake. Then call submit_feedback again.")


def _circuit_solved(result: TeachResult) -> bool:
    return any(c.startswith("solve_circuit(") and "= ok" in c for c in result.tool_calls)


def _settled(submit: dict, reports: list[dict], req: CheckRequest, result: TeachResult) -> tuple[dict, list[str]]:
    """The submit with its solutions made safe to send: cut before a step the checker called wrong, dropped
    when nothing could be checked. Unchecked steps are only let through for a spoken request in help mode."""
    if not reports:
        return submit, []
    spoken = req.mode == "help" and bool((req.question or "").strip())
    actions, notes = solution.settle(submit.get("actions"), reports, spoken, _circuit_solved(result))
    return {**submit, "actions": actions}, notes


def _own_work(submit: dict, set_work: frozenset, result: TeachResult) -> dict:
    """A submit without anything that does a practice problem for the student: no solution under it, no
    line of it finished. (The guard drops these too; taking them out here lets Help be asked for a hint instead.)"""
    actions = submit.get("actions")
    if not set_work or not isinstance(actions, list):
        return submit
    kept = [a for a in actions if not (isinstance(a, dict) and a.get("line_id") in set_work and (
        a.get("type") == "solution" or (a.get("type") == "note" and (a.get("color") == "black" or a.get("side") == "inline"))))]
    if len(kept) != len(actions):
        result.tool_calls.append(f"practice: {len(actions) - len(kept)} action(s) that did the student's practice dropped")
    return {**submit, "actions": kept}


def teach(client, model: str, lines: list[ReadLine], req: CheckRequest) -> TeachResult:
    result = TeachResult()
    practice_checks = _check_practice(lines, result)
    checked = {i: v for i, v in result.verdicts.items() if v != "unknown"}  # these stand, whatever is re-checked later
    set_work = practice.line_ids(lines)
    hands_off = set_work if req.mode != "help" else frozenset()
    pending: tuple | None = None  # the last reply that was sent back to be fixed, kept in case nothing better comes
    help_sent = steps_sent = named_sent = False
    contents: list = [
        types.Content(role="user", parts=[types.Part.from_text(text=_page_json(lines, req, practice_checks))])
    ]

    def apply(submit: dict, notes: list[str]) -> TeachResult:
        result.tool_calls.extend(notes)
        _apply_submit(submit, result, lines)
        result.verdicts.update(checked)
        result.finished = True
        return result

    for _ in range(MAX_ROUNDS):
        try:
            response = gemini.generate(client, model, contents, _build_config)
        except gemini.OutOfTime:
            if pending is not None or result.tool_calls:
                result.tool_calls.append("out of time")
                break  # keep whatever was already checked (below)
            raise
        calls = response.function_calls or []
        cand = response.candidates[0].content if response.candidates else None

        if not calls:
            if cand is not None:
                contents.append(cand)
            contents.append(types.Content(role="user", parts=[types.Part.from_text(
                text="Respond only by calling verify_step, compute_step, solve_circuit, check_units, check_forces or submit_feedback.")]))
            continue

        # Send the model's turn back unchanged (keeps Gemini 3 thought signatures).
        contents.append(cand if cand is not None else types.Content(
            role="model", parts=[types.Part(function_call=c) for c in calls]))

        submit = None
        replies = []
        for call in calls:
            args = dict(call.args or {})
            if call.name == "verify_step":
                out = _run_verify(args, lines, result)
            elif call.name == "compute_step":
                out = _run_compute(args, lines, result, hands_off)
            elif call.name == "solve_circuit":
                out = _run_circuit(args, lines, result)
            elif call.name == "check_units":
                out = _run_units(args, lines, result)
            elif call.name == "check_forces":
                out = _run_forces(args, lines, result)
            elif call.name == "submit_feedback":
                submit = args
                out = {"ok": True}
            else:
                out = {"error": f"unknown function {call.name}"}
            replies.append(types.Part(function_response=types.FunctionResponse(
                id=call.id, name=call.name, response=out)))

        if submit is not None:
            submit = _own_work(submit, set_work, result)
            # A full solution is checked step by step here, whatever the model checked itself.
            reports = solution.review(submit.get("actions"), lines, result.verdicts)
            spoken = req.mode == "help" and bool((req.question or "").strip())
            fixed, notes = _settled(submit, reports, req, result)
            gap = why = None
            if not steps_sent:
                gap = solution.gap(reports, spoken, _circuit_solved(result))
                if gap is not None:
                    steps_sent, why = True, "a solution step did not pass the check"
            if gap is None and not help_sent:
                gap = help_gap(_parse_actions(fixed.get("actions"), lines), req)
                if gap is not None:
                    help_sent, why = True, "Help must explain, not only ask"
            if gap is None and not named_sent and req.mode == "help" and result.fbd:
                levels = {h.get("problem_id"): h.get("hint_level") for h in fixed.get("hint_updates") or []
                          if isinstance(h, dict)}
                gap = named_too_soon(_parse_actions(fixed.get("actions"), lines), lines, result, levels)
                if gap is not None:
                    named_sent, why = True, "hint 1 named the missing force"
            if gap is None:
                return apply(fixed, notes)
            pending = (fixed, notes)
            result.tool_calls.append(f"submit_feedback sent back: {why}")
            for part in replies:
                if part.function_response.name == "submit_feedback":
                    part.function_response.response = {"ok": False, "fix_and_submit_again": gap}
        contents.append(types.Content(role="user", parts=replies))

    if pending is not None:  # it never did better: what could be checked is still better than silence
        return apply(*pending)
    result.finished = False
    result.actions, result.clear_line_ids, result.hint_updates = [], [], []
    return result
