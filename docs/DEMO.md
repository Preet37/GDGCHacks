# Demo plan for [need: name]

State as of about 2:15 AM Sunday, Nov 15, 2026. Written from `AGENT_LOG.md` (to 1:56 AM) and the harness runs listed in `docs/STATUS.md`. Judging is 11:30 AM to 1:00 PM, in person, with a 90-second pitch.

Timings below were measured with pen strokes on the real canvas in headless Chrome against the real server. "Check" is the request alone. The page also waits 2 seconds after the last stroke before it sends. Nothing after midnight has been timed on the iPad.

## Pre-demo checklist

Do this once at the table, before the first judge.

**1. Pick the URL.** The demo order below needs code that was not on the live site at 2:15 AM.

| URL | Use it when | What is different |
| --- | --- | --- |
| A. https://tutor-1098c.web.app | `main` was deployed this morning and checked | Nothing. This is the one to use. |
| B. https://3663-128-114-255-202.ngrok-free.app (tunnel to Preet's laptop) | The deploy did not happen | Laptop must stay on and awake. The address changes if ngrok restarts. Pages do not save to the cloud. It uses the laptop's Gemini key, not the live one. |
| C. https://tutor-1098c.web.app as it was at 2:15 AM | No deploy and no tunnel | No "Solve it" button. Solve on a printed integral answers "I could not check a full solution". Do step 3 the old way (see step 3, "On URL C"). |

To tell A from C: the page has a **Solve it** button above Teach me only on the new code.

**2. Credit.** Parsh opens AI Studio billing for `tutor-1098c` and reads the prepaid balance. It ran out once at 11:08 PM Saturday. If a red banner on the page says the tutor is out of credit, he adds credit at https://ai.studio/projects.

**3. Voice quota.** Open `<URL>/api/debug/usage` on the laptop. Each voice model allows 100 clips a day; a lesson uses 7 to 9. The server moves to the next voice model by itself when one runs out. If no model has quota left, the lesson still plays with subtitles and the browser voice.

**4. Orientation: portrait.** Every lesson run with the real voice in the harness was in portrait, and the sample worksheets are portrait pages. In landscape the tutor's note beside a line can sit under the lesson panel.

**5. Volume.** Play one lesson. Set the iPad volume so the voice carries over the room. Check the panel's mute button is off.

**6. iPad.** Do Not Disturb on. Auto-lock Never. Other tabs closed. Hard-reload the page so the newest build loads.

**7. Two tabs, prepared before each judge:**

- Tab 1, `?page=<fresh id>`: step 1 written and already circled.
- Tab 2, `?page=<another fresh id>`: the sample worksheet imported. Open `<URL>/samples/mixed.pdf` in Safari, save it to Files, then tap **Import PDF** in the app. Zoom so problem 1 fills most of the width. Write nothing on it.

**8. Microphone.** Tap **Listen** once so Safari asks for microphone permission now. Turn it off again unless Listen is in the demo.

**9. Fallback.** `submission-draft.mp4` open in a tab on the laptop.

## Rules while writing

- One step per line. At most one blank line between steps.
- After the last stroke, lift the Pencil and wait. A pulsing blue dot means a check is running.
- Keep the zoom near 100% on a blank page.
- Turn on "Show what AI read". The status line under it says what was read and why nothing was drawn.
- Recovery, in this order: (1) add a small stroke to the last line and pause, (2) read the status line, (3) open `/api/debug/recent` on the laptop, (4) reload the page, (5) switch the iPad to the hotspot, (6) play the video.
- A toast "That took too long. Zoom in on one problem and try again" means a timeout. Zoom in and repeat.

## Demo order

Steps 1 and 2 are the core and have the most evidence. Steps 3 and 4 are newer: they passed in the harness after midnight and have not been tried on the iPad. Step 5 is optional.

| # | Step | Evidence | Wait |
| --- | --- | --- | --- |
| 1 | Wrong derivative gets circled | Passed in every run since 7:29 PM Saturday, live server | 4.8 s check, about 7 to 9 s from last stroke |
| 2 | Teach me, Your turn, Solved | Passed against the live server at 9:59 PM and 11:34 PM | about 12 s to the panel; a few seconds for Solved |
| 3 | Solve it on the sample worksheet | Passed at 12:49 AM and 1:20 AM, local server on new code | 8.4 s |
| 4 | Graph, then 3D surface | Graph passed in every run; 3D on the worksheet passed at 12:49 AM and 1:20 AM | 3.6 s check for the graph; 5.7 s reply for 3D |
| 5 | Listen (optional) | Unit tests only. Never worked with a real microphone. | not measured |

### 1. A wrong derivative gets circled

- **Write (before the judge arrives):** line 1 `f(x) = 3x^2 + 2x`. Line 2 `f'(x) = 6x + 1`. Pause.
- **Should happen:** a red circle around `+ 1` and a red question beside the line: "What is the derivative of 2x?".
- **How long:** check 4.8 s (11:22 PM Saturday). From the last stroke, 6.7 to 8.8 s in the earlier runs.
- **Say:** "Gemini read my handwriting, a math engine checked the step, and it circled the wrong term and asked a question instead of giving the answer."
- **If it fails:** the two lines are probably too far apart, so only one was sent. Rewrite line 2 directly under line 1 and pause.
- **Leave the mistake on the page.** It is fixed at the end: erase `1`, write `2`, pause, and the circle and question clear (about 12 s from starting the fix in the earlier runs).

### 2. Teach me, then Your turn, then Solved

- **Tap:** **Teach me**, with the red mark from step 1 on the page.
- **Should happen:** the button shows "Preparing a lesson…". A panel docks at the bottom and plays about 7 steps: a plot with something moving, the derivative taken term by term, where your own line went off, subtitles, and the Gemini voice.
- **How long:** the lesson came back in 8.8 s and 9.1 s in the last two runs. Tap to panel 12.4 s. Voice clips arrive two steps ahead of the one playing.
- **Then tap:** "Next step" to the last step, then **Your turn**. The page writes "Your turn: find the derivative.", a new problem such as `g(x) = 4x^2 + 5x`, and `g'(x) =`, in violet.
- **Then write:** the answer straight after the tutor's `=`, for example `8x + 5`. Pause.
- **Should happen:** a green note "Correct. You've got it." and the label changes to "✓ Solved". The pill reads "Solved · Another one".
- **Say:** "Gemini wrote this lesson about my line and reads it aloud; then it sets a new problem that the math engine solved first, and checks my handwritten answer."
- **If it fails:**
  - Panel shows "Tap to play with sound": tap it.
  - No voice: check the volume and the panel's mute button. The lesson still plays with subtitles. Keep going.
  - No panel after 30 s: tap Teach me once more. If it fails again, skip to step 3.
  - No "Solved": read the status line. `no actions: the step checked correct` means the check ran. Say the answer was checked, and move on.

### 3. Solve it on the sample worksheet

- **Do:** switch to tab 2 (the imported `mixed.pdf`, nothing written, nothing selected). Tap **Solve it**.
- **Should happen:** the button shows "Solving…". Worked steps for printed problem 1 are written under it, every step and not only the answer, typeset, clear of the print. In the harness there were 2 steps. `[need: write here what problem 1 is and the steps you saw in rehearsal]`
- **How long:** 8.4 s (12:49 AM Sunday).
- **Say:** "It can also just solve it when I ask: it reads the printed problem and writes out each step, and the steps are checked by the math engine before they are shown."
- **If it fails:**
  - It solved a different problem: with nothing selected it uses the last thing written or circled, else problem 1. Circle the problem you want with the Pencil and tap Solve it again.
  - A note "I could not check a full solution": you are on old code (URL C), or the print was misread. Use "On URL C" below.
  - Timeout toast: zoom in on problem 1 and tap again.
  - Steps land beside the page under "Solution to: …": that is the placement rule when there is no room. It has only been unit-tested. Say so if asked.
- **On URL C (old code, no Solve it button):** stay on tab 1. Write `3x^2 - 3 = 0` and the word `solve` to its right on the same row. Pause. Three lines appear under it: `3x² = 3`, `x² = 1`, `x = ±1`. Reply 9.4 to 10.6 s in the earlier runs; this flow passed against the live server at 11:34 PM Saturday.

### 4. Graph, then a 3D surface

- **Write:** on the worksheet, in the space under a problem: `y = x^2 - 4`, then the words `graph it` beside it. Pause.
- **Should happen:** a plot of the parabola next to the line, not covering ink or print. On new code the title reads `y = x² − 4`.
- **How long:** check 3.6 s (11:22 PM Saturday). 5.3 to 7.1 s from the last stroke in earlier runs.
- **Then write:** under another problem, `z = x^2 + y^2` and the word `graph`. Pause.
- **Should happen:** a 3D surface with a "Drag to spin it" label. Drag on it with a finger or the Pencil and it rotates.
- **How long:** reply 5.7 s in the earlier run.
- **Say:** "Gemini returns the graph as structured data and the page draws it; a function of x and y comes out as a surface I can spin."
- **If it fails:** write `graph it` closer to the function, on the same row, and pause. If the 3D surface does not appear, do not retry in front of the judge. It failed to appear once on the iPad at 12:02 AM Sunday and that was not reproduced. Go to the handover.

### Handover

- Go back to tab 1. Hand over the Pencil: "Fix my first line." The judge erases `1`, writes `2`. The circle and question clear.
- Or the judge writes a wrong step of their own. A good one: `2x + 6 = 14`, then `2x = 20`. Expect a circle on `20` and a question about subtracting 6.

### 5. Optional: Listen

Use this only if it worked three times in a row in this morning's rehearsal, on the same URL. It needs https, so it cannot work on a plain laptop address. It has never been run with a real microphone since its fix.

- **Tap:** the **Listen** chip. It changes to "Listening".
- **Say out loud:** "I'm stuck" or "help me here". For a lesson: "teach me".
- **Should happen:** your words show in the subtitle bar. The chip shows "Thinking…", then "Speaking…". A hint appears on the page and is read aloud in the lesson voice. The microphone is closed while the tutor speaks.
- **How long:** not measured. A first hint took 4.2 to 4.6 s by tap, and a voice clip 2.7 to 8.1 s.
- **Say:** "I don't have to tap anything; I say I'm stuck and it answers out loud."
- **If it fails:** "This browser can't listen. Hold Help to ask instead" or "Couldn't start the microphone. Tap Listen again": tap Listen once more, then drop it. Fallback: tap **Help** for the same hint, or hold **Help** and ask the question (hold-to-talk worked on the iPad at 6:20 PM Saturday). After 6 dead sessions Listen turns itself off and says so. A loud room may also stop it hearing the phrase.

### Follow-ups, if a judge asks for more

- **Help ladder.** Write `d/dx (x sin x)` with no answer and tap **Help**. Hint 1 names the idea (4.2 to 4.6 s). Hints 2 and 3 arrive by themselves about 18 s apart, behind a countdown pill. Tap the pill to stop.
- **Help on a worksheet problem.** Circle a printed problem and tap Help. The hint is about that problem (2.6 s in the harness). With nothing circled on a full page, Help goes to problem 1.
- **Finish my line.** `g(x) = 6x^2`, then `g'(x) =`. `12x` appears after the `=`. Apple's Math Notes already does this, so it is not in the pitch.
- **Not for the table:** circuits, "Write in my handwriting", and anything on the `engineering` branch (circuit x-ray and what-if card, unit checks, free-body diagrams). That branch is not merged and not on the live site. If Parsh shows it, it is from his own setup.

## 90-second pitch

Set up: portrait. Tab 1 with step 1 circled. Tab 2 with the worksheet. One person speaks, one writes.

| Time | Do | Say |
| --- | --- | --- |
| 0:00 to 0:12 | Point at the circle. Writer taps **Teach me** at 0:10. | "Apple's Notes will finish a line of handwritten math for you. This notebook does a different job. I wrote a wrong derivative. Gemini read it, a math engine checked it, and it circled the wrong term and asked me a question." |
| 0:12 to 0:24 | The button shows "Preparing a lesson…". | "I'm still stuck, so I tapped Teach me. Gemini is writing a short lesson about this exact line, including where I went wrong." |
| 0:24 to 0:38 | The panel opens. Let the voice play about 8 seconds. Then step to the end. | (Let the voice speak.) "That voice is Gemini text to speech." |
| 0:38 to 0:56 | Tap **Your turn**. Write `8x + 5` after the `=`. Wait for "✓ Solved". | "Then it is my turn. A new problem of the same kind. The math engine solved it before showing it to me, and it checks what I write." |
| 0:56 to 1:14 | Switch to tab 2. Tap **Solve it**. | "It works on any PDF worksheet. If I just want the solution, I ask. While it works: Gemini takes the page image and returns structured lines. A second Gemini call uses function calling to run the math checks. It runs on Cloud Run, Firebase Hosting and Firestore." |
| 1:14 to 1:22 | The steps appear under problem 1. | "Every step written out, and checked before it is shown." |
| 1:22 to 1:30 | Back to tab 1. Hand over the Pencil. | "Your turn. Fix my first line, or write a wrong step of your own." |

Notes:

- The lesson needs about 12 s to open. That is why Teach me is tapped at 0:10 and the speaker talks over the wait.
- If the lesson has not opened by 0:30, go to the 0:56 row and come back.
- If you are on URL C, replace the 0:56 to 1:22 rows with the written `solve` from step 3, on tab 1.
- The graph and the 3D surface are not in the 90 seconds. Show them when the judge stays.
- Do not say "every mark is verified". Say "checked by a math engine where it can be". See the second question below.
- This pitch has not been rehearsed. Time it twice before 11:30 AM.

## The 2-minute video

Already made, on Preet's laptop in `teaser/out/`:

| File | Length | Content |
| --- | --- | --- |
| `submission-draft.mp4` | 118 s | The 18 s teaser, then the walkthrough, with a music bed. Copy at `~/Downloads/tutor-submission-draft.mp4`. |
| `demo-capture.mp4` | 110 s | The walkthrough alone, recorded by `web/e2e/capture.mjs` from the real app: wrong derivative circled and fixed; a Help hint, then Solve it; a Teach me lesson, then "Your turn" and Solved; worksheet Solve it, a graph, a 3D surface. |
| `tutor-launch.mp4` | 50 s | Launch video |
| `tutor-teaser-18s.mp4` | 18 s | Teaser |

Things to know before submitting it:

- The replies in the walkthrough are real Gemini replies. It is sped up about 2× and says so on screen.
- The writing is the harness's stroke font, not a hand on an iPad. If there is time in the morning, one over-the-shoulder shot of the real iPad would help. It is not required.
- It must be 2 minutes or less. The draft is 118 s. Do not add to it without cutting.
- `[need: name]` in the video, if a title card shows one. `[need: video link]` for Devpost.

## Likely judge questions, honest answers

**Doesn't Apple's Math Notes already do this?**
It does part of it. Math Notes writes the answer after an equals sign in your handwriting and draws graphs. We can do those and do not lead with them. What we add is the teaching: a mark on the wrong term with a question, a spoken lesson about your own line, and a practice problem that gets checked. We have not compared the products side by side.

**What if the AI is wrong?**
Gemini does not get the last word on a mistake. It must call `verify_step`, which uses SymPy to test whether a line follows from the one above. Code drops any red mark on a line the checker called correct. Solution steps and practice problems go through the checker before they are shown. There are gaps, and we say so. If the checker cannot parse a line it returns `unknown`, and the model may still mark it when it is very sure. On a spoken request it may write steps the checker could not confirm. And if Gemini misreads the handwriting, the checker checks the wrong text; "Show what AI read" shows the reading. So: checked by a math engine where it can be.

**How is this different from the Zurich project?**
That project finishes your calculation. We started from it and say so. Ours checks your work, teaches the step you got wrong and gives you practice. It writes a solution only when you ask.

**How is this different from pasting a photo into Gemini?**
There is no photo step: you keep writing and feedback lands next to the line. A chat gives you the full solution; here you have to ask for it. A chat's math is unchecked; here the steps go through SymPy where it can parse them. And a chat does not hand you a new problem and check your handwritten answer. The model is the same Gemini. The difference is the tools and the rules around it.

**Which Gemini features do you use?**
Image input for reading the page. Structured output with a JSON schema. Function calling with `verify_step`, `compute_step`, `solve_circuit` and `submit_feedback` in the tutor loop, and `submit_lesson` in the lesson loop. Text to speech for lessons and spoken hints, with a fallback across four voice models. Speech recognition for Listen and hold-to-talk is Safari's, not Gemini.

**What does one check cost?**
We measured tokens, not dollars. One check or one Help is 3 Gemini calls: about 21,000 input tokens, 350 to 500 output, no thinking tokens. A lesson is about 16,700 in and 1,300 out, plus one voice clip per step. Most of the input is the tutor prompt sent in two rounds; we did not cut that. We hit the spend cap at 8:35 PM Saturday and ran out of prepaid credit at 11:08 PM. The server now counts tokens per call at `/api/debug/usage`.

**How fast is it?**
A mistake mark: about 5 s for the check, plus the 2 second pause. A hint: about 4 to 5 s. A worked solution: about 8 s. A graph: about 4 s. A lesson: about 9 s to prepare, about 12 s from tap to panel. Lessons are the slow part.

**What happens to the student's work?**
The page image goes to our Cloud Run server and from there to the Gemini API. The server does not store images. It keeps a text summary of the last 30 requests in memory at `/api/debug/recent`, which is open this weekend and should be locked. Pages are saved in Firestore under a page id; anyone with the id can open that page. There are no accounts. Fine for a demo, not for a school.

**What does not work yet?**
The newest features (the Solve it button, typeset solutions, Listen) have been tested with a scripted pen in a browser, not with a hand on the iPad `[update after rehearsal]`. Listen has not been run with a real microphone. Help with nothing selected on a full worksheet page goes to problem 1. In landscape the tutor's note can sit under the lesson panel. Lessons take 5 to 10 s to prepare. A circle can sit off on uneven handwriting. Hint history is lost on a server restart.

**What subjects does it cover?**
Tested: derivatives, integrals, algebra steps, equation solving, and DC resistor circuits (circuits less than the rest). The page has no subject-specific code. A new subject is a new tool plus a prompt section.

**Why these Google services?**
Cloud Run runs the Python server because SymPy needs a real runtime. Firebase Hosting gives the iPad an https link and proxies `/api` to Cloud Run, so the key never reaches the browser. Firestore stores pages so a notebook opens on another device.

**Who wrote the code?**
Two AI coding agents, one on each laptop, coordinating through a shared log in the repo. We set the direction, tested on the iPad, and reported what was wrong. The log is in the repo.
