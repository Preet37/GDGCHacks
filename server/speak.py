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
import time
import wave
from collections import OrderedDict

import gemini
from explain import speech_safe

log = logging.getLogger("tutor.speak")

DEFAULT_MODEL = "gemini-3.8-flash-lite-tts"
# Each voice model has its own requests-per-day quota (100 a day on Tier 1). When one runs out, the next
# is used until the first is available again. All of them have the same voices.
FALLBACK_MODELS = ("gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts")
DEFAULT_VOICE = "Kore"
MAX_CHARS = 600
CACHE_SIZE = 256
TIMEOUT_MS = 40000
# How the voice should sound. Sent as the part's speech metadata (a field of the API made for this), never
# as words in front of the text, so it can't be read aloud. A model that rejects the field is called without it.
STYLE = "a warm, patient tutor sitting beside the student: unhurried, clear, friendly"

# The page asks for every step of a lesson at once; the TTS model's per-minute quota answers a burst like
# that with 429s. So: at most MAX_CONCURRENT calls at a time per instance, and one retry after a 429.
MAX_CONCURRENT = 3
RETRY_AFTER_429_S = 1.0
_slots = threading.BoundedSemaphore(MAX_CONCURRENT)
_sleep = time.sleep  # replaced in tests

_lock = threading.Lock()
_cache: "OrderedDict[tuple[str, str, str], tuple[bytes, str]]" = OrderedDict()
_no_style: set[str] = set()     # models that rejected the style field
_clients: dict[str, object] = {}
_spent: dict[str, float] = {}   # model -> time (epoch s) its daily quota is back


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


def _rate_limited(e: Exception) -> bool:
    msg = str(e).lower()
    return "429" in msg or "resource_exhausted" in msg or "too many requests" in msg


def _daily_quota(e: Exception) -> bool:
    """The model's requests-per-day quota is used up: retrying in a second won't help, another model will."""
    msg = str(e).lower()
    return _rate_limited(e) and ("per_day" in msg or "per day" in msg)


def _retry_after(e: Exception) -> float:
    """Seconds until the quota is back, from "Please retry in 36m1.8s" (half an hour if it doesn't say)."""
    m = re.search(r"retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s", str(e).lower())
    if not m:
        return 1800.0
    secs = int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + float(m.group(3))
    return min(max(secs, 60.0), 6 * 3600.0)


def tts_models() -> list[str]:
    """The voice model to use, then the ones to fall back to (GEMINI_TTS_FALLBACKS: comma list, empty = none)."""
    first = os.environ.get("GEMINI_TTS_MODEL") or DEFAULT_MODEL
    extra = os.environ.get("GEMINI_TTS_FALLBACKS")
    rest = [m.strip() for m in extra.split(",")] if extra is not None else list(FALLBACK_MODELS)
    return [first] + [m for m in rest if m and m != first]


def _speak_with_fallback(client, voice: str, text: str):
    """The reply of the first voice model that still has quota today."""
    models = tts_models()
    now = time.time()
    usable = [m for m in models if _spent.get(m, 0) <= now] or models[:1]
    last: Exception | None = None
    for m in usable:
        try:
            return _generate_limited(client, m, voice, text)
        except Exception as e:
            if not _daily_quota(e):
                raise
            _spent[m] = time.time() + _retry_after(e)
            log.warning("%s is out of requests for today, trying the next voice model", m)
            last = e
    raise last  # every model is out


def _generate_limited(client, model: str, voice: str, text: str):
    """_generate, at most MAX_CONCURRENT at once, retried once after a 429 (quota) error."""
    with _slots:
        try:
            return _generate(client, model, voice, text)
        except Exception as e:
            if not _rate_limited(e) or _daily_quota(e):
                raise
            log.warning("%s rate limited, retrying once in %.1f s", model, RETRY_AFTER_429_S)
            _sleep(RETRY_AFTER_429_S)
            return _generate(client, model, voice, text)


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
        resp = _speak_with_fallback(client or _client(), voice, clean)
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
