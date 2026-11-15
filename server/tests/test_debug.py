"""GET /api/debug/recent: what the server saw and did, without the image."""
import base64
import io
import json

from fastapi.testclient import TestClient
from PIL import Image

from internal import HintUpdate, TeachResult
from models import Action, ReadLine


def _png():
    buf = io.BytesIO(); Image.new("RGB", (200, 100), "white").save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _line(i, plain, relation, confidence="high", source=None):
    return ReadLine(line_id=i, problem_id="P1", latex=plain, plain=plain, box=(10 * int(i[1:]), 0, 10 * int(i[1:]) + 8, 90),
                    relation=relation, confidence=confidence, source=source)


def test_recent_requests_are_summarised(monkeypatch):
    import main, pipeline, read, teach
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    monkeypatch.setenv("GEMINI_MODEL", "fake-model")
    lines = [_line("L1", "f(x) = x^3 - 3*x", "start"), _line("L2", "f'(x) = 3*x^2 - 3*x", "derivative")]
    monkeypatch.setattr(read, "read_page", lambda client, model, png, prev: lines)
    monkeypatch.setattr(teach, "teach", lambda client, model, ls, req: TeachResult(
        actions=[Action(type="ask", line_id="L1", color="blue", side="below", text="What are you looking to find?"),
                 Action(type="circle", line_id="L2", color="red", box=lines[1].box),
                 Action(type="note", line_id="L2", color="red", side="right", text="What is the derivative of $3x$?")],
        hint_updates=[HintUpdate(problem_id="P1", hint_level=1)],
        verdicts={"L2": "incorrect"}, tool_calls=["verify_step(L1->L2, derivative) = incorrect"]))
    http = TestClient(main.app)
    assert http.get("/api/debug/recent").json() == {"count": 0, "requests": []}

    image = _png()
    r = http.post("/api/check", json={"image_base64": image, "mode": "auto", "help_box": [1, 2, 3, 4],
                                      "question": "why?", "state": {"page_id": "pg9"}})
    assert r.status_code == 200
    http.post("/api/check", json={"image_base64": "not an image", "mode": "help", "state": {"page_id": "pg9"}})
    monkeypatch.setattr(pipeline, "_run_check", lambda req, entry: (_ for _ in ()).throw(RuntimeError("gemini down")))
    assert http.post("/api/check", json={"image_base64": image, "mode": "explain", "state": {"page_id": "pg9"}}).status_code == 502

    body = http.get("/api/debug/recent").json()
    assert body["count"] == 3 and [e["mode"] for e in body["requests"]] == ["explain", "help", "auto"]   # newest first
    failed, bad, ok = body["requests"]
    assert failed["error"] == "RuntimeError: gemini down" and bad["error"].startswith("ImageError")
    assert ok["time"].endswith("+00:00") and ok["page_id"] == "pg9" and "error" not in ok
    assert ok["help_box"] == [1, 2, 3, 4] and ok["question"] == "why?"
    assert ok["lines"][1] == {"id": "L2", "problem": "P1", "plain": "f'(x) = 3*x^2 - 3*x", "relation": "derivative",
                              "source": "handwriting", "confidence": "high", "box": [20, 0, 28, 90]}
    assert ok["tool_calls"] == ["verify_step(L1->L2, derivative) = incorrect"]
    # what the model submitted, and what was left after the guard (the unasked question on L1 is gone)
    assert [(a["type"], a["line_id"]) for a in ok["actions_from_model"]] == [("ask", "L1"), ("circle", "L2"), ("note", "L2")]
    assert ok["actions_sent"] == [{"type": "circle", "color": "red", "line_id": "L2"},
                                  {"type": "note", "color": "red", "side": "right",
                                   "text": "What is the derivative of $3x$?", "line_id": "L2"}]
    assert ok["clear_line_ids"] == [] and ok["flagged_line_ids"] == ["L2"] and ok["problems"] == []
    assert {"read_ms", "teach_ms", "total_ms"} <= set(ok) and ok["model"] == "fake-model"
    assert image not in json.dumps(body) and "image" not in " ".join(ok)

    # only the last 30 are kept
    monkeypatch.setenv("MOCK", "1")
    for _ in range(35):
        http.post("/api/check", json={"image_base64": "x", "mode": "auto", "state": {"page_id": "m"}})
    body = http.get("/api/debug/recent").json()
    assert body["count"] == 30 and all(e.get("mock") for e in body["requests"])


def test_run_check_called_directly_is_recorded_too(monkeypatch):
    import pipeline, read, teach
    from models import CheckRequest, PageState
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    monkeypatch.setenv("GEMINI_MODEL", "fake-model")
    monkeypatch.setattr(read, "read_page", lambda client, model, png, prev: [])
    monkeypatch.setattr(teach, "teach", lambda client, model, ls, req: TeachResult())
    pipeline.run_check(CheckRequest(image_base64=_png(), mode="auto", state=PageState(page_id="d")))
    (entry,) = pipeline.recent()
    assert entry["page_id"] == "d" and entry["lines"] == [] and "total_ms" in entry
