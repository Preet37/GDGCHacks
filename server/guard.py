"""Guard and merge: plain code, no topic-specific logic."""
from internal import TeachResult
from models import Action, CheckResponse, PageState, ProblemState, ReadLine

MARK_TYPES = {"circle", "underline"}
PRINTED_BLOCKED_TYPES = {"circle", "underline", "note"}


def _open(line: ReadLine | None) -> bool:
    """A line the student stopped right after '=': unfinished, which is not a mistake."""
    return line is not None and line.plain.strip().endswith("=")


def _keep(action: Action, verdicts: dict, by_id: dict, state: PageState, mode: str) -> bool:
    """Safety net, the same for any subject:
    - printed worksheet text is never marked; the one thing allowed on it is a blue hint note in help mode
      (the student asked how to start a printed problem);
    - a line verify_step called correct is never marked red;
    - an unfinished line is never marked red;
    - on an automatic check, a line that already has feedback is not finished inline again while it is unchanged
      (in help mode the student asked, so it goes through).
    """
    line = by_id.get(action.line_id)
    if line is not None and line.source == "printed" and action.type in PRINTED_BLOCKED_TYPES:
        return action.type == "note" and mode == "help" and action.color in ("blue", None) and action.side != "inline"
    if action.color == "red" and action.type in MARK_TYPES | {"note"} and _open(line):
        return False
    if action.type in MARK_TYPES and action.color == "red" and action.line_id:
        return verdicts.get(action.line_id) != "correct"
    if action.side == "inline" and mode == "auto" and line is not None and action.line_id in state.flagged_line_ids:
        before = next((l for l in state.lines if l.line_id == action.line_id), None)
        return before is None or before.plain.replace(" ", "") != line.plain.replace(" ", "")
    return True


def _ordered_unique(items):
    seen, out = set(), []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def merge(state: PageState, lines: list[ReadLine], result: TeachResult, mode: str = "auto") -> CheckResponse:
    """`mode` is the request's mode ("auto" or "help")."""
    if result.finished:
        by_line = {l.line_id: l for l in lines}
        actions = [a for a in result.actions if _keep(a, result.verdicts, by_line, state, mode)]
        if mode == "auto":
            # No repeats: a line that already has feedback on the page and reads exactly as it did last
            # time gets nothing new from an automatic check. (Help may add to it: that's the hint ladder.)
            before = {l.line_id: l.plain for l in state.lines}
            settled = {i for i in state.flagged_line_ids
                       if i in by_line and before.get(i) == by_line[i].plain}
            actions = [a for a in actions if a.line_id not in settled]
        clear = list(result.clear_line_ids)
        hint_updates = result.hint_updates
    else:
        actions, clear, hint_updates = [], [], []

    # Hint levels
    problems = [p.model_copy() for p in state.problems]
    by_id = {p.problem_id: p for p in problems}
    for hu in hint_updates:
        level = max(0, min(3, int(hu.hint_level)))
        if hu.problem_id in by_id:
            by_id[hu.problem_id].hint_level = level
        else:
            p = ProblemState(problem_id=hu.problem_id, hint_level=level)
            problems.append(p)
            by_id[p.problem_id] = p

    # Flagged / clear bookkeeping
    present = {l.line_id for l in lines}
    action_ids = [a.line_id for a in actions if a.line_id]
    flagged = [i for i in state.flagged_line_ids if i not in set(clear)] + action_ids
    flagged = _ordered_unique(flagged)
    gone = [i for i in flagged if i not in present]
    flagged = [i for i in flagged if i in present]
    clear = _ordered_unique(clear + gone)

    new_state = PageState(
        page_id=state.page_id,
        lines=list(lines),
        problems=problems,
        flagged_line_ids=flagged,
    )
    return CheckResponse(lines=list(lines), actions=actions, clear_line_ids=clear, state=new_state)
