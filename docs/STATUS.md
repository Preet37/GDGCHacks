# Status of [need: name]

As of about 2:15 AM Sunday, Nov 15, 2026. Written from `AGENT_LOG.md` (to its last entry, 1:56 AM), `git log` (to `3c623fc`, 1:58 AM) and the code. `web/e2e/RESULTS.md` still describes the 7:29 to 8:31 PM Saturday runs; the later runs are only in the log. All times are Pacific.

## If you read one thing

**What works** (pen strokes on the real canvas, real server, real Gemini; last full run 11:34 to 11:44 PM Saturday):

- A wrong step is circled with a question. Fixing it clears the mark.
- Teach me plays a lesson with the Gemini voice and subtitles. "Your turn" writes a practice problem, and a correct handwritten answer gets a green note and "✓ Solved".
- Help gives three different hints. Graphs and 3D surfaces draw. A written `solve` gives worked steps.
- On a PDF worksheet: marks land on the handwriting, and Help on a circled printed problem answers that problem (2.6 s).

**What is in `main` but not on the live site** (https://tutor-1098c.web.app is at `11c3b1b`, deployed about 11:30 PM Saturday, plus the sample PDFs):

- Solve on printed integrals (`6ea3d5c`). On the live site this still answers "I could not check a full solution".
- The "Solve it" button, every-step solutions, a solution moved beside the worksheet when there is no room, graph titles as math (`7ccc1fa`).
- Typeset solution steps with stacked fractions (`d13aab5`). A solution lowered to clear the print (`9c80e34`).
- These run only on the tunnel from Preet's laptop: https://3663-128-114-255-202.ngrok-free.app (address changes if ngrok restarts; the laptop must stay on).

**What has never been tested on the iPad:**

- Everything built after midnight: the "Solve it" button, every-step and typeset solutions, the solve fix for integrals, solution placement on a worksheet, math titles.
- "Listen" since its 11:20 PM fix. It has never run with a real microphone that worked.
- Help on a circled problem on a zoomed-out worksheet since its fix (passed in the harness only).

**Three things to do before 11:30 AM, in this order:**

1. **Get the latest code onto the URL you will demo from.** Preet signs in on his laptop (`gcloud auth login`, `firebase login`) and deploys `main` to production. If that is not done and checked by about 9:00 AM, stop and demo from the tunnel, or from the live site as it is with the shorter script in `docs/DEMO.md`.
2. **Rehearse on the iPad on that URL**, with Preet's handwriting, in the order in `docs/DEMO.md`. Include Listen once. Cross out anything that fails. Say the 90-second pitch out loud twice.
3. **Pick the name, finish the video, submit on Devpost.** Aim for 11:00 AM. The deadline is 11:30 AM. One track only: Best Integration of Gemini/Google API.

## State of the live site

| Item | State at 2:15 AM Sunday |
| --- | --- |
| Gemini calls | Working. See "Money and limits" for the two outages tonight. |
| Cloud Run | `tutor-api-00028-bej`, built from `11c3b1b`, promoted about 11:30 PM Saturday. Model `gemini-3.5-flash`. |
| Firebase Hosting | Page from `11c3b1b` (about 11:30 PM), then `e7c5533` at 11:50 PM, which only added the sample PDFs. |
| Behind `main` by | `6ea3d5c`, `7ccc1fa`, `d13aab5`, `9c80e34` (listed above). |
| Sample worksheets | Live: `/samples/derivatives.pdf`, `/samples/algebra.pdf`, `/samples/mixed.pdf`. One letter page each, four printed problems. |
| Deploys | Moving to Preet's laptop. gcloud and firebase-tools are installed. Parsh granted Preet Editor on project `tutor-1098c`. Preet has not signed in yet, so nothing has been deployed from there. |
| Tunnel | https://3663-128-114-255-202.ngrok-free.app serves the dev page on current `main` and Preet's local server. It is https, so the microphone can work. The local server uses a different key from the live one. |
| `engineering` branch | Not merged, not on the live site. Circuits x-ray and what-if card, unit checking, free-body diagrams. It runs on a separate service, `tutor-api-eng`. Preet's agent tested it at 1:56 AM: four of its five demo flows passed. |
| Tests | At 12:52 AM Sunday: server 304 offline tests pass, web 445 pass. Not re-counted after `d13aab5` and `9c80e34`. |

Deploy plan from the log (1:15 AM): deploy `tutor-api` without `--set-env-vars` so the live key and model stay as they are, tagged with no traffic, check health and one real check, then promote; then Hosting from `main`. The earlier rule from 7:33 PM Saturday says Hosting goes first when the server starts sending something the old page rejects. `[need: check whether d13aab5 adds a field the old page rejects, and pick the order]`

## Money and limits found tonight

| When | What happened | Fix |
| --- | --- | --- |
| 8:35 PM Sat | The Gemini project hit its spend cap. Every call failed. `/api/health` stayed ok. | Parsh raised the cap to $10 at about 9:55 PM. |
| 11:08 PM Sat | Prepaid credit ran out (`402 ... prepayment credits are depleted`). | Parsh topped up at about 11:20 PM. |
| 11:24 PM Sat | The voice model `gemini-3.8-flash-lite-tts` hit its limit of 100 requests per day per project on this tier. | The server now falls back through `gemini-3.8-flash-tts`, `gemini-3.1-flash-tts-preview`, `gemini-2.5-flash-preview-tts`. Seen working at 11:34 to 11:44 PM: 1 clip from the lite model, 7 from the next. Lessons now fetch clips two steps ahead instead of all at once. |

- The voice quota resets at midnight Pacific. Voice clips used after midnight (testing, the capture video) come out of Sunday's 100 per model. How many are left is not known.
- The current credit balance is not known. `[need: balance from AI Studio]`
- Measured cost: one check or one Help is 3 Gemini calls, about 21,000 input tokens, 350 to 500 output, no thinking tokens. A lesson is about 16,700 in and 1,300 out, plus one voice clip per step (150 to 180 audio tokens each).
- `GET /api/debug/usage` shows live token counts per model since the instance started.
- The page now shows failures: a red banner that stays for out-of-credit, and a 7 second toast for a timeout ("That took too long. Zoom in on one problem and try again").

## How things were tested

Four levels, weakest first. Each feature is listed under the strongest level it has reached.

1. **Unit tests**: pytest and Vitest, no network, no model.
2. **Headless browser with fake replies or typed text**, or a local server driven by a script.
3. **Headless browser, real pen events, real server**: `web/e2e/run.mjs`, flows 1 to 17. Each line is written on the canvas with pen pointer events tracing a stroke font. No reply is faked. The stroke font is neater than real handwriting, and headless Chrome is not iPad Safari. `web/e2e/demo.mjs` runs the README's five demo problems the same way. `web/e2e/capture.mjs` films a walkthrough the same way.
4. **A real iPad with Preet's handwriting.**

## Level 4: real iPad, Preet's handwriting

| When | Setup | What Preet tried and saw |
| --- | --- | --- |
| About 4:50 PM Sat | iPad to the laptop's dev page, lite model | Handwriting was read. A red circle, a graph and a "correct" note appeared. Notes were tiny, a graph was clipped, printed PDF text was not read. |
| About 5:35 PM Sat | Same, 16 photos | Core flows worked. Bugs: tiny feedback when zoomed out, notes on top of each other, an answer written on a line with no `=`, Help on finished work silent, a circuit failed with "no ground node". |
| About 6:20 PM Sat | Live link, venue wifi | Link loaded. Hold-Help voice input worked. Lesson played in the old card with the browser voice. A wrong derivative got no circle. Worksheet hints were terse and drawn over the print. |
| About 11:05 PM Sat | Live site | A 3D surface drew. Help on a whole zoomed-out worksheet page timed out at 44 s. "Listen" said "This browser can't listen". |
| About midnight | Live site, sample worksheet | Help hints worked. `y = x^2 - 4` with "graph it" worked. Spoken "solve problem one" was transcribed correctly but returned "I could not check a full solution". A 3D graph asked for at 12:02 AM never appeared, though the server sent it. |

What happened to the bugs from the last two rounds:

| Bug | Fix | Re-tested on the iPad? |
| --- | --- | --- |
| Worksheet Help timed out at 44 s | Below 50% zoom with nothing selected, only the circled part is sent (`d59ce5e`, live) | No. Harness flow 16 passes in 2.6 s. |
| "This browser can't listen" | The microphone is opened first, inside the tap (`d59ce5e`, live) | No. |
| "I could not check a full solution" on integrals | Checker bug fixed (`6ea3d5c`) | No. Not live. |
| 3D graph missing at 12:02 AM | None. Not reproduced; it draws in the harness. | Open. |

Fixes for the three afternoon rounds are all in and pass in the harness. The log does not say what else Preet tried in the 11:05 PM and midnight rounds beyond the rows above.

## Level 3: real pen events against the real server

Full run, 11:34 to 11:44 PM Saturday, dev page to Cloud Run `00028-bej`. Cost: 31 checks, 8 voice clips, 2 glyph calls.

| Flow | Result | Measured |
| --- | --- | --- |
| 1 Wrong derivative circled, then corrected and cleared | Pass | check 4.8 s at 11:22 PM (`demo.mjs`); earlier: reply 8.8 s portrait, 6.7 s landscape, pause included |
| 2 Correct work gets no marks | Pass | check 3.6 s at 11:22 PM |
| 3 Algebra mistake | Pass | check 4.5 s at 11:22 PM (sign error); live smoke 6.0 s at 9:59 PM |
| 4 Finish my line (`g'(x) =` gets `12x`) | Pass | check 3.9 to 6.1 s (earlier runs; flaky then, 3 of 4) |
| 5 Full solve by writing `solve` | Pass | reply 10.6 s and 9.4 s (earlier runs) |
| 6 Graph | Pass | check 3.6 s at 11:22 PM |
| 7 3D surface, rotated with the pen | Pass | reply 5.7 s (earlier run) |
| 8 Help ladder, three different hints | Pass | hint 1 at 4.2 to 4.6 s; next hints about 18 s apart (earlier runs) |
| 9 Help on finished, correct work | Pass | 5.9 s (earlier run) |
| 10 Teach me, voice, Your turn, Solved | Every product check passed: lesson 9.1 s, server voice, subtitles, practice problem, `8x + 5` gets a green note and "✓ Solved". Two harness checks failed because they assumed all clips are requested at once. The checks were changed; flow 10 was not re-run. | At 9:59 PM: lesson 8.8 s, tap to panel 12.4 s, 8 clips, 2.7 to 8.1 s each |
| 11 Two problems far apart | Pass | |
| 12 Page zoomed out to 40% | Pass | |
| 13 Worksheet PDF: mark on handwriting, nothing on print | Pass | |
| 14 "Write in my handwriting" with harness strokes | Pass | |
| 15 Reload; restore in a fresh browser | Pass | |
| Live site smoke | Pass | |
| 16 Zoomed-out worksheet, circle a printed problem, Help | Pass (new at 11:48 PM). Only the circled problem was read; the hint was drawn under it. | 2.6 s |
| 17 Sample worksheet `mixed.pdf`: "Solve it" writes worked steps under printed problem 1; `z = x^2 + y^2` and "graph" draws a 3D surface on the sheet | Pass at 12:49 AM Sunday, and again at 1:20 AM with typeset steps. Run against a local server on the new code, not the live site. | solve 8.4 s |

Other level 3 results tonight:

- `demo.mjs` at 11:22 PM against Cloud Run `00025-seb`: 5 of 5. Wrong derivative (4.8 s), sign error `3x - 7 = 2` to `3x = -5` (4.5 s), wrong integral `∫ cos(x) dx = -sin(x) + C` (5.2 s), correct expansion with nothing drawn (3.6 s), graph (3.6 s).
- `capture.mjs` filmed the walkthrough video on the dev page with real Gemini replies (see "Videos").
- On the fixed code, local server, sample sheet image: "Solve problem one" gave `x^4 + x^2 + C` (7.0 s). "Walk me through problem 2 and solve it for me" gave `∫cos(x) dx = sin(x) + C` with a note (7.2 s). "Solve problem 3" on the algebra sheet gave `(x-2)(x-3) = 0`, `x = 2 or x = 3`. Handwritten `d/dx (x sin x)` gave two product-rule steps.

Not covered by any automated run: the microphone (Listen and hold-to-talk), real sound, the iOS audio unlock, pinch zoom, palm rejection, circuits, and Preet's own handwriting.

## Level 2: headless browser, typed text or fake replies

- Page load checks of the live site after each Hosting deploy (toolbar present, no `/api` calls on load, no console errors). Buttons seen at 11:19 PM: Import PDF, Show what AI read, Write in my handwriting, Listen, Teach me, Help.
- Circuit read, solved, wrong answer circled: on a generated sketch image, earlier on Saturday. Not from the canvas.
- `/api/speak` under load: 9 parallel requests, 9 returned, in waves of 3.
- The three fallback voice models: one call each returned audio.
- Character finding on 4 real pages of Preet's writing: 55 of 59 characters with `gemini-3.5-flash`.

## Level 1: unit tests only

- **Listen** (`web/src/handsfree.ts`): phrase matching and the open/close logic. Never run with a real microphone since the fix.
- **A solution moved beside the worksheet** when it would touch print or ink below its line. The sample sheets have room under each problem, so this has not been seen live.
- The out-of-credit banner and the timeout toast as drawn by the page (the server's `reason` field was seen live at 11:19 PM).
- The "Drag to spin it" label on a 3D surface.

## Not tested on an iPad

- "Solve it" button. Every-step solutions. Typeset steps with stacked fractions. Solve on printed integrals.
- Solution placement on a worksheet (lowered under the print, or moved beside the page).
- Graph titles shown as math. The "Drag to spin it" label.
- Listen since the fix: whether Safari opens the microphone, keeps it open, and whether hints are read aloud in the lesson voice.
- Help on a circled problem on a zoomed-out worksheet since the fix.
- The failure banners.
- Voice fallback as heard on the iPad, and clips fetched two steps ahead.
- "Write in my handwriting" with real Pencil strokes.
- Circuits since their fix.
- `[need: Preet to confirm]` whether the docked lesson panel, the Gemini voice, "Your turn" and "Solved" were tried on the iPad in the 11:05 PM or midnight rounds. The log does not say.

## Known bugs and limits

Open:

- **"Every mark is verified" is too strong.** A red mark on a line the checker called correct is dropped by code. When the checker returns `unknown`, the model may still mark the line if it is very sure. On a spoken request the model may write steps the checker could not confirm. Say "checked by a math engine where it can be".
- **Help with nothing selected on a full worksheet page goes to problem 1.** Circle the problem, or zoom in on it, first. "Solve it" has the same rule: selection, else the last thing written or circled, else problem 1.
- **Solutions and hints depend on Gemini reading the handwriting correctly.** A misread line is checked as misread. "Show what AI read" shows the reading.
- **In landscape the tutor's note can sit under the lesson panel.**
- **Lessons take 5 to 10 s to prepare** (8.8 and 9.1 s in the last two runs; about 12 s from tap to panel).
- **Cost per check is about 21,000 input tokens**, mostly the tutor prompt sent in two rounds. Not reduced tonight.
- **Voice quota:** 100 requests per day per voice model. The fallback covers it, with different voice models.
- **A 3D graph did not appear on the iPad at 12:02 AM.** Not reproduced.
- **Listen risks** (from the code and log): iPad Safari may refuse to reopen the recognizer without a tap, or end sessions quickly. After 6 dead sessions in a row Listen turns itself off and says so. Each spoken hint costs one voice clip.
- Nothing solves by itself. The student has to ask. This is by design.
- A circle is placed by estimating where the wrong term sits in the line. It can be off on uneven handwriting.
- Lines more than about 6 line heights apart are not sent together, so the step has nothing to be checked against.
- Hint history is in server memory. A restart or a second instance loses it.
- The first request after idle is slower.
- The tunnel page has no cloud save (`web/` has no `.env.local`).
- `/api/debug/recent` and `/api/debug/usage` are open to anyone. Firestore pages are readable by anyone with the page id. Lock these after the weekend.
- `web/e2e/README.md` and `RESULTS.md` do not mention flows 16 and 17 or the late runs. The header comment of `capture.mjs` says nothing is sped up; the code speeds the video up and labels it.

Fixed tonight, and how far each fix was confirmed:

| Fix | Confirmed by |
| --- | --- |
| "✓ Solved" after a correct practice answer | Harness against the live server, 9:59 PM and 11:34 PM |
| Worksheet Help sends only the circled part | Harness flow 16, 11:48 PM. Live. |
| Listen opens the microphone inside the tap | Unit tests only. Live. |
| Out-of-credit and timeout messages | Server reply seen live; page side unit tests |
| Voice fallback, clips two steps ahead | Seen in the 11:34 PM run. Live. |
| Token counts at `/api/debug/usage` | Returns JSON on the live site |
| Solve on printed integrals | Local server, 2 real checks, plus flow 17. Not live. |
| Every-step solve, "Solve it", math titles | Flow 17 and three local checks. Not live. |
| Typeset solution steps | Flow 17 at 1:20 AM. Not live. |
| Solution lowered to clear the print | Flow 17. Not live. |

## Videos

On Preet's laptop in `teaser/out/` (git-ignored):

| File | Length | What it is |
| --- | --- | --- |
| `tutor-teaser-18s.mp4` | 18 s | Teaser |
| `tutor-launch.mp4` | 50 s | Launch video |
| `demo-capture.mp4` | 110 s | Walkthrough of the real app recorded by `web/e2e/capture.mjs`: wrong derivative circled and fixed; a Help hint, then Solve it; a Teach me lesson, then "Your turn" and Solved; worksheet Solve it, a graph, a 3D surface. Real Gemini replies. Sped up about 2×, and labelled as such on screen. Stroke-font writing, not a hand. |
| `submission-draft.mp4` | 118 s | The 18 s teaser followed by the walkthrough, with a music bed. Copy at `~/Downloads/tutor-submission-draft.mp4`. |

The draft is under the 2-minute limit. It is not uploaded anywhere yet. `[need: video link]`

## Still not done

- Project name. `[need: name]` is still in every doc.
- Devpost submission.
- Production deploy of `main`.
- iPad re-test of everything built after midnight.
- Listen on a real microphone.
- Pitch rehearsal.
- The Zurich project's name and link in `docs/DEVPOST.md`.

### Name ideas (suggestions only, nothing is decided)

1. Margin
2. Red Pen
3. Show Your Work
4. Office Hours
5. Second Look

## Sunday morning checklist

Before leaving for the venue:

- [ ] iPad at 100%, charger and cable packed. Pencil paired and charged.
- [ ] Laptop charged, charger packed. It must stay on if the tunnel is the demo URL.
- [ ] `submission-draft.mp4` on the laptop and on the iPad.
- [ ] Phone hotspot tested with the iPad.

First, on the laptop:

- [ ] `gcloud auth login` and `firebase login` as Preet.
- [ ] Deploy `main` (plan above). Tell Parsh in `AGENT_LOG.md` before promoting, so nobody promotes over anybody.
- [ ] After the deploy: `node web/e2e/run.mjs live --no-speak` once (smoke on the live site, 2 checks). Then flow 17 against production: start the dev page with `cd web && API_TARGET=https://tutor-api-191803288552.us-central1.run.app npm run dev -- --port 5174` and run `node web/e2e/run.mjs 17` once (2 checks). Do not run the full harness; it cost 31 checks and 8 voice clips.
- [ ] If the deploy is not done by about 9:00 AM: check the tunnel is up (`ngrok http 5174`, dev page on port 5174, local server running) and write its address on a sticky note.

Then, on the iPad:

- [ ] Open the AI Studio billing page on the laptop and read the credit balance.
- [ ] Open `<demo URL>/api/debug/usage` and look at the voice model counts.
- [ ] Hard-reload the page. Open a fresh page id: `?page=sun-1`.
- [ ] Run the demo steps in `docs/DEMO.md` in order, in portrait. Note what fails.
- [ ] Tap Listen once and say "I'm stuck". This also triggers the microphone permission prompt before a judge is watching. Decide whether Listen is in or out.
- [ ] Set the volume during the lesson. Check the panel's mute button is off.
- [ ] iPad: Do Not Disturb on, auto-lock Never, other tabs closed.
- [ ] Say the 90-second pitch out loud twice with a timer.

Before 11:00 AM:

- [ ] Pick the name. Replace `[need: name]` in `docs/DEVPOST.md`, and the Zurich project's name and link.
- [ ] Upload the video. Paste the link into Devpost.
- [ ] Submit on Devpost. Deadline 11:30 AM.
- [ ] No deploys after the last successful rehearsal.

During judging, 11:30 AM to 1:00 PM:

- [ ] Keep the video open in a tab on the laptop.
- [ ] Between judges: new page id, pre-write step 1, check the battery.
- [ ] If a check returns nothing: read the status line under "Show what AI read", then open `/api/debug/recent` on the laptop.
- [ ] If a red banner says the tutor is out of credit: Parsh adds prepaid credit at https://ai.studio/projects. Play the video meanwhile.
