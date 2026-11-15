"""Your turn: practice problems the tutor wrote on the page, and the student's work under them.

The page sends each tutor-written problem line as a `GivenLine`. Here it becomes an ordinary ReadLine that
starts its own problem, so the handwriting under it is checked against it like work under a problem the
student wrote themselves. Plain code, geometry only: the same for any subject.

How a given line is told apart without a contract change: it is a `source: "printed"` line (so it is never
marked) whose `line_id` starts with "G". The id is made from the line's text, so it is the same on every
request, and it survives the round trip through `state.lines`. The reader's own ids never start with "G"
(`merge_given` renumbers one that does).
"""
import hashlib
import re

import compute
import solution
import verify
from models import GivenLine, ReadLine
from target import NEAR

ID_PREFIX = "G"
DUPLICATE_SHARE = 0.5   # a read line with this share of its box inside a given line's box is that same text
TRY_FIRST = "Try it first, then tap Help if you're stuck."


def key(plain: str) -> str:
    """A problem's text with spacing and case taken out: how a practice problem is recognised again."""
    return re.sub(r"\s+", "", plain or "").lower()


def is_given(line: ReadLine | None) -> bool:
    return line is not None and line.source == "printed" and line.line_id.startswith(ID_PREFIX)


def problems(lines: list[ReadLine]) -> dict[str, ReadLine]:
    """problem_id -> the tutor-written line that states it."""
    return {l.problem_id: l for l in lines if is_given(l)}


def work(lines: list[ReadLine], given: ReadLine) -> list[ReadLine]:
    """The student's lines under a given line, in reading order. A written "solve" is a request, not work."""
    return [l for l in lines if l.problem_id == given.problem_id and l is not given
            and l.source != "printed" and not solution.is_request(l)]


def line_ids(lines: list[ReadLine]) -> frozenset:
    """Ids of every line that belongs to a practice problem (the given lines included)."""
    pids = problems(lines)
    return frozenset(l.line_id for l in lines if l.problem_id in pids)


# ---- GivenLine -> ReadLine ----

def _box(raw) -> tuple[int, int, int, int]:
    y0, x0, y1, x1 = (min(1000, max(0, int(v))) for v in raw)
    return (min(y0, y1), min(x0, x1), max(y0, y1), max(x0, x1))


def given_lines(given: list[GivenLine] | None) -> list[ReadLine]:
    """One ReadLine per given line, top to bottom. Same text -> same id on every request."""
    out, seen = [], {}
    for g in sorted(given or [], key=lambda g: (min(g.box[0], g.box[2]), min(g.box[1], g.box[3]))):
        plain = (g.plain or "").strip()
        if not plain:
            continue
        base = ID_PREFIX + hashlib.sha1(key(plain).encode()).hexdigest()[:6]
        seen[base] = seen.get(base, 0) + 1
        line_id = base if seen[base] == 1 else f"{base}{seen[base]}"  # the same problem set twice on one page
        out.append(ReadLine(line_id=line_id, problem_id="P" + line_id, latex=(g.latex or plain).strip(), plain=plain,
                            box=_box(g.box), relation="start", confidence="high", source="printed"))
    return out


# ---- geometry ----

def _mid(line: ReadLine) -> float:
    return (line.box[0] + line.box[2]) / 2


def _across(a, b) -> int:
    """Width two boxes share; zero or less = not above one another."""
    return min(a[3], b[3]) - max(a[1], b[1])


def _share(a, b) -> float:
    """The share of box `a` that lies inside box `b`."""
    h, w = min(a[2], b[2]) - max(a[0], b[0]), _across(a, b)
    if h <= 0 or w <= 0:
        return 0.0
    return h * w / max(1, (a[2] - a[0]) * (a[3] - a[1]))


def _same_text(read: ReadLine, given: ReadLine) -> bool:
    return (_share(read.box, given.box) >= DUPLICATE_SHARE
            or (_share(given.box, read.box) >= DUPLICATE_SHARE and key(read.plain) == key(given.plain)))


def math_text(plain: str) -> str:
    """A line as the checker should get it: without a part label or words in front, when that leaves math."""
    plain = (plain or "").strip()
    return plain if compute.operation(plain) is not None else (solution.math_part(plain) or plain)


def _is_math(line: ReadLine) -> bool:
    return not solution.is_request(line) and bool(compute.operation(line.plain) or solution.math_part(line.plain))


def merge_given(lines: list[ReadLine], given: list[GivenLine] | None, tasks: dict | None = None) -> list[ReadLine]:
    """The page's lines with the tutor-written problem lines in place.

    - A line the reader read off the same spot as a given line is that text again: dropped, the given one stays.
    - Handwriting belongs to a given line's problem when the reader already put it there (it grouped it with
      the text it read at that spot, or kept the problem id from last time), or when it starts directly under
      the given line: the first line below it, above the next given line, no further than NEAR, with nothing
      of another problem nearer to it. Lines the reader grouped with that first line follow it, down to the
      first line of anything else.
    - The first line of that work is not a `start`: the given line is. It gets the relation the practice was
      set with (`tasks`: text key -> relation, from memory) when that is known, else "other", and the tutor
      picks the relation when it checks it. Nothing here looks at the maths.
    """
    givens = given_lines(given)
    used = {l.line_id for l in lines}
    n = max([int(m.group(1)) for m in (re.fullmatch(r"L(\d+)", i) for i in used) if m], default=0)
    out: list[ReadLine] = []
    read_as: dict[str, ReadLine] = {}  # the reader's problem id for a given line's text -> that given line
    for l in lines:
        dup = next((g for g in givens if _same_text(l, g)), None)
        if dup is not None:
            read_as.setdefault(l.problem_id, dup)
            continue
        if is_given(l):  # only this module makes "G" ids
            n += 1
            while f"L{n}" in used:
                n += 1
            l = l.model_copy(update={"line_id": f"L{n}"})
            used.add(l.line_id)
        out.append(l)
    if not givens:
        return out

    tasks = tasks or {}
    for g in givens:
        stop = min([o.box[0] for o in givens if o is not g and o.box[0] > g.box[0] and _across(o.box, g.box) > 0],
                   default=1001)
        pids = {g.problem_id} | {p for p, d in read_as.items() if d is g}
        grouped = set(pids)
        under = sorted((l for l in out if g.box[2] <= _mid(l) < stop and _across(l.box, g.box) > 0),
                       key=lambda l: l.box[0])
        if under and under[0].source != "printed" and under[0].problem_id not in pids:
            first = under[0]
            gap = first.box[0] - g.box[2]
            nearer = any(o is not first and o.box[2] <= _mid(first) and _across(o.box, first.box) > 0
                         and first.box[0] - o.box[2] < gap for o in out)
            if gap <= NEAR and not nearer:
                pids.add(first.problem_id)
        mine: set[int] = set()
        for l in under:
            if l.source == "printed" or l.problem_id not in pids:
                break  # the next problem starts here
            mine.add(id(l))
        for l in out:  # what the reader itself grouped with this text, beside it or below it
            if l.problem_id in grouped and l.source != "printed" and g.box[0] < _mid(l) < stop:
                mine.add(id(l))
        at, started = None, False
        for i, l in enumerate(out):
            if id(l) not in mine:
                continue
            at = i if at is None else at
            update = {"problem_id": g.problem_id}
            if not started and _is_math(l):
                started = True
                if l.relation in ("start", "other"):
                    update["relation"] = tasks.get(key(g.plain)) or "other"
            out[i] = l.model_copy(update=update)
        if at is None:  # no work yet: the given line goes where it sits on the page
            at = next((i for i, l in enumerate(out) if l.box[0] > g.box[0]), len(out))
        out.insert(at, g)
    return out


# ---- is a practice problem answered? ----

def _solved_form(plain: str) -> bool:
    """'x = 4', 'x = 1 or x = -1': every part names one letter and gives it a value without that letter."""
    parts = [p for p in re.split(r",|;|\bor\b|\band\b", plain) if p.strip()]
    for p in parts:
        m = re.match(r"^\s*([A-Za-z])\s*=\s*(\S.*)$", p)
        if not m or re.search(rf"(?<![A-Za-z]){m.group(1)}(?![A-Za-z])", m.group(2)):
            return False
    return bool(parts)


def done(lines: list[ReadLine], verdicts: dict) -> dict[str, str]:
    """problem_id -> the id of its final line, for each practice problem whose work is finished and right:
    the last line under the given line was checked `correct`, is not left open, and no line of the work was
    checked `incorrect`. When the given line is an equation, the last line must also state the value(s)."""
    out = {}
    for pid, g in problems(lines).items():
        mine = work(lines, g)
        if not mine or mine[-1].plain.strip().endswith("="):
            continue
        last = mine[-1]
        if verdicts.get(last.line_id) != "correct" or any(verdicts.get(l.line_id) == "incorrect" for l in mine):
            continue
        stated = "" if compute.operation(g.plain) is not None else solution.math_part(g.plain)
        if stated and verify.is_equation(stated) and not _solved_form(last.plain):
            continue
        out[pid] = last.line_id
    return out


def status(lines: list[ReadLine], verdicts: dict) -> list[dict]:
    """What memory keeps about each practice problem in view."""
    finished = done(lines, verdicts)
    return [{"problem": g.plain, "latex": g.latex, "problem_id": pid, "lines": len(work(lines, g)),
             "correct": pid in finished} for pid, g in problems(lines).items()]
