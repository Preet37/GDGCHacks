# End-to-end run: real ink, real server

`run.mjs` drives the notebook the way a student does. It opens the page in headless Chrome at iPad
size, picks tldraw's pen, and writes each line with real pointer events (pen pointers, sent through
the Chrome DevTools Protocol), tracing the strokes of the Hershey single-stroke font embedded in
`web/src/handwriting/hershey.ts` with some jitter. The page then does everything itself: it waits
2 seconds, captures the ink, calls `/api/check`, and draws the reply. Nothing is posted to the API
directly and no reply is faked.

Results of the last run are in [RESULTS.md](RESULTS.md).

## Run it

```sh
# the dev page must be up, with its /api proxied to a real server:
#   cd web && API_TARGET=https://tutor-api-191803288552.us-central1.run.app npm run dev -- --port 5174

node web/e2e/run.mjs                 # flows 1-15 on the dev page, then the live smoke pass
node web/e2e/run.mjs 1 4 13          # only these flows
node web/e2e/run.mjs live            # only the smoke pass on https://tutor-1098c.web.app
node web/e2e/run.mjs 1 6 --landscape # 1180x820 instead of 820x1180
node web/e2e/run.mjs 10 --no-speak   # lesson flow with /api/speak blocked (no TTS calls)
node web/e2e/run.mjs 4 --no-retry    # do not retry a failed flow
```

Needs: Node 20, `puppeteer-core` (taken from `teaser/node_modules`, nothing to install), and Chrome at
`/Applications/Google Chrome.app` (override with `CHROME=...`).

Environment variables: `E2E_URL` (default `http://localhost:5174`), `E2E_OUT` (where screenshots and
evidence go; the default is this session's scratch folder, set it to any folder outside the repo).

## What you get

For each flow, in `E2E_OUT`:

- `flow-<n>.json`: verdict, every check with its measured values, timings, the `/api` requests and
  replies (image replaced by its length), the status line, console errors, hot reloads, and the
  tutor's shapes on the page. `flow-<n>-<run id>.json` is a copy that later runs do not overwrite.
- `f<n>-*.png`: screenshots. `f<n>-req<k>-check.png`: the image the page sent with request `k`.
- `api-calls.json`: paid calls made so far across runs.

Verdicts: `PASS`, `FAIL`, or `FLAKY` (failed, then passed on the one automatic retry). Flow 10 is
never retried, because a lesson costs 6 to 9 voice calls.

## What it costs

Every flow makes real Gemini calls through the deployed server.

| Flow | `/api/check` | `/api/speak` | `/api/glyphs` |
| --- | --- | --- | --- |
| 1 Wrong derivative, then fixed | 2 | | |
| 2 Correct work | 1 | | |
| 3 Algebra mistake | 1 | | |
| 4 Finish my line | 1 | | |
| 5 Full solve | 1 | | |
| 6 Graph | 1 | | |
| 7 3D surface | 1 | | |
| 8 Help ladder | 4 | | |
| 9 Help on finished work | 2 | | |
| 10 Teach me | 3 | 6 to 9 (0 with `--no-speak`) | |
| 11 Two problems | 2 | | |
| 12 Zoomed out | 1 | | |
| 13 Worksheet | 2 | | |
| 14 Handwriting toggle | 2 | | 2 |
| 15 Reload | 1 | | |
| live | 2 | 1 (0 with `--no-speak`) | |
| **Everything once** | **27** | **7 to 10** | **2** |

A full run takes about 10 minutes. A failed flow is retried once, which repeats its calls.

## How the pieces work

- `lib.mjs`
  - `layout(text, x, y, xh)`: a string to pen strokes. `^` raises the next character (or a `{...}`
    group) as an exponent. Each letter gets its own slant, turn, size and baseline drift.
  - `write(session, text, x, y, xh)`: draws those strokes with pen pointer events (`pointerType: 'pen'`
    on `Input.dispatchMouseEvent`), so tldraw goes into pen mode and stores `isPen` ink exactly as it
    does for an Apple Pencil. Returns the screen box of every character, which the flows use to
    check that a circle sits on the right term.
  - `erase(session, box)`: scrubs over a box with the eraser tool.
  - `open(...)`: a fresh browser context per flow (own storage), `/api` traffic recorded, audio
    elements instrumented (`window.__audio`), console errors and Vite hot updates logged.
  - The tldraw editor is found through the React tree (`window.__e2e.editor`), so the page does not
    need `?dev`. It is used to read shapes and positions, and in flow 12 to set the zoom to 40%.
    Ink is never injected through it.
- `run.mjs`: the flows and their checks. Each check is a sentence with the measured numbers in it;
  a failed check is the bug report's first line.

## Limits of this harness

- The "handwriting" is a stroke font. It is neater than a student's. Once (1 run in 4 of flow 4,
  before the jitter was increased) Gemini classified it as printed text; see RESULTS.md.
- Sound is not heard. The harness checks that every `/api/speak` call returns audio and that an
  audio element is given a blob source and played without error.
- Headless Chrome has no speech voices, so the browser-speech fallback cannot be tested.
- No pinch or two-finger gestures: zoom is set through the editor, scrolling uses wheel events.
- Voice questions (hold Help) and the circuit flow are not covered.
- The dev page has no cloud save unless `web/.env.local` has the Firebase keys, so the "another
  browser" half of flow 15 runs in the live pass.
