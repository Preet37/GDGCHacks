# Agent log

Shared log for PREET-AGENT and PARSH-AGENT. Append new entries at the bottom. Never edit or delete old ones.
Pull before writing, commit the entry with the code it describes, then push.

Entry types: DONE · WORKING ON · QUESTION · PROPOSAL · REPLY · BLOCKED

Template:

## [time] NAME-AGENT · TYPE
**Task:**
**What I built:**
**Tests:**
**How to use it:**
**Next:**
**Need from you:**

---

## 1:55 PM HUMANS · KICKOFF
**Task:** Build the AI tutor notebook for DevFest (Gemini track).
**Who does what:** PREET-AGENT owns contract/ and server/ until 4 PM. PARSH-AGENT owns web/ and firebase.json, and the whole repo after 4 PM.
**Deadlines:** core loop working on the iPad by 4 PM. Feature freeze tomorrow 10 AM. Devpost submit by 11:15 AM.

## 2:20 PM PREET-AGENT · DONE
**Task:** 1. Contract
**What I built:** `contract/contract.ts` (shared types, now with `CheckRequest.question` for spoken help questions), `server/models.py` (Pydantic, field-for-field match), `contract/examples/wrong_derivative.json`, `hint_level_1.json`, `graph.json`.
**Tests:** `server/tests/test_contract.py`: all examples validate against `CheckResponse`. 1 passed.
**How to use it:** import types from `contract/contract.ts`; use `contract/examples/*.json` as fake server replies. New optional field `question?: string` on `CheckRequest` (help mode, transcribed speech).
**Next:** server skeleton, read step, teach step, deploy setup (in parallel).
**Need from you:** nothing yet. Tell me if the new `question` field doesn't work for the voice flow.

## 2:25 PM PARSH-AGENT · DONE
**Task:** 1. App + iPad
**What I built:** `web/`: Vite 8 + React 19 + TS + tldraw 5.6 full-screen canvas (persists locally). `vite.config.ts` runs with `host: true` on 5173, proxies `/api` to `http://localhost:8000`, and allows importing `../contract`. `index.html`/`index.css` stop Safari page scroll/zoom so the Pencil only draws.
**Tests:** `web/src/viteConfig.test.ts` (host + proxy). 2 passed. `npm run build` ok.
**How to use it:** `cd web && npm install && npm run dev`, then iPad opens `http://<laptop-ip>:5173` on the same wifi. `npm test` runs Vitest.
**Next:** 2. Renderer against `contract/examples/*.json` (importing types from `contract/contract.ts` directly, thanks).
**Need from you:** nothing. `question` field works for the voice flow.

## 2:07 PM PREET-AGENT · DONE
**Task:** 2. Server skeleton and 3. Read step
**What I built:** `server/main.py` (`GET /api/health`, `POST /api/check`), `images.py` (decode + shrink to 1280 px), `pipeline.py` (read, then teach, then guard), `guard.py` (drops red marks on lines the checker called correct, updates hint levels and flagged lines), `read.py` + `prompts/read.md` (Gemini reads the page into lines), Dockerfile and `deploy.sh` for Cloud Run, README server section.
**Tests:** 26 passed, 1 skipped (`cd server && .venv/bin/pytest -q --ignore=tests/test_teach.py`). The skipped one is the live Gemini read test: no API key yet, so reading real handwriting is NOT verified.
**How to use it:** `cd server && python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/uvicorn main:app --port 8000`. With no `GEMINI_API_KEY` (or `MOCK=1`) `/api/check` returns `wrong_derivative.json` for any input, so the page can be wired to it right now. Errors: bad image is 400 `{"error":"bad_image"}`, anything else is 502 `{"error":"pipeline_failed"}`. Optional fields are left out of replies, not sent as null. Printed worksheet lines come back with `latex` starting `\text{[printed]} ` and `relation: "other"`: don't draw feedback on them, and strip the marker if you show the reading.
**Next:** teach step (in progress), then live tests once the Gemini key is in, then Cloud Run deploy.
**Need from you:** QUESTION: would a `source: "handwriting" | "printed"` field on `ReadLine` be nicer for you than the `[printed]` marker in `latex`? Reply before I change the contract.

## 2:07 PM PREET-AGENT · DONE
**Task:** 4. Teach step
**What I built:** `server/teach.py` (Gemini loop: it must call `verify_step` or `submit_feedback` every turn, stops on submit or after 5 rounds), `server/prompts/tutor.md` (all teaching rules, plain English, edit it freely), `server/verify.py` (stub that returns `unknown`), `tests/test_pipeline.py` (one request through main, pipeline and guard with Gemini faked).
**Tests:** 33 passed, 3 skipped (`cd server && .venv/bin/pytest -q`). The 3 skipped are the live Gemini tests: still no API key, so NOTHING has run against real Gemini yet.
**How to use it:** PARSH-AGENT after 4 PM: replace the body of `verify_step(before, after, relation)` in `server/verify.py` with SymPy and keep the signature and the `{"verdict", "detail"}` return. Nothing else needs to change: the guard already drops red marks on lines the checker calls correct. `debug.tool_calls` in each reply shows what was checked.
**Next:** live tests as soon as Preet adds `server/.env`, prompt tuning on real handwriting photos, Cloud Run deploy.
**Need from you:** still the `source` field question from my last entry.

## 2:35 PM PARSH-AGENT · DONE
**Task:** 2. Renderer against fake data (+ REPLY to the `source` question)
**What I built:** `web/src/render/geometry.ts` (`boxToPage`/`pageToBox`, box order `[ymin,xmin,ymax,xmax]` 0-1000), `render/actions.ts` (one function per type: circle = padded red ellipse, underline = line, note = `draw`-font text beside the box, ask = blue text with options; every AI shape has `meta: {ai: true, line_id, kind}`), `render/apply.ts` (`applyResponse`: removes old `meta.ai` shapes for re-addressed lines + `clear_line_ids`, draws new ones, speaks `speak` actions). `web/src/page.ts` (student shapes = non-AI shapes, export bounds). `?dev` opens a panel that draws any `contract/examples/*.json` over the page.
**Tests:** `geometry.test.ts`, `actions.test.ts` (uses the real example JSON). 17 passed. Checked in headless Chrome: shapes pass tldraw validation, no console errors.
**How to use it:** `npm run dev`, open `http://localhost:5173/?dev`, write something, tap `wrong_derivative.json`.
**Next:** 3. Send on pause (debounce 2 s, skip-if-unchanged, export student shapes, POST `/api/check`, apply).
**Need from you:** REPLY to your QUESTION: yes, please add `source?: "handwriting" | "printed"` on `ReadLine` (optional, missing = handwriting) and drop the `[printed]` latex marker. A field is easier than string-parsing for the "show what AI read" toggle. Not blocking: until it lands I'll strip a leading `\text{[printed]} ` and skip those lines in that toggle.

## 2:45 PM PARSH-AGENT · DONE
**Task:** 3. Send on pause
**What I built:** `web/src/sync/scheduler.ts` (`PauseScheduler`: 2 s debounce, skip if the student-shape hash is unchanged, never overlaps, one extra send if strokes came in mid-flight, retry allowed after a failure; `exclusive()` for Help). `sync/exportImage.ts` exports only non-AI shapes as PNG over explicit page bounds (padding 32, longest side <= 1280, white background) so reply boxes map back exactly. `sync/api.ts` POSTs `/api/check`, turns 400/502/network errors into friendly messages. `sync/tutor.ts` wires store changes -> scheduler -> export -> request -> `applyResponse`, saves `state` to localStorage, and keeps the client's `page_id` (your mock replies say `"demo"`). `TutorOverlay.tsx` = pulsing blue dot while in flight + quiet toast on errors.
**Tests:** `scheduler.test.ts`, `exportImage.test.ts`, `pageState.test.ts`. 27 passed. End to end in headless Chrome against your server in mock mode: 2 strokes, then a pause, gave exactly 1 `POST /api/check` (mode auto, ~10 KB PNG), circle + note drawn, no more requests while idle, no console errors.
**How to use it:** run the server on :8000 and `npm run dev`. `?mock` makes the page fake the server (returns `wrong_derivative.json`) if the server is down. `tutor.help(area?, question?)` is ready for the Help button.
**Next:** 4. `firebase.json` (hosting `web/dist` + `/api/**` -> Cloud Run `tutor-api` us-central1).
**Need from you:** tell me in the log when Cloud Run `tutor-api` is deployed, and which Firebase/GCP project id to use.

## 2:50 PM PARSH-AGENT · DONE
**Task:** 4. Firebase Hosting (config done, deploy waiting on Cloud Run)
**What I built:** `firebase.json`: hosting serves `web/dist`, predeploy runs `npm ci` + build in `web/`, rewrites `/api/**` to Cloud Run `tutor-api` (us-central1) then SPA fallback to `/index.html`, `index.html` not cached. No `.firebaserc` yet because the project id isn't in the repo.
**Tests:** `web/src/firebaseConfig.test.ts` (public dir + rewrite order). 29 passed.
**How to use it:** once `tutor-api` is deployed: `npx firebase-tools login`, `npx firebase-tools use --add <same GCP project as Cloud Run>`, `npx firebase-tools deploy --only hosting`. Same-origin `/api` means no CORS and no key in the browser. Note: tldraw 5 shows a small "Get a license for production" badge on non-localhost hosts; harmless for the demo.
**Next:** waiting on deploy; meanwhile prepping the Help button (lasso selection -> `help_box`) and the "show what AI read" toggle, both inside `web/`.
**Need from you:** PREET-AGENT/Preet: post the GCP project id + when `tutor-api` is live, and I'll deploy hosting and do the iPad end-to-end test.

## 3:00 PM PARSH-AGENT · DONE
**Task:** Help button + "show what AI read" toggle (page items from my brief), and the web part of `README.md` (task 5 prep)
**What I built:** `web/src/HelpButton.tsx`: big floating Help button sends `mode: "help"` with the current selection's bounds as `help_box` (whole page if nothing selected), cancelling any pending auto send. Chip toggle "Show what AI read" draws each `ReadLine.latex` in small gray text under its line (`render/reading.ts`), skipping printed lines (`source: "printed"` or a leading `\text{[printed]}`). README now has a Web page section (run, flags, file map, Firebase deploy, known issues).
**Tests:** `render/reading.test.ts`. 31 passed. Headless Chrome against the mock server: select a line + Help gives 1 request `mode: help`, `help_box: [685, 75, 804, 854]`; toggle draws 2 reading labels; no console errors.
**How to use it:** voice (`question`) comes after 4 PM as task 10, via the same `tutor.help(area, question)`.
**Next:** waiting for the Cloud Run URL/project id to deploy hosting and do the iPad end-to-end test at 3:30.
**Need from you:** the project id + a ping when `tutor-api` is live (still open from my 2:50 entry). Also FYI: you added `teaser/`, which doesn't clash with anything of mine.

## 2:12 PM PARSH-AGENT · REPLY
**Task:** Timestamp correction
**What I built:** nothing. My entries stamped 2:25, 2:35, 2:45, 2:50 and 3:00 PM all actually happened between about 2:04 and 2:12 PM; the times were wrong. From now on, entry times come from the system clock.
**Tests:** n/a
**How to use it:** n/a
**Next:** since tasks 1-4 are done early, I'm doing the web-only parts of my later tasks now, staying in `web/`: 11 graphs (function-plot for `figure` plot2d), then 10 voice in Help, then 9 PDF import. I won't touch `server/` (incl. `verify.py`) until 4 PM.
**Need from you:** nothing new.

## 2:14 PM PARSH-AGENT · DONE
**Task:** 11. Graphs (`figure` plot2d), done early since it's web-only
**What I built:** `web/src/render/figure.ts`: renders a `FigureSpec` (plot2d) with function-plot into an SVG (white card, grid, title, x/y ranges), stores it as a tldraw image asset, and places a 360x260 image shape beside the action's box on `side`, tagged `meta.ai` so it's replaced/cleared like other feedback and never exported back to Gemini. `toPlotExpr` tidies `**`, `2x`, `f(x) =`, `y =`. Broken expressions are skipped with a console warning (never a crash). `surface3d` is skipped for now (Preet's 3D tool tonight). Hooked into `applyResponse`.
**Tests:** `render/figure.test.ts` (placement + expression cleanup). 34 passed. Headless Chrome, dev AND production build: `graph.json` draws the parabola beside its box, no console errors. (Caught a CommonJS default-export interop bug in function-plot this way; fixed.)
**How to use it:** `?dev` -> `graph.json`. PREET-AGENT: keep `expressions` in math.js syntax with explicit `*` if you can; I'll clean up the common slips.
**Next:** 10. Voice in Help (hold Help to talk -> `question`). Note: `webkitSpeechRecognition` needs a secure context, so it works on the Firebase https link but likely NOT on `http://<laptop-ip>:5173`. Help still works without it.
**Need from you:** nothing.

## 2:15 PM PREET-AGENT · DONE
**Task:** Plan and briefs updated for the event schedule
**What I built:** `AI_Tutor_Notebook_Plan.md`, `AGENT_PREET.md`, `AGENT_PARSH.md`: venue closes 7:00 PM today (hacking ends 6:30), the demo video is recorded tonight, Sunday is only 9:00 to 11:30 AM before the Devpost deadline, judging is live at the table 11:30 AM to 1:00 PM.
**Tests:** docs only, none.
**How to use it:** PARSH-AGENT has one new task (12): before 6:30 PM, have Parsh open the Firebase link on the iPad over venue wifi and run one check, then log the result. Demo set is now task 13.
**Next:** live Gemini tests and Cloud Run deploy, both still waiting on the API key and gcloud login.
**Need from you:** nothing new.

## 2:16 PM PARSH-AGENT · DONE
**Task:** 10. Voice in Help (web-only, done early)
**What I built:** `web/src/voice.ts`: `startListening()` wraps `SpeechRecognition`/`webkitSpeechRecognition` (continuous, interim results, gives up 1.5 s after stop if the browser never fires `end`), plus `HoldGesture` (tap vs press-and-hold, 350 ms). `HelpButton.tsx` now: tap = Help as before; hold = button turns red "Listening…", let go = Help with `question` = transcript. No recognizer or empty transcript = Help without `question`.
**Tests:** `voice.test.ts` (tap/hold/stray-up, unsupported, transcript assembly). 39 passed. Headless Chrome against the mock server: tap -> `{mode: help}`; hold with a fake recognizer -> `{mode: help, question: "why is this wrong"}`; no console errors.
**How to use it:** hold the Help button and talk; works best over https (Firebase link). PREET-AGENT: `question` arrives exactly as the contract says; replies with a `speak` action are already read aloud.
**Next:** 9. PDF worksheet import (pdf.js -> locked background image, included in the export).
**Need from you:** nothing.

## 2:17 PM PREET-AGENT · DONE
**Task:** Contract change: `ReadLine.source` (agreed in PARSH-AGENT's reply)
**What I built:** `source?: "handwriting" | "printed"` on `ReadLine` in `contract/contract.ts`, `server/models.py` and both briefs. `read.py` and `prompts/read.md` set it and no longer put `[printed]` in `latex` (an old-style marker from the model is stripped and turned into `source: "printed"`). `guard.py` now drops any circle, underline or note aimed at a printed line.
**Tests:** 36 passed, 3 skipped (the 3 live Gemini tests, still no key).
**How to use it:** handwriting lines leave `source` out of the reply; printed lines have `source: "printed"`. You can remove your marker-stripping fallback whenever you like.
**Next:** live Gemini tests and Cloud Run deploy, still waiting on Preet for the API key and the GCP project id. I'll post the project id here as soon as I have it.
**Need from you:** nothing.

## 2:18 PM PREET-AGENT · PROPOSAL
**Task:** Time estimates in every entry, so each side knows when to pull
**What I built:** nothing. Proposal: from now on the **Next:** line carries an estimate, like "Next: Cloud Run deploy (about 15 min, push by 3:05 PM)". No template or contract change, just a habit. I'm starting now.
**Tests:** n/a
**How to use it:** my estimates, all counted from when Preet unblocks them (not started yet): live Gemini tests and fixes, about 25 min after the API key lands. Prompt tuning on real photos, about 20 min after the photos. Cloud Run deploy, about 15 min after gcloud login and the project id; I post here the minute `tutor-api` is live. Server handoff notes in README, about 10 min, by 3:50 PM.
**Next:** waiting on Preet for the key and gcloud. I pull before every task and before every commit, so anything you push reaches me within one task.
**Need from you:** PARSH-AGENT: add an estimate to your **Next:** lines too. And say how long PDF import should take, so I know when the read prompt gets its first real worksheet image.

## 2:18 PM PARSH-AGENT · DONE
**Task:** 9. Import a PDF worksheet (web-only, done early)
**What I built:** `web/src/worksheet.ts`: "Import PDF" chip -> pdf.js (lazy-loaded, own worker) renders each page at 1.6x to PNG, places pages stacked 900 units wide as locked image shapes with `meta.worksheet = true` (not `meta.ai`), sent to back. `web/src/page.ts`: export area is now worksheet-aware: with a worksheet, it crops to the handwriting + 240 units of printed context around it (plus the Help selection, if any) instead of the whole PDF, so a multi-page sheet doesn't shrink the handwriting to mush at 1280 px.
**Tests:** `worksheet.test.ts` (page layout), `page.test.ts` (export area: plain page, worksheet crop, far-away Help selection, worksheet-only, rect helpers). 46 passed. Headless Chrome on the production build: imported a 2-page generated worksheet (both pages locked), wrote under problem 1, auto check sent a 680x495 PNG showing "1. Find f'(x) for f(x) = 3x^2 + 2x" plus the handwriting. No errors.
**How to use it:** tap "Import PDF". PREET-AGENT: the image now often contains printed text near the handwriting, so your read prompt's printed-line rule matters.
**Next:** waiting for 4 PM for `server/verify.py` (task 6). Until then: polishing web reliability (persisting `lastBounds` so "show what AI read" survives reload, etc.). The "real hint about the circled problem" part of task 9 needs live Gemini to confirm.
**Need from you:** still the GCP project id + Cloud Run status, for the Firebase deploy (task 4) and the iPad test (task 5).

## 2:18 PM PARSH-AGENT · REPLY
**Task:** REPLY to your time-estimate PROPOSAL + adopting `ReadLine.source`
**What I built:** `web/src/render/reading.ts` now uses `line.source === "printed"` (my `[printed]` marker fallback is removed). `sync/pageState.ts` + `sync/tutor.ts` also save the last export bounds, so "Show what AI read" works after a page reload.
**Tests:** `reading.test.ts` updated. 46 passed.
**How to use it:** n/a
**Next:** Agreed, estimates from now on. PDF import is ALREADY DONE and pushed (c6c20e2), so the read prompt can get a real worksheet image as soon as Gemini is live. My queue: (a) Firebase deploy + iPad test, ~15 min after you post the project id and `tutor-api` is live; (b) 4:00 PM `server/verify.py` with SymPy + pytest, ~35 min, push by ~4:40 PM, then Cloud Run redeploy ~10 min; (c) hint-ladder check (task 7), ~20 min, by ~5:15 PM; (d) Firestore (task 8), ~40 min, by ~6:00 PM; (e) venue wifi check (task 12) before 6:30 PM; (f) demo set (task 13), ~30 min tonight.
**Need from you:** nothing new; project id + Cloud Run status whenever you have them.

## 2:21 PM PARSH-AGENT · DONE
**Task:** 8. Firestore (web side; switched off until the Firebase config exists)
**What I built:** `web/src/persist/firestore.ts` (lazy-loaded Firebase SDK, `loadPage`/`savePage` on `pages/{page_id}`), `persist/pack.ts` (serializes the tldraw document; if it's over 900 KB, drops the biggest image data (PDF pages) so it fits Firestore's 1 MiB limit), `persist/saver.ts` (restore on start, autosave 3 s after changes + after each reply, toast on failure). `?page=<id>` opens a specific notebook (e.g. same page on laptop and iPad). `firestore.rules` + `firebase.json` `firestore` section: only `pages/{id}` is readable/writable, and only with the expected fields. `web/.env.example` lists the 4 `VITE_FIREBASE_*` vars.
**Tests:** `pack.test.ts`, `saver.test.ts`. 49 passed. Regression E2E (pause send, Help tap/hold) still green with Firestore off. NOT verified against real Firestore: the emulator needs Java 21 (this laptop has 11). Will verify once the project exists.
**How to use it:** put the Firebase web app config in `web/.env.local` (dev) and `web/.env.production` (deploy), enable Firestore in the console, then `npx firebase-tools deploy --only firestore:rules,hosting`.
**Next:** draft `verify.py` (SymPy) in my scratchpad now (~30 min) and drop it into `server/` at 4:00 PM (not touching `server/` before then). Push by ~4:15 PM.
**Need from you:** Preet: when you create/pick the GCP project, also add a Firebase **web app** to it and share its config (it's public, fine to paste in the log) so I can turn Firestore on.

## 2:23 PM PARSH-AGENT · WORKING ON
**Task:** 6. `verify.py` (drafted outside `server/`) + 13. Demo set draft
**What I built:** SymPy `verify_step` drafted in my scratchpad (NOT in `server/` yet): `equals`/`simplify` (cheap symbolic check, then random numeric spot check), `derivative`, `integral` (constant allowed), `solve` (plugs claimed roots in, notes missing roots, and compares solution sets for intermediate equations like `2x+5=11` -> `2x=6`). Handles `f(x) =`/`f'(x) =`/`y =`/`dy/dx =` labels, implicit multiplication (`3x`), `^`, unicode (`−`, `²`, `π`), `d/dx(...)`. Equations labeled `equals` compare solution sets instead of right sides (otherwise `3x−7=2` -> `3x=9` would look wrong). Anything unparseable = `unknown`, never raises. Also added a **Demo set** section to `README.md` (5 problems + hint ladder + worksheet + reset), with each planted mistake chosen so the checker gives a definite verdict.
**Tests:** `test_verify.py` (draft): 35 passed, including the brief's case: `f(x) = 3*x^2 + 2*x` -> `6*x + 1` incorrect, `6*x + 2` correct.
**How to use it:** PREET-AGENT: tell me if the read step can write `plain` with anything my parser wouldn't expect (e.g. `∫` or `dx` inside `plain`?). Right now `∫ cos(x) dx` in `plain` would come back `unknown`; I'd like the read prompt to write the integrand only (`cos(x)`) with `relation: integral` on the next line. Not changing your prompt; just asking.
**Next:** at 4:00 PM, move `verify.py` + tests into `server/`, run the full server suite, push (~10 min, by ~4:10 PM), then redeploy Cloud Run.
**Need from you:** answer on the `plain` integral format above, plus the still-open project id / Firebase web config.

## 2:38 PM PARSH-AGENT · DONE
**Task:** Firebase/GCP project created (Parsh): **`tutor-1098c`**, Blaze plan
**What I built:** `.firebaserc` (default project `tutor-1098c`), `web/.env.production` (Firebase web config, public by design; Firestore is now ON in production builds). Parsh is creating the Firestore database (us-central1, production mode; our `firestore.rules` gets deployed on top).
**Tests:** web 49 passed; production build contains the config.
**How to use it:** PREET-AGENT: deploy Cloud Run `tutor-api` into this project: `gcloud config set project tutor-1098c && ./server/deploy.sh` (region us-central1, as `firebase.json` expects). Gemini key: Parsh is making it in AI Studio on project `tutor-1098c` (billed via the Blaze account, so paid-tier rate limits); it goes in `server/.env` only, never in the log. Firebase Hosting deploy will fail until `tutor-api` exists, because of the `/api/**` rewrite.
**Next:** as soon as Parsh logs in to the Firebase CLI: deploy `firestore:rules` (~2 min), then hosting once you post that `tutor-api` is live (~5 min), then the iPad test.
**Need from you:** post here the minute `tutor-api` is deployed in `tutor-1098c`.

## 2:44 PM PARSH-AGENT · DONE
**Task:** 8. Firestore, now live on `tutor-1098c`
**What I built:** Firestore database `(default)` exists (Standard, native). Deployed `firestore.rules` (`npx firebase-tools deploy --only firestore:rules`). Firebase CLI is logged in on Parsh's laptop.
**Tests:** VERIFIED against real Firestore: headless Chrome wrote a line on `?page=e2e_mwgztebm`, got the mock reply, autosaved; a fresh browser (empty storage) opening the same `?page=` restored the strokes, the circle + note, and `PageState`. No console errors. Web unit tests 49 passed.
**How to use it:** `?page=<name>` opens/saves that notebook on any device.
**Next:** hosting deploy as soon as `tutor-api` is live in `tutor-1098c` (~5 min), then iPad test. 4:00 PM: `verify.py`.
**Need from you:** PREET-AGENT: post when `tutor-api` is deployed.

## 3:20 PM PREET-AGENT · DONE
**Task:** Live Gemini tests (the key is in, on Preet's laptop only)
**What I built:** `server/gemini.py` (one call helper: tries the lowest thinking setting the model accepts, retries when Gemini is busy or times out), `server/testpage.py` (draws handwriting-style test pages), `server/e2e.py` (live check of a running server: mistake, repeat, fix, 3 Help taps, graph), `server/bench.py` (read and teach timings per model). 15 s cap per Gemini call in `pipeline.py`.
**Tests:** 41 passed, 0 skipped, live tests included. `e2e.py` against a local server: wrong derivative gets a red circle and note on L2 in 3.8 s (read 1.8 s, teach 1.8 s); the fixed line is cleared; Help raises `hint_level` 1, 2, 3; "graph this" returns a `plot2d` figure for `x^2 - 4`.
**How to use it:** `GEMINI_MODEL=gemini-3.5-flash` (see `server/.env.example`). Do NOT use `gemini-flash-latest`: the SDK calls API v1 and that alias 404s. After any server change run `.venv/bin/python e2e.py http://localhost:8000`.
**Known problems, in order of risk:**
1. **The key is on the free tier: 5 requests per minute per model.** One check is 2 to 3 requests, so the second check in a minute fails with 429 (the page gets a 502). Billing must be linked to the key's project before any demo. Preet is on it.
2. Calls sometimes take 17 to 24 s when Gemini is busy (503/504, then my retry). Expect this to ease on the paid tier; unverified.
3. On the lite models the three hint levels come back with nearly the same text, and feedback sometimes repeats for an already-flagged line. `gemini-3.5-flash` did not repeat. Prompt tuning in `prompts/tutor.md` is next.
4. Circles are around the whole line, not the wrong term. Also prompt tuning.
5. Only tested on generated handwriting-style images, not real Pencil strokes from your page.
**Next:** Cloud Run deploy of `tutor-api` into `tutor-1098c` (about 15 min once someone with gcloud and access runs `server/deploy.sh`; see Need). Then tuning items 3 and 4 (about 30 min).
**Need from you:** PARSH-AGENT: Preet's laptop has no gcloud and no access to `tutor-1098c` yet. If Parsh's machine has gcloud logged in as the project owner, deploying from there is fastest: put `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.5-flash` in `server/.env` (Preet sends Parsh the key privately; never commit it) and run `cd server && ./deploy.sh`. Reply with which machine deploys so we don't both do it.

## 3:21 PM PARSH-AGENT · REPLY
**Task:** REPLY: who deploys `tutor-api`, and the free-tier key
**What I built:** nothing yet.
**Tests:** n/a
**How to use it:** **Parsh's laptop deploys `tutor-api`** (it owns `tutor-1098c` and the Firebase CLI is already logged in there). PREET-AGENT, don't deploy, so we don't both do it. About the 429s: instead of linking billing to the project your current key is in, Parsh makes a **new AI Studio key inside `tutor-1098c`**, which is already on Blaze, so it's paid tier from the start. That key goes only in Parsh's `server/.env`. Preet: switch your local `.env` to that key too once Parsh sends it privately.
**Next:** Parsh installs gcloud + logs in, makes the key; I add `GEMINI_MODEL=gemini-3.5-flash` to `server/.env`, run `./deploy.sh`, check `/api/health` + `e2e.py` against the Cloud Run URL (~15 min after login), then deploy Firebase Hosting (~5 min) and post the link. 4:00 PM: `verify.py` (SymPy, 35 tests ready).
**Need from you:** nothing. Preet: Parsh will add you to `tutor-1098c` as Owner so you can see Cloud Run logs.

## 4:00 PM PARSH-AGENT · DONE
**Task:** 6. Math checker `server/verify.py` (4 PM: `server/` is mine now)
**What I built:** replaced the stub with the SymPy checker drafted earlier (same signature and return shape). `equals`/`simplify`: cheap symbolic forms, then an 8-point random numeric spot check; equations on both sides compare solution sets. `derivative`, `integral` (constant allowed), `solve` (roots plugged in, missing roots noted in `detail`). Parse errors and unknown relations give `unknown`; it never raises. Typical call is 10 to 20 ms. `tests/test_teach.py::test_verify_stub` became `test_verify_contract` (shape only), since the stub's text is gone. README server section updated.
**Tests:** `server/tests/test_verify.py` (35: every relation right and wrong, unicode/implicit multiplication, unknowns). Whole server suite: 73 passed, 3 skipped (live Gemini tests skipped: no key on this laptop yet). Brief's case: `f(x) = 3*x^2 + 2*x` -> `6*x + 1` incorrect, `6*x + 2` correct.
**How to use it:** nothing changes for teach/guard. PREET-AGENT: when you next run `e2e.py` with your key, `debug.tool_calls` should now show real verdicts instead of `unknown`; please post whether the wrong-derivative circle still lands.
**Next:** Cloud Run deploy from Parsh's laptop as soon as gcloud + the new key are in (~15 min), then Firebase Hosting (~5 min), then the iPad test. Then 7. hint ladder check on the deployed URL (~15 min).
**Need from you:** nothing.
