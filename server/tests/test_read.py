import io
import json
import os
from types import SimpleNamespace

import pytest

from models import ReadLine
import read as read_mod
from read import is_printed, read_page, parse_lines, RESPONSE_SCHEMA


def line(**kw):
    base = dict(line_id="L1", problem_id="P1", latex="f(x)=3x^2", plain="f(x) = 3*x^2",
                box=[100, 100, 200, 600], relation="start", confidence="high")
    base.update(kw)
    return base


class FakeModels:
    def __init__(self, text):
        self.text = text
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append(dict(model=model, contents=contents, config=config))
        return SimpleNamespace(text=self.text)


class FakeClient:
    def __init__(self, payload):
        self.models = FakeModels(payload if isinstance(payload, str) else json.dumps(payload))


def test_parses_good_response():
    client = FakeClient({"lines": [line(), line(line_id="L2", latex="f'(x)=6x+1", plain="f'(x) = 6*x + 1",
                                               box=[250, 100, 350, 600], relation="derivative")]})
    out = read_page(client, "gemini-test", b"\x89PNG fake", [])
    assert [l.line_id for l in out] == ["L1", "L2"]
    assert out[1].relation == "derivative"
    assert out[1].box == (250, 100, 350, 600)
    cfg = client.models.calls[0]["config"]
    assert cfg.response_mime_type == "application/json"
    assert cfg.response_json_schema == RESPONSE_SCHEMA
    assert cfg.temperature <= 0.2


def test_drops_malformed_line():
    bad = [line(line_id="L2", relation="guess"),       # bad enum
           line(line_id="L3", box=[1, 2, 3]),          # 3-number box
           {"line_id": "L4"},                          # missing fields
           "not a dict"]
    out = parse_lines(json.dumps({"lines": [line()] + bad}), [])
    assert [l.line_id for l in out] == ["L1"]


def test_not_json_returns_empty():
    assert parse_lines("oops", []) == []


def test_clamps_and_uninverts_boxes():
    out = parse_lines(json.dumps({"lines": [line(box=[-50, 1200, 300.6, 40])]}), [])
    assert out[0].box == (0, 40, 301, 1000)


def test_duplicate_ids_get_next_unused():
    prev = [ReadLine(**line(line_id="L5"))]
    out = parse_lines(json.dumps({"lines": [line(), line(box=[300, 0, 400, 500])]}), prev)
    assert [l.line_id for l in out] == ["L1", "L6"]


def test_printed_lines_forced_to_other():
    out = parse_lines(json.dumps({"lines": [line(latex="\\text{Find } f'(x)", relation="start", source="printed"),
                                            line(line_id="L2", source="handwriting"),
                                            line(line_id="L3")]}), [])
    assert out[0].relation == "other" and out[0].source == "printed" and is_printed(out[0])
    assert out[0].latex == "\\text{Find } f'(x)"
    assert out[1].relation == "start" and out[1].source == "handwriting" and not is_printed(out[1])
    assert out[2].source is None and not is_printed(out[2])  # missing = handwriting


def test_legacy_printed_marker_stripped():
    out = parse_lines(json.dumps({"lines": [
        line(latex="\\text{[printed]} Find f'(x)", plain="[printed] Find f'(x)", relation="start"),
        line(line_id="L2", latex="\\text{[printed] Solve for x}", plain="Solve for x", source="handwriting"),
    ]}), [])
    assert out[0].latex == "Find f'(x)" and out[0].plain == "Find f'(x)"
    assert out[1].latex == "\\text{Solve for x}"
    for l in out:
        assert l.source == "printed" and l.relation == "other" and is_printed(l)
        assert "[printed]" not in l.latex


def test_schema_has_optional_source():
    item = RESPONSE_SCHEMA["properties"]["lines"]["items"]
    assert item["properties"]["source"]["enum"] == ["handwriting", "printed"]
    assert "source" not in item["required"]


def test_passes_prev_lines_into_request():
    prev = [ReadLine(**line(latex="f(x)=3x^2+2x"))]
    client = FakeClient({"lines": []})
    read_page(client, "gemini-test", b"\x89PNG fake", prev)
    contents = client.models.calls[0]["contents"]
    texts = [c for c in contents if isinstance(c, str)]
    prev_blob = next(t for t in texts if t.startswith('{"previous_lines"'))
    assert json.loads(prev_blob)["previous_lines"][0]["latex"] == "f(x)=3x^2+2x"
    assert any("Transcribe, never fix" in t for t in texts)  # prompt loaded from prompts/read.md


def test_retries_without_thinking_if_rejected():
    class Picky(FakeModels):
        def generate_content(self, model, contents, config):
            if config.thinking_config is not None:
                raise ValueError("thinking_level is not supported for this model")
            return super().generate_content(model, contents, config)

    client = SimpleNamespace(models=Picky(json.dumps({"lines": [line()]})))
    assert len(read_page(client, "gemini-test", b"x", [])) == 1


def _env():
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    except ImportError:
        pass
    return os.environ.get("GEMINI_API_KEY"), os.environ.get("GEMINI_MODEL")


def test_live_derivative_page():
    key, model = _env()
    if not key or not model:
        pytest.skip("GEMINI_API_KEY and GEMINI_MODEL not set")
    from PIL import Image, ImageDraw, ImageFont
    from google import genai

    import testpage
    png = testpage.page(["f(x) = 3x^2 + 2x", "f'(x) = 6x + 1"])

    out = read_page(genai.Client(api_key=key), model, png, [])
    assert len(out) == 2, out
    assert out[0].problem_id == out[1].problem_id
    assert out[1].relation == "derivative"
    assert out[1].box[0] > out[0].box[0]
    assert "6*x+1" in out[1].plain.replace(" ", "")  # mistake kept, not fixed


def test_open_line_is_kept_as_its_own_unfinished_line():
    raw = [line(latex="g(x) = 6x^2", plain="g(x) = 6*x^2"),
           line(line_id="L2", latex="g'(x) = ", plain="g'(x) = ", box=[260, 80, 340, 300], relation="derivative")]
    out = parse_lines(json.dumps({"lines": raw}), [])
    assert [(l.line_id, l.plain, l.relation) for l in out] == \
        [("L1", "g(x) = 6*x^2", "start"), ("L2", "g'(x) =", "derivative")]
    prompt = read_mod.PROMPT_PATH.read_text()
    assert "## Unfinished lines" in prompt and "`g'(x) =`" in prompt
