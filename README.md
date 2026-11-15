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

### Math checker (`server/verify.py`)

`verify_step(before, after, relation) -> {"verdict": "correct"|"incorrect"|"unknown", "detail"}` uses SymPy:
`equals`/`simplify` (symbolic, then a random numeric spot check), `derivative`, `integral` (constant allowed),
`solve` (plugs in the roots, notes missing ones, compares solution sets for intermediate equations).
Labels like `f(x) =`, `f'(x) =`, `y =`, `dy/dx =` are dropped; `3x`, `^`, `−`, `²`, `d/dx(...)` are understood.
Anything it can't parse is `unknown`; it never raises. Tests: `server/tests/test_verify.py`.

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
| `src/worksheet.ts` | Import PDF: pdf.js renders each page to a locked background image (`meta.worksheet`), included in the export |
| `src/page.ts` | What to export: student shapes; with a worksheet, crops to the handwriting + 240 px of printed context (+ Help selection) |
| `src/persist/*` | Firestore: saves `pages/{page_id}` (tldraw document + `PageState`) 3 s after changes and after each reply; loads it on start. `?page=<id>` opens a page on any device |
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
- Firestore is off until `web/.env.local` / `web/.env.production` has the Firebase web config (see `web/.env.example`);
  the page still saves locally. Firestore docs max at 1 MiB, so big PDF page images are dropped from the cloud copy
  if needed (shapes stay). Deploy rules with `npx firebase-tools deploy --only firestore:rules`.

## Demo set

Five problems that show every feature. Write each one by hand, one step per line, and pause 2 s after the last line.
The "Checker" column is what `server/verify.py` returned for that step on the live server, so every red circle is
backed by SymPy, not just Gemini.

**Status: all 5 verified live on 2026-11-14, 11:22 PM** (Cloud Run `tutor-api-00025-seb`, `gemini-3.5-flash`), written
as real pen strokes by `web/e2e/demo.mjs`. Rerun any time with
`cd web && API_TARGET=https://tutor-api-191803288552.us-central1.run.app npm run dev -- --port 5174`, then
`node web/e2e/demo.mjs` (5 `/api/check` calls, no lessons or voice).

| # | Write | Mistake | Checker (live) | What happened live | Time |
| --- | --- | --- | --- | --- | --- |
| 1 | `f(x) = 3x² + 2x` then `f'(x) = 6x + 1` | wrong derivative (`+1`) | derivative: incorrect | red circle + "What is the derivative of 2x?" | 4.8 s |
| 2 | `3x − 7 = 2` then `3x = −5` | sign error moving the 7 | solve: incorrect | red circle + "What do you get when you add 7 to both sides?" | 4.5 s |
| 3 | `∫ cos(x) dx` then `= −sin(x) + C` | wrong sign | integral: incorrect | red circle + "What function has a derivative of cos(x)?" | 5.2 s |
| 4 | `(x + 1)²` then `= x² + 2x + 1` | none | equals: correct | nothing drawn | 3.6 s |
| 5 | `y = x² − 4` and "graph this" next to it | none | n/a | a graph of the parabola beside the line | 3.6 s |

Times are from the end of writing to the reply. The first check after the server has been idle can take a few
seconds longer (cold start).

**Hint ladder (Help):** write `d/dx (x sin x)`, lasso it, tap Help three times.
1st: a nudge (which rule: product rule). 2nd: a bigger push (set up u = x, v = sin x). 3rd: the worked step
`sin x + x cos x`. Hold Help and ask "why the product rule?" to send the question by voice.

**Worksheet:** tap "Import PDF", load a problem set, write under a problem, lasso the printed problem, tap Help:
the hint is about that problem. Printed text is never marked.

**Reset between judges:** tldraw menu → Edit → Select all → Delete, or open the app with a new `?page=<name>`.
