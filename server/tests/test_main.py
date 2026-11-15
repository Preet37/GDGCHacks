import base64, io, json, pathlib
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main

EXAMPLE = pathlib.Path(__file__).resolve().parents[2] / "contract" / "examples" / "wrong_derivative.json"


def body(image_b64):
    return {"image_base64": image_b64, "mode": "auto", "state": {"page_id": "demo"}}


def png_b64():
    buf = io.BytesIO()
    Image.new("RGB", (50, 50), "white").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def client():
    return TestClient(main.app)


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_mock_check_returns_example(client, monkeypatch):
    monkeypatch.setenv("MOCK", "1")
    r = client.post("/api/check", json=body(png_b64()))
    assert r.status_code == 200
    expected = main.CheckResponse.model_validate(json.loads(EXAMPLE.read_text()))
    assert main.CheckResponse.model_validate(r.json()) == expected


def test_mock_when_no_key(client, monkeypatch):
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r = client.post("/api/check", json=body("anything"))
    assert r.status_code == 200 and r.json()["actions"]


def test_bad_image_is_4xx_not_crash(client, monkeypatch):
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    monkeypatch.setenv("GEMINI_MODEL", "fake-model")
    r = client.post("/api/check", json=body("definitely not an image"))
    assert r.status_code == 400 and r.json()["error"] == "bad_image"


def test_pipeline_error_is_502(client, monkeypatch):
    import pipeline
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")

    def boom(req):
        raise RuntimeError("gemini down")
    monkeypatch.setattr(pipeline, "run_check", boom)
    r = client.post("/api/check", json=body(png_b64()))
    assert r.status_code == 502 and r.json()["error"] == "pipeline_failed"


def test_invalid_body_is_422(client):
    r = client.post("/api/check", json={"mode": "auto"})
    assert r.status_code == 422


def test_failure_reason_tells_credit_from_timeout():
    import main
    credit = Exception("402 RESOURCE_EXHAUSTED. {'error': {'code': 402, 'message': 'Your prepayment credits are depleted.'}}")
    cap = Exception("429 RESOURCE_EXHAUSTED. Your project has exceeded its monthly spending cap.")
    slow = Exception("504 DEADLINE_EXCEEDED. Deadline expired before operation could complete.")
    busy = Exception("429 RESOURCE_EXHAUSTED. Quota exceeded for requests per minute")
    assert main.failure_reason(credit) == "out_of_credit"
    assert main.failure_reason(cap) == "out_of_credit"
    assert main.failure_reason(slow) == "timeout"
    assert main.failure_reason(busy) == "busy"
    assert main.failure_reason(ValueError("bad json")) is None


def test_usage_is_counted_per_call_and_per_request():
    import types as pytypes

    import gemini

    class Detail:
        def __init__(self, modality, n):
            self.modality, self.token_count = modality, n

    usage = pytypes.SimpleNamespace(prompt_token_count=1000, cached_content_token_count=600, candidates_token_count=40,
                                    thoughts_token_count=25, prompt_tokens_details=[Detail("IMAGE", 258), Detail("TEXT", 742)],
                                    candidates_tokens_details=[Detail("AUDIO", 30)])
    resp = pytypes.SimpleNamespace(usage_metadata=usage)
    before = gemini.totals().get("m-test", {}).get("calls", 0)
    calls = gemini.collect()
    gemini.record(resp, "m-test")
    gemini.record(pytypes.SimpleNamespace(usage_metadata=None), "m-test")  # a reply without counts
    assert calls[0] == {"model": "m-test", "in": 1000, "cached": 600, "image_in": 258, "out": 40, "think": 25, "audio_out": 30}
    assert gemini.summary(calls) == {"calls": 2, "in": 1000, "cached": 600, "image_in": 258, "out": 40, "think": 25, "audio_out": 30}
    assert gemini.totals()["m-test"]["calls"] == before + 2
    gemini._sink.set(None)


def test_debug_usage_route(client):
    r = client.get("/api/debug/usage")
    assert r.status_code == 200 and "since_start" in r.json() and "recent" in r.json()
