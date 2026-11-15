# What other learning products do, and what we could take from them

Researched Nov 14, 2026 (evening) for the DevFest tutor notebook. Read-only research: nothing in the repo was changed.

## The short version

- **mccoy.org is real and is an education product**, so Preet's name was right. It is a gamified "learn anything" app with a concept graph. It is not a handwriting or math tutor, so what it offers us is ideas about mastery tracking, not about the notebook.
- **Our notebook features are already matched by Apple.** Math Notes on the iPad finishes your line after `=` in your own handwriting, graphs equations and does 3D graphs. Goodnotes checks handwritten math like a spellchecker. What neither does is teach: no lesson, no voice, no practice, no memory of your mistakes. That is where to spend tonight.
- **The best products make the learner do something after the explanation.** Math Academy adds questions when you miss, Brilliant asks before it explains, Google's Learn About has "stop and think" and "test your knowledge" cards. Our lesson ends on a spoken check question that nothing checks. Closing that loop is the direct answer to "I'm not really learning anything."
- **Gemini features we don't use yet** (confirmed by searching `server/` and `web/src`): the Live API, grounding with Google Search, code execution, image generation, and reading a whole PDF in one call.

## 1. What "mccoy.org" is

**Established** (from the site itself, fetched today):

- McCoy (McCoy Universe Inc.), tagline "Knowledge without limits. Learn anything with McCoy." Source: https://mccoy.org
- A consumer app, on a waitlist, with "1M+ interconnected topics" across every subject, themed "worlds", collectible "player pieces", achievements, communities and certificates. Source: https://mccoy.org/app
- A **Concept Graph** that "dynamically maps knowledge in real time, identifying what you've mastered, what you're missing, and where to go next. It adjusts difficulty, fills gaps with prerequisites". Source: https://mccoy.org
- For organisations: **Terminal** turns a title, a PDF or a set of files into a full curriculum, checked by a multi-model "A.T.L.A.S. consensus engine", then adds diagrams, question variants and translations. **Surface** is the learner interface with four modes per lesson: Learn, Read, Test, Scenario. Sources: https://mccoy.org/terminal, https://mccoy.org/surface
- Started in healthcare and nursing education; the banner says it has passed $1M in funding. Source: https://mccoy.org/company

**Not established:**

- I couldn't try the app (waitlist only), so everything above is the company's own description. I found no independent review; two web searches for McCoy returned nothing about it.
- Whether this is the product Preet meant. It fits ("platforms like mccoy.org"), and it is an AI learning platform, so I treated it as the one. If he was thinking of a handwriting tutor, the closest real ones are Goodnotes and Apple Math Notes below.
- The Zurich hackathon project that inspired this one: three searches did not find it by name. The plan describes it as an app that "finishes your calculations for you" on an imported worksheet. Apple's Math Notes does the same thing, which is worth knowing for the pitch.

## 2. What the relevant products do

"Company" means the claim comes from the product's own site; "reviews" means third-party write-ups I could not check against the product.

| Product | What the learner does | What makes it work | Source |
| --- | --- | --- | --- |
| **McCoy** | Picks any topic, plays through short illustrated lessons in a themed world | Concept graph that fills prerequisite gaps; four modes per lesson (Learn, Read, Test, Scenario); collectibles and achievements | Company: https://mccoy.org, https://mccoy.org/surface |
| **Math Academy** | Takes an adaptive diagnostic, then works question-based lessons picked by an algorithm | Mastery gating on prerequisites; lessons get longer when you miss and shorter when you're accurate; a missed quiz question triggers an immediate remedial review; spaced review where practising an advanced topic counts as review of the simpler ones inside it | Company: https://mathacademy.com/how-our-ai-works |
| **Khanmigo** | Works Khan Academy exercises with a chat tutor beside them | "Unlike ChatGPT, Khanmigo never gives you the answer"; asks what you think the first step is; you can speak to it and it reads replies aloud | Company: https://www.khanmigo.ai/learners. First-step behaviour is from reviews |
| **Gemini Guided Learning** | Asks a question in the Gemini app with the mode on | Probing open questions instead of answers; step-by-step breakdown; images, diagrams, videos and interactive quizzes inside the reply | Google: https://blog.google/products-and-platforms/products/education/guided-learning/ |
| **Google Learn About** | Explores a topic through cards | Card types "common misconceptions", "stop and think", "test your knowledge" | Google help: https://support.google.com/websearch/answer/15662709 (2024 to 2025 material; not rechecked for 2026) |
| **NotebookLM** | Uploads sources, then studies from them | Flashcards and quizzes from your own documents, with an "explain" button on a wrong answer that cites the source; narrated video overviews; a Learning Guide chat mode that asks probing questions | Google: https://blog.google/technology/google-labs/notebooklm-student-features/. 2026 details are from third-party guides |
| **Apple Math Notes** | Writes math by hand in Notes or Calculator | Writes the answer after `=` in your own handwriting; drag a number to change it and everything that depends on it updates; one-tap graphs, 3D graphs in iPadOS 26 | https://www.macrumors.com/2025/06/12/ipados-26-math-notes-3d-graphing/, https://education-corp.apple.com/resource/250014203 (secondary coverage plus Apple's education page) |
| **Goodnotes AI Math Assistance** | Writes homework by hand | "Similarly to spellcheck, but for math"; deliberately small nudges first, then hints, then steps, to keep "desired difficulty"; runs on the device | Company: https://www.goodnotes.com/blog/how-its-made-ai-math-assistance |
| **Brilliant** | Short interactive lessons, 5 to 15 minutes | "Often asks a question before presenting a procedure"; things to drag and move before any notation; a wrong answer gets a chance to revise instead of a red mark; streaks and XP | Company: https://brilliant.org/resources/choosing-brilliant/how-brilliant-teaches-math/. Streaks and lesson length from reviews |
| **Synthesis Tutor** | Ages 5 to 11, touch and voice | On-screen objects to act on first, symbols afterwards; voice narration throughout | Company: https://synthesis.com/blog/the-science-of-synthesis-tutor-1-the-embodiment-of-mathematical-knowledge. I found no "explain it back" feature there |
| **Photomath** | Photographs a problem | Steps broken down with the "why" as well as the "how"; animated steps in the paid tier | App Store listing: https://apps.apple.com/us/app/id919087726 |
| **ChatGPT study mode** | Chats with the mode on | Socratic questions, material split into small parts, knowledge checks with feedback | Launch coverage, July 2025: https://campustechnology.com/articles/2025/07/30/new-chatgpt-study-mode-guides-students-through-questions.aspx |
| **Desmos** | Types an equation, adds sliders | Sliders on parameters so you see what each one does; a secant sliding into a tangent is a standard classroom demo | Teacher write-ups, for example https://edtechteacher.org/plot-functions-create-tables-animate-graphs-using-desmos-from-jennifer-carey |

Not researched for lack of time: Mathway, Symbolab, Wolfram Alpha, GeoGebra, Notability, Socratic, Quizlet, Duolingo Math, StudyFetch, Mindgrasp, Thea, Numerade. These are answer engines or flashcard tools and were the least likely to change the list below.

**What repeats across the good ones**

1. The learner produces something after every explanation, and it is checked.
2. A miss leads to more practice on that exact skill, straight away.
3. The product remembers what you got wrong and names it.
4. Help comes in small steps, smallest first. We already do this.
5. Pictures you can move come before the symbols. Our lessons have one moving mark per lesson.

## 3. Ideas for our product, ranked for tomorrow

Sizes: **S** under 1 hour for one agent, **M** 1 to 2 hours, **L** more. Feature freeze in the plan is 10:00 AM.

| # | Idea | Size | Builds on | Main risk |
| --- | --- | --- | --- | --- |
| 1 | "Your turn": a checked practice problem after every lesson and every fixed mistake | M | lesson check question, `solution.py`, `verify_step` | slow on the real model |
| 2 | Explain it back, out loud | S | hold-to-talk, `/api/speak` | iPad speech recognition is still untested |
| 3 | "What I noticed": named mistake patterns and a session recap | M | `memory.py`, Firestore | needs a few mistakes on the page to look good |
| 4 | Talk to the tutor live (Gemini Live API) | L | Help voice, lesson panel | Safari mic and audio streaming, untested |
| 5 | Read the whole worksheet once on import | M | `worksheet.ts` PDF import, `target.py` | import gets slower; do it in the background |
| 6 | "Where this shows up": one grounded real-world link per lesson | S | lesson panel | low; keep it a separate call |
| 7 | Lessons that stop and wait for you to write the next line | M | lesson player pause, `/api/check` | overlaps with idea 1; do one |
| 8 | Drag a number on a graph | M | `figures.py`, lesson draw code | no Gemini in it; Apple already has it |
| 9 | Second checker through Gemini code execution | S | `verify.py` | adds latency for a case judges rarely hit |

### 1. "Your turn" (M)

**What:** when a lesson ends, or when the student corrects a circled mistake, the tutor writes one new problem of the same kind on the page (same skill, different numbers). The student solves it by hand and the normal check runs. If they miss, the next one arrives with the first step already written in (a half-worked example); if they get it, the tutor says so and stops.

**Why a judge cares:** it is the visible difference between a tutor and an answer machine, and it is the Math Academy and Brilliant pattern in one move. It shows function calling doing real work: Gemini writes the problem, SymPy solves it first so the tutor never sets something it can't check.

**Builds on:** the lesson already ends with a spoken "Now try one yourself" question that nothing checks (Parsh's 6:39 PM run). `solution.py` already verifies a chain of steps.

**Risk:** the real model took 13 to 23 s for a verified solution at 6:48 PM. Generate the practice problem while the lesson is still playing so it is ready at the end.

### 2. Explain it back (S)

**What:** after the student fixes a circled mistake, a small prompt appears: "Tell me why the x disappeared." They hold the Help button and answer out loud. Gemini judges the explanation against the specific slip and replies in one spoken sentence: either "yes, because…" or the one thing they left out.

**Why a judge cares:** speech in, judged reasoning, speech out. It is a 15-second moment a judge can do themselves at the table, and nobody else's homework app asks the student to talk.

**Builds on:** hold-to-talk, the `question` field, `/api/speak`. Mostly a prompt change plus one new note type.

**Risk:** speech recognition on iPad Safari is listed as not verified in the 7:09 PM entry. Test that before building on it. A stronger version sends the recorded audio straight to Gemini instead of using the browser's recogniser, which removes that dependency and is a better Gemini story, at roughly M.

### 3. "What I noticed" (M)

**What:** each confirmed mistake gets a short label from Gemini ("kept the variable when differentiating a linear term", "sign lost when moving a term across"). A recap card, opened from a button, lists the patterns across the session with counts and offers one practice problem aimed at the most frequent one.

**Why a judge cares:** it is McCoy's concept graph and Math Academy's remedial review at a size we can build tonight, and it gives Firestore a purpose beyond saving pages. It also answers "would a student come back?"

**Builds on:** `memory.py` already records mistake marks per line; the plan's Firestore box already lists "past mistakes". Shares the problem generator with idea 1.

**Risk:** an empty recap looks weak. The demo set needs two planted mistakes of the same kind.

### 4. Talk to the tutor live (L)

**What:** a "Talk" button opens a spoken conversation. The student can interrupt, ask "wait, why?", and the tutor answers in voice while seeing the current page.

**Why a judge cares:** the Live API is the most visible Gemini capability we haven't touched, and interruption is something a judge feels immediately.

**What the docs say** (https://aistudio.google.com/docs/live-api): it takes audio (16 kHz PCM), images (JPEG, at most one a second) and text, speaks back in 24 kHz PCM audio, lets the user interrupt, supports function calling and Google Search, and the browser connects directly over WebSockets with short-lived tokens issued by our server. The page I read did not name the models that support it, so that needs checking before starting.

**Risk:** high. Microphone capture and streamed playback in iPad Safari are both untested here, and venue wifi is already a listed worry. Build it behind a toggle that is off by default, and only start it if ideas 1 and 2 are done by about midnight. The current hold-to-talk plus spoken answers already covers most of the demo value.

### 5. Read the whole worksheet once (M)

**What:** when a PDF is imported, send the whole file to Gemini once in the background. Get back each problem's exact text, its parts, the skills it needs and what it depends on. Show a small chip by each problem ("needs: chain rule") and give Help and Teach me the printed problem text instead of re-reading it from a cropped image each time.

**Why a judge cares:** long-context document understanding, used for something concrete. It also makes hints more accurate on printed problems.

**Builds on:** `importPdf` in `web/src/worksheet.ts`, `target.py`, `read.md`.

**Risk:** a slower import and one more thing that can fail. It must never block writing; if the read fails, everything works as it does now.

### 6. "Where this shows up" (S)

**What:** at the end of a lesson, one line with a real use of the idea and a link, produced with Google Search grounding.

**Why a judge cares:** adds grounding with citations to the list of Gemini features for very little work. The docs (https://aistudio.google.com/docs/google-search) say the tool is `google_search` and the reply carries URL citations tied to spans of text.

**Risk:** low. Make it a separate request from the tutor call so it can't slow or break teaching. It adds motivation more than understanding, which is why it sits below the first five.

### 7 to 9, briefly

- **Lessons that wait for you (M):** the lesson pauses at "what comes next?" and resumes when the student writes the line. This is Brilliant's "question before procedure". It competes with idea 1 for the same hours; idea 1 is safer because it doesn't touch the lesson player.
- **Drag a number on a graph (M):** Apple Math Notes and Desmos both have it. Pleasant, but it contains no Gemini and Apple ships it for free.
- **Code execution as a second checker (S):** Gemini's code tool includes SymPy, NumPy and matplotlib (https://aistudio.google.com/docs/code-execution). Useful where our own checker can't decide, but a judge is unlikely to hit that case.

### Don't bother by tomorrow

- **Streaks, XP, leaderboards, collectibles.** McCoy, Brilliant and Khanmigo all have them. They need days of use to mean anything and a judge sees them in none of a two-minute demo.
- **A real knowledge graph with spaced-repetition scheduling.** It is Math Academy's core and took them years. Idea 3 gives the visible part.
- **A placement test.** Nobody at a table wants to take one.
- **Generated illustrations.** The image docs promise "legible" text in diagrams, not correct math; a wrong label in a picture undoes the "a math engine checks everything" story. Our drawn figures are exact.
- **Podcast or video overviews in the NotebookLM style.** "Teach me" already is the narrated lesson, tied to the student's own mistake.
- **More subjects or a curriculum generator** in the McCoy Terminal style. Breadth doesn't show in 90 seconds; calculus plus circuits is enough.
- **More polish on writing in the student's handwriting.** Apple already does it. Keep the prototype as a toggle and don't lead with it.

## 4. How they pitch, and what to borrow

**One-liners in use**

- Khanmigo: "Unlike ChatGPT, Khanmigo never gives you the answer."
- Gemini Guided Learning: "From answers to understanding."
- Goodnotes: "Similarly to spellcheck, but for math."
- Synthesis: "The first superhuman math tutor."
- McCoy: "Knowledge without limits."

**What works in them:** each names an enemy or a familiar thing in under ten words. Khanmigo names ChatGPT; Goodnotes borrows spellcheck.

**For the 90-second table pitch**

- Open with a contrast the judge already knows: "Apple's notes app will finish your math for you. Ours finds where you went wrong and teaches you until you can do the next one yourself." That also answers the Zurich question before it is asked.
- Hand over the Pencil within the first 20 seconds. The plan already does this; keep it.
- End the live part on the student getting a new problem right (idea 1). Every product above shows the learner succeeding, not the AI being clever.
- Keep the plan's trust line: Gemini reads and decides how to teach, a math engine checks every step.
- Say the Gemini list out loud once, as a list: handwriting vision, function calling, structured output, text-to-speech, plus whichever of live voice, Search grounding or whole-PDF reading ships tonight.

**For the 2-minute video**

1. 0:00 to 0:15: the problem. A screenshot pasted into a chatbot that returns the answer.
2. 0:15 to 0:45: a wrong derivative gets circled, then one Help hint.
3. 0:45 to 1:15: "Teach me", with the voice audible and subtitles visible.
4. 1:15 to 1:40: the practice problem arrives, the student gets it right, then says why out loud.
5. 1:40 to 2:00: quick cuts of circuits, a 3D surface and the recap card, then the one-liner again.

Goodnotes' design note is worth quoting if a judge asks about teaching: help should be "unobtrusive, but enough to trigger self-reflection and self-correction". That is our red circle plus a question.

## What was and wasn't checked

- Product claims come from the pages linked above, fetched today. Most are the companies' own descriptions; I used none of the products hands-on.
- Gemini capability notes come from the current docs pages linked in section 3. I did not run any of these calls against our key.
- Build sizes are estimates from reading the agent log and file layout, not from reading the code in depth.
