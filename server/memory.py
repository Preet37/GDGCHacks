"""What this server process remembers about a page between requests. Best effort, in memory only.

The contract's PageState has no room for the words of earlier hints, for what kind of feedback a line
has, or for which practice problems were set and how they went, so the server keeps them here, keyed by page_id. After a restart (or on another instance) the memory
is empty and everything still works: hints may repeat an idea, and a mistake mark may be sent once more.
"""
import threading
from collections import OrderedDict

MAX_PAGES = 300
MAX_HINTS = 3   # per problem
MAX_PRACTICE = 20  # practice problems remembered per page

_lock = threading.Lock()
_pages: "OrderedDict[str, dict]" = OrderedDict()


def reset() -> None:
    with _lock:
        _pages.clear()


def _page(page_id: str) -> dict:
    page = _pages.get(page_id)
    if page is None:
        page = _pages[page_id] = {"hints": {}, "marked": {}, "solved": {}, "practice": {}, "turns": []}
        while len(_pages) > MAX_PAGES:
            _pages.popitem(last=False)
    _pages.move_to_end(page_id)
    return page


MAX_TURNS = 4


def remember_turn(page_id: str, mode: str, question: str | None, actions) -> None:
    """One exchange on this page: what the student asked (out loud or by a button) and what came back, in a line
    or two. Kept so that "a 3D model for this" or "make me a lesson" is read as being about the same subject."""
    said = []
    for a in actions or []:
        if a.type in ("note", "ask") and a.text:
            said.append(a.text.strip()[:240])
        elif a.type == "solution":
            said.append("[wrote a worked solution]")
        elif a.type == "figure" and a.figure is not None:
            said.append(f"[drew a {a.figure.kind} figure: {a.figure.title or ', '.join(a.figure.expressions or [])}]"[:120])
        elif a.type == "lesson" and a.lesson is not None:
            said.append(f"[played a lesson: {a.lesson.title}]"[:120])
    q = (question or "").strip()
    if not q and not (mode in ("help", "explain") and said):
        return
    with _lock:
        turns = _page(page_id).setdefault("turns", [])
        turns.append({"student_asked": q[:300] or ("(tapped Teach me)" if mode == "explain" else "(tapped Help)"),
                      "tutor_answered": " ".join(dict.fromkeys(said))[:600] or "(nothing)"})
        del turns[:-MAX_TURNS]


def recent_turns(page_id: str) -> list[dict]:
    with _lock:
        return [dict(t) for t in _pages.get(page_id, {}).get("turns", [])]


def previous_hints(page_id: str, problems) -> dict[str, list[str]]:
    """problem_id -> the hints already given for it, oldest first. Only for problems the page says have hints."""
    live = {p.problem_id for p in problems if p.hint_level > 0}
    with _lock:
        hints = _pages.get(page_id, {}).get("hints", {})
        for pid in [pid for pid in hints if pid not in live]:
            del hints[pid]  # the page started that problem's hints over
        return {pid: list(texts) for pid, texts in hints.items() if texts}


def marked(page_id: str) -> dict[str, str]:
    """line_id -> the line's text when a mistake mark was last sent for it."""
    with _lock:
        return dict(_pages.get(page_id, {}).get("marked", {}))


def solved(page_id: str) -> dict[str, str]:
    """line_id -> the line's text when a worked solution was last written under it."""
    with _lock:
        return dict(_pages.get(page_id, {}).get("solved", {}))


def remember(page_id: str, mode: str, lines, actions, clear_line_ids) -> None:
    """Record what was just sent: hint notes (help mode) and mistake marks."""
    by_id = {l.line_id: l for l in lines}
    with _lock:
        page = _page(page_id)
        for kind in ("marked", "solved"):
            for i in clear_line_ids:
                page[kind].pop(i, None)
            for i in [i for i in page[kind] if i not in by_id]:
                del page[kind][i]
        for a in actions:
            line = by_id.get(a.line_id)
            if line is None:
                continue
            if a.type == "solution":
                page["solved"][line.line_id] = line.plain
            elif a.color == "red" and a.type in ("circle", "underline", "note"):
                page["marked"][line.line_id] = line.plain
            elif mode == "help" and a.type == "note" and a.color in ("blue", None) and a.side != "inline" and a.text:
                texts = page["hints"].setdefault(line.problem_id, [])
                if a.text not in texts:
                    texts.append(a.text)
                del texts[:-MAX_HINTS]


# ---- practice problems ("Your turn"): which were set on a page, and whether each was answered correctly ----

def _key(plain: str) -> str:
    return "".join((plain or "").split()).lower()


def _practice(page: dict, plain: str, latex: str = "") -> dict:
    items = page["practice"]
    item = items.get(_key(plain))
    if item is None:
        item = items[_key(plain)] = {"problem": plain, "latex": latex, "relation": None, "status": "set",
                                     "lines": 0, "checks": 0}
        while len(items) > MAX_PRACTICE:
            del items[next(iter(items))]
    return item


def practice_set(page_id: str, plain: str, latex: str = "", relation: str | None = None) -> None:
    """A lesson just set this practice problem. `relation` is what the student is asked to do to it."""
    if not (plain or "").strip():
        return
    with _lock:
        item = _practice(_page(page_id), plain, latex)
        item.update(latex=latex or item["latex"], relation=relation or item["relation"])


def practice_tasks(page_id: str) -> dict[str, str]:
    """problem text (spacing and case removed) -> the relation it was set with, where known."""
    with _lock:
        items = _pages.get(page_id, {}).get("practice", {})
        return {k: v["relation"] for k, v in items.items() if v["relation"]}


def practice_seen(page_id: str, statuses) -> None:
    """Record how each practice problem in view stands after a check: no work yet ("set"), work that is
    not finished or not right ("attempted"), or a correct final answer ("correct")."""
    if not statuses:
        return
    with _lock:
        page = _page(page_id)
        for s in statuses:
            item = _practice(page, s["problem"], s.get("latex", ""))
            item["lines"] = s["lines"]
            item["checks"] += 1
            item["status"] = "correct" if s["correct"] else "attempted" if s["lines"] else "set"


def practice(page_id: str) -> list[dict]:
    """The page's practice problems, oldest first, each with `status` and `answered_correctly`."""
    with _lock:
        items = _pages.get(page_id, {}).get("practice", {})
        return [dict(v, answered_correctly=v["status"] == "correct") for v in items.values()]
