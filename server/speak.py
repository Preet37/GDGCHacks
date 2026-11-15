"""POST /api/speak: narration read aloud by a Gemini text-to-speech voice.

synthesize(text, voice) -> (audio bytes, mime type). The text is made speech-safe and capped, the result is
cached so a replay is instant, and without a key (or with MOCK=1) a short silent WAV comes back instead.
"""
import base64
import io
import logging
import os
import re
import struct
import threading
import wave
from collections import OrderedDict

import gemini
from explain import speech_safe

log = logging.getLogger("tutor.speak")

DEFAULT_MODEL = "gemini-3.8-flash-lite-tts"
DEFAULT_VOICE = "Kore"
MAX_CHARS = 600
CACHE_SIZE = 256
TIMEOUT_MS = 40000
# How the voice should sound. Sent as the part's speech metadata (a field of the API made for this), never
# as words in front of the text, so it can't be read aloud. A model that rejects the field is called without it.
STYLE = "a warm, patient tutor sitting beside the student: unhurried, clear, friendly"

_lock = threading.Lock()
_cache: "OrderedDict[tuple[str, str, str], tuple[bytes, str]]" = OrderedDict()
_no_style: set[str] = set()     # models that rejected the style field
_clients: dict[str, object] = {}


class SpeakError(RuntimeError):
    pass


def mock_mode() -> bool:
    return os.environ.get("MOCK") == "1" or not os.environ.get("GEMINI_API_KEY")


def clean_text(text) -> str:
    """Speech-safe and at most MAX_CHARS, cut at the end of a sentence (or a word) rather than mid-word."""
    s = speech_safe(text)
    if len(s) <= MAX_CHARS:
        return s
    cut = s[:MAX_CHARS]
    end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    if end >= MAX_CHARS // 2:
        return cut[:end + 1]
    return cut[:cut.rfind(" ")] if " " in cut else cut


def clean_voice(voice) -> str:
    v = str(voice or "").strip()
    return v if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", v) else os.environ.get("GEMINI_TTS_VOICE") or DEFAULT_VOICE


def pcm_to_wav(pcm: bytes, rate: int = 24000, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def silent_wav(seconds: float = 0.4, rate: int = 24000) -> bytes:
    return pcm_to_wav(b"\x00\x00" * int(seconds * rate), rate)


def _as_wav(data, mime: str) -> tuple[bytes, str]:
    """Audio the browser can play: WAV stays as it is, raw PCM (audio/L16) gets a WAV header."""
    if isinstance(data, str):
        data = base64.b64decode(data)
    data = bytes(data or b"")
    if not data:
        raise SpeakError("the voice model returned no audio")
    kind = (mime or "").lower()
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return data, "audio/wav"
    if "l16" in kind or "pcm" in kind or not kind:
        rate = re.search(r"rate=(\d+)", kind)
        channels = re.search(r"channels=(\d+)", kind)
        if len(data) % 2:
            data = data[:-1]
        return pcm_to_wav(data, int(rate.group(1)) if rate else 24000, int(channels.group(1)) if channels else 1), "audio/wav"
    return data, kind.split(";")[0].strip()  # mp3, ogg: already a file the browser plays


def _audio_parts(resp) -> list:
    out = []
    for cand in getattr(resp, "candidates", None) or []:
        for part in getattr(getattr(cand, "content", None), "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            if inline is not None and getattr(inline, "data", None):
                out.append(inline)
    return out


def _client():
    from google import genai
    from google.genai import types
    key = os.environ.get("GEMINI_API_KEY") or ""
    if key not in _clients:
        _clients.clear()
        _clients[key] = genai.Client(api_key=key, http_options=types.HttpOptions(api_version="v1beta", timeout=TIMEOUT_MS))
    return _clients[key]


def _generate(client, model: str, voice: str, text: str):
    from google.genai import types
    config = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))))

    def call(styled: bool):
        if styled:
            contents = [types.Content(role="user", parts=[types.Part(
                text=text, speech_metadata=types.SpeechMetadata(style=STYLE))])]
        else:
            contents = text
        # gemini.generate: the shared retry for a busy or timed-out model. No thinking setting applies to speech.
        return gemini.generate(client, model, contents, lambda _thinking: config)

    if not STYLE or model in _no_style:
        return call(False)
    try:
        resp = call(True)
        if _audio_parts(resp):
            return resp
        log.warning("%s returned no audio with a style, trying without", model)
    except Exception as e:
        msg = str(e).lower()
        if not any(k in msg for k in ("400", "invalid", "unknown", "unsupported", "not supported", "speech_metadata",
                                      "speechmetadata", "extra inputs", "validation")):
            raise
        log.warning("%s rejected the voice style (%s), speaking without it", model, str(e)[:120])
    resp = call(False)
    if _audio_parts(resp):
        _no_style.add(model)  # it speaks without the style: stop sending it
    return resp


def synthesize(text, voice=None, client=None) -> tuple[bytes, str]:
    """(audio bytes, mime type). Raises SpeakError when there is nothing to say or the voice model fails."""
    clean = clean_text(text)
    if not clean:
        raise ValueError("no text to speak")
    if mock_mode() and client is None:
        return silent_wav(), "audio/wav"
    model = os.environ.get("GEMINI_TTS_MODEL") or DEFAULT_MODEL
    voice = clean_voice(voice)
    key = (model, voice, clean)
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    try:
        resp = _generate(client or _client(), model, voice, clean)
        parts = _audio_parts(resp)
        if not parts:
            raise SpeakError("the voice model returned no audio")
        mime = getattr(parts[0], "mime_type", "") or ""
        datas = [base64.b64decode(p.data) if isinstance(p.data, str) else bytes(p.data) for p in parts]
        raw = "l16" in mime.lower() or "pcm" in mime.lower()
        out = _as_wav(b"".join(datas) if raw else datas[0], mime)  # PCM chunks join; a WAV file is whole already
    except SpeakError:
        raise
    except Exception as e:
        raise SpeakError(f"{type(e).__name__}: {e}"[:300]) from e
    with _lock:
        _cache[key] = out
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return out
