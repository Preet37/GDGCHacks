# Status of [need: name]

As of the last entry in `AGENT_LOG.md` (8:36 PM Saturday, Nov 14) and `web/e2e/RESULTS.md` (runs at 7:29 to 7:58 PM and 8:16 to 8:31 PM). Update this after the iPad rehearsal.

## State of the live site when the log ends

- **Every Gemini call fails.** At about 8:34 PM the project hit its monthly Gemini spend cap. `/api/check` and `/api/speak` return 502; `/api/health` still returns ok. Nothing works on the live site (marks, hints, lessons, voice) until Parsh raises the cap in AI Studio under Spend. It is not a code problem.
- **Hosting:** deployed from `7afe935` at about 8:35 PM. It carries the page fixes from the end-to-end run.
- **Cloud Run:** `tutor-api-00019-vig`, promoted about 8:17 PM, model `gemini-3.5-flash`. It does not have the 8:36 PM `server/practice.py` fix for "Solved". That fix is waiting for a tagged deploy.
- **Tests:** server 298 offline tests pass, web 407 tests pass.

## How things were tested

Four levels, weakest first. Each feature below is listed under the strongest level it has reached.

1. **Unit tests**: pytest and Vitest, no network, no model.
2. **Headless browser with fake replies**: the page in headless Chrome with `?mock` or with `/api/check` intercepted. Also, on the server side, a local server on the lite model driven by a script.
3. **Headless browser, real pen events, real server**: `web/e2e/run.mjs`. Each line is written on the canvas with pen pointer events tracing a stroke font, and the page calls Cloud Run with `gemini-3.5-flash`. No reply is faked. The stroke font is neater than real handwriting, and headless Chrome is not iPad Safari.
4. **A real iPad with Preet's handwriting.**

## Level 4: real iPad, Preet's handwriting

Three rounds, all before about 6:20 PM. Nothing has been tried on the iPad since.

| When | Setup | What Preet tried and saw |
| --- | --- | --- |
| About 4:50 PM | iPad to the laptop's dev page, local server on the lite model | Real handwriting was read. A red circle on `+ 1`, a graph and a "correct" note appeared. Notes were tiny next to large writing and the graph of `x^2 - 4` was clipped. With an imported PDF, the printed text was not read and Help flagged an old line. |
| About 5:35 PM | Same setup, 16 photos | Core flows worked on real handwriting. Bugs seen: tiny feedback when zoomed out, a new note drawn on top of the old one, a finished answer written on a line that did not end in `=`, Help on finished correct work returned nothing, a hand-drawn circuit failed with "no ground node". |
| About 6:20 PM | Live link on venue wifi | The live link loaded and worked on venue wifi. Voice input (hold Help) worked. A lesson played in the old card with the browser voice: visuals good, lesson too shallow, voice bad, card covering the work. A wrong derivative (`f'(x) = 3x^2 - 3x`) got no red circle. A spoken question got a question back. On a worksheet the hints were terse, repeated, drawn over the print, and the lesson was about the wrong problem. |

Fixes for every bug in this table are in. None of the fixes has been re-tested on the iPad.

## Level 3: real pen events against the real server

From `web/e2e/RESULTS.md`. "Reply" is from the last stroke and includes the 2 second pause; "check" is the request alone.

| Flow | Result | Measured |
| --- | --- | --- |
| Wrong derivative circled, then corrected and cleared | Pass, portrait and landscape, and again after the fixes | reply 8.8 s / 6.7 s, check 6.8 s / 4.7 s; fix to cleared 12.1 s / 11.8 s |
| Correct work gets no marks | Pass | reply 7.2 s, check 5.1 s |
| Algebra mistake (`2x = 20`) | Pass | reply 6.8 s, check 4.7 s |
| Finish my line (`g'(x) =` gets `12x`) | Flaky: 3 of 4 runs before the fix, 1 of 1 after | check 3.9 to 6.1 s |
| Full solve (`solve` written by `3x^2 - 3 = 0`) | Pass, 2 runs: three steps under the equation in order | reply 10.6 s / 9.4 s, check 8.5 s / 7.3 s |
| Graph | Pass, portrait and landscape, no overlap with ink | reply 5.3 s / 7.1 s |
| 3D surface, rotated by dragging with the pen | Pass, 1 run | reply 5.7 s |
| Help ladder: three different hints, 2 and 3 without a tap | Pass, 2 runs | hint 1 at 4.6 s / 4.2 s; hint 2 after 18.3 s / 18.1 s; hint 3 after 24.8 s / 17.9 s |
| Help on finished, correct work: green note | Pass | 5.9 s |
| Teach me in portrait with the real Gemini voice: docked panel, 7 steps, subtitles, 7 of 7 clips returned and the audio element played, practice problem written at the end | Pass | lesson 8.6 to 11.3 s; tap to panel 9.9 to 12.7 s; clips 2.0 to 4.7 s each |
| Teach me in landscape | Failed at 7:43 PM (page zoomed to 58%). Pass after the fix, 2 runs, with the voice blocked | zoom stayed 100% |
| Practice answer written after the tutor's `=` | The answer was sent and the server's check returned `correct`. No green note and no "Solved" came back, in the 7:57 PM run and again against revision `00019` at 8:17 PM | n/a |
| Two problems far apart: only the second is sent, the first keeps its marks | Pass | second check 4.3 s |
| Page zoomed out to 40%: feedback sized to the handwriting | Pass | reply 7.2 s |
| Worksheet PDF: mark on the handwriting, nothing on the print, Help answers the problem in view | Pass, and again after the fixes | import 0.3 s, check 5.1 s, help 9.1 s |
| "Write in my handwriting": `12x` drawn as 4 pen strokes; `/api/glyphs` round trip | Pass, 1 run, with harness-generated strokes as the "handwriting" | check 6.3 s; glyphs 3.2 s and 4.9 s |
| Reload in the same browser: ink and marks back, no request | Pass | n/a |
| Saved page opened in a fresh browser on the live site | Ink and marks came back from Firestore. An extra check was sent before the fix. After the fix, Parsh saw no check in 15 s on live (8:35 PM) | n/a |
| Live site smoke (7:48 and 7:50 PM) | Pass: page loads, mistake circled, one voice clip | check 4.7 s / 5.1 s; clip 2.3 s |
| Live site smoke (8:35 PM) | Fail: spend cap | n/a |

Also in that run: Gemini read all of about 60 pen-drawn lines on 28 pages with the right text. On 2 of the 28 pages it labelled the handwriting `printed`. There were no console errors in any flow. The status line matched what happened in every flow.

Not covered by the harness: real sound, the iOS audio unlock, voice questions, circuits, pinch zoom, palm rejection, and a lesson with the real voice in landscape.

## Level 2: headless browser with typed text or fake replies, or a local server on the lite model

- **"Solved" label on the page.** With `/api/check` intercepted and a green reply supplied, the label flipped to "Solved". With the real server it has not appeared yet (see above).
- **Practice checked by the server.** Local server, lite model, scripted request: `g'(x) = 3x^2` under a given `g(x) = x^3` got "Correct. You've got it." (2.6 s); `g'(x) = 3x` got a red circle and a question; an open `g'(x) =` got nothing. The green note written by code appeared on 2 of 3 local runs; the miss was a test-script error.
- **Your turn on the live site with typed text** (Parsh, 7:58 PM): the practice problem was written under the work and sent as `given`. His typed answer did not trigger a check; the page only watches ink.
- **Full solve on the live site with typed text** (Parsh, 7:23 PM): `2x + 6 = 14` and `solve it` gave `2x = 8`, `x = 4` under the line.
- **Teach me on the live site with typed text** (Parsh, 7:34 PM): docked panel, 8 steps, 8 voice clips returned.
- **Live transcript bar while holding Help, placement on a worksheet image.** Headless screenshots only.
- **Handwriting toggle with a synthetic learned hand** (7:20 PM): `12x` written as 21 ink strokes.
- **Server forcing handwriting when `has_worksheet` is false; the mistake mark written by the server when the model is silent.** Local server on the lite model, plus unit tests. Flows 1 and 4 passed afterwards with `has_worksheet: false`, one run each. How often handwriting is still mislabelled after the fix has not been measured.
- **Circuit read, solved, wrong answer circled.** Full pipeline on a generated sketch image with `gemini-3.5-flash` (read 5.0 s, teach 6.9 s), earlier in the day.
- **`/api/speak` under load.** 9 parallel requests on a local server with the real key: 9 of 9 returned, in waves of 3, the last after 10.4 s.
- **Character finding on real handwriting.** Measured on 4 real pages of Preet's Pencil writing: `gemini-3.5-flash` found 55 of 59 characters with no wrong labels; the lite model found 27 of 32.

## Level 1: unit tests only

- **The "Solved" fix** (`server/practice.py`, 8:36 PM): the ask line joins the statement's problem, and ink on the ask row counts as the answer. 298 server tests pass, including the exact failing request. Not deployed, not run against the model.
- The blue note when a written "solve" produces nothing usable (also reproduced once on a local lite server).
- The limit of 3 voice calls at a time and the single retry on a 429 (also checked with parallel requests, above).

## Not tested on an iPad

Everything built after about 6:20 PM. In particular:

- The docked lesson panel, in either orientation.
- The Gemini voice: whether it is audible, the iOS audio unlock, and whether late clips fall back to the browser voice mid-lesson.
- Subtitles in lessons and the live transcript while holding Help.
- "Your turn" and "Solved".
- Full solve.
- Help that explains, the countdown and the prefetched hints.
- Placement that avoids ink, print and buttons.
- "Write in my handwriting" with real Pencil strokes.
- The blank-line fix for the wrong derivative that got no circle at 6:07 PM.
- Worksheets and circuits since their fixes. 3D rotation by touch.
- `/api/debug/recent` has only been read from a laptop.

## Known bugs and limits

Open:

- **"Solved" does not show on the live site** until the 8:36 PM fix is deployed and confirmed. Known limits of that fix: a gap of more than 150 units after the `=` is ignored, and a one-character answer after a misread prefix can be dropped as a duplicate.
- **The spend cap** blocks everything until it is raised.
- **Checked marks have a gap.** A red mark on a line the checker called correct is dropped by code. If the checker returns `unknown` (it could not parse the step), Gemini may still mark the line when it is very sure. That mark is not verified.
- **In landscape, the tutor's question beside a line can run under the lesson panel.** The student's lines stay clear.
- **A lesson with the voice blocked waits on "Tap to play with sound"** and then plays silently. Seen only in headless Chrome, which has no speech voices.
- **Later lesson steps may use the browser voice.** With 3 voice calls at a time the last clip of 9 can arrive about 10 s after the request. If the page's 2.5 s lateness rule counts from the request, later steps fall back. Not checked.
- **Hint 3 was 7 s late once** (24.8 s on the server).
- **Typed text is not checked.** The page only watches ink. This matters for testing, not for the iPad.
- A circle is narrowed to the wrong term by its position in the text. It is an estimate and can sit off on uneven handwriting.
- Lines more than about 6 line heights apart, or off to the side, are not sent together. The step then has nothing to be checked against and gets no mark.
- The first request after idle is slower (about 7 s measured earlier in the day).
- Hint history is kept in server memory per page. A restart or a second Cloud Run instance loses it, and hints may then repeat an idea.
- `compute_step` could not parse "integral of 2x dx" written in words.
- The dev page has no cloud save (`web/` has no `.env.local`). A page opened through the fallback laptop address does not restore on another device.
- `/api/debug/recent` is open to anyone. Firestore pages are readable by anyone with the page id. Remove or lock both after the weekend.
- The top-level `README.md` is out of date.

Fixed tonight, and how far each fix was confirmed:

- Landscape lesson zoomed the page to 58%: fixed. Harness on the dev page, 2 landscape runs and 1 portrait.
- Handwriting labelled `printed` so the tutor stayed silent: page sends `has_worksheet`, server forces handwriting. Harness flows 1, 4 and 13 pass, one run each.
- Opening a saved page sent an unrequested check: fixed. Confirmed on the live site at 8:35 PM.
- Notes drawn over the gray "what AI read" label, the lesson's end cutting off the work in portrait, the status line over the undo strip: fixed. Harness on the dev page.
- Two voice requests rejected with 429 during a lesson: server limit and retry, deployed in revision `00016`.
- Silence after a written "solve" when the steps fail the check: now a blue note.
- Teach me broken on live from about 7:31 to 7:33:35 PM (server sent `practice` before the page accepted it): fixed by the Hosting deploy. Rule: Hosting first when the page must accept a new field.

The "Re-run after fixes" section of RESULTS.md lists three items as "not touched" that the log says were changed on the server at 8:09 PM: forcing handwriting, the green practice note from code, and hints always placed below. The log is the later and more specific source for those.

## Sunday morning checklist

Before leaving home:

- [ ] Confirm with Parsh that the Gemini spend cap has been raised.
- [ ] iPad charged to 100%, charger and cable packed.
- [ ] Pencil paired and charged. Spare tip if there is one.
- [ ] Laptop charged, charger packed.
- [ ] The 2-minute video saved on the iPad and the laptop, and uploaded where Devpost can link it.
- [ ] Phone hotspot tested with the iPad.

At the table, 9:00 AM:

- [ ] Join venue wifi. Open `https://tutor-1098c.web.app/api/health` and expect `{"ok": true}`. Health stays ok when the spend cap is hit, so the next two steps are the real test.
- [ ] On the laptop, start the dev page (`cd web && API_TARGET=https://tutor-api-191803288552.us-central1.run.app npm run dev -- --port 5174`) and re-run the harness: `node web/e2e/run.mjs`. It runs flows 1 to 15 and the live smoke pass. For a short version: `node web/e2e/run.mjs 1 10 live`. Each run makes paid Gemini calls, so run it once.
- [ ] In the flow 10 result, check whether "Solved" appears after the practice answer. That decides the wording of the pitch (see `docs/DEMO.md`).
- [ ] Hard-reload the page on the iPad so the newest build loads.
- [ ] Open a fresh page id: `https://tutor-1098c.web.app/?page=sun-1`. Use a new id for each judge (`sun-2`, `sun-3`).
- [ ] Run demo problem 1 once on the iPad. This also warms up Cloud Run.
- [ ] Run problem 2 (Teach me, then Your turn) in portrait. Listen for the Gemini voice. Set the iPad volume so it is clear over the room. Check the panel's mute button is off.
- [ ] Run problems 3 to 6 once each.
- [ ] If something looks wrong, open `https://tutor-1098c.web.app/api/debug/recent` on the laptop. It lists the last 30 requests: what was read, which tools were called with their verdicts, and what was sent.
- [ ] Hold Help and say a short question, to trigger the microphone permission prompt before a judge is watching.
- [ ] Decide what from the "Only if rehearsed" list is in, from the rehearsal.
- [ ] If wifi is slow, switch the iPad to the hotspot and repeat problem 1.
- [ ] Fallback laptop address ready: with the dev page running as above, open `http://<laptop-ip>:5174` on the iPad (same network). Write the address on a sticky note. Voice questions do not work on this address because speech input needs https, and pages do not save to the cloud there.
- [ ] iPad: Do Not Disturb on, auto-lock set to Never, Safari in full screen, other tabs closed.
- [ ] Pre-write problem 1 on the first page, with its red mark showing, so the pitch starts without waiting.

Before 11:15 AM:

- [ ] Fill in `[need: name]` and the Zurich project's name and link in `docs/DEVPOST.md`.
- [ ] Submit on Devpost with the video link. Deadline is 11:30 AM. One track only: Best Integration of Gemini/Google API.
- [ ] No deploys after the last successful rehearsal. If a deploy is unavoidable and it adds a field the page must accept, Hosting goes first, then Cloud Run.

During judging, 11:30 AM to 1:00 PM:

- [ ] Keep the video open in a tab on the laptop.
- [ ] Between judges: new page id, pre-write problem 1, check the battery.
- [ ] If a check returns nothing or an error, read the status line under "Show what AI read", then open `/api/debug/recent` on the laptop.
