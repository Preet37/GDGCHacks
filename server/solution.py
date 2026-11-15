"""Full solve: the student asked for the whole worked solution, written out under their problem.

Plain code, the same for any subject. Three jobs:
- say whether a solution was asked for (a handwritten request word by the problem, or a spoken question);
- pick where the steps go (under the last line of the problem's work) and which line they continue from
  (the last line that is not wrong);
- check the chain of steps with verify.py before anything is sent. A step the checker calls wrong is never shown.
"""
import re
import threading

import compute
import verify
from models import ReadLine
from target import NEAR, _distance

MAX_STEPS = 8
STEP_RELATIONS = ("solve", "equals", "simplify", "derivative", "integral")
TIMEOUT_S = 4.0  # SymPy can grind on a hard equation; the request must not hang on it

# What a student writes by a problem to ask for the whole solution. Small on purpose: a copied instruction
# like "solve for x" is part of the problem, not a request.
_REQUEST = re.compile(
    r"^(?:please )?(?:"
    r"solve(?: (?:it|this|that|this one|for me|it for me|this for me))?"
    r"|work (?:it|this) out"
    r"|show (?:me )?(?:the |all |all the )?(?:steps|work|working)"
    r"|(?:full |worked |whole )?solution"
    r"|steps"
    r")(?: please)?$")
# The same idea in a spoken question. The model's own `solution_requested` flag covers other wordings.
_SPOKEN = re.compile(
    r"\b(?:solve|solution|work (?:it|this|that) out|step by step"
    r"|(?:show|give)(?: me)? (?:the |all |all the )?(?:steps|work|working)"
    r"|do (?:it|this|that)(?: one)?(?: for me)?)\b")


def _words(text: str) -> str:
    text = re.sub(r"\\text\s*\{([^{}]*)\}", r"\1", (text or "").lower())
    return " ".join(re.sub(r"[^a-z ]", " ", text).split())


def is_request(line: ReadLine | None) -> bool:
    """A handwritten line that is only a request for the solution: "solve", "solve it", "show steps"."""
    return line is not None and line.source != "printed" and bool(_REQUEST.match(_words(line.plain)))


def asks_aloud(question: str | None) -> bool:
    return bool(_SPOKEN.search(_words(question or "")))


def _request_problem(req: ReadLine, lines: list[ReadLine]) -> str | None:
    """The problem a request word belongs to: the one the reader put it in, or, if the reader gave it a
    problem of its own, the problem of the nearest line."""
    others = [l for l in lines if not is_request(l)]
    if any(l.problem_id == req.problem_id for l in others):
        return req.problem_id
    near = min(others, key=lambda l: _distance(l.box, req.box), default=None)
    return near.problem_id if near is not None and _distance(near.box, req.box) <= NEAR else None


def requested_problems(lines: list[ReadLine]) -> set[str]:
    """Problem ids that have a handwritten request for the solution next to them."""
    return {p for p in (_request_problem(l, lines) for l in lines if is_request(l)) if p}


def is_circuit(line: ReadLine) -> bool:
    plain = line.plain.strip()
    return plain.startswith("{") and '"circuit"' in plain


def _open(line: ReadLine) -> bool:
    return line.plain.strip().endswith("=")


_OPERATION_START = re.compile(r"\b(?:int|integral|integrate|antiderivative|diff|derivative)\s*\(|∫|\bd\s*/\s*d[A-Za-z]\b", re.I)


def math_part(plain: str) -> str:
    """The math of a line, without a part label ('a) ') or words in front ('Solve: '). '' if it is not math."""
    s = re.sub(r"^\s*\(?[A-Za-z0-9]{1,2}[).]\s+", "", (plain or "").strip())
    if s and not compute._has_words(s):
        return s
    # 'Evaluate int(4*x^3 + 2*x) dx': the operation is the math, the words in front of it are not
    at = _OPERATION_START.search(s)
    if at and compute.operation(s[at.start():].strip()) is not None:
        return s[at.start():].strip()
    s = re.sub(r"^(?:[A-Za-z]+\b[\s,]*)+:", "", s)                 # 'solve for x: 2*x + 5 = 11'
    s = re.sub(r"^(?:[A-Za-z]{2,}\b[\s:,]*)+", "", s).strip()      # 'Solve 3*x^2 - 3 = 0'
    return s if s and not compute._has_words(s) else ""


# --- steps: what the model sends ({latex, plain, relation}) and what the page gets (LaTeX strings) ---

def clean_latex(s) -> str:
    s = str(s or "").strip()
    for a, b in (("\\(", "\\)"), ("\\[", "\\]")):
        if s.startswith(a) and s.endswith(b):
            s = s[len(a):-len(b)]
    # Models sometimes double the backslash of a LaTeX command ("\\\\pm"): one is enough.
    return re.sub(r"\\\\(?=[A-Za-z])", r"\\", s.replace("$", "")).strip()


def to_plain(latex: str) -> str:
    """Best effort LaTeX -> calculator syntax, for a step that came without `plain`. '' = can't."""
    s = re.sub(r"\\(?:left|right|,|;|!|quad|qquad)", " ", latex)
    for _ in range(4):
        s = re.sub(r"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"((\1)/(\2))", s)
        s = re.sub(r"\\sqrt\s*\{([^{}]*)\}", r"sqrt(\1)", s)
    s = re.sub(r"\\text\s*\{\s*(or|and)\s*\}", r" \1 ", s)
    s = re.sub(r"\\(?:cdot|times)", "*", s).replace("\\div", "/").replace("\\pm", "±")
    s = re.sub(r"\^\s*\{([^{}]*)\}", r"^(\1)", s)
    s = re.sub(r"\\(sin|cos|tan|sec|csc|cot|ln|log|exp|pi)\b", r"\1", s)
    s = s.replace("{", "(").replace("}", ")")
    return "" if "\\" in s else " ".join(s.split())


def expand_pm(plain: str) -> str:
    """'x = ±1' -> 'x = 1 or x = -(1)': the checker reads a list of values, not a ± sign."""
    m = re.match(r"^(.*?)=\s*(?:±|\+-|\+/-)\s*(.+)$", plain)
    if not m:
        return plain
    left, right = m.group(1).strip(), m.group(2).strip()
    return f"{left} = {right} or {left} = -({right})"


def norm_steps(raw) -> list[dict]:
    """[{latex, plain, relation}], empty entries dropped, `$` delimiters removed, at most MAX_STEPS."""
    out = []
    for s in raw if isinstance(raw, list) else []:
        if isinstance(s, dict):
            latex, plain, rel = s.get("latex") or s.get("plain") or "", s.get("plain") or "", s.get("relation")
        elif isinstance(s, str):
            latex, plain, rel = s, "", None
        else:
            continue
        latex = clean_latex(latex)
        if not latex:
            continue
        plain = str(plain).replace("$", "").strip() or to_plain(latex)
        out.append({"latex": latex, "plain": expand_pm(plain), "relation": rel if rel in STEP_RELATIONS else "equals"})
    return out[:MAX_STEPS]


# --- checking ---

def _unknown(detail: str) -> dict:
    return {"verdict": "unknown", "detail": detail}


def judge(before: str, after: str, relation: str) -> dict:
    """Does line `after` follow from line `before`? {"verdict", "detail"}; never raises, never hangs."""
    before, after = (before or "").strip(), (after or "").strip()
    if not before or not after:
        return _unknown("nothing to check against")
    for text in (before, after):
        if compute._has_words(re.sub(r"\b(?:or|and)\b", " ", text)) and compute.operation(text) is None:
            return _unknown("a line with words in it")  # the parser would read a word as a product of letters
    op = compute.operation(before) if "=" not in before.rstrip("= ") else None
    if op is not None and not op["limits"]:
        before, relation = op["expr"], op["kind"]   # 'int(2*x, x)' is checked as that operation on what is inside
    elif relation not in ("derivative", "integral"):
        if after.startswith("="):
            # '= 12 + 2' carries on the line above: equal to its last right-hand side
            before, after, relation = before.rsplit("=", 1)[-1], after.lstrip("= "), "equals"
        elif verify.is_equation(before):
            relation = "solve"  # equation to equation (same solutions) or equation to 'x = ...'
    box: dict = {}

    def run():
        try:
            box["out"] = verify.verify_step(before, after, relation)
        except Exception as e:  # a checker bug must never break the request
            box["out"] = _unknown(f"checker error: {type(e).__name__}")

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(TIMEOUT_S)
    out = box.get("out") or _unknown("took too long to check")
    verdict, detail = out.get("verdict"), str(out.get("detail", ""))
    if verdict not in ("correct", "incorrect", "unknown"):
        verdict = "unknown"
    if verdict == "correct" and "also a solution" in detail:
        verdict, detail = "incorrect", "leaves out a solution (" + detail.split("also a solution:")[-1].strip() + ")"
    return {"verdict": verdict, "detail": detail}


def check_chain(base: str, steps: list[dict]) -> list[dict]:
    """A verdict per step (base -> step 1, step i -> step i+1), stopping at the first `incorrect`."""
    out, prev, good = [], base, base
    for s in steps:
        v = judge(prev, s["plain"], s["relation"])
        rewriting = s["relation"] not in ("derivative", "integral")
        if not rewriting and v["verdict"] != "correct" and prev != base:
            # A later step labelled "integral"/"derivative" is usually the same answer tidied up
            # (x^4 + x^2 + C after 4*x^4/4 + 2*x^2/2 + C). It is right if it equals the step before,
            # or if it is itself a result of the operation the problem asks for.
            same = judge(prev, s["plain"], "equals")
            of_base = judge(base, s["plain"], s["relation"]) if compute.operation(base) is not None else None
            if same["verdict"] == "correct":
                v = same
            elif of_base is not None:
                v = of_base
        if v["verdict"] == "unknown" and rewriting and good and good != prev:
            # the step before couldn't be read: rewriting steps can be checked against the last line that could
            again = judge(good, s["plain"], s["relation"])
            v = again if again["verdict"] != "unknown" else v
        out.append(v)
        if v["verdict"] == "incorrect":
            break
        prev = s["plain"]
        if v["verdict"] == "correct":
            good = prev
        elif not rewriting:
            good = ""  # an unchecked derivative or integral: nothing earlier can vouch for what follows
    return out


def _anchor(line: ReadLine, lines: list[ReadLine], verdicts: dict) -> tuple[ReadLine, str, str | None]:
    """(the line the steps are written under, the math they continue from, that line's id).

    The steps go under the last line of the problem's work. They continue from the last line that is math and
    is not wrong; a line nobody checked is checked here first."""
    if is_request(line):  # the action pointed at the word "solve": move to the problem it sits by
        pid = _request_problem(line, lines)
        line = next((l for l in lines if l.problem_id == pid and not is_request(l)), line)
    same = [l for l in lines if l.problem_id == line.problem_id and not is_request(l)] or [line]
    hand = [l for l in same if l.source != "printed"]
    show = (hand or same)[-1]
    for i in range(len(same) - 1, -1, -1):
        cand, math = same[i], math_part(same[i].plain)
        if _open(cand) or not math or is_circuit(cand) or verdicts.get(cand.line_id) == "incorrect":
            continue
        if verdicts.get(cand.line_id) is None and cand.relation not in ("start", "other"):
            before = next((m for m in (math_part(l.plain) for l in reversed(same[:i]) if not _open(l)) if m), "")
            if judge(before, math, cand.relation)["verdict"] == "incorrect":
                continue
        return show, math, cand.line_id
    return show, "", None


def review(raw_actions, lines: list[ReadLine], verdicts: dict) -> list[dict]:
    """One report per `solution` action in a submit: where it goes, its steps, and a verdict per step."""
    by_id = {l.line_id: l for l in lines}
    reports = []
    for i, a in enumerate(raw_actions if isinstance(raw_actions, list) else []):
        if not isinstance(a, dict) or a.get("type") != "solution":
            continue
        line = by_id.get(a.get("line_id"))
        if line is None:
            reports.append({"index": i, "show": None, "base_id": None, "steps": [], "checks": [], "bad": None,
                            "circuit": False})
            continue
        show, base, base_id = _anchor(line, lines, verdicts)
        steps = norm_steps(a.get("steps"))
        circuit = any(is_circuit(l) for l in lines if l.problem_id == show.problem_id)
        checks = [] if circuit else check_chain(base, steps)
        bad = next((k for k, c in enumerate(checks) if c["verdict"] == "incorrect"), None)
        reports.append({"index": i, "show": show, "base": base, "base_id": base_id, "steps": steps, "checks": checks,
                        "bad": bad, "circuit": circuit})
    return reports


def _checked(r: dict) -> bool:
    return any(c["verdict"] == "correct" for c in r["checks"])


def gap(reports: list[dict], allow_unchecked: bool, circuit_ok: bool) -> str | None:
    """What the model must fix in its solution before it can be sent, or None."""
    for r in reports:
        if r["show"] is None:
            continue
        lid = r["show"].line_id
        if not r["steps"]:
            return (f"The solution for {lid} has no steps. Send `steps`: 2 to 8 entries, each with `latex`, `plain` "
                    "and `relation`. Then call submit_feedback again with the whole reply.")
        if r["circuit"]:
            if not circuit_ok:
                return (f"The solution for {lid} is for a circuit: call solve_circuit first and take every step's "
                        "value from its result. Then call submit_feedback again with the whole reply.")
            continue
        if r["bad"] is not None:
            k = r["bad"]
            before = r["steps"][k - 1]["plain"] if k else (r["base"] or "the problem line")
            return (f"The solution for {lid} failed the check at step {k + 1}: `{r['steps'][k]['plain']}` does not "
                    f"follow from `{before}` ({r['checks'][k]['detail']}). Steps before it are fine. Fix step {k + 1} "
                    "and every step after it (compute_step for results, verify_step on each pair), keep the earlier "
                    "steps, and call submit_feedback again with the whole reply.")
        if not _checked(r) and not allow_unchecked:
            return (f"None of the steps of the solution for {lid} could be checked. Each step needs `plain`: the "
                    "whole line in calculator syntax (`3*x^2 = 3`, `x = 1 or x = -1`), starting from line "
                    f"`{r['base'] or lid}`, and its `relation`. Then call submit_feedback again with the whole reply.")
    return None


CUT_NOTE = "I could not check the rest of this solution, so I stopped here."
DROP_NOTE = "I could not check a full solution for this one, so I have not written it out."


def settle(raw_actions, reports: list[dict], allow_unchecked: bool, circuit_ok: bool) -> tuple[list, list[str]]:
    """The submit's actions with every solution made safe to send, and what was done (for tool_calls).

    A solution is cut before the first step the checker called wrong. It is dropped if nothing is left, or
    if no step could be checked at all (unless `allow_unchecked`: a spoken request in help mode)."""
    actions = list(raw_actions) if isinstance(raw_actions, list) else []
    by_index = {r["index"]: r for r in reports}
    out, log, seen = [], [], set()
    for i, a in enumerate(actions):
        r = by_index.get(i)
        if r is None:
            out.append(a)
            continue
        show = r["show"]
        if show is None or not r["steps"] or show.line_id in seen:
            log.append(f"solution({a.get('line_id') or '?'}) dropped: "
                       + ("no such line" if show is None else "no steps" if not r["steps"] else "repeated"))
            continue
        seen.add(show.line_id)
        steps, note, tag = r["steps"], None, f"solution({show.line_id} from {r['base_id'] or '?'})"
        marks = ", ".join(f"S{k + 1}={c['verdict']}" for k, c in enumerate(r["checks"]))
        if r["circuit"]:
            if circuit_ok:
                log.append(f"{tag}: circuit, {len(steps)} steps from solve_circuit, not chain-checked")
            else:
                steps, note = [], DROP_NOTE
                log.append(f"{tag} dropped: circuit was not solved with solve_circuit")
        else:
            if r["bad"] is not None:
                steps, note = steps[:r["bad"]], CUT_NOTE
            kept_checked = any(c["verdict"] == "correct" for c in r["checks"][:len(steps)])
            if not steps or not (kept_checked or allow_unchecked):
                why = "first step incorrect" if r["bad"] == 0 else "no step could be checked"
                steps, note = [], DROP_NOTE
                log.append(f"{tag} dropped: {marks}; {why}")
            elif r["bad"] is not None:
                log.append(f"{tag}: {marks}; cut after S{len(steps)}")
            elif not kept_checked:
                log.append(f"{tag}: {marks}; unchecked steps allowed (spoken request in help mode)")
            else:
                log.append(f"{tag}: {marks}")
        if steps:
            out.append({"type": "solution", "line_id": show.line_id, "box": list(show.box), "color": "black",
                        "steps": [s["latex"] for s in steps]})
        if note:
            out.append({"type": "note", "line_id": show.line_id, "box": list(show.box), "color": "blue",
                        "side": "right", "text": note})
    return out, log
