"""Guard and merge: plain code, no topic-specific logic."""
import solution
from internal import TeachResult
from models import Action, CheckResponse, PageState, ProblemState, ReadLine

MARK_TYPES = {"circle", "underline"}
PRINTED_BLOCKED_TYPES = {"circle", "underline", "note"}


def _open(line: ReadLine | None) -> bool:
    """A line the student stopped right after '=': unfinished, which is not a mistake."""
    return line is not None and line.plain.strip().endswith("=")


def _answer(action: Action) -> bool:
    """A note that writes the rest of the student's line for them."""
    return action.type == "note" and (action.color == "black" or action.side == "inline")


def _stray_ask(action: Action, line: ReadLine | None) -> bool:
    """An `ask` is only for a line the reader was unsure of. On an automatic check, a question about a
    confidently read line ("What are you looking to find?") is a nudge nobody asked for."""
    return action.type == "ask" and (line is None or line.confidence != "low")


def _unrequested(action: Action, line: ReadLine | None, result: TeachResult, kept: list[Action],
                 wanted: frozenset = frozenset()) -> bool:
    """On an automatic check the tutor only points out mistakes. True for a note that does anything else:
    a hint, a nudge or praise nobody asked for. Notes that stay: red ones (a mistake), an answer on an open
    line, anything on an open line (the student asked for it to be finished), and a note that goes with a
    figure, a question (ask) or a solution that is itself being sent for the same line. A note in a problem
    the student wrote "solve" by (`wanted`) also stays: they asked, so they are told if it could not be done."""
    if action.type != "note" or action.color == "red" or _answer(action) or _open(line):
        return False
    if action.line_id and any(a.type in ("figure", "ask", "solution") and a.line_id == action.line_id for a in kept):
        return False
    if line is not None and line.problem_id in wanted:
        return False
    if action.color is None:  # the model forgot the colour: it is a mistake note if the line is marked as one
        return not (result.verdicts.get(action.line_id) == "incorrect" or any(
            a.type in MARK_TYPES and a.color == "red" and a.line_id == action.line_id for a in result.actions))
    return True


def _keep(action: Action, verdicts: dict, by_id: dict, state: PageState, mode: str, question: str | None = None,
          wanted: frozenset = frozenset(), spoken: bool = False, solved: dict | None = None) -> bool:
    """Safety net, the same for any subject:
    - a lesson is only sent when the student tapped Teach me;
    - a line is only finished for the student (a black or inline note) if they left it open, ending in '=',
      or asked out loud in help mode;
    - printed worksheet text is never marked; the one thing allowed on it is a blue hint note in help mode
      (the student asked how to start a printed problem);
    - a line verify_step called correct is never marked red;
    - an unfinished line is never marked red;
    - on an automatic check, a line that already has feedback is not finished inline again while it is unchanged
      (in help mode the student asked, so it goes through);
    - a full worked solution is only sent when the student asked for one: they wrote "solve" (or the like) by
      that problem (`wanted`), or asked out loud in help mode (`spoken`). On an automatic check it is not
      written again under a line that already has one and has not changed (`solved`);
    - the word "solve" itself is a request, not work: it is never marked.
    """
    line = by_id.get(action.line_id)
    if action.type == "lesson":
        return False  # explain mode never reaches here
    if solution.is_request(line):
        return action.type not in MARK_TYPES | {"note", "solution"}
    if action.type == "solution":
        if line is None or not action.steps or not (spoken or line.problem_id in wanted):
            return False
        return not (mode == "auto" and solved is not None and solved.get(line.line_id) == line.plain)
    if _answer(action) and not _open(line) and not (mode == "help" and (question or "").strip()):
        return False
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


def _new_mistake(action: Action, line: ReadLine, verdicts: dict, marked: dict | None) -> bool:
    """A red mark for a line the checker called incorrect, which the page is not known to carry yet. A line
    can be flagged for other reasons (a hint, a question about the handwriting, a graph); that must not
    hide its mistake."""
    return (marked is not None and action.color == "red" and action.type in MARK_TYPES | {"note"}
            and verdicts.get(action.line_id) == "incorrect" and marked.get(action.line_id) != line.plain)


def _new_solution(action: Action, line: ReadLine, solved: dict | None) -> bool:
    """A requested solution for a line the page is not known to have one under yet. The line may be flagged
    for something else (a hint, a mistake mark): the request was written after that."""
    return action.type == "solution" and solved is not None and solved.get(action.line_id) != line.plain


def merge(state: PageState, lines: list[ReadLine], result: TeachResult, mode: str = "auto",
          question: str | None = None, marked: dict | None = None, solved: dict | None = None) -> CheckResponse:
    """`mode` is the request's mode ("auto", "help" or "explain"); `question` is what the student asked out loud.
    `marked` (line_id -> the line's text when a mistake mark was last sent for it) is what the server
    remembers of this page; None = nothing known, and a flagged, unchanged line then gets nothing new.
    `solved` is the same for worked solutions (line_id -> the line's text when one was written under it)."""
    if mode == "explain":
        # Teach me: the lesson goes through as it is. It is not feedback on a line, so it changes nothing
        # the checks rely on: no hint levels, nothing cleared, and its line is not added to flagged_line_ids
        # (a flagged, unchanged line gets no new feedback on automatic checks, which would hide a mistake).
        actions = [a for a in result.actions if a.type == "lesson" and a.lesson is not None] if result.finished else []
        clear, hint_updates = [], []
    elif result.finished:
        by_line = {l.line_id: l for l in lines}
        # Who asked for a full solution: problems with a handwritten "solve" by them, or a spoken question
        # in help mode that asks for it (the model's flag is only trusted there, with a question present).
        wanted = frozenset(solution.requested_problems(lines))
        asked = (question or "").strip()
        spoken = mode == "help" and bool(asked) and (result.solution_requested or solution.asks_aloud(asked))
        actions = [a for a in result.actions
                   if _keep(a, result.verdicts, by_line, state, mode, question, wanted, spoken, solved)]
        if mode == "auto":
            # Nobody asked: nothing is read aloud, and a question only goes to a line that was hard to read.
            actions = [a for a in actions if a.type != "speak" and not _stray_ask(a, by_line.get(a.line_id))]
            actions = [a for a in actions if not _unrequested(a, by_line.get(a.line_id), result, actions, wanted)]
            # No repeats: a line that already has feedback on the page and reads exactly as it did last
            # time gets nothing new from an automatic check. (Help may add to it: that's the hint ladder.)
            # The one thing that still goes through is a mistake mark the line does not have yet.
            before = {l.line_id: l.plain for l in state.lines}
            settled = {i for i in state.flagged_line_ids
                       if i in by_line and before.get(i) == by_line[i].plain}
            actions = [a for a in actions if a.line_id not in settled
                       or _new_mistake(a, by_line[a.line_id], result.verdicts, marked)
                       or _new_solution(a, by_line[a.line_id], solved)]
        clear = list(result.clear_line_ids)
        hint_updates = result.hint_updates if mode == "help" else []  # the hint ladder only moves when Help is tapped
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
    action_ids = [a.line_id for a in actions if a.line_id and a.type != "lesson"]
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
