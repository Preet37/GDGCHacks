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

## Web page (`web/`)

Vite + React + TypeScript + tldraw. The student writes; after a 2 s pause the page sends a PNG of their
strokes to `/api/check` and draws the reply. The page knows nothing about math: it only draws the 6 actions.

### Run locally

```bash
cd web
npm install          # once
npm run dev          # http://localhost:5173, and http://<laptop-ip>:5173 for the iPad (same wifi)
npm test             # Vitest
npm run build        # -> web/dist
```

`/api` is proxied to `http://localhost:8000`, so run the server too (MOCK mode is fine).

URL flags:
- `?mock`: the page fakes the server and always gets `contract/examples/wrong_derivative.json`.
- `?dev`: buttons that draw any `contract/examples/*.json` over the page, plus `window.editor` / `window.tutor`.

### How it works

| File | Job |
| --- | --- |
| `src/sync/tutor.ts` | Listens to student strokes, sends on pause (`auto`) or on Help (`help`), applies the reply, saves `PageState` |
| `src/sync/scheduler.ts` | 2 s debounce, skip if unchanged (hash of student shapes), never overlaps, one more send if strokes came in mid-flight |
| `src/sync/exportImage.ts` | Exports only non-AI shapes over exact page bounds (32 px padding), longest side <= 1280 px |
| `src/render/geometry.ts` | `boxToPage`: `[ymin, xmin, ymax, xmax]` 0-1000 over the sent image -> page coords |
| `src/render/actions.ts` | One function per action type (circle, underline, note, ask). Every AI shape has `meta.ai = true` + `line_id` |
| `src/render/apply.ts` | Replaces old feedback for re-addressed lines and `clear_line_ids`, draws new shapes, speaks `speak` actions |
| `src/render/figure.ts` | `figure` plot2d -> function-plot SVG -> image shape beside its box (360x260) |
| `src/render/reading.ts` | "Show what AI read": gray text under each handwritten line |
| `src/HelpButton.tsx` | Help: tap = hint for the selection (`help_box`) or whole page; hold = also listen and send the speech as `question` |
| `src/voice.ts` | `webkitSpeechRecognition` wrapper + tap-vs-hold gesture. Needs https (Firebase link); without it Help works with no question |

### Deploy (Firebase Hosting)

`firebase.json` serves `web/dist` and rewrites `/api/**` to Cloud Run `tutor-api` (us-central1), so the
browser never sees the Gemini key. Deploy after the Cloud Run service exists, in the same GCP project:

```bash
npx firebase-tools login
npx firebase-tools use --add          # pick the Cloud Run project
npx firebase-tools deploy --only hosting
```

### Known issues

- tldraw shows a small "Get a license for production" badge on non-localhost hosts.
- `figure` draws `plot2d` only (function-plot); `surface3d` is skipped until the 3D tool lands. `speak` uses the browser's built-in voice.
- `PageState` is kept in localStorage until Firestore is wired up.
