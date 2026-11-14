# AI Tutor Notebook

## Server (`server/`)

FastAPI app that reads a handwritten page with Gemini, checks the steps, and returns drawing actions.
The request/response shapes are in `contract/contract.ts` (mirrored by `server/models.py`).

Endpoints:
- `GET /api/health` -> `{"ok": true}`
- `POST /api/check` -> body `CheckRequest`, returns `CheckResponse`. Bad image -> 400, pipeline failure -> 502 with `{"error", "detail"}`.

### Run locally

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
cp .env.example .env                                                  # then fill it in
.venv/bin/uvicorn main:app --reload --port 8000
curl localhost:8000/api/health
.venv/bin/pytest -q                                                   # tests
```

### Environment variables (`server/.env`)

| Var | Meaning |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio key. Never commit it. |
| `GEMINI_MODEL` | Gemini model name (use the fastest current Flash). Required; there is no default. |
| `MOCK` | `1` = skip Gemini and always return `contract/examples/wrong_derivative.json`. |
| `PORT` | Set by Cloud Run (default 8080 in the container). |

### MOCK mode

If `MOCK=1`, or `GEMINI_API_KEY` is not set, `/api/check` returns the example reply for any input.
Use this to build the page before the real pipeline works.

### How a check works

`main.py` -> `pipeline.run_check`:
1. `images.py` decodes the base64 PNG (a `data:` prefix is fine) and shrinks it to 1280 px on the long side.
2. `read.py` (`read_page`) reads the lines with Gemini, using `prompts/read.md`.
3. `teach.py` (`teach`) runs the Gemini tool loop (`verify_step`, `submit_feedback`), using `prompts/tutor.md`.
4. `guard.py` (`merge`) drops red circles/underlines on lines `verify_step` called correct, applies hint levels,
   updates `flagged_line_ids` / `clear_line_ids`, and returns the response. Timings and tool calls are in `debug`.
   Each step's time is logged.

### Where the prompts live

`server/prompts/read.md` (reading) and `server/prompts/tutor.md` (teaching). All teaching behaviour lives there;
no topic-specific code.

### Deploy (Cloud Run)

```bash
gcloud auth login && gcloud config set project <project-id>
./server/deploy.sh     # deploys service tutor-api to us-central1 with the vars from server/.env
```

Note: the container is built from `server/` only, so MOCK mode in the deployed service can't find
`contract/examples/`; deploy with a real key.

### Next thing to build

`server/verify.py` is a stub that always says `unknown`. Replace it with real SymPy checks, keeping the signature
`verify_step(before: str, after: str, relation: str) -> {"verdict": "correct"|"incorrect"|"unknown", "detail": str}`.
