"""Guard and merge: plain code, no topic-specific logic."""
from internal import TeachResult
from models import Action, CheckResponse, PageState, ProblemState, ReadLine

MARK_TYPES = {"circle", "underline"}
PRINTED_BLOCKED_TYPES = {"circle", "underline", "note"}


def _keep(action: Action, verdicts: dict, printed_ids: set[str]) -> bool:
    """Safety net: never mark printed worksheet text, never mark a line red that verify_step called correct."""
    if action.type in PRINTED_BLOCKED_TYPES and action.line_id in printed_ids:
        return False
    if action.type in MARK_TYPES and action.color == "red" and action.line_id:
        return verdicts.get(action.line_id) != "correct"
    return True


def _ordered_unique(items):
    seen, out = set(), []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def merge(state: PageState, lines: list[ReadLine], result: TeachResult) -> CheckResponse:
    if result.finished:
        printed_ids = {l.line_id for l in lines if l.source == "printed"}
        actions = [a for a in result.actions if _keep(a, result.verdicts, printed_ids)]
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
