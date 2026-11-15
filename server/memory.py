"""What this server process remembers about a page between requests. Best effort, in memory only.

The contract's PageState has no room for the words of earlier hints or for what kind of feedback a line
has, so the server keeps them here, keyed by page_id. After a restart (or on another instance) the memory
is empty and everything still works: hints may repeat an idea, and a mistake mark may be sent once more.
"""
import threading
from collections import OrderedDict

MAX_PAGES = 300
MAX_HINTS = 3   # per problem

_lock = threading.Lock()
_pages: "OrderedDict[str, dict]" = OrderedDict()


def reset() -> None:
    with _lock:
        _pages.clear()


def _page(page_id: str) -> dict:
    page = _pages.get(page_id)
    if page is None:
        page = _pages[page_id] = {"hints": {}, "marked": {}}
        while len(_pages) > MAX_PAGES:
            _pages.popitem(last=False)
    _pages.move_to_end(page_id)
    return page


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


def remember(page_id: str, mode: str, lines, actions, clear_line_ids) -> None:
    """Record what was just sent: hint notes (help mode) and mistake marks."""
    by_id = {l.line_id: l for l in lines}
    with _lock:
        page = _page(page_id)
        for i in clear_line_ids:
            page["marked"].pop(i, None)
        for i in [i for i in page["marked"] if i not in by_id]:
            del page["marked"][i]
        for a in actions:
            line = by_id.get(a.line_id)
            if line is None:
                continue
            if a.color == "red" and a.type in ("circle", "underline", "note"):
                page["marked"][line.line_id] = line.plain
            elif mode == "help" and a.type == "note" and a.color in ("blue", None) and a.side != "inline" and a.text:
                texts = page["hints"].setdefault(line.problem_id, [])
                if a.text not in texts:
                    texts.append(a.text)
                del texts[:-MAX_HINTS]
