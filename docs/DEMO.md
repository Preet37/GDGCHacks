# Demo plan for [need: name]

Written from `AGENT_LOG.md` as of 7:10 PM Saturday. Rehearse every problem on the iPad tonight and edit this file where the real behaviour differs.

Link: https://tutor-1098c.web.app/?page=<fresh-id>

## Rules for every problem

- One step per line. Leave at most one blank line between steps.
- After the last stroke, lift the Pencil and wait. The page sends after a 2 second pause. A pulsing blue dot means a check is running.
- Keep the page zoom near 100%.
- Start each judge on a fresh page id (`?page=judge3`), or select all and delete.
- General recovery, in this order: (1) add a small stroke to the last line and pause again, (2) read the status line under "Show what AI read" for the last check's result or error, (3) reload the page, (4) switch to the hotspot, (5) play the video.

## (a) Demo set: 6 problems, strongest first

Problems 1 to 5 use flows the log shows passing on the deployed site with `gemini-3.5-flash`. Problem 6 passed through the full pipeline on a sketch image, and has not been logged as run from the canvas on the live site, so it goes last and is optional.

### 1. Wrong derivative, then fix it

- **Write:** line 1 `f(x) = 3x^2 + 2x`. Line 2 `f'(x) = 6x + 1`. Pause.
- **Should appear:** a red circle around `+ 1` and a red question beside the line, such as "What is the derivative of 2x?". Measured 3.7 s and 4.4 s after the request is sent.
- **Then:** erase `1`, write `2`, pause. The circle and note disappear.
- **Shows:** handwriting read by Gemini, the step checked by SymPy through `verify_step`, feedback as a question, no repeat on an unchanged line.
- **If nothing appears:** the two lines are probably too far apart, so the check saw one line. Rewrite line 2 directly under line 1 and pause.

### 2. Finish my line, then Teach me

- **Write:** line 1 `f(x) = x^2`. Line 2 `f'(x) =` and stop. Pause.
- **Should appear:** `2x` written straight after the equals sign.
- **Then:** tap **Teach me**. The button shows "Preparing a lesson…". A panel opens (right side in landscape, bottom in portrait) and plays: the curve with a tangent, the tangent sliding, a secant closing in, the power rule written out, ending on `f'(x) = 2x`. A Gemini voice reads each step with subtitles. Measured 7.0 s for this lesson on one run, and up to 17.5 s for a deeper one.
- **Shows:** `compute_step`, the explain loop with function calling, Gemini TTS, the animated lesson panel.
- **If nothing appears:** if `2x` does not come, make sure the line ends in a clear `=` with nothing after it, then pause again. If the lesson panel shows "Tap to play with sound", tap it. If there is no voice, check the iPad volume and the mute button in the panel; the lesson still plays with subtitles.

### 3. Hint ladder

- **Write:** `d/dx (x sin x)` on a clear part of the page. Do not write an answer.
- **Do:** tap **Help**. Read the hint. Tap Help again, and again.
- **Should appear:** hint 1 names the idea in words (which rule applies to a product). Hint 2 sets up the two parts. Hint 3 shows the worked step, `sin x + x cos x`. Measured 2.5 to 3.2 s per hint.
- **Note:** after the first tap a countdown pill appears above the Help button, and the next hint arrives by itself after about 18 s. This auto-continue has not been confirmed on the iPad against the real server. For the demo, tap Help again instead of waiting, or tap the pill to cancel.
- **Shows:** hints before answers, hint level kept per problem.
- **If nothing appears:** tap once on the line with the select tool so Help targets it, then tap Help. If two hints say the same thing, move on; it happens.

### 4. Graph this

- **Write:** line 1 `g(x) = x^2 - 4`. Line 2 the words `graph this`. Pause.
- **Should appear:** a plot of the parabola beside the line, with both roots and the lowest point in the window.
- **Shows:** Gemini returning a figure spec as structured data, drawn by the page.
- **If nothing appears:** write `graph this` closer to the function, on the next line, and pause. As a second route, hold Help and say "graph this".

### 5. A mistake, then a lesson about that mistake

- **Write:** line 1 `f(x) = x^3 - 3x`. Line 2 `f'(x) = 3x^2 - 3x`. Pause.
- **Should appear:** a red circle on the last term and a question such as "What is the derivative of 3x?".
- **Then:** tap **Teach me**. The lesson explains the derivative term by term, then says where the student's line went off (it kept the x on the second term), and ends on a practice question. Measured 17.5 s for 8 steps on one run, so say "this one takes a moment" and keep talking.
- **Optional:** hold Help and ask "why does the graph turn around at those points?". The page shows what it heard, then a blue note with a plain answer. Voice input was confirmed on the iPad on the live link. The direct-answer behaviour was tested on the lite model only, so try it tonight before using it.
- **Shows:** the lesson is written from the student's own work, not a canned topic.
- **If nothing appears:** if there is no circle, bring line 2 closer to line 1 and pause. If the lesson takes more than 30 s, close the panel and tap Teach me once more.

### 6. Circuit (optional, rehearse first)

- **Draw:** a loop with a 9 V battery (long plate marked `+`), then two resistor zigzags in series labelled `R1 = 1k` and `R2 = 2k`. Under it write `I = 9 mA`. Pause.
- **Should appear:** a red circle on `9 mA` and a question such as "What is the total resistance of R1 and R2 in series?". Change it to `I = 3 mA` and the mark clears.
- **Measured:** read 5.0 s plus teach 6.9 s on a sketch-style image, so about 12 s.
- **Shows:** function calling with a different tool (`solve_circuit`, nodal analysis in SymPy), same page and same rules.
- **Status:** the full pipeline passed on a generated sketch image with `gemini-3.5-flash`. On Preet's iPad an earlier build failed with "no ground node"; the solver now picks a ground itself. A hand-drawn circuit on the live site has not been logged as passing since. Run it three times tonight. If it fails once, drop it from the table demo.
- **If nothing appears:** write the answer closer to the drawing and pause. If still nothing, say "the circuit reader is the newest part" and go back to problem 1.

### Not in the set, and why

- **PDF worksheet.** Import works, but the iPad test found the hint aimed at the wrong printed problem and drawn over the print. Fixes are in, not re-tested on a real PDF. Show it only if tonight's rehearsal is clean.
- **Full worked solution ("solve").** The server returns checked steps. The page does not draw them yet.
- **Write in my handwriting, 3D surfaces.** Built, not tested on the iPad.

## (b) 90-second table pitch

| Time | Who | Say / do |
| --- | --- | --- |
| 0:00 to 0:12 | Speaker | "This is a notebook that tutors you while you write. Most AI homework tools hand you the answer. This one finds your mistake and makes you fix it." |
| 0:12 to 0:32 | Writer | Problem 1 is already half written (line 1 on the page). Write `f'(x) = 6x + 1`, lift the Pencil. Speaker: "Gemini reads the handwriting. Then it has to call a real math engine, SymPy, on that step before anything is drawn." The circle appears. "It circled the wrong term and asked a question. It did not give the answer." |
| 0:32 to 0:42 | Writer | Fix `1` to `2`. The circle clears. Speaker: "Fixed, so the mark goes away." |
| 0:42 to 1:02 | Writer | On problem 2 (prepared: `f(x) = x^2`, `f'(x) =` with `2x` already filled in), tap Teach me. Speaker, while it loads: "If you are still stuck, Help gives three hints, and Teach me builds a short lesson about your problem. Gemini writes the steps, the plot and the narration, and Gemini text to speech reads it." Let the voice play for five seconds. |
| 1:02 to 1:20 | Speaker | "How it uses Google: Gemini takes the page image and returns structured lines. A second Gemini call must use function calling: verify a step, compute a step, solve a circuit. The server runs on Cloud Run, the page is on Firebase Hosting, and pages save to Firestore." |
| 1:20 to 1:30 | Speaker | "The idea started from a Zurich hackathon project that finishes your calculation. Ours checks your work instead. Here is the Pencil, write a wrong step." Hand over the Pencil. |

Notes:

- Prepare problems 1 and 2 on the page before each judge arrives, so nothing waits on handwriting.
- If the lesson has not opened by 1:02, start the 1:02 line anyway and point at it when it arrives.
- If the judge writes their own problem and nothing happens, use the general recovery list at the top.

## (c) 2-minute video: shot list

Record the iPad screen with screen recording, plus one or two over-the-shoulder shots. Record the voice-over separately. Total 2:00.

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0:00 to 0:08 | Over the shoulder: hand with Pencil on a blank page. Title text: [need: name]. | "This is [need: name]. A notebook on the iPad that tutors you while you write." |
| 0:08 to 0:16 | Screen: writing `f(x) = 3x^2 + 2x`, then `f'(x) = 6x + 1`. | "Most AI homework tools give you the answer. We wanted one that finds your mistake and makes you fix it." |
| 0:16 to 0:28 | Blue dot pulses. Red circle lands on `+ 1`, question appears. Slow zoom on the circle. | "Pause, and Gemini reads the handwriting. Each step is checked by a real math engine. It circles the wrong term and asks a question." |
| 0:28 to 0:36 | Erase `1`, write `2`. Circle disappears. | "Fix it, and the mark goes away." |
| 0:36 to 0:50 | New problem: `d/dx (x sin x)`. Tap Help three times (cut the waits). The three hints appear in turn. | "If you are stuck before you start, Help gives three hints. First the idea, then the setup, and only then the worked step." |
| 0:50 to 0:58 | Write `f(x) = x^2`, `f'(x) =`. `2x` appears after the equals sign. | "Leave a line open and it finishes just that line. The result comes from the math engine." |
| 0:58 to 1:22 | Tap Teach me. Panel opens. Keep the lesson's own audio for about 12 seconds: tangent sliding, secant closing in, subtitles. | (First 4 s) "Teach me builds a lesson about your problem." Then let the Gemini voice play with no voice-over. |
| 1:22 to 1:30 | Write `g(x) = x^2 - 4`, `graph this`. Plot appears. | "Ask for a graph and it draws one next to your work." |
| 1:30 to 1:40 | Circuit: drawn loop, `I = 9 mA`, red circle on the value. Use only if it works in rehearsal; otherwise extend the lesson shot by 10 s. | "It reads a hand-drawn circuit too, solves it, and checks your answer." |
| 1:40 to 1:54 | Architecture diagram from DEVPOST.md, with labels lighting up in order: Gemini read, Gemini tools, Cloud Run, Firebase Hosting, Firestore. | "Gemini reads the page image into structured lines. A second Gemini call uses function calling to verify steps, compute steps and solve circuits. Gemini text to speech narrates. It runs on Cloud Run, Firebase Hosting and Firestore." |
| 1:54 to 2:00 | Over the shoulder: the wrong-derivative page with the circle. Text: the link and both names. | "Inspired by a Zurich hackathon project that finishes your math. Ours makes you finish it. Built by Preet and Parsh at DevFest 2026." |

Recording notes:

- Cut the waits in the edit, but do not fake a result. Every mark on screen must come from the live site.
- Turn on Do Not Disturb. Set the volume before the Teach me shot.
- If the Gemini voice is not audible in the screen recording, record the lesson shot with a second device.

## (d) Likely judge questions, honest answers

**What if the AI is wrong?**
Gemini does not get the last word on a mistake. It must call `verify_step`, which uses SymPy to test whether the line follows from the one above. Our code drops any red circle on a line the checker called correct. If the checker cannot parse a line it returns `unknown`, and the prompt tells Gemini to stay quiet unless it is very sure. The weak point is reading: if Gemini misreads the handwriting, the checker checks the wrong text. For that there is a "Show what AI read" toggle, and low-confidence lines get a "did you mean" question instead of a red mark. We have seen misreads, mostly on the lite model.

**How is this different from the Zurich project?**
That project finishes your calculation. We started from it and say so. Ours checks your work: it circles the wrong term, asks a question, gives three levels of hint, and can play a lesson. It only finishes a line when you leave it open or ask. We also added the SymPy check, worksheets and circuits.

**How is this different from pasting a photo into Gemini?**
Three things. There is no photo step: you keep writing and feedback lands on the page next to the line, at your handwriting's size. A chat gives you the full solution; here code blocks an answer unless you asked for it. And the chat's math is unchecked, while here each flagged step went through SymPy. The model is the same Gemini. The difference is the tools and the rules around it.

**Which Gemini features do you use?**
Image input for reading the page. Structured output with a JSON schema for the reading. Function calling with four tools in the tutor loop (`verify_step`, `compute_step`, `solve_circuit`, `submit_feedback`) and three in the lesson loop. Text to speech for narration. Voice questions use Safari's speech recognition, which is not Gemini.

**What does one check cost?**
We have not measured cost in dollars. One check is one image call plus one to three text calls on `gemini-3.5-flash`. A lesson adds one TTS call per step, 6 to 9 steps. The page only sends after a 2 second pause, skips if nothing changed, and sends a crop of the working area at 1280 px or less, which keeps the call count and image size down.

**How fast is it?**
Measured on the deployed site: about 3.7 to 4.4 s for a mistake check, 2.5 to 3.2 s for a hint, 7 to 17.5 s for a lesson, plus the 2 second pause before sending. The first call after idle was about 7 s. A circuit took about 12 s. Lessons are the slow part and we show a "Preparing a lesson" state.

**What happens to the student's work?**
The page image goes to our Cloud Run server and from there to the Gemini API. The server does not store images. It keeps a summary of the last 30 requests in memory (the text it read, no images) at a debug address that is open this weekend and should be removed. Notebook pages are saved in Firestore under a page id; anyone who has the id can open that page. There are no accounts. This is fine for a demo and not for a school. It would need sign-in, per-user rules and a review of the data terms.

**What does not work yet?**
Full worked solutions are computed on the server but not drawn on the page. "Write in my handwriting" is a prototype that is off. 3D surfaces, the auto-continuing hints and the worksheet flow have not been confirmed on the iPad. Circles are placed by estimating where the wrong term sits in the line, so they can be off on uneven handwriting. Hint history lives in server memory and is lost on a restart. Lessons can take 17 s.

**What subjects does it cover?**
Tested: derivatives, integrals, algebra steps and equation solving, and DC resistor circuits. The page and the guard have no subject-specific code, so a new subject is a new tool plus a prompt section. We have not tested beyond those.

**Why these Google services?**
Cloud Run runs the Python server because SymPy needs a real runtime. Firebase Hosting gives the iPad an https link and proxies `/api` to Cloud Run, so the key never reaches the browser. Firestore stores pages so a notebook opens on another device.

**Who wrote the code?**
Two AI coding agents, one on each laptop, coordinating through a shared log in the repo. We set the direction, tested on the iPad, and reported what was wrong. The log is in the repo.
