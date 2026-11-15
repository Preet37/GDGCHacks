"""Your turn: practice problems the tutor wrote on the page, and the student's work under them.

The page sends each tutor-written problem line as a `GivenLine`. Here it becomes an ordinary ReadLine that
starts its own problem, so the handwriting under it is checked against it like work under a problem the
student wrote themselves. Plain code, geometry only: the same for any subject.

How a given line is told apart without a contract change: it is a `source: "printed"` line (so it is never
marked) whose `line_id` starts with "G". The id is made from the line's text, so it is the same on every
request, and it survives the round trip through `state.lines`. The reader's own ids never start with "G"
(`merge_given` renumbers one that does).

A practice problem is usually two given lines: the statement (`g(x) = 4x^2 + 5x`) and under it an "ask" line
that ends in `=` (`g'(x) =`), which the student finishes on its own row. Both belong to one problem, named
after the statement. Ink on the ask line's row is the student's answer: it takes the ask line's place.
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
ROW_BEYOND = 25         # ink must reach this far right of an ask line's box to be an answer written after it
SAME_SPOT = 0.85        # ... and have less than this share of its box inside the ask line's box
TRY_FIRST = "Try it first, then tap Help if you're stuck."


def key(plain: str) -> str:
    """A problem's text with spacing and case taken out: how a practice problem is recognised again."""
    return re.sub(r"\s+", "", plain or "").lower()


def is_given(line: ReadLine | None) -> bool:
    return line is not None and line.source == "printed" and line.line_id.startswith(ID_PREFIX)


def is_ask(line: ReadLine | None) -> bool:
    """A tutor-written line left open for the student to finish (`g'(x) =`)."""
    return is_given(line) and _open(line.plain)


def _open(plain: str) -> bool:
    return (plain or "").strip().endswith("=")


def problems(lines: list[ReadLine]) -> dict[str, ReadLine]:
    """problem_id -> the tutor-written line that states it (the statement, not the ask line under it)."""
    out: dict[str, ReadLine] = {}
    for l in lines:
        if is_given(l) and (l.problem_id not in out or (is_ask(out[l.problem_id]) and not is_ask(l))):
            out[l.problem_id] = l
    return out


def work(lines: list[ReadLine], given: ReadLine) -> list[ReadLine]:
    """The student's lines of a given line's problem, in reading order. A written "solve" is a request, not work."""
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
    """One ReadLine per given line, top to bottom. Same text -> same id on every request.
    An ask line (ends in `=`) directly under a statement line is part of that statement's problem."""
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
    for i, a in enumerate(out):
        if not _open(a.plain):
            continue
        above = [o for o in out if not _open(o.plain) and o.box[0] < a.box[0] and _across(o.box, a.box) > 0
                 and a.box[0] - o.box[2] <= NEAR and _mid(o) < a.box[0]]
        if above:
            owner = max(above, key=lambda o: o.box[2])
            out[i] = a.model_copy(update={"problem_id": owner.problem_id, "relation": "other"})
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


def _text_key(plain: str) -> str:
    return re.sub(r"[\u2032\u2019`\u00b4]", "'", key(plain))


def _on_row(l: ReadLine, a: ReadLine) -> bool:
    shared = min(l.box[2], a.box[2]) - max(l.box[0], a.box[0])
    return a.box[0] <= _mid(l) <= a.box[2] or shared >= 0.5 * max(1, min(l.box[2] - l.box[0], a.box[2] - a.box[0]))


def _row_part(l: ReadLine, a: ReadLine, reach: int) -> str | None:
    """Is this read line the student finishing ask line `a` on its own row? "whole": the reader read the row
    as one line, the tutor's text included. "part": only what the student wrote after it. None: neither
    (elsewhere on the page, or just the tutor's text read again). `reach`: how far right the row goes so far."""
    if solution.is_request(l) or not _on_row(l, a):
        return None
    if l.box[3] <= a.box[1] or l.box[1] - reach > NEAR:   # left of the ask line, or in another column
        return None
    k, ka = _text_key(l.plain), _text_key(a.plain)
    if not k or k == ka or _open(l.plain):
        return None
    if k.startswith(ka):
        return "whole"
    if l.box[3] - a.box[3] < ROW_BEYOND or _share(l.box, a.box) >= SAME_SPOT:
        return None                                          # the tutor's text, read a little differently
    covers = _across(l.box, a.box) >= 0.5 * (a.box[3] - a.box[1])
    left = l.plain.split("=", 1)[0].strip()
    return "whole" if covers and "=" in l.plain and left else "part"


def _asked(ask: ReadLine, statement: ReadLine | None) -> str | None:
    """What an ask line asks for, where its own text makes that clear: `g'(x) =`, `dy/dx =`, `x =`."""
    left = ask.plain.strip().rstrip("=").strip()
    if re.search(r"[A-Za-z]\s*['\u2032\u2019]", left) or re.search(r"\bd[A-Za-z]?\s*/\s*d[A-Za-z]\b", left):
        return "derivative"
    if re.match(r"(int\b|integral\b|\u222b)", left, re.I):
        return "integral"
    if statement is not None and re.fullmatch(r"[A-Za-z]", left):
        stated = solution.math_part(statement.plain)
        if stated and verify.is_equation(stated) and re.search(rf"(?<![A-Za-z]){left}(?![A-Za-z])", stated):
            return "solve"
    return None


def _answer(a: ReadLine, parts: list[tuple[ReadLine, str]], asked: str | None, known: str | None) -> ReadLine:
    """The student's answer on ask line `a`'s row as one line: the ask's text, then what they wrote. It keeps
    the reader's id (and box, unless the reader split the ink into several lines)."""
    parts = sorted(parts, key=lambda p: p[0].box[1])
    (first, kind), rest = parts[0], [p for p, _ in parts[1:]]
    plain, latex = first.plain.strip(), first.latex.strip()
    if kind == "part":
        plain = a.plain.strip() + " " + plain.lstrip("= ")
        latex = a.latex.strip() + " " + latex.lstrip("= ")
    for p in rest:
        plain, latex = f"{plain} {p.plain.strip().lstrip('= ')}", f"{latex} {p.latex.strip().lstrip('= ')}"
    box = first.box
    for p in rest:
        box = (min(box[0], p.box[0]), min(box[1], p.box[1]), max(box[2], p.box[2]), max(box[3], p.box[3]))
    relation = asked or (first.relation if first.relation not in ("start", "other") else known or "other")
    return first.model_copy(update={"plain": plain, "latex": latex, "box": box, "problem_id": a.problem_id,
                                    "relation": relation, "source": None if first.source == "printed" else first.source})


def _label(plain: str) -> str | None:
    """The function a statement names: `g(x) = 4*x^2 + 5*x` -> "g". None if it names none."""
    m = re.match(r"\s*([A-Za-z])\s*'*\s*\(\s*[A-Za-z]\s*\)\s*=", plain or "")
    return m.group(1) if m else None


def _new_problem(l: ReadLine, statement: ReadLine) -> bool:
    """A line under an ANSWERED practice problem that starts something of the student's own: the reader read it
    as the start of a problem, and it is not about the practice function (`d/dx (x*sin(x))` under `g'(x) = 8x + 5`).
    Such a line is not practice work: Solve and Help treat it like any other problem."""
    if l.relation != "start" or l.source == "printed":
        return False
    name = _label(statement.plain)
    if name and re.search(rf"(?<![A-Za-z]){name}\s*'*\s*\(", l.plain or ""):
        return False  # g'(x) = 5 + 8x: still about g
    return bool(name) or compute.operation(l.plain) is not None


def merge_given(lines: list[ReadLine], given: list[GivenLine] | None, tasks: dict | None = None) -> list[ReadLine]:
    """The page's lines with the tutor-written problem lines in place.

    - Ink on an ask line's row, reaching past it to the right, is the student finishing that line. It becomes
      one line with the whole text (`g'(x) = 8*x + 5`), whether the reader read the row as one line or only
      the part after the `=`, and takes the ask line's place in the statement's problem. Its relation is what
      the ask line asks for where that is clear (`g'(x) =`: derivative), so it is checked against the statement.
    - A line the reader read off the same spot as a given line is that text again: dropped, the given one stays.
    - Handwriting belongs to a given line's problem when the reader already put it there (it grouped it with
      the text it read at that spot, or kept the problem id from last time), or when it starts directly under
      the given line: the first line below it, above the next given line, no further than NEAR, with nothing
      of another problem nearer to it. Lines the reader grouped with that first line follow it, down to the
      first line of anything else.
    - The first line of that work is not a `start`: the given line is. It gets what the ask line asks for, or
      the relation the practice was set with (`tasks`: text key -> relation, from memory) when that is known,
      else "other", and the tutor picks the relation when it checks it. Nothing here looks at the maths.
    """
    givens = given_lines(given)
    tasks = tasks or {}
    stated = problems(givens)

    def asked(g: ReadLine) -> str | None:
        owner = stated.get(g.problem_id, g)
        return _asked(g, owner if owner is not g else None) if _open(g.plain) else None

    def relation_for(g: ReadLine) -> str | None:
        return asked(g) or tasks.get(key(stated.get(g.problem_id, g).plain)) or tasks.get(key(g.plain))

    # The student's answer written on an ask line's own row.
    asks = [g for g in givens if _open(g.plain)]
    row: dict[str, tuple[ReadLine, str]] = {}  # read line id -> (its ask line, "whole" | "part")
    for a in asks:
        reach = a.box[3]
        for l in sorted(lines, key=lambda l: l.box[1]):
            kind = None if l.line_id in row else _row_part(l, a, reach)
            if kind:
                row[l.line_id], reach = (a, kind), max(reach, l.box[3])
    answers: dict[str, ReadLine] = {}          # ask line id -> the answer line that takes its place
    for a in asks:
        parts = [(l, row[l.line_id][1]) for l in lines if l.line_id in row and row[l.line_id][0] is a]
        if parts:
            answers[a.line_id] = _answer(a, parts, asked(a), relation_for(a))
    placed: set[str] = set()
    used = {l.line_id for l in lines}
    n = max([int(m.group(1)) for m in (re.fullmatch(r"L(\d+)", i) for i in used) if m], default=0)
    out: list[ReadLine] = []
    read_as: dict[str, ReadLine] = {}  # the reader's problem id for a given line's text -> that given line
    for l in lines:
        if l.line_id in row:
            a, kind = row[l.line_id]
            if kind == "whole":
                read_as.setdefault(l.problem_id, a)
            if a.line_id in placed:
                continue  # the reader split the answer: this piece is already in the line placed for it
            placed.add(a.line_id)
            l = answers[a.line_id]
        else:
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

    for g in givens:
        answer = answers.get(g.line_id)
        stop = min([o.box[0] for o in givens if o is not g and o.box[0] > g.box[0] and _across(o.box, g.box) > 0],
                   default=1001)
        pids = {g.problem_id} | {p for p, d in read_as.items() if d is g}
        grouped = set(pids)
        under = sorted((l for l in out if g.box[2] <= _mid(l) < stop and _across(l.box, g.box) > 0),
                       key=lambda l: l.box[0])
        statement = stated.get(g.problem_id, g)
        # the ask line is answered on its own row: what comes under it may be a new problem of the student's
        fresh = next((l for l in under if answer is not None and _new_problem(l, statement)), None)
        if fresh is not None:
            stop = min(stop, fresh.box[0])
            under = [l for l in under if l.box[0] < fresh.box[0]]
        if under and under[0].source != "printed" and under[0].problem_id not in pids:
            first = under[0]
            gap = first.box[0] - g.box[2]
            nearer = any(o is not first and o.box[2] <= _mid(first) and _across(o.box, first.box) > 0
                         and first.box[0] - o.box[2] < gap for o in out)
            if gap <= NEAR and not nearer:
                pids.add(first.problem_id)
        mine: set[int] = {id(l) for l in out if answer is not None and l.line_id == answer.line_id}
        for l in under:
            if l.source == "printed" or l.problem_id not in pids:
                break  # the next problem starts here
            mine.add(id(l))
        for l in out:  # what the reader itself grouped with this text, beside it or below it
            if l.problem_id in grouped and l.source != "printed" and g.box[0] < _mid(l) < stop:
                mine.add(id(l))
        at, started = None, answer is not None
        for i, l in enumerate(out):
            if id(l) not in mine:
                continue
            at = i if at is None else at
            update = {"problem_id": g.problem_id}
            if not started and _is_math(l):
                started = True
                if l.relation in ("start", "other"):
                    update["relation"] = relation_for(g) or "other"
            out[i] = l.model_copy(update=update)
        if at is None:  # no work yet: the given line goes where it sits on the page
            at = next((i for i, l in enumerate(out) if l.box[0] > g.box[0]), len(out))
        if answer is None:  # an ask line the student wrote on is that line now
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
    the last line of its work was checked `correct`, is not left open, and no line of the work was
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
