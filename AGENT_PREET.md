# Agent brief: Preet's side (the brain)

You are helping Preet build an AI tutor notebook at a 24-hour hackathon (Google DevFest, UCSC). Track: Best Integration of Gemini/Google API. Teammate Parsh has his own agent building the iPad page in parallel. Your job is the server: the part that reads handwriting with Gemini, decides how to teach, and returns drawing actions.

**Deadline for your work: 4:00 PM today.** After that Parsh takes over the repo, so everything must run and deploy without Preet around.

When you report back to Preet, explain what you did in plain, simple words.

## What the product does

A student writes math by hand on an iPad. After they pause, the app sends a picture of the page to our server. The server:

1. Reads the handwriting into clean lines (Gemini).
2. Checks each step with real math (SymPy, through a tool Gemini can call).
3. Decides how to teach: circle a mistake, write a hint, ask "did you mean...?", or draw a graph (Gemini).
4. Returns a list of simple drawing actions. The page draws them.

The tutor never gives the answer first. It finds mistakes and gives hints in 3 levels: nudge, bigger push, then the worked step.

## Rules

- **No hard-coding by topic.** No `if topic == "derivative"` branches, no canned feedback strings. Teaching behavior lives in `server/prompts/*.md`. New abilities are new tools or new action fields, not new code paths.
- **Stay in your folders:** `contract/` and `server/`. Never edit `web/` or `firebase.json`. Those are Parsh's.
- **The contract is shared.** You own `contract/` until 4 PM. Any change must update `contract/contract.ts`, `server/models.py` and `contract/examples/*.json` together, and tell Preet so he can tell Parsh.
- **API key stays on the server.** Read it from the environment. Never commit `.env`.
- **Model name comes from the environment** (`GEMINI_MODEL`). Use the fastest current Gemini Flash model available in Google AI Studio.
- Don't add features beyond this brief. Small commits, push often so Parsh can pull.

## Team log (talk to Parsh's agent here)

`AGENT_LOG.md` at the repo root is where the two agents talk: post updates, ask for help, and debate the best way to do things. Both agents read it and write to it.

**Every time you finish a task:**

1. Run the tests (`pytest` in `server/`). Every task adds at least one test.
2. `git pull --rebase` first, so you have the other agent's latest entries.
3. Append an entry to the bottom of `AGENT_LOG.md` (template below). Never edit or delete old entries, only add new ones. That avoids merge fights.
4. Commit the code and the log entry together, then push.

**Before starting any task:** pull, then read every entry since your last one. If the other agent asked you something or proposed a change to your area, answer in a new entry before you continue.

**Entry template:**

```
## [time] PREET-AGENT · [DONE | WORKING ON | QUESTION | PROPOSAL | REPLY | BLOCKED]
**Task:** what this is about
**What I built:** files changed and what they do, in 2 to 4 lines
**Tests:** which tests, pass/fail
**How to use it:** anything the other side needs to know (endpoints, fields, commands)
**Next:** what I'm doing now
**Need from you:** questions, requests, or "nothing"
```

**Debating a change:**

- To change the contract or anything in the other agent's area, post a `PROPOSAL` with the problem, 2 options and which one you'd pick and why. Wait for a `REPLY` before changing shared files.
- If you disagree with a proposal, reply with your reasoning and a counter-option. Pick the one that's simpler to demo by tomorrow at 10 AM.
- If you can't agree after 2 rounds, post `BLOCKED` and ask Preet to decide.
- If you're stuck on a bug for more than 20 minutes, post `BLOCKED` with what you tried.

## Repo layout

```
/contract/contract.ts          shared types (you write this first)
/contract/examples/*.json      example CheckResponse replies Parsh uses as fake data
/server/main.py                FastAPI app: POST /api/check, GET /api/health
/server/models.py              Pydantic models, field-for-field match with contract.ts
/server/pipeline.py            read step + teach step
/server/verify.py              verify_step tool (stub now; Parsh fills in SymPy after 4)
/server/prompts/read.md        instructions for the read step
/server/prompts/tutor.md       instructions for the teach step
/server/requirements.txt
/server/Dockerfile             for Cloud Run
/server/.env.example           GEMINI_API_KEY=, GEMINI_MODEL=
/web/                          Parsh's (don't touch)
/firebase.json                 Parsh's (don't touch)
/README.md                     handoff notes (you write the server part)
/AGENT_LOG.md                  shared log both agents append to
```

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

## How the server works

**Step 1: Read** (one Gemini call, structured output)

- Input: the page image, plus `state.lines` from last time so line and problem ids stay the same.
- Output: `{ "lines": ReadLine[] }` using a response schema.
- Instructions in `prompts/read.md`: read every handwritten line, group lines into problems, give each line a box, write it as LaTeX and as plain calculator syntax, label how it follows from the line before, and mark `confidence: "low"` when unsure. Never fix the student's math while reading: write what is on the page, mistakes included.

**Step 2: Teach** (Gemini with function calling, in a loop)

- Input: the lines, `mode`, `help_box`, hint levels and `flagged_line_ids`.
- Tools Gemini can call:
  - `verify_step(before: string, after: string, relation: string)` returns `{ "verdict": "correct" | "incorrect" | "unknown", "detail": string }`. Lives in `verify.py`.
  - `submit_feedback(actions: Action[], clear_line_ids: string[], hint_updates: {problem_id, hint_level}[])` is how Gemini finishes. Using a function as the final answer gives us structured output and function calling in one loop.
- Force a function call every turn (function calling mode "ANY"). Stop when `submit_feedback` is called, or after 5 rounds (then return no actions).
- Instructions in `prompts/tutor.md`. Core rules:
  - Call `verify_step` on every new line before judging it.
  - Only flag a line as a mistake if `verify_step` said `incorrect`. If it said `unknown`, only flag when you're very sure.
  - Never give the answer first. Mistake notes ask a question that points at the error.
  - In `help` mode, if `question` is set, answer that question as a hint (never the final answer). Then give the next hint level for that problem: 1 = a nudge (which idea or rule to use), 2 = a bigger push (set up the first step), 3 = show the next worked step. Raise `hint_level` by 1.
  - If a line has `confidence: "low"`, use `ask` ("did you mean...?") instead of marking it wrong.
  - Don't repeat feedback for lines in `flagged_line_ids` unless the line changed. If a flagged line is now correct, put it in `clear_line_ids`.
  - If the student writes "graph", "plot" or "sketch" near an expression, return a `figure` action with a `FigureSpec`.
  - Keep notes short, under 15 words, friendly, like a TA writing in the margin.

**Step 3: Guard and merge** (plain code, not topic-specific)

- Drop any red `circle` on a line that `verify_step` called `correct`. This is the safety net against wrong feedback.
- Apply `hint_updates`, update `flagged_line_ids`, put the new lines in `state`, return the `CheckResponse`.
- Fill `debug` with timings and the tool calls made, so Preet can see what happened.

**verify.py right now:** a stub that always returns `{"verdict": "unknown", "detail": "checker not built yet"}`. Parsh's agent replaces it with SymPy after 4 PM. Keep the function signature exactly as above.

**Speed**

- Read with the fastest Flash model.
- Reject or shrink images over 1280 px on the long side.
- Log how long each step takes.

## Tasks, in order

1. **Contract (by ~2:15).** Write `contract/contract.ts`, `server/models.py`, and the 3 example JSON files. Commit and push right away so Parsh's agent can build against them.
   *Done when:* the examples load into the Pydantic `CheckResponse` model without errors.
2. **Server skeleton.** FastAPI app, `/api/health`, `/api/check` returning `examples/wrong_derivative.json` for any input. CORS open for local dev.
   *Done when:* `curl localhost:8000/api/health` returns ok and `/api/check` returns the example.
3. **Read step + `prompts/read.md`.** Use the `google-genai` Python SDK.
   *Done when:* a photo of `f(x)=3x^2+2x` then `f'(x)=6x+1` comes back as 2 lines in one problem, the second labeled `derivative`, with boxes around the right lines.
4. **Teach step + `prompts/tutor.md` + `verify.py` stub.**
   *Done when:* that same photo returns a red `circle` and a `note` on L2, and a page with correct work returns no red marks. Test with 3 to 4 handwritten photos (correct work, wrong derivative, messy writing, a "graph this").
5. **Deploy to Cloud Run** as service `tutor-api`, region `us-central1`, with `GEMINI_API_KEY` and `GEMINI_MODEL` set as environment variables. Parsh's Firebase setup sends `/api/**` to it.
   *Done when:* the deployed `/api/health` responds.
6. **Handoff (3:30 to 4:00).** Test end to end with Parsh's page on the iPad. Write the server part of `README.md`: how to run locally, how to deploy, where the prompts are, what works, known bugs, and that `verify.py` is the next thing to build.

**Printed worksheets:** the page image may include an imported PDF worksheet under the handwriting. `prompts/read.md` must tell Gemini to read printed problem text as context (mark those lines `relation: "other"`, problem_id of the problem they belong to) and never grade printed text, only handwriting.

## Things only Preet can do (ask him)

- Make a Gemini API key in Google AI Studio and put it in `server/.env`.
- Log in to Google Cloud (`gcloud auth login`) and pick the project for Cloud Run.
- Take photos of handwritten test pages for step 3 and 4.
