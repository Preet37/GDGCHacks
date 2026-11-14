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
