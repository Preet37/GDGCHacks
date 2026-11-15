# Demo plan for [need: name]

Written from `AGENT_LOG.md` (to its last entry, 8:36 PM Saturday) and `web/e2e/RESULTS.md`. Timings are from RESULTS.md: pen strokes on the real canvas in headless Chrome, the deployed server, `gemini-3.5-flash`. "Reply" is measured from the last stroke and includes the page's 2 second pause.

Link: https://tutor-1098c.web.app/?page=<fresh-id>

## Before any of this works

Three things were open when the log ends. Check each one first.

1. **The Gemini spend cap.** At 8:35 PM every Gemini call on the live site failed with "exceeded its monthly spending cap". Marks, hints, lessons and voice are all down until Parsh raises the cap in AI Studio. `/api/health` still returns ok while this is happening, so test with a real check.
2. **"Solved" is not confirmed live.** The practice answer is checked, but the green note and the "Solved" label did not appear on the live site at 8:17 PM. The fix (`server/practice.py`, 8:36 PM) passes its unit tests and was not deployed when the log ends. After it is deployed, run `node web/e2e/run.mjs 10` and look for "Solved".
3. **No iPad run since about 6:20 PM.** Everything in problems 2 to 4 was built after Preet last used the iPad. The results below come from a headless browser. Rehearse every problem on the iPad and edit this file where the real behaviour differs.

## Rules for every problem

- One step per line. Leave at most one blank line between steps.
- After the last stroke, lift the Pencil and wait. The page sends after a 2 second pause. A pulsing blue dot means a check is running.
- Keep the page zoom near 100%.
- Hold the iPad in portrait for a lesson. Portrait is the only orientation where the lesson was run with the real voice. Landscape passed after the 8:32 PM fix, with the voice blocked.
- Start each judge on a fresh page id (`?page=judge3`), or select all and delete.
- Turn on "Show what AI read". The status line under it says what the last check read and why nothing was drawn, for example `no actions: the step checked correct` or `the writing was taken for printed text`.
- General recovery, in this order: (1) add a small stroke to the last line and pause again, (2) read the status line, (3) open `/api/debug/recent` on the laptop to see what the server read and which tools ran, (4) reload the page, (5) switch to the hotspot, (6) play the video.

## (a) Demo set: 6 problems

Ordered so the teaching loop comes first. Every problem passed in the end-to-end run. Problems 1 and 2 are one continuous story on one page.

### 1. A wrong derivative gets circled

- **Write:** line 1 `f(x) = 3x^2 + 2x`. Line 2 `f'(x) = 6x + 1`. Pause.
- **Should appear:** a red circle around `+ 1` and a red question beside the line: "What is the derivative of 2x?".
- **Measured:** reply 8.8 s in portrait, 6.7 s in landscape (request alone 6.8 s and 4.7 s). Passed in both orientations and again after the fixes.
- **Leave the mistake on the page** and go to problem 2. Come back afterwards: erase `1`, write `2`, pause. The circle and the question clear (11.8 s and 12.1 s measured from starting the fix to the marks being gone).
- **Shows:** handwriting read by Gemini, the step checked by SymPy through `verify_step`, feedback as a question and no answer.
- **If nothing appears:** the two lines are probably too far apart, so the check saw one line. Rewrite line 2 directly under line 1 and pause.

### 2. Teach me, then Your turn

- **Do:** with the red mark from problem 1 on the page, tap **Teach me**.
- **Should appear:** the button shows "Preparing a lesson…". A panel docks at the bottom (portrait) and plays about 7 steps: a plot with something moving, the derivative taken term by term, where the student's own line went off, subtitles, and the Gemini voice. The notebook keeps its zoom and the two lines stay visible.
- **Measured:** the lesson came back in 8.6 to 11.3 s, and the panel was up 9.9 to 12.7 s after the tap. 7 of 7 voice clips returned, 2.0 to 4.7 s each.
- **Then:** let the voice play for a few steps, use "Next step" to reach the last step, and tap **Your turn**. The page writes "Your turn: find the derivative.", a new problem such as `g(x) = 4x^2 + 5x`, and `g'(x) =` under the work, in violet. The panel folds to a pill.
- **Then:** write the answer straight after the tutor's `=`, for example `8x + 5`. Pause.
- **Should appear:** a green note and the label changing to "Solved". This is the part not yet seen on the live site (see "Before any of this works", item 2). What is confirmed live: the practice problem is written, it is sent with the next check, and the server's check of `8x + 5` returns `correct`.
- **Shows:** the explain loop with function calling, Gemini TTS, and a practice problem that `compute_step` solved before it was shown and `verify_step` checks afterwards.
- **If nothing appears:** if the panel shows "Tap to play with sound", tap it. If there is no voice, check the iPad volume and the panel's mute button; the lesson still plays with subtitles. If the lesson takes more than 30 s, close the panel and tap Teach me once more. If the answer gets no "Solved", read the status line: `no actions: the step checked correct` means the check ran. Say that the answer was checked and the confirmation is the newest piece, then go back and fix line 2 of problem 1.

### 3. Help that explains

- **Write:** `d/dx (x sin x)` on a clear part of the page. Do not write an answer.
- **Do:** tap **Help**.
- **Should appear:** hint 1 names the idea. A countdown pill appears above the Help button, and hints 2 and 3 arrive by themselves: the setup, then the worked step. All three were different in both runs, each with a reason or worked math. Tap the pill to cancel.
- **Measured:** hint 1 at 4.6 s and 4.2 s. Hint 2 after 18.3 s and 18.1 s. Hint 3 after 24.8 s and 17.9 s (the slow one sat on "Next hint…" for 7 s).
- **Shows:** hints before answers, the next hint fetched during the countdown.
- **If nothing appears:** tap once on the line with the select tool so Help targets it, then tap Help. If the next hint is slow, keep talking; it is the server working.

### 4. Full solve, only when asked

- **Write:** `3x^2 - 3 = 0`. Then the word `solve` to the right of it on the same row. Pause.
- **Should appear:** three lines under the equation, one at a time, at the handwriting's size: `3x² = 3`, `x² = 1`, `x = ±1`.
- **Measured:** reply 10.6 s and 9.4 s (request 8.5 s and 7.3 s). Passed in both runs.
- **Shows:** the answer exists but has to be asked for, and every step shown has passed the checker.
- **If nothing appears:** a blue note "I couldn't work this one out reliably…" means the equation was misread or the steps failed the check. Rewrite the equation more clearly and write `solve` again. With no note at all, write `solve` closer to the equation.

### 5. Graph

- **Write:** line 1 `g(x) = x^2 - 4`. Line 2 the words `graph it`. Pause.
- **Should appear:** a plot of the parabola beside the lines, with the lowest point in the window, not covering any ink.
- **Measured:** reply 5.3 s in portrait and 7.1 s in landscape.
- **Shows:** Gemini returning a figure spec as structured data, drawn by the page.
- **If nothing appears:** write `graph it` on the very next line, closer to the function, and pause.

### 6. An algebra mistake, for the judge to fix

- **Write:** line 1 `2x + 6 = 14`. Line 2 `2x = 20`. Pause.
- **Should appear:** a red circle on `20` and "What do you get when you subtract 6 from both sides?".
- **Measured:** reply 6.8 s (request 4.7 s).
- **Then:** hand over the Pencil. The judge writes `2x = 8` and `x = 4`. The mark clears. Tapping Help on the finished work gave a green note in the run: "Correct! You can plug x = 4 back into the start to double check: 2(4) + 6 = 14." (5.9 s).
- **Shows:** the same loop on a different kind of math, with no subject-specific code.
- **If nothing appears:** rewrite line 2 directly under line 1 and pause.

### Only if rehearsed

Each of these is flaky, or untested on a real iPad in its current form, or both. Use one only after it has worked three times in a row on the iPad.

- **Finish my line** (`g(x) = 6x^2`, then `g'(x) =`, and `12x` appears after the `=`). Passed 3 of 4 runs before the fix and 1 of 1 after it (request 3.9 to 6.1 s). The failure was handwriting taken for printed text. It is also the feature Apple's Math Notes already has, so it does not belong in the pitch.
- **Write in my handwriting.** A prototype. In the run, `12x` was drawn as 4 pen strokes at the handwriting's size, using strokes generated by the harness. Never tried with real Pencil writing.
- **3D surface** (`z = x^2 + y^2`, then `graph this`). Passed once (5.7 s), and dragging on it with the pen rotated it. Not tested on the iPad.
- **PDF worksheet.** Passed twice in the run: the mark landed on the handwriting, nothing on the print, and Help answered the problem in view (import 0.3 s, check 5.1 s, help 9.1 s). On the iPad earlier today the hint aimed at the wrong printed problem and was drawn over the print. Not re-tested on the iPad since the fixes.
- **Circuit** (9 V source, `R1 = 1k` and `R2 = 2k` in series, `I = 9 mA`). Not covered by the end-to-end run. It passed on a generated sketch image (read 5.0 s, teach 6.9 s). The one iPad attempt failed with "no ground node" on the lite model; the solver now picks a ground itself, and that has not been re-tested from the canvas.
- **Voice question** (hold Help and speak). Speech input worked on the iPad on the live link. The live transcript bar and the plain-language answers were built afterwards and have not been tried on the iPad.
- **A lesson in landscape.** Passes with the voice blocked. In landscape the tutor's question beside the line can run under the lesson panel.
- **Opening a saved page on a second device.** In a headless browser on the live site the page came back from Firestore, and the extra check it used to send is gone. Not tried between the iPad and a laptop.

## (e) Engineering demo (Part 2, branch `engineering` only)

Not on the live site. Run it from the laptop, on the same wifi as the iPad:

```bash
git checkout engineering
cd web && API_TARGET=https://tutor-api-eng-191803288552.us-central1.run.app npm run dev -- --host --port 5174
ipconfig getifaddr en0          # the laptop's address, e.g. 10.0.0.65
```

On the iPad open `http://<laptop address>:5174/?page=eng-1` (use a new `?page=` name per run for a clean page).
Plain http: everything works except speaking a question (that needs https). Write big and clear with the Pencil.

### E-1. A wrong circuit answer gets circled
1. Draw a loop: a battery on the left (a long and a short plate, `+` by the long one, `9V` beside it), a zigzag on top
   labelled `R1 = 1k`, a zigzag on the right labelled `R2 = 2k`, wires joining them.
2. Under it write `I = 9 mA`, then lift the Pencil.
3. **Should happen** (about 7 s): a red circle on `9 mA` and a question like "What is the total resistance in the loop?".
4. **If not:** tap "Show what AI read". If the circuit wasn't read as one line, redraw the zigzags bigger with clear
   gaps between labels and wires. If nothing came back, check the status line for an error.

### E-2. Fix it: the drawing comes alive
1. Rub out `9 mA` with the eraser and write `3 mA`.
2. **Should happen** (about 5 s): the red marks clear; small blue labels appear on your drawing: `9 V` on the top-left
   wire, `6 V` on the right wire, `3 mA` with an arrow by each part; a "What if…?" card appears beside the circuit.
3. **If not:** if the circle stays, the answer may have been read differently ("Show what AI read"). If no labels or
   card, the answer wasn't checked as correct; write it as `I = 3 mA`.

### E-3. What if R2 were 4 kΩ?
1. On the card, tap R2's value, type `4k`, tap return (or use + / −).
2. **Should happen** (under a second): the card says `I = 1.8 mA`; the labels on the drawing change to `7.2 V` and
   `1.8 mA`. No AI is used for this. "Reset" goes back to 2 kΩ.
3. **If not:** a gray line on the card says why (for example an impossible value). If nothing changes at all, the
   laptop can't reach the server: check the dev server is still running.

### E-4. A units mistake
1. On a fresh line write `F = 2 kg · 9.8 m/s = 19.6 N` (not too wide).
2. **Should happen** (about 5 s): `9.8 m/s` circled and "What are the units of acceleration?".
3. **If not:** "Show what AI read" should show `F = 2*kg * 9.8*m/s = 19.6*N`. If the units were dropped, write them
   bigger with a space before each unit.

### E-5. A force diagram with a force missing
1. Draw a ramp (a right triangle rising to the right), write `30` in the corner angle, draw a square resting on the
   slope, an arrow straight down labelled `mg`, an arrow straight out of the slope labelled `N`. Beside it write
   `at rest` and `m = 2 kg`. Pause: a question may appear ("what stops it from sliding?").
2. Tap **Help** (hint 1): a question about what keeps it from sliding, without naming the force.
3. Tap **Help** again (hint 2): a clean copy of your diagram appears beside it, with the missing force dashed and
   pointing up the slope.
4. Tap **Help** again (hint 3): the worked size, `f = mg sin 30° = 9.8 N` up the slope.
5. **If not:** the page may show the next hint on its own after a pause (that is Part 1's hint chain, not a bug). If
   the dashed arrow is missing, the diagram may not have been read as one drawing: draw the arrows from the block's
   centre with clear arrowheads.

### E-6. "What is the physics of a bridge?" (3D model)
1. Write `What is the physics of a bridge?` at the top of a fresh page. Pause (or tap **Help**).
2. A short blue answer appears, and below it a **3D card** of a suspension bridge: towers red (compression), cables
   and hangers blue (tension), the deck purple (bending), green arrows for the traffic and the ground pushing up.
3. **Drag** inside the card to turn it; **+ / −** to zoom.
4. **Tap a part** (a tower, a cable): it lights up, everything else fades, and the panel says what it does and why it
   carries that force. **‹ ›** steps through every part; **Show all** goes back.
5. Works for other structures too: "how does a truss bridge carry a load?", "what forces act on a crane?". Takes about
   8 to 10 s (the model is a big answer).

## (b) 90-second table pitch

Set up before the judge arrives, in portrait: problem 1 written and already circled on a fresh page. Problem 6 written on a second page id in another tab, without its second line.

| Time | Who | Say / do |
| --- | --- | --- |
| 0:00 to 0:12 | Speaker | "Apple's Notes app will finish a line of handwritten math for you and draw the graph. This notebook does a different job. It finds where you went wrong, teaches you that step, and then gives you a new problem to do yourself." |
| 0:12 to 0:24 | Writer taps **Teach me** at 0:12. Speaker points at the circle. | "I wrote a wrong derivative. Gemini read the handwriting, and a math engine, SymPy, checked the step. It circled the wrong term and asked a question. It did not give the answer." |
| 0:24 to 0:44 | The lesson panel opens. Let the voice play for about 8 seconds, then step to the end. | (After the voice) "Gemini wrote this lesson about my line, including where I went wrong, and Gemini text to speech reads it." |
| 0:44 to 1:04 | Writer taps **Your turn**, writes the answer after the `=`. | "Then it is my turn. It wrote a new problem of the same kind. The math engine solved it before showing it to me, and it checks what I write." Wait for "Solved". |
| 1:04 to 1:18 | Speaker | "How it uses Google: Gemini takes the page image and returns structured lines. A second Gemini call must use function calling: verify a step, compute a step, solve a circuit. Gemini TTS is the voice. The server runs on Cloud Run, the page is on Firebase Hosting, and pages save to Firestore." |
| 1:18 to 1:30 | Speaker hands over the Pencil. | "Your turn. Fix my first line, or write a wrong step of your own." The mark on problem 1 clears when the judge fixes it. |

Notes:

- The lesson needs 9.9 to 12.7 s to open, which is why Teach me is tapped at 0:12 and the speaker talks over the wait.
- If "Solved" has not been confirmed in rehearsal, change the 0:44 line to end with "and it checks what I write" and move on without waiting.
- If the lesson has not opened by 0:30, say the 1:04 line early and come back to the panel.
- Help, full solve and the graph are for follow-up questions. If the judge asks "can it just give me the answer", show problem 4.
- If the judge writes their own problem and nothing happens, use the general recovery list at the top.

## (c) 2-minute video: shot list

Record the iPad screen with screen recording, plus one or two over-the-shoulder shots. Record the voice-over separately. Total 2:00. The lesson and practice loop takes 0:28 to 1:26, about half the video.

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0:00 to 0:10 | Over the shoulder: hand with Pencil on a blank page. Title text: [need: name]. | "This is [need: name]. Notes apps can already finish your math for you. We built a notebook that teaches you instead." |
| 0:10 to 0:28 | Screen: writing `f(x) = 3x^2 + 2x`, then `f'(x) = 6x + 1`. Blue dot pulses. Red circle lands on `+ 1`, question appears. Slow zoom on the circle. | "Write your work by hand and pause. Gemini reads the handwriting and a math engine checks the step. It circles the wrong term and asks a question. It does not give the answer." |
| 0:28 to 0:36 | Tap Teach me. Cut the wait. The panel docks under the work. | "Still stuck. Teach me builds a lesson about this exact line." |
| 0:36 to 1:02 | The lesson plays: the plot moving, lines written, subtitles. Include the step that names the student's slip. | No voice-over. Keep the lesson's own Gemini voice. |
| 1:02 to 1:26 | Tap Your turn. The violet practice problem is written under the work. The student writes the answer after the `=`. Green note, label changes to "Solved". | "Then it hands the Pencil back. A new problem of the same kind, solved by the math engine before it is shown, and your answer is checked." |
| 1:26 to 1:36 | Back at the first problem: erase `1`, write `2`. The circle disappears. | "Now fix the original mistake, and the mark goes away." |
| 1:36 to 1:46 | Quick cuts: one Help hint on `d/dx (x sin x)`; `solve` written next to `3x^2 - 3 = 0` and three steps appearing. | "Help gives hints in three levels. The full solution is there too, but only when you ask for it." |
| 1:46 to 1:56 | Architecture diagram from DEVPOST.md, with labels lighting up in order: Gemini read, Gemini tools, Gemini TTS, Cloud Run, Firebase Hosting, Firestore. | "Gemini reads the page image into structured lines. Function calling runs the math checks. Gemini text to speech is the voice. It runs on Cloud Run, Firebase Hosting and Firestore." |
| 1:56 to 2:00 | The page with "Solved". Text: the link and both names. | "Built by Preet and Parsh at DevFest 2026." |

Recording notes:

- Cut the waits in the edit, but do not fake a result. Every mark on screen must come from the live site.
- If "Solved" does not appear on the live site by recording time, end the 1:02 to 1:26 shot on the written answer, drop the words "and your answer is checked" only if no check ran (the status line tells you), and use the problem 1 page for the last shot.
- Turn on Do Not Disturb. Set the volume before the Teach me shot.
- If the Gemini voice is not audible in the screen recording, record the lesson shot with a second device.
- Credit the Zurich project in the Devpost text. The video has no room for it.

## (d) Likely judge questions, honest answers

**Doesn't Apple's Math Notes already do this?**
It does part of it. Math Notes writes the answer after an equals sign in your handwriting and draws 2D and 3D graphs. We can do those too and we do not lead with them. What we add is the teaching: a mark on the wrong term with a question, a spoken lesson about your own line, and a practice problem that gets checked. From Apple's and Goodnotes' own descriptions, neither has a lesson, a voice or practice. We have not compared the products side by side.

**What if the AI is wrong?**
Gemini does not get the last word on a mistake. It must call `verify_step`, which uses SymPy to test whether the line follows from the one above. Code drops any red mark on a line the checker called correct, and if the checker says a line is wrong and the model says nothing, code writes the mark itself. Solution steps and practice problems are checked before they are shown. Two gaps remain. If the checker cannot parse a line it returns `unknown`, and the prompt lets Gemini mark it only when it is very sure, so that mark is the model's judgment. And if Gemini misreads the handwriting, the checker checks the wrong text. For that there is the "Show what AI read" toggle, and low-confidence lines get a "did you mean" question.

**How is this different from the Zurich project?**
That project finishes your calculation. We started from it and say so. Ours checks your work, teaches the step you got wrong and gives you practice. It only finishes a line or writes a solution when you ask.

**How is this different from pasting a photo into Gemini?**
There is no photo step: you keep writing and feedback lands on the page next to the line. A chat gives you the full solution; here code holds the answer back unless you asked for it. A chat's math is unchecked; here the steps go through SymPy. And a chat does not hand you a new problem and check your handwritten answer. The model is the same Gemini. The difference is the tools and the rules around it.

**Which Gemini features do you use?**
Image input for reading the page and for finding characters. Structured output with a JSON schema. Function calling with four tools in the tutor loop (`verify_step`, `compute_step`, `solve_circuit`, `submit_feedback`) and three in the lesson loop (`verify_step`, `compute_step`, `submit_lesson`). Text to speech for narration. Voice questions use Safari's speech recognition, which is not Gemini.

**What does one check cost?**
We have not measured cost in dollars. One check is one image call plus one to three text calls on `gemini-3.5-flash`. A lesson adds one TTS call per step, 6 to 9 steps. We did hit the project's monthly spend cap on Saturday evening during testing. The page only sends after a 2 second pause, skips if nothing changed, and sends a crop of the working area.

**How fast is it?**
Measured with pen strokes against the deployed server, from the last stroke and including the 2 second pause: 6.7 to 8.8 s for a mistake mark, 9.4 to 10.6 s for a full solution, 5.3 to 7.1 s for a graph. A first hint took 4.2 to 4.6 s after the tap. A lesson took 8.6 to 11.3 s to come back. Lessons are the slow part and the button shows "Preparing a lesson".

**What happens to the student's work?**
The page image goes to our Cloud Run server and from there to the Gemini API. The server does not store images. It keeps a summary of the last 30 requests in memory (the text it read, the tool calls, no images) at `/api/debug/recent`, which is open this weekend and should be removed. Notebook pages are saved in Firestore under a page id; anyone who has the id can open that page. There are no accounts. This is fine for a demo and not for a school.

**What does not work yet?**
The "Solved" confirmation after a correct practice answer was not showing on the live site at the last test; the fix is written. Nothing built since Saturday 6:20 PM has been used on a real iPad. "Write in my handwriting" is a prototype. Circuits and worksheets have had little or no real-Pencil testing since their last fixes. A red circle is placed by estimating where the wrong term sits in the line, so it can be off on uneven handwriting. Hint history lives in server memory and is lost on a restart.

**What subjects does it cover?**
Tested: derivatives, integrals, algebra steps and equation solving, and DC resistor circuits. The page and the guard have no subject-specific code, so a new subject is a new tool plus a prompt section. We have not tested beyond those.

**Why these Google services?**
Cloud Run runs the Python server because SymPy needs a real runtime. Firebase Hosting gives the iPad an https link and proxies `/api` to Cloud Run, so the key never reaches the browser. Firestore stores pages so a notebook opens on another device.

**Who wrote the code?**
Two AI coding agents, one on each laptop, coordinating through a shared log in the repo. We set the direction, tested on the iPad, and reported what was wrong. The log is in the repo.
