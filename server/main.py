"""FastAPI app: GET /api/health, POST /api/check."""
import json
import logging
import os
import pathlib
import time

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

load_dotenv(pathlib.Path(__file__).resolve().parent / ".env")

from images import ImageError  # noqa: E402
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
    try:
        if mock_mode():
            resp = load_mock()
            source = "mock"
        else:
            import pipeline
            resp = pipeline.run_check(req)
            source = "pipeline"
    except ImageError as e:
        log.warning("check bad image: %s", e)
        return JSONResponse(status_code=400, content={"error": "bad_image", "detail": str(e)})
    except Exception as e:  # never crash the request
        log.exception("check failed")
        return JSONResponse(status_code=502, content={"error": "pipeline_failed", "detail": f"{type(e).__name__}: {e}"[:300]})
    log.info("check %s mode=%s total_ms=%d actions=%d", source, req.mode,
             int((time.perf_counter() - t0) * 1000), len(resp.actions))
    return resp
