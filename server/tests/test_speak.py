"""POST /api/speak with the voice model faked."""
import io
import wave

import pytest
from fastapi.testclient import TestClient
from google.genai import types

import main
import speak


def _wav(seconds=0.1):
    return speak.silent_wav(seconds)


def _resp(data, mime):
    part = types.Part(inline_data=types.Blob(data=data, mime_type=mime))
    return types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=[part]))])


class FakeClient:
    def __init__(self, *results):
        self.results, self.calls, self.models = list(results), [], self

    def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        out = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(out, Exception):
            raise out
        return out


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.delenv("MOCK", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    monkeypatch.delenv("GEMINI_TTS_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_TTS_VOICE", raising=False)
    monkeypatch.setattr(speak, "_cache", type(speak._cache)())
    monkeypatch.setattr(speak, "_no_style", set())
    monkeypatch.setattr(speak.gemini.time, "sleep", lambda s: None)


def _use(monkeypatch, client):
    monkeypatch.setattr(speak, "_client", lambda: client)
    return TestClient(main.app)


def _frames(data):
    with wave.open(io.BytesIO(data)) as w:
        return w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()


def test_wav_passes_through_with_model_voice_and_style(monkeypatch):
    client = FakeClient(_resp(_wav(), "audio/wav"))
    r = _use(monkeypatch, client).post("/api/speak", json={"text": "Here is your curve."})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav" and r.content == _wav()
    model, contents, config = client.calls[0]
    assert model == "gemini-3.8-flash-lite-tts" and config.response_modalities == ["AUDIO"]
    assert config.speech_config.voice_config.prebuilt_voice_config.voice_name == "Kore"
    # the delivery style rides in the part's speech metadata; the only words sent are the student's sentence
    (part,) = contents[0].parts
    assert part.text == "Here is your curve." and "tutor" in part.speech_metadata.style
    # env and the request choose the model and the voice
    monkeypatch.setenv("GEMINI_TTS_MODEL", "other-tts")
    monkeypatch.setenv("GEMINI_TTS_VOICE", "Puck")
    _use(monkeypatch, client).post("/api/speak", json={"text": "One."})
    _use(monkeypatch, client).post("/api/speak", json={"text": "Two.", "voice": "Aoede"})
    _use(monkeypatch, client).post("/api/speak", json={"text": "Three.", "voice": "not a voice!"})
    assert [(c[0], c[2].speech_config.voice_config.prebuilt_voice_config.voice_name) for c in client.calls[1:]] == \
        [("other-tts", "Puck"), ("other-tts", "Aoede"), ("other-tts", "Puck")]


def test_raw_pcm_gets_a_wav_header(monkeypatch):
    pcm = b"\x01\x02" * 2400
    r = _use(monkeypatch, FakeClient(_resp(pcm, "audio/L16;codec=pcm;rate=24000"))).post("/api/speak", json={"text": "hi there"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert r.content[:4] == b"RIFF" and _frames(r.content) == (24000, 1, 2, 2400)
    assert r.content.endswith(pcm)
    assert _frames(speak._as_wav(pcm, "audio/l16; rate=16000; channels=2")[0])[:2] == (16000, 2)
    assert speak._as_wav(b"ID3abc", "audio/mpeg") == (b"ID3abc", "audio/mpeg")


def test_replay_comes_from_the_cache(monkeypatch):
    client = FakeClient(_resp(_wav(), "audio/wav"))
    http = _use(monkeypatch, client)
    a = http.post("/api/speak", json={"text": "The slope of $x^2$ is $2x$."})
    b = http.post("/api/speak", json={"text": "The slope of  $x^2$ is $2x$. "})   # the same words once cleaned
    assert a.content == b.content and len(client.calls) == 1
    http.post("/api/speak", json={"text": "The slope of $x^2$ is $2x$.", "voice": "Puck"})   # another voice: another entry
    http.post("/api/speak", json={"text": "Something else."})
    assert len(client.calls) == 3
    monkeypatch.setattr(speak, "CACHE_SIZE", 2)
    http.post("/api/speak", json={"text": "A third sentence."})
    assert len(speak._cache) == 2                                                 # least recently used is dropped


def test_mock_mode_returns_a_short_silent_wav(monkeypatch):
    monkeypatch.setattr(speak, "_client", lambda: (_ for _ in ()).throw(AssertionError("no model in mock mode")))
    for env in ({"MOCK": "1"}, {"GEMINI_API_KEY": ""}):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        r = TestClient(main.app).post("/api/speak", json={"text": "hello"})
        assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
        rate, channels, width, n = _frames(r.content)
        assert (rate, channels, width) == (24000, 1, 2) and 0 < n <= 24000 and not any(r.content[44:])
        monkeypatch.delenv("MOCK", raising=False)


def test_text_is_cleaned_and_capped(monkeypatch):
    client = FakeClient(_resp(_wav(), "audio/wav"))
    http = _use(monkeypatch, client)
    http.post("/api/speak", json={"text": r"So $\frac{1}{2} x^2$ is the area, and ω = 5."})
    assert client.calls[0][1][0].parts[0].text == "So 1 over 2 x squared is the area, and omega equals 5."
    long = "This is one sentence of the narration. " * 40
    http.post("/api/speak", json={"text": long})
    sent = client.calls[1][1][0].parts[0].text
    assert len(sent) <= speak.MAX_CHARS and sent.endswith("narration.") and len(sent) > 500
    assert len(speak.clean_text("word " * 400)) <= speak.MAX_CHARS and len(speak.clean_text("x" * 5000)) == speak.MAX_CHARS
    # nothing to say is the caller's mistake, not a server failure
    r = http.post("/api/speak", json={"text": " $ $ "})
    assert r.status_code == 400 and r.json()["error"] == "no_text" and len(client.calls) == 2
    assert http.post("/api/speak", json={}).status_code == 422


def test_errors_are_a_json_502_and_are_not_cached(monkeypatch):
    http = _use(monkeypatch, FakeClient(RuntimeError("429 RESOURCE_EXHAUSTED quota")))
    r = http.post("/api/speak", json={"text": "hello"})
    assert r.status_code == 502 and r.json()["error"] == "speak_failed" and "429" in r.json()["detail"]
    empty = types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=[]))])
    r = _use(monkeypatch, FakeClient(empty)).post("/api/speak", json={"text": "hello"})
    assert r.status_code == 502 and "no audio" in r.json()["detail"]
    assert not speak._cache
    good = _use(monkeypatch, FakeClient(_resp(_wav(), "audio/wav"))).post("/api/speak", json={"text": "hello"})
    assert good.status_code == 200


def test_busy_model_is_retried_and_a_rejected_style_is_dropped(monkeypatch):
    client = FakeClient(RuntimeError("503 UNAVAILABLE"), _resp(_wav(), "audio/wav"))
    assert _use(monkeypatch, client).post("/api/speak", json={"text": "hello"}).status_code == 200
    assert len(client.calls) == 2
    # a model that does not take the style field is called again with just the text, and remembered
    client = FakeClient(RuntimeError("400 INVALID_ARGUMENT: speechMetadata is not supported"), _resp(_wav(), "audio/wav"))
    http = _use(monkeypatch, client)
    assert http.post("/api/speak", json={"text": "hello you"}).status_code == 200
    assert client.calls[1][1] == "hello you"
    http.post("/api/speak", json={"text": "again"})
    assert len(client.calls) == 3 and client.calls[2][1] == "again"


QUOTA = RuntimeError("429 RESOURCE_EXHAUSTED. You exceeded your current quota")


def test_a_429_is_retried_once_then_speaks(monkeypatch):
    waits = []
    monkeypatch.setattr(speak, "_sleep", waits.append)
    client = FakeClient(QUOTA, _resp(_wav(), "audio/wav"))
    r = _use(monkeypatch, client).post("/api/speak", json={"text": "Watch the tangent line."})
    assert r.status_code == 200 and r.content == _wav()
    assert waits == [speak.RETRY_AFTER_429_S] and len(client.calls) == 2


def test_a_second_429_still_fails_cleanly(monkeypatch):
    monkeypatch.setattr(speak, "_sleep", lambda s: None)
    client = FakeClient(QUOTA, QUOTA)
    r = _use(monkeypatch, client).post("/api/speak", json={"text": "Watch the tangent line."})
    assert r.status_code == 502 and r.json()["error"] == "speak_failed"
    assert len(client.calls) == 2  # one retry, not more


def test_other_errors_are_not_retried_here(monkeypatch):
    waits = []
    monkeypatch.setattr(speak, "_sleep", waits.append)
    client = FakeClient(RuntimeError("500 internal"))
    r = _use(monkeypatch, client).post("/api/speak", json={"text": "Watch the tangent line."})
    assert r.status_code == 502 and waits == []


def test_at_most_three_voice_calls_at_once(monkeypatch):
    import threading
    live, peak, lock = [0], [0], threading.Lock()
    hold = threading.Event()  # time.sleep is stubbed by the fixture, so wait on an event instead

    class SlowClient:
        models = None

        def __init__(self):
            self.models = self

        def generate_content(self, model, contents, config):
            with lock:
                live[0] += 1
                peak[0] = max(peak[0], live[0])
            hold.wait(0.1)
            with lock:
                live[0] -= 1
            return _resp(_wav(), "audio/wav")

    client = SlowClient()
    texts = [f"Step {i} of the lesson." for i in range(9)]  # a whole lesson asked for at once
    threads = [threading.Thread(target=speak.synthesize, args=(t, None, client)) for t in texts]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak[0] == speak.MAX_CONCURRENT
