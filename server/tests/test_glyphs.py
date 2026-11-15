import base64
import io
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

import glyphs
from glyphs import RESPONSE_SCHEMA, clean_char, find_glyphs, fix_box, parse_glyphs


class FakeModels:
    def __init__(self, text=None, error=None):
        self.text = text
        self.error = error
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append(dict(model=model, contents=contents, config=config))
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.text)


class FakeClient:
    def __init__(self, payload=None, error=None):
        text = payload if isinstance(payload, str) or payload is None else json.dumps(payload)
        self.models = FakeModels(text, error)


def g(char, box):
    return {"char": char, "box": box}


def png_b64(size=(60, 40)):
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def api():
    app = FastAPI()
    app.include_router(glyphs.router)
    return TestClient(app)


def test_parses_good_response_and_asks_for_structured_output():
    client = FakeClient({"glyphs": [g("x", [100, 100, 200, 180]), g("=", [130, 220, 170, 300]), g("2", [90, 340, 200, 420])]})
    out = find_glyphs(client, "gemini-test", b"\x89PNG fake")
    assert [(q.char, q.box) for q in out] == [("x", (100, 100, 200, 180)), ("=", (130, 220, 170, 300)), ("2", (90, 340, 200, 420))]
    call = client.models.calls[0]
    assert call["model"] == "gemini-test"
    cfg = call["config"]
    assert cfg.response_mime_type == "application/json"
    assert cfg.response_json_schema == RESPONSE_SCHEMA
    assert cfg.temperature <= 0.2
    # the image goes first, then the prompt
    assert call["contents"][0].inline_data.mime_type == "image/png"
    assert "every single handwritten character" in call["contents"][1]


def test_boxes_are_clamped_and_put_in_order():
    assert fix_box([-20, 50, 1200, 80]) == (0, 50, 1000, 80)
    assert fix_box([300, 400, 100, 200]) == (100, 200, 300, 400)
    assert fix_box([10.4, 20.6, 30, 40]) == (10, 21, 30, 40)
    assert fix_box(["10", "20", "30", "40"]) == (10, 20, 30, 40)


def test_bad_boxes_are_rejected():
    assert fix_box([1, 2, 3]) is None
    assert fix_box(None) is None
    assert fix_box("nope") is None
    assert fix_box([1, 2, "x", 4]) is None
    assert fix_box([500, 500, 500, 500]) is None      # a point
    assert fix_box([500, 500, 501, 501]) is None      # too small to be a character
    assert fix_box([500, 100, 501, 180]) is not None  # a flat dash is fine
    assert fix_box([100, 500, 180, 501]) is not None  # so is a thin 1


def test_characters_are_normalised_to_one_plain_character():
    assert clean_char(" x ") == "x"
    assert clean_char("−") == "-"
    assert clean_char("′") == "'"
    assert clean_char("`") == "'"
    assert clean_char("²") == "2"
    assert clean_char("×") == "*"
    assert clean_char("\\pm") == "±"
    assert clean_char("$y$") == "y"
    assert clean_char("X") == "X"
    assert clean_char("∫") == "∫"


def test_non_characters_are_rejected():
    for bad in ["", " ", "xy", "x^2", "^", "\\", None, 7, "\\frac", "\n"]:
        assert clean_char(bad) is None, bad


def test_bad_entries_are_dropped_not_fatal():
    out = parse_glyphs(json.dumps({"glyphs": [
        g("x", [100, 100, 200, 180]),
        g("xx", [100, 200, 200, 280]),        # two characters
        g("y", [1, 2, 3]),                    # 3-number box
        {"char": "z"},                        # no box
        "junk",
        g("3", [-5, 300, 1100, 380]),         # clamped, kept
        g("x", [100, 100, 200, 180]),         # exact repeat
    ]}))
    assert [(q.char, q.box) for q in out] == [("x", (100, 100, 200, 180)), ("3", (0, 300, 1000, 380))]


def test_a_box_around_the_whole_page_is_dropped():
    out = parse_glyphs(json.dumps({"glyphs": [g("x", [0, 0, 1000, 1000]), g("2", [100, 100, 200, 180])]}))
    assert [q.char for q in out] == ["2"]
    # but a picture of a single character is allowed to be all character
    assert len(parse_glyphs(json.dumps({"glyphs": [g("x", [0, 0, 1000, 1000])]}))) == 1


def test_garbage_gives_an_empty_list():
    assert parse_glyphs("") == []
    assert parse_glyphs("not json") == []
    assert parse_glyphs(json.dumps({"glyphs": "no"})) == []
    assert parse_glyphs(json.dumps({"other": []})) == []
    assert find_glyphs(FakeClient(None), "m", b"png") == []


def test_accepts_a_bare_list():
    assert [q.char for q in parse_glyphs(json.dumps([g("7", [10, 10, 90, 60])]))] == ["7"]


def test_too_many_glyphs_are_cut_off():
    many = [g("1", [i % 900, i, i % 900 + 50, i + 20]) for i in range(glyphs.MAX_GLYPHS + 50)]
    assert len(parse_glyphs(json.dumps({"glyphs": many}))) == glyphs.MAX_GLYPHS


def test_thinking_is_never_below_low(monkeypatch):
    from google.genai import types
    monkeypatch.delenv("GLYPHS_THINKING", raising=False)
    assert glyphs._build_config(types.ThinkingConfig(thinking_level="minimal")).thinking_config.thinking_level.value.lower() == "low"
    assert glyphs._build_config(None).thinking_config is None
    # older models take a budget, which is passed through untouched
    assert glyphs._build_config(types.ThinkingConfig(thinking_budget=0)).thinking_config.thinking_budget == 0


def test_endpoint_mock_mode_returns_empty(api, monkeypatch):
    monkeypatch.setenv("MOCK", "1")
    r = api.post("/api/glyphs", json={"image_base64": png_b64()})
    assert r.status_code == 200 and r.json() == {"glyphs": []}


def test_endpoint_without_a_key_is_mock(api, monkeypatch):
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r = api.post("/api/glyphs", json={"image_base64": png_b64()})
    assert r.status_code == 200 and r.json() == {"glyphs": []}


def test_endpoint_bad_image_is_400(api, monkeypatch):
    monkeypatch.setenv("MOCK", "1")
    r = api.post("/api/glyphs", json={"image_base64": "!!!not an image!!!"})
    assert r.status_code == 400 and r.json()["error"] == "bad_image"
    assert api.post("/api/glyphs", json={}).status_code == 422


def test_endpoint_returns_glyphs_from_the_model(api, monkeypatch):
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-main")
    monkeypatch.delenv("GLYPHS_MODEL", raising=False)
    fake = FakeClient({"glyphs": [g("x", [100, 100, 200, 180]), g("−", [140, 220, 150, 300])]})
    monkeypatch.setattr(glyphs, "_client", lambda: fake)
    r = api.post("/api/glyphs", json={"image_base64": "data:image/png;base64," + png_b64()})
    assert r.status_code == 200
    assert r.json() == {"glyphs": [{"char": "x", "box": [100, 100, 200, 180]}, {"char": "-", "box": [140, 220, 150, 300]}]}
    assert fake.models.calls[0]["model"] == "gemini-main"
    monkeypatch.setenv("GLYPHS_MODEL", "gemini-glyphs")
    api.post("/api/glyphs", json={"image_base64": png_b64()})
    assert fake.models.calls[1]["model"] == "gemini-glyphs"


def test_endpoint_model_failure_is_a_502_the_page_can_retry(api, monkeypatch):
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(glyphs, "_client", lambda: FakeClient(error=RuntimeError("429 quota exceeded")))
    r = api.post("/api/glyphs", json={"image_base64": png_b64()})
    assert r.status_code == 502 and r.json()["error"] == "glyphs_failed"
