# Agent brief: Parsh's side (the page, then the rest)

You are helping Parsh build an AI tutor notebook at a 24-hour hackathon (Google DevFest, UCSC). Track: Best Integration of Gemini/Google API. Teammate Preet has his own agent building the server (Gemini pipeline) in parallel until 4:00 PM. After 4 PM, Preet is gone until tonight and you own the whole repo.

## What the product does

A student writes math by hand on an iPad. After they pause, the page sends a picture of itself to our server. The server reads the handwriting with Gemini, checks each step with real math, decides how to teach, and returns a list of simple drawing actions. **Your page draws them**: a red circle around a mistake, a handwritten-style hint in the margin, a "did you mean...?" bubble, a graph.

The tutor never gives the answer first. It finds mistakes and gives hints in 3 levels: nudge, bigger push, then the worked step.

## Event schedule (affects your tasks)

- Today: hacking ends 6:30 PM and the venue closes at 7:00 PM. Work after that is off-site.
- Sunday: check-in 9:00 AM, Devpost submit by 11:30 AM (video of 2 minutes or less), judging in person at the table 11:30 AM to 1:00 PM.
- The track rubric says the Gemini feature must work live in the demo. A reliable live demo beats any new feature.
- The demo video is recorded tonight, not Sunday morning.

## Rules

- **No hard-coding by topic.** The page draws 6 generic actions and knows nothing about math. No special cases for derivatives, graphs of specific functions, etc.
- **Before 4 PM, stay in your folders:** `web/` and `firebase.json`. Don't edit `server/` or `contract/`. Those are Preet's until 4.
- **After 4 PM** you may edit everything. `server/verify.py` and the Firestore work are yours.
- **The contract is shared.** Any change must update `contract/contract.ts`, `server/models.py` and `contract/examples/*.json` together. Before 4 PM, propose changes in the team log instead of making them.
- Don't add features beyond this brief. Small commits, push often.

## Team log (talk to Preet's agent here)

`AGENT_LOG.md` at the repo root is where the two agents talk: post updates, ask for help, and debate the best way to do things. Both agents read it and write to it.

**Every time you finish a task:**

1. Run the tests (`npm test` in `web/` with Vitest, `pytest` in `server/` once you work there). Every task adds at least one test.
2. `git pull --rebase` first, so you have the other agent's latest entries.
3. Append an entry to the bottom of `AGENT_LOG.md` (template below). Never edit or delete old entries, only add new ones. That avoids merge fights.
4. Commit the code and the log entry together, then push.

**Before starting any task:** pull, then read every entry since your last one. If the other agent asked you something or proposed a change to your area, answer in a new entry before you continue.

**Entry template:**

```
## [time] PARSH-AGENT · [DONE | WORKING ON | QUESTION | PROPOSAL | REPLY | BLOCKED]
**Task:** what this is about
**What I built:** files changed and what they do, in 2 to 4 lines
**Tests:** which tests, pass/fail
**How to use it:** anything the other side needs to know (components, commands, URLs)
**Next:** what I'm doing now
**Need from you:** questions, requests, or "nothing"
```

**Debating a change:**

- To change the contract or anything in the other agent's area, post a `PROPOSAL` with the problem, 2 options and which one you'd pick and why. Wait for a `REPLY` before changing shared files. (After 4 PM nobody else is there to reply, so make the call, log it as `DONE` with your reasoning, and Preet's agent will review it tonight.)
- If you disagree with a proposal, reply with your reasoning and a counter-option. Pick the one that's simpler to demo by tomorrow at 10 AM.
- If you can't agree after 2 rounds, post `BLOCKED` and ask Parsh to decide.
- If you're stuck on a bug for more than 20 minutes, post `BLOCKED` with what you tried.

## Repo layout

```
/web/                          yours: Vite + React + TypeScript app with tldraw
/firebase.json                 yours: hosting + /api rewrite to Cloud Run
/contract/contract.ts          shared types (Preet's agent writes first; import from here)
/contract/examples/*.json      fake server replies to build against
/server/                       Preet's until 4 PM (Python, FastAPI, Gemini)
/server/verify.py              yours after 4 PM
/AGENT_LOG.md                  shared log both agents append to
/README.md                     handoff notes (you write the web part)
```

If `contract/` isn't pushed yet when you start, create `web/src/contract.ts` from the section below and switch to importing `contract/contract.ts` once it lands.

## The shared contract (copy exactly)

Boxes use Gemini's own convention: `[ymin, xmin, ymax, xmax]`, each 0 to 1000, measured over the image that was sent.

```ts
// contract/contract.ts
export type Box = [number, number, number, number]; // [ymin, xmin, ymax, xmax], 0-1000 over the sent image

export interface ReadLine {
  line_id: string;      // stable id like "L1"; reuse ids from state.lines when the same line is seen again
  problem_id: string;   // like "P1"; lines of one worked problem share it
  latex: string;        // what was read, as LaTeX, for display
  plain: string;        // same line in calculator syntax for checking, e.g. "f(x) = 3*x^2 + 2*x"
  box: Box;
  relation: "start" | "equals" | "simplify" | "derivative" | "integral" | "solve" | "other";
                        // how this line follows from the previous line of the same problem
  confidence: "high" | "low";
}

export type ActionType = "circle" | "underline" | "note" | "figure" | "ask" | "speak";

export interface FigureSpec {
  kind: "plot2d" | "surface3d";
  expressions: string[];      // math.js syntax: "x^2 - 4", "sin(x)". surface3d: one expression in x and y
  x_range: [number, number];
  y_range?: [number, number];
  title?: string;
}

export interface Action {
  type: ActionType;
  box?: Box;                  // circle/underline: what to mark. note/figure/ask: what to sit next to
  line_id?: string;           // the line this is about, if any
  color?: "red" | "green" | "blue";
  text?: string;              // note/ask/speak. Plain words, inline math in $...$
  side?: "right" | "below";
  options?: string[];         // ask: choices, e.g. ["x^2", "x_2"]
  figure?: FigureSpec;        // figure only
}

export interface ProblemState {
  problem_id: string;
  hint_level: 0 | 1 | 2 | 3;  // 0 = no hints given yet, 3 = worked step shown
}

export interface PageState {
  page_id: string;
  lines: ReadLine[];          // last reading
  problems: ProblemState[];
  flagged_line_ids: string[]; // lines that currently have feedback on the page
}

export interface CheckRequest {
  image_base64: string;       // PNG, longest side <= 1280 px
  mode: "auto" | "help";      // auto = sent after a pause; help = user tapped Help
  help_box?: Box;             // help mode: area the user selected (missing = whole page)
  question?: string;          // help mode: what the student asked out loud, transcribed (missing = no question)
  state: PageState;
}

export interface CheckResponse {
  lines: ReadLine[];
  actions: Action[];          // NEW or UPDATED feedback only. Actions with a line_id replace that line's old feedback
  clear_line_ids: string[];   // lines whose old feedback should be removed (fixed or erased)
  state: PageState;           // updated state for the page to save
  debug?: { model: string; read_ms: number; teach_ms: number; tool_calls: string[] };
}
```

**Endpoints**

- `POST /api/check`: body `CheckRequest`, returns `CheckResponse`.
- `GET /api/health`: returns `{"ok": true}`.

**Example reply** (put this in `contract/examples/wrong_derivative.json`, and also make `hint_level_1.json` and `graph.json`):

```json
{
  "lines": [
    { "line_id": "L1", "problem_id": "P1", "latex": "f(x) = 3x^2 + 2x", "plain": "f(x) = 3*x^2 + 2*x",
      "box": [120, 80, 180, 420], "relation": "start", "confidence": "high" },
    { "line_id": "L2", "problem_id": "P1", "latex": "f'(x) = 6x + 1", "plain": "f'(x) = 6*x + 1",
      "box": [200, 80, 260, 400], "relation": "derivative", "confidence": "high" }
  ],
  "actions": [
    { "type": "circle", "box": [200, 300, 260, 400], "line_id": "L2", "color": "red" },
    { "type": "note", "box": [200, 300, 260, 400], "line_id": "L2", "color": "red", "side": "right",
      "text": "Check the derivative of $2x$. What happens to the $x$?" }
  ],
  "clear_line_ids": [],
  "state": {
    "page_id": "demo",
    "lines": [],
    "problems": [{ "problem_id": "P1", "hint_level": 0 }],
    "flagged_line_ids": ["L2"]
  }
}
```

(`state.lines` in a real reply holds the same lines as the top-level `lines`.)


## How the page works

**Canvas**

- tldraw, full screen, in Safari on the iPad. Apple Pencil draws; fingers pan and zoom.
- Everything the AI draws is a normal tldraw shape tagged with `meta: { ai: true, line_id }`, so it can be found, replaced and left out of the image we send.

**When to send**

- After 2 seconds with no new pen strokes (debounce on store changes to the student's draw shapes).
- Skip if the student's shapes haven't changed since the last send (compare a hash of the shape records).
- Never send while a request is already in flight; if strokes came in during it, send once more after it returns.

**What to send**

- Export only the student's shapes (not `meta.ai` shapes) as a PNG, with a bit of padding. Check the installed tldraw version's export API (`editor.toImage` in recent versions).
- Shrink so the longest side is at most 1280 px. Send it base64 in a `CheckRequest`.
- **Remember the page-space bounds of the exported area.** Boxes come back as 0 to 1000 over that image, so convert: `x = bounds.x + xmin / 1000 * bounds.w`, `y = bounds.y + ymin / 1000 * bounds.h` (same for xmax, ymax).

**How to draw each action** (one function per type, in `web/src/render/`)

| Action | Draw it as |
| --- | --- |
| `circle` | tldraw ellipse around the box, a little padding, its `color`, no fill |
| `underline` | short line under the box |
| `note` | text shape in tldraw's handwriting font (`draw`), next to the box on `side`, in its `color`. Show `$...$` math as plain text for now |
| `figure` | render the `FigureSpec` (plot2d: function-plot; surface3d: Three.js, only tonight) to an image and place it next to the box |
| `ask` | note-style text with the options listed, in blue |
| `speak` | `window.speechSynthesis` reads `text` aloud; nothing drawn |

**Applying a response**

- For each action with a `line_id`: remove existing `meta.ai` shapes with that `line_id`, then draw the new ones.
- For each id in `clear_line_ids`: remove its `meta.ai` shapes.
- Save `state` and send it with the next request.

**Help button**

- Big floating button. If the student has something selected (lasso), send `mode: "help"` with that selection as `help_box`. Otherwise send the whole page.
- **Voice is part of Help, not a separate feature.** Hold the Help button (or a mic button) and speak; transcribe with the browser's `webkitSpeechRecognition` and send the text as `question` in the same `mode: "help"` request. Circle + speak = Help. If speech recognition isn't available, Help still works without `question`.
- When the reply has a `speak` action, read it out loud with `speechSynthesis`.

**Small touches that matter for the demo**

- A small pulsing dot while a request is in flight.
- A toggle "show what AI read" that writes each `ReadLine.latex` in small gray text under its line.
- Errors from the server show a quiet toast, never a crash.

## Tasks, in order

### Before 4 PM

1. **App + iPad.** Vite + React + TS with tldraw. Run with `--host` so the iPad opens `http://<laptop-ip>:5173` on the same wifi. Proxy `/api` to `http://localhost:8000` in `vite.config.ts`.
   *Done when:* Parsh can write smoothly with the Pencil in Safari.
2. **Renderer against fake data.** Load `contract/examples/*.json` and draw every action type except `figure` and `speak`.
   *Done when:* a test page with handwriting plus the fake reply shows a red circle and note in the right spots. Unit tests for the box-to-page conversion.
3. **Send on pause.** Debounce, skip-if-unchanged, export, shrink, `POST /api/check`, apply the response. Until Preet's server is up, a mock that returns the example file.
   *Done when:* writing, then pausing, triggers exactly one request, and the reply gets drawn.
4. **Firebase Hosting.** `firebase.json` with `public: "web/dist"` and a rewrite `{"source": "/api/**", "run": {"serviceId": "tutor-api", "region": "us-central1"}}` plus the SPA fallback. Deploy once Preet's Cloud Run service exists.
   *Done when:* the iPad opens the Firebase link and the real server answers.
5. **3:30 to 4:00, with Preet:** end-to-end test on the iPad. Write the web part of `README.md`.

### After 4 PM (you own the repo)

6. **Math checker in `server/verify.py`.** Keep the signature `verify_step(before, after, relation) -> {"verdict", "detail"}`. Use SymPy on the `plain` strings: split on `=`, take the right side, then
   - `equals` / `simplify`: before minus after simplifies to 0
   - `derivative`: derivative of before minus after is 0
   - `integral`: derivative of after minus before is 0 (constant allowed)
   - `solve`: plug the solutions into the earlier equation
   - anything else, or a parse error: `unknown`
   Add a numeric spot check (plug in a few random values) as backup. Pytest for each relation, right and wrong. Redeploy Cloud Run.
   *Done when:* `f(x) = 3*x^2 + 2*x` then `6*x + 1` (derivative) returns `incorrect`, and `6*x + 2` returns `correct`.
7. **Hint ladder.** Help button sends `mode: "help"`; hint level per problem comes back in `state`.
   *Done when:* tapping Help 3 times on the same problem gives a nudge, a bigger push, then the worked step.
8. **Firestore.** Save each page (tldraw snapshot + `PageState`) under `pages/{page_id}`, and load it on start.
9. **Import a PDF worksheet.** An "Import PDF" button renders each page with pdf.js to an image and places it on the canvas as a locked background shape (not `meta.ai`). Include it in the exported image so Gemini sees the printed problem; the read prompt already knows to grade only handwriting.
   *Done when:* a problem set PDF shows on the canvas, you circle a part, tap Help, and get a hint about that problem.
10. **Voice in Help.** Hold-to-talk on the Help button, sends `question` (see "Help button" above).
11. **Graphs.** `figure` actions with `plot2d` render with function-plot and get placed next to their box.
12. **Venue wifi check (before 6:30 PM).** Ask Parsh to open the Firebase link on the iPad over venue wifi and run one check. Log the result. If it fails, note that judging needs a phone hotspot.
13. **Demo set.** 5 problems with planted mistakes that work every time (wrong derivative, sign error in algebra, wrong integral, a correct one, a "graph this"). Write them in `README.md` with what should happen.

Log every finished task in `AGENT_LOG.md` before moving on. Preet's agent picks up 3D figures, voice polish and the pitch tonight, and will read the log first.
