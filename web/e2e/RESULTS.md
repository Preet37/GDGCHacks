# End-to-end results

Run on Saturday Nov 14, 7:29 PM to 7:58 PM PST, against the dev page `http://localhost:5174`
(its `/api` proxied to Cloud Run, `gemini-3.5-flash`) and the live site `https://tutor-1098c.web.app`.
How to re-run: [README.md](README.md).

Screenshots and evidence are in
`/private/tmp/claude-501/-Users-preet-Desktop-hackathons-gdgc/73dcfcc0-13da-4c28-8a85-abb9c652bd1f/scratchpad/e2e/`
(called `OUT/` below). `OUT/flow-<n>.json` holds every request, reply and measurement of a flow's latest run.

## Summary

- **Pen-drawn ink works.** Every line in every flow was written on the real canvas with pen pointer
  events tracing the stroke font. tldraw stored it as pen ink and went into pen mode, as with an Apple
  Pencil. No shapes were injected. The first attempt worked at an x-height of 26 px with tldraw's
  default pen size (M); no tuning of size was needed.
- **Gemini read it correctly every time.** 28 pages, about 60 handwritten lines: every line came back
  with the right text, including exponents, primes and `d/dx (x sin x)`.
- **But on 2 of 28 pages it labelled the handwriting `printed`** (worksheet text). On one of them that
  silently cancelled the tutor's answer. This is bug 2 below.
- 12 flows pass, 1 is flaky, 1 passes in portrait and fails in landscape, and the reload flow passes
  with a bug on the live site.
- The status line under "Show what AI read" matched what happened in every flow.
- **No console errors** in any flow, on dev or live.
- Paid calls used: 49 `/api/check`, 8 `/api/speak`, 2 `/api/glyphs`.

## Flows

Portrait is 820x1180, landscape 1180x820. "Reply" is the time from the last pen stroke to the reply
(it includes the page's 2-second pause); "check" is the request alone.

| # | Flow | Verdict | Timings | Notes |
| --- | --- | --- | --- | --- |
| 1 | Wrong derivative, then corrected | **PASS** (portrait and landscape) | reply 8.8 s / 6.7 s, check 6.8 s / 4.7 s; fix to marks cleared 12.1 s / 11.8 s | Red circle on `+ 1`, red "What is the derivative of 2x?". Erasing with the eraser tool and rewriting `6x + 2` cleared both. |
| 2 | Correct work, no marks | **PASS** | reply 7.2 s, check 5.1 s | No marks, one request. |
| 3 | Algebra mistake | **PASS** | reply 6.8 s, check 4.7 s | Circle on `20`, "What do you get when you subtract 6 from both sides?" |
| 4 | Finish my line | **FLAKY** (3 of 4 runs pass) | reply 5.9 to 8.1 s, check 3.9 to 6.1 s | Passing runs: `12x` straight after the `=`, 50 px font beside 39 px handwritten digits, black. Failing run: bug 2. |
| 5 | Full solve | **PASS** (2 runs) | reply 10.6 s / 9.4 s, check 8.5 s / 7.3 s | `3x² = 3`, `x² = 1`, `x = ±1` under the equation, in order, 49 px font. |
| 6 | Graph | **PASS** (portrait and landscape) | reply 5.3 s / 7.1 s | Parabola beside "graph it", y from -5 (or -6) to 12, vertex visible, no overlap with ink. |
| 7 | 3D surface | **PASS** | reply 5.7 s | WebGL surface drawn; dragging on it with the pen rotates it, draws no ink and does not move the card. |
| 8 | Help ladder | **PASS** (2 runs) | hint 1 at 4.6 s / 4.2 s; hint 2 after 18.3 s / 18.1 s; hint 3 after 24.8 s / 17.9 s | Three different hints, each with a reason or worked math, hints 2 and 3 without a tap. See "Smaller findings" 1 and 3. |
| 9 | Help on finished, correct work | **PASS** | help 5.9 s | Green note: "Correct! You can plug x = 4 back into the start to double check: 2(4) + 6 = 14." |
| 10 | Teach me | **PASS in portrait, FAIL in landscape** | lesson 8.6 to 11.3 s; tap to panel 9.9 to 12.7 s; 7 voice clips, 2.0 to 4.7 s each | Portrait with the real voice: 7 of 7 `/api/speak` returned 200 `audio/wav`, audio element played, subtitles, 7 steps, practice problem written at the end. Landscape: bug 1. |
| 11 | Two problems far apart | **PASS** | second check 4.3 s | Only the second problem was sent; the first problem's circle and question stayed. |
| 12 | Zoomed out to 40% | **PASS** | reply 7.2 s | Note is 21 px on screen beside handwriting with 41 px digits; "what AI read" text 11 px. |
| 13 | Worksheet PDF | **PASS** | import 0.3 s, check 5.1 s, help 9.1 s | Printed problem read as context, circle on the handwritten `+ 2x`, nothing on the print. After scrolling to problem 2: "To solve for x, get x by itself. First undo the subtraction by adding 7 to both sides, then divide by 3." under problem 2. |
| 14 | Handwriting toggle | **PASS** | check 6.3 s; glyphs 3.2 s and 4.9 s | `12x` drawn as **4 ink strokes** (draw shapes), no text shape, 41 px tall beside 39 px digits. `/api/glyphs`: 2 calls, both 200, 11 and 28 characters found. |
| 15 | Reload, same `?page=` | **PASS, with bug 3 on live** | n/a | Same browser (dev): 32 strokes, circle and question back, no new request. Fresh browser (live): everything back from Firestore, but one extra `/api/check` is sent. The dev page has no cloud save (see "Smaller findings" 7). |
| live | Smoke on tutor-1098c.web.app | **PASS, with bug 3** | check 4.7 s / 5.1 s; one voice clip 2.3 s, 188 KB | Page loads, toolbar present, `/api/health` ok, mistake circled. The build is current: it has the "Write in my handwriting" chip. |

Two harness mistakes are visible in the saved evidence and are not product failures: flow 10's
first run fails one check that expected `data-voice="gemini"` (the page's value for the server
voice is `"audio"`), and flow 8's first run fails two checks that were too strict about brackets
and about what counts as explaining. Both checks were corrected and the flows re-run.

## Bugs

### 1. Teach me in landscape shrinks the page to 58% and hides the first line under a button

- **Did:** landscape, wrote `f(x) = 3x^2 + 2x` and `f'(x) = 6x + 1` at 100% zoom, got the red mark, tapped Teach me.
- **Expected:** the lesson docks on the right and the problem stays readable beside it.
- **Happened** (both landscape runs, 7:43 PM and 7:46 PM): the panel docked correctly (496 px wide),
  but the camera zoomed out to 58% and moved the work to the top-left corner. The start of line 1 sits
  under tldraw's "Exit pen mode" button and page menu (5 of 32 strokes covered; the ink box is at
  x 57, y 47, the button covers x 8 to 135, y 46 to 86). The zoom stays at 58% after the lesson is
  closed, so the practice problem and everything written afterwards is small.
- **Evidence:** `OUT/flow-10-land.json` (`zoomDuringLesson: 0.58`, `layout.ink: "57,47 226x88"`).
  Portrait is fine: zoom stays 100%, nothing covered.
- **Likely cause:** `web/src/lesson/layout.ts`. `canvasInsets()` reserves 56 px at the top, less than the
  86 px the "Exit pen mode" button reaches (it is always shown when writing with a Pencil), and
  `cameraFor()` zooms out to fit ink plus the lesson marker plus a 260 px margin (`focusLesson` in
  `web/src/lesson/focus.ts`) into the 684 px that are left. Nothing restores the zoom on close.
- **Screenshots:** `OUT/f10-land-b-panel.png`, `OUT/f10-land-f-practice-answered.png`

### 2. Handwriting is sometimes labelled "printed", and then the tutor stays silent

- **Did:** flow 4, first run (7:31 PM): wrote `g(x) = 6x^2` and `g'(x) =` on an empty page, no worksheet.
- **Expected:** `12x` after the equals sign.
- **Happened:** nothing was drawn. The reply read both lines correctly but with `source: "printed"`, and
  `actions: []`. The server's own log shows it had the answer:
  `tool_calls: ["compute_step(L1->L2, derivative) = 12*x", "submit_feedback(1/1 actions kept)"]`.
  The status line said "read 2 lines, no actions, drew 0", and the gray "what AI read" labels were
  missing (the page hides printed lines), so nothing told the student why.
- **Again** at 7:54 PM (flow 8, second run): `d/dx (x sin x)` came back `printed` in all four requests
  for that page. Help still worked there, because a blue hint is allowed on printed text. A red mark
  or an inline answer would not have been.
- **How often:** 2 of 28 pages. Both were short pages (one or two lines). The harness's stroke font is
  neater than real handwriting, which makes this more likely here than with a Pencil, but nothing in
  the system prevents it for a neat writer.
- **Evidence:** the request image `OUT/f8-req0-check.png` and `OUT/flow-8.json` (every line
  `"src": "printed"`). The flow 4 failure's JSON was overwritten by its re-runs; its reply is quoted above.
- **Likely cause:** `server/prompts/read.md` lets the model choose `printed` for any image, and
  `server/guard.py` (`_keep`, the `line.source == "printed"` rule) then drops marks and answers on
  that line. The page knows there is no worksheet in the window (`sheets` is empty in
  `web/src/sync/tutor.ts` `fetch()`), but the request has no way to say so. Either send that fact
  and have the server force `handwriting`, or have the server ignore `printed` when the page sent
  no worksheet.
- **Screenshot:** `OUT/f8-hint1.png` (the hint is shown, but there is no gray reading label under the line)

### 3. Opening a saved page in another browser sends a check nobody asked for (live site)

- **Did:** on the live site wrote `2x + 6 = 14`, `2x = 20`, got the circle and question, waited 6 s for
  the save, then opened the same `?page=` in a fresh browser.
- **Expected:** ink and feedback come back; no request, since nothing changed.
- **Happened** (both live runs, 7:48 PM and 7:50 PM): ink (18 of 18 strokes), circle and question came
  back, and 2.6 s after load the page sent an auto `/api/check` (9.1 s, `read 2 lines`, `actions: []`;
  the request carried the 2 saved lines and `flagged_line_ids: ["L2"]`). Nothing was lost or doubled
  this time, but each open costs a paid call, and the reply could redraw or clear feedback.
  A reload in the same browser does not do this.
- **Evidence:** `OUT/flow-live.json`, `freshApi`.
- **Likely cause:** `web/src/persist/saver.ts` `restorePage()` calls `editor.loadSnapshot()` and then
  `tutor.adoptState()`, which clears the list of unsent changes. The tutor's store listener in
  `web/src/sync/tutor.ts` (source `'user'`) is delivered after that, sees every loaded stroke as
  new, and pokes the scheduler; 2 s later it sends. The 2.6 s delay matches the 2 s pause.
- **Screenshot:** `OUT/flive-fresh-browser-later.png`

## Smaller findings

1. **Hint 3 was 7 s late once.** Flow 8, first run: the third hint took 24.8 s on the server
   (`teach_ms` 22.8 s); the pill showed "Next hint…" for 7 s after the countdown ended. Second run: 17.9 s.
2. **A correct practice answer gets no response.** After the lesson, the page wrote "Your turn: find the
   derivative.", `g(x) = 4x² + 5x`, `g'(x) =` in violet. Writing `8x + 5` after it by hand sent the
   tutor's lines as `given`, and the server checked it (`verify_step(G422902->L4, derivative) = correct`)
   but returned no actions, so the student sees nothing. Evidence: `OUT/flow-10.json`, `practiceAnswer`.
   Screenshot: `OUT/f10-f-practice-answered.png`. Likely `server/practice.py` / `server/guard.py`.
3. **Hints move.** In flow 8's first run, hint 1 was drawn to the right of the line in a 183 px column
   (at x 467, y 204) and hints 2 and 3 below the line (x 93, y 277). In the second run all three were
   below. The first run's screenshots were overwritten by the second; the positions are from its log.
4. **Notes are drawn over the gray "what AI read" label** when that chip is on: the first line of a
   note below the work touches the label (`OUT/f1-a-wrong.png`, `OUT/f11-b-both.png`). `web/src/render/apply.ts`
   leaves `reading` shapes out of the obstacles.
5. **End of a lesson in portrait:** the page scrolls so the practice problem is in view, which cuts the
   original work off at the top, and the "Lesson" and "Your turn" pills sit over the red question
   (`OUT/f10-d-end.png`).
6. **Lesson panel open in portrait with "Show what AI read" on:** the status line covers part of
   tldraw's undo/redo strip (`OUT/f10-b-panel.png`).
7. **The dev page has no cloud save.** `web/` has `.env.production` but no `.env.local`, so Firestore is
   off under `npm run dev`. The fallback laptop address in `docs/STATUS.md` would therefore not
   restore a page on another device.
8. **Voice blocked:** with `/api/speak` failing, the lesson waited on "Tap to play with sound" instead
   of starting. Headless Chrome has no speech voices, so this may not happen on an iPad. After the tap
   it played through in silence and reached the practice problem.
9. **Hot reload:** during flow 5's first run (7:31 PM) the canvas was remounted by a hot update and the
   tool went back to Select. That was the other agent's edit, not a product bug; the re-run kept the pen.

## Not covered

Real sound, the iOS audio unlock, voice questions (hold Help), the circuit flow, pinch zoom, palm
rejection, and a lesson with the real voice in landscape (the voice budget covered one lesson).
