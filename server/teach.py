"""Teach step: Gemini with function calling decides what feedback to draw.

Text only (the page was already read). Gemini calls verify_step on lines (and compute_step when the
student asked for a line to be finished), then finishes by calling submit_feedback. Teaching behavior lives in prompts/tutor.md, not here.
"""
import json
import logging
import pathlib
from typing import Any

import gemini
from focus import focus_box
from google.genai import types
from pydantic import ValidationError

import compute
import verify
from figures import fix_figure
from internal import HintUpdate, TeachResult
from models import Action, CheckRequest, ReadLine

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
        "kind": {"type": "string", "enum": ["plot2d", "surface3d"]},
        "expressions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "math.js syntax, e.g. 'x^2 - 4'. surface3d: one expression in x and y",
        },
        "x_range": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
        "y_range": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
        "title": {"type": "string"},
    },
    "required": ["kind", "expressions", "x_range"],
}

_ACTION = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["circle", "underline", "note", "figure", "ask", "speak"]},
        "box": _BOX,
        "line_id": {"type": "string", "description": "the line this action is about"},
        "color": {"type": "string", "enum": ["red", "green", "blue", "black"],
                  "description": "black only for an inline note that finishes the student's line"},
        "text": {"type": "string", "description": "note/ask/speak text, under 15 words, inline math in $...$"},
        "side": {"type": "string", "enum": ["right", "below", "inline"],
                 "description": "inline (note only): written straight after the end of the line"},
        "options": {"type": "array", "items": {"type": "string"}, "description": "ask only: choices"},
        "focus": {"type": "string", "description": "circle/underline only: the smallest wrong part of the line, copied exactly from that line's `plain` (e.g. '+ 1'). The server narrows the box to it."},
        "figure": _FIGURE,
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
        "the student asked you to finish (a line left open after '=', or a spoken request). Returns "
        "`result` (plain) and `latex`: what to write after the open line's '='. Empty result = couldn't."
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "before": {"type": "string", "description": "the line to work from (usually the line before the open one), plain syntax"},
            "relation": {"type": "string", "enum": list(compute.RELATIONS)},
            "before_line_id": {"type": "string"},
            "after_line_id": {"type": "string", "description": "the open line being finished"},
        },
        "required": ["before", "relation", "before_line_id", "after_line_id"],
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
        },
        "required": ["actions", "clear_line_ids", "hint_updates"],
    },
)


def _build_config(thinking=None) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=PROMPT_PATH.read_text(),  # loaded per call so prompt edits apply live
        tools=[types.Tool(function_declarations=[VERIFY_DECL, COMPUTE_DECL, SUBMIT_DECL])],
        tool_config=types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(mode="ANY")
        ),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        thinking_config=thinking,
        temperature=0.2,
    )


def _page_json(lines: list[ReadLine], req: CheckRequest) -> str:
    return json.dumps(
        {
            "mode": req.mode,
            "help_box": list(req.help_box) if req.help_box else None,
            "question": req.question,
            "lines": [l.model_dump() for l in lines],
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
        return {"verdict": "unknown", "detail": "this line is unfinished (nothing after '='). That is not a "
                                                "mistake: do not mark it. Use compute_step to finish it."}
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


def _run_compute(args: dict, lines: list[ReadLine], result: TeachResult) -> dict:
    relation = str(args.get("relation", ""))
    before_id, after_id = _resolve_ids(args, lines)
    before = str(args.get("before") or "")
    if not before.strip():  # the model gave only the id: use that line's text
        before = next((l.plain for l in lines if l.line_id == before_id), "")
    try:
        out = compute.compute_step(before, relation)
        out = {k: str(out.get(k, "")) for k in ("result", "latex", "detail")}
    except Exception as e:  # compute_step should never raise; a bug there must not break the request
        log.exception("compute_step failed")
        out = {"result": "", "latex": "", "detail": f"compute error: {e}"}
    result.tool_calls.append(f"compute_step({before_id}->{after_id}, {relation}) = {out['result'] or 'nothing'}")
    return out


def _clean_box(v: Any) -> Any:
    if isinstance(v, (list, tuple)):
        try:
            return [max(0, min(1000, int(round(float(x))))) for x in v]
        except (TypeError, ValueError):
            return v
    return v


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
        line = by_id.get(a.get("line_id"))
        if focus and line is not None and a.get("type") in ("circle", "underline"):
            # Always start from the line's own box, so a box the model made up can't move the mark.
            a["box"] = focus_box(line.plain, list(line.box), str(focus)) or list(line.box)
        try:
            actions.append(Action.model_validate(a))
        except ValidationError as e:
            log.warning("dropping invalid action %s: %s", a, e)
    return _tidy(actions, by_id)


def _tidy(actions: list[Action], by_id: dict) -> list[Action]:
    """Shape fixes that hold for any subject: marks carry no words, and words are never lost or empty."""
    noted = {a.line_id for a in actions if a.type == "note" and a.line_id}
    out: list[Action] = []
    for a in actions:
        if a.type in ("note", "ask", "speak") and not (a.text or "").strip():
            continue  # nothing to show or say
        if a.side == "inline":
            line = by_id.get(a.line_id)
            if a.type != "note" or line is None:
                a = a.model_copy(update={"side": "right"})  # only a note can continue a line, and it needs the line
            else:
                # It continues the student's own line: their ink colour, placed by the line's real box.
                a = a.model_copy(update={"color": "black", "box": line.box})
        if a.type in ("circle", "underline") and a.text:
            # The page draws a mark without words. If the model put the hint on the mark and sent no
            # note for that line, move the words into a note beside the whole line.
            if a.line_id not in noted:
                line = by_id.get(a.line_id)
                out.append(Action(type="note", line_id=a.line_id, color=a.color, side=a.side or "right",
                                  text=a.text, box=line.box if line is not None else a.box))
                noted.add(a.line_id)
            a = a.model_copy(update={"text": None, "side": None})
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
    n = len(args.get("actions") or [])
    result.tool_calls.append(f"submit_feedback({len(result.actions)}/{n} actions kept)")


def teach(client, model: str, lines: list[ReadLine], req: CheckRequest) -> TeachResult:
    result = TeachResult()
    contents: list = [
        types.Content(role="user", parts=[types.Part.from_text(text=_page_json(lines, req))])
    ]

    for _ in range(MAX_ROUNDS):
        response = gemini.generate(client, model, contents, _build_config)
        calls = response.function_calls or []
        cand = response.candidates[0].content if response.candidates else None

        if not calls:
            if cand is not None:
                contents.append(cand)
            contents.append(types.Content(role="user", parts=[types.Part.from_text(
                text="Respond only by calling verify_step, compute_step or submit_feedback.")]))
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
                out = _run_compute(args, lines, result)
            elif call.name == "submit_feedback":
                submit = args
                out = {"ok": True}
            else:
                out = {"error": f"unknown function {call.name}"}
            replies.append(types.Part(function_response=types.FunctionResponse(
                id=call.id, name=call.name, response=out)))

        if submit is not None:
            _apply_submit(submit, result, lines)
            result.finished = True
            return result
        contents.append(types.Content(role="user", parts=replies))

    result.finished = False
    result.actions, result.clear_line_ids, result.hint_updates = [], [], []
    return result
