"""End to end through main -> pipeline -> read -> teach -> guard, with Gemini faked at the read/teach boundary."""
import base64, io, json, pathlib
from fastapi.testclient import TestClient
from PIL import Image
from internal import TeachResult
from models import Action, ReadLine

EX = json.loads((pathlib.Path(__file__).resolve().parents[2] / "contract/examples/wrong_derivative.json").read_text())


def _png():
    buf = io.BytesIO(); Image.new("RGB", (200, 100), "white").save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_check_end_to_end(monkeypatch):
    import main, read, teach
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    monkeypatch.setenv("GEMINI_MODEL", "fake-model")
    lines = [ReadLine.model_validate(l) for l in EX["lines"]]
    monkeypatch.setattr(read, "read_page", lambda client, model, png, prev: lines)
    monkeypatch.setattr(teach, "teach", lambda client, model, ls, req: TeachResult(
        actions=[Action.model_validate(a) for a in EX["actions"]]
        + [Action(type="circle", box=lines[0].box, line_id="L1", color="red")],  # wrong flag on a correct line
        verdicts={"L1": "correct", "L2": "incorrect"},
        tool_calls=["verify_step(L1->L2, derivative) = incorrect"]))
    r = TestClient(main.app).post("/api/check", json={
        "image_base64": _png(), "mode": "auto", "state": {"page_id": "t"}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [a["line_id"] for a in body["actions"]] == ["L2", "L2"]  # guard dropped the red circle on L1
    assert body["state"]["flagged_line_ids"] == ["L2"]
    assert len(body["state"]["lines"]) == 2
    assert body["debug"]["model"] == "fake-model"


def _finish_line_page(monkeypatch, wrong=False):
    """The reader calls both handwritten lines printed; the tutor works out the open line (or marks the wrong one)."""
    import gemini, main, read
    from types import SimpleNamespace
    from google.genai import types
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    monkeypatch.setenv("GEMINI_MODEL", "fake-model")
    second = "g'(x) = 6*x" if wrong else "g'(x) ="
    page = {"lines": [
        {"line_id": "L1", "problem_id": "P1", "latex": "g(x) = 6x^2", "plain": "g(x) = 6*x^2", "box": [100, 80, 160, 400],
         "relation": "other", "confidence": "high", "source": "printed"},
        {"line_id": "L2", "problem_id": "P1", "latex": second, "plain": second, "box": [180, 80, 240, 300],
         "relation": "other", "confidence": "high", "source": "printed"}]}
    call = lambda name, args: types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(
        role="model", parts=[types.Part(function_call=types.FunctionCall(name=name, args=args))]))])
    ids = {"before_line_id": "L1", "after_line_id": "L2"}
    turns = [call("verify_step", {"before": "g(x) = 6*x^2", "after": second, "relation": "derivative", **ids}),
             call("submit_feedback", {"actions": [], "clear_line_ids": [], "hint_updates": []})] if wrong else [
        call("compute_step", {"before": "g(x) = 6*x^2", "relation": "derivative", **ids}),
        call("submit_feedback", {"actions": [{"type": "note", "line_id": "L2", "color": "black", "side": "inline",
                                              "text": "$12 x$"}], "clear_line_ids": [], "hint_updates": []})]
    state = {"teach": 0}

    def generate(client, model, contents, make_config, busy_retries=2):
        if make_config is read._build_config:
            return SimpleNamespace(text=json.dumps(page))
        state["teach"] += 1
        return turns[min(state["teach"], len(turns)) - 1]
    monkeypatch.setattr(gemini, "generate", generate)
    http = TestClient(main.app)
    return lambda **kw: http.post("/api/check", json={"image_base64": _png(), "mode": "auto",
                                                      "state": {"page_id": "ink"}, **kw}).json()


def test_no_worksheet_handwriting_called_printed_is_still_finished(monkeypatch):
    post = _finish_line_page(monkeypatch)
    # the page says there is no worksheet: the lines are the student's, and the answer reaches the page
    r = post(has_worksheet=False)
    assert [(l["source"], l["relation"]) for l in r["lines"]] == [("handwriting", "start"), ("handwriting", "other")]
    assert [(a["type"], a["side"], a["text"], a["line_id"]) for a in r["actions"]] == [("note", "inline", "$12 x$", "L2")]
    assert "compute_step(L1->L2, derivative) = 12*x" in r["debug"]["tool_calls"]
    # nothing said about a worksheet (an older page) or one in view: the reader's label stands, as before
    for kw in ({}, {"has_worksheet": True}):
        r = post(**kw)
        assert [l["source"] for l in r["lines"]] == ["printed", "printed"] and r["actions"] == []


def test_no_worksheet_handwriting_called_printed_still_gets_its_mistake_marked(monkeypatch):
    post = _finish_line_page(monkeypatch, wrong=True)
    r = post(has_worksheet=False)   # the model is silent too: the server's own mark goes out
    assert [(a["type"], a["color"], a["line_id"]) for a in r["actions"]] == [("circle", "red", "L2"), ("note", "red", "L2")]
    assert post()["actions"] == []  # printed text is never marked
