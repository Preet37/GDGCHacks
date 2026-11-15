"""FastAPI app: GET /api/health, POST /api/check, POST /api/speak, GET /api/debug/recent."""
import json
import logging
import os
import pathlib
import time

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

load_dotenv(pathlib.Path(__file__).resolve().parent / ".env")

from images import ImageError  # noqa: E402
import pipeline  # noqa: E402  (light: Gemini and the math are imported when a check runs)
from models import CheckRequest, CheckResponse  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("tutor")

HERE = pathlib.Path(__file__).resolve().parent
MOCK_CANDIDATES = [
    HERE.parent / "contract" / "examples" / "wrong_derivative.json",  # repo checkout
    HERE / "examples" / "wrong_derivative.json",                     # optional copy next to server
]

app = FastAPI(title="tutor-api")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

import glyphs  # noqa: E402

app.include_router(glyphs.router)  # POST /api/glyphs: per-character boxes, for "write in my handwriting"


def mock_mode() -> bool:
    return os.environ.get("MOCK") == "1" or not os.environ.get("GEMINI_API_KEY")


def load_mock() -> CheckResponse:
    for p in MOCK_CANDIDATES:
        if p.exists():
            return CheckResponse.model_validate(json.loads(p.read_text()))
    raise FileNotFoundError("wrong_derivative.json example not found")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/check", response_model=CheckResponse, response_model_exclude_none=True)
def check(req: CheckRequest):
    t0 = time.perf_counter()
    entry = pipeline.begin(req)  # summary for GET /api/debug/recent
    try:
        if mock_mode():
            resp = load_mock()
            source = "mock"
            entry["mock"] = True
        else:
            resp = pipeline.run_check(req)
            source = "pipeline"
    except ImageError as e:
        pipeline.finish(entry, t0, e)
        log.warning("check bad image: %s", e)
        return JSONResponse(status_code=400, content={"error": "bad_image", "detail": str(e)})
    except Exception as e:  # never crash the request
        pipeline.finish(entry, t0, e)
        log.exception("check failed")
        return JSONResponse(status_code=502, content={"error": "pipeline_failed", "reason": failure_reason(e),
                                                      "detail": f"{type(e).__name__}: {e}"[:300]})
    pipeline.finish(entry, t0)
    log.info("check %s mode=%s total_ms=%d actions=%d", source, req.mode,
             int((time.perf_counter() - t0) * 1000), len(resp.actions))
    return resp


@app.post("/api/circuit/solve")
async def circuit_solve(request: Request):
    """Re-solve a circuit for the what-if card: {elements: CircuitElement[]} -> {ok: true, ...solution} or
    {ok: false, detail}. Pure SymPy, no Gemini, so it is free to call on every edit. Bad input is explained with
    status 200 (the card shows the reason) and never becomes a 500."""
    import circuits
    t0 = time.perf_counter()
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "detail": "the request body is not JSON"}
    elements = body.get("elements") if isinstance(body, dict) else None
    if not isinstance(elements, list):
        return {"ok": False, "detail": "send {\"elements\": [...]}"}
    if not all(isinstance(e, dict) for e in elements):
        return {"ok": False, "detail": "every element must be an object"}
    out = circuits.solve_circuit(elements)  # ignores extra keys such as box
    log.info("circuit solve ms=%d elements=%d ok=%s", int((time.perf_counter() - t0) * 1000), len(elements), out.get("ok"))
    return out


@app.get("/api/debug/usage")
def debug_usage():
    """Tokens used since this server instance started, per model, and by each of the last 30 checks."""
    import gemini
    return {"since_start": gemini.totals(),
            "recent": [{"time": r.get("time"), "mode": r.get("mode"), "total_ms": r.get("total_ms"), **(r.get("usage") or {})}
                       for r in pipeline.recent() if r.get("usage")]}


def failure_reason(e: Exception) -> str | None:
    """Why Gemini failed, when the page can say something more useful than "try again"."""
    text = f"{type(e).__name__}: {e}".lower()
    if "quota exceeded" in text or "exceeded your current quota" in text or "rate-limit" in text:
        return "busy"  # a rate or daily limit, not money
    if "spending cap" in text or "prepayment credits" in text or " 402 " in text:
        return "out_of_credit"
    if "deadline" in text or "timed out" in text or "timeout" in text or " 504 " in text:
        return "timeout"
    if " 429 " in text or "resource_exhausted" in text or " 503 " in text or "overloaded" in text:
        return "busy"
    return None


@app.get("/api/debug/recent")
def debug_recent():
    """The last 30 requests, newest first: what was read, what the model submitted, what was sent. No images."""
    return {"count": len(pipeline.RECENT), "requests": pipeline.recent()}


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None


@app.post("/api/speak")
def speak_route(req: SpeakRequest):
    """Narration as audio. Body {"text", "voice"?}; replies with the audio bytes (audio/wav)."""
    import speak
    t0 = time.perf_counter()
    try:
        audio, mime = speak.synthesize(req.text, req.voice)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": "no_text", "detail": str(e)})
    except Exception as e:  # never crash the request
        log.warning("speak failed: %s", e)
        return JSONResponse(status_code=502, content={"error": "speak_failed", "reason": failure_reason(e), "detail": f"{e}"[:300]})
    log.info("speak ms=%d bytes=%d chars=%d", int((time.perf_counter() - t0) * 1000), len(audio), len(req.text))
    return Response(content=audio, media_type=mime, headers={"Cache-Control": "private, max-age=86400"})
