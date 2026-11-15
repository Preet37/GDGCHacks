# Socra architecture

Socra is a notebook page with a tutor built in. You write math by hand, and the page marks the step that is
wrong, gives a hint, a lesson, a graph, a 3D model or a worked solution, on the same page.

The rule behind the design: **Gemini reads and explains. Code does the math.** Gemini never decides by itself
whether a step is right. It calls a checker, and the checker decides. A red mark is never a guess.

## System

```mermaid
flowchart LR
  subgraph Browser["iPad browser (Firebase Hosting)"]
    Canvas["tldraw canvas<br/>pen strokes, PDFs"]
    Capture["Capture<br/>only the ink near the pen"]
    Apply["Apply actions<br/>circle, note, hint, solution"]
    Render["Renderers<br/>KaTeX, plots, Three.js 3D"]
    Voice["Listen / speak<br/>Web Speech + audio clips"]
  end

  subgraph Server["FastAPI on Cloud Run (tutor-api)"]
    Read["read.py<br/>page image to structured lines"]
    Teach["teach.py<br/>tool loop"]
    Guard["guard.py<br/>drops marks the checker disagrees with"]
    Memory["memory.py<br/>last 4 exchanges per page"]
    subgraph Checkers["Deterministic checkers"]
      SymPy["verify.py / compute.py<br/>SymPy"]
      Circuits["circuits.py<br/>circuit solver"]
      Units["units.py"]
      Forces["forces.py"]
    end
  end

  subgraph Gemini["Gemini API"]
    Vision["Gemini 3.5 Flash<br/>vision"]
    Tools["Gemini 3.5 Flash<br/>function calling"]
    TTS["Gemini text-to-speech"]
  end

  Canvas --> Capture -->|POST /api/check| Read
  Read <--> Vision
  Read --> Teach
  Teach <--> Tools
  Teach <-->|verify_step, check_units, check_forces| Checkers
  Teach --> Guard -->|actions| Apply
  Memory --- Teach
  Apply --> Render
  Server -->|lesson audio| Voice
  Server <--> TTS
```

## One check, step by step

```mermaid
sequenceDiagram
  participant S as Student
  participant P as Page (browser)
  participant A as Server
  participant G as Gemini
  participant C as Checkers (SymPy and others)

  S->>P: writes a step, pauses or taps Help
  P->>A: image of the ink near the pen
  A->>G: read the page
  G-->>A: lines as math, with positions
  A->>G: tutor prompt + lines + recent exchanges
  loop up to 5 tool rounds
    G->>A: verify_step(previous, current)
    A->>C: is this step equivalent?
    C-->>A: correct / wrong, with the reason
    A-->>G: tool result
  end
  G->>A: submit_feedback(actions)
  A->>A: guard: remove any red mark on a step the checker called correct
  A-->>P: actions
  P->>S: circle, question or hint drawn on the page
```

One check is about 3 Gemini calls and about 21,000 input tokens. It takes 4 to 10 seconds.

## What each part does

| Part | Where | What it does |
|---|---|---|
| Canvas | `web/` (React, tldraw) | The page you write on. Imports PDFs as worksheets. |
| Capture | `web/src` | Sends only the area around the pen, not the whole page. |
| Read | `server/read.py`, `prompts/read.md` | Gemini vision turns handwriting and diagrams into structured lines. |
| Tutor loop | `server/teach.py`, `prompts/tutor.md` | Gemini calls the checkers as tools, then answers as a list of actions. |
| Math checker | `server/verify.py`, `compute.py` | SymPy checks algebra, derivatives and integrals, each step against the one before. |
| Engineering checkers | `server/circuits.py`, `units.py`, `forces.py` | Circuit solver, unit check, force balance. |
| Guard | `server/guard.py` | Removes any red mark that the checker does not support. |
| Lessons | `server/explain.py`, `practice.py` | A lesson about the mistake, then a practice problem checked the same way. |
| Solutions | `server/solution.py` | Worked steps; every step goes through the checker before it is shown. |
| Voice | `server/speak.py`, `web/src/handsfree.ts` | Gemini text-to-speech for lessons, with fallback models. Listening uses the browser. |
| Memory | `server/memory.py` | Keeps the last 4 exchanges per page so follow-ups stay on topic. |
| Graphs and 3D | `web/src/render`, `web/src/shapes` | Plots and surfaces drawn in the browser from the checked formula. 3D models from a small library or generated. |
| Circuit what-if | `POST /api/circuit/solve` | Change a value and the circuit is re-solved in code, with no AI call. |

## The contract

The server never returns free text. It returns **actions** (`contract/contract.ts`, mirrored in
`server/models.py`): circle a line, write a note, ask a question, draw a figure, write a solution, speak.
The browser draws them. This is why feedback lands on the right line of the student's own page.

## Hosting

```mermaid
flowchart LR
  Dev["main branch"] -->|scripts/deploy_prod.sh| Test["tests + candidate revision<br/>health, bad image, one real check"]
  Test -->|promote| Run["Cloud Run: tutor-api"]
  Test --> Host["Firebase Hosting: tutor-1098c.web.app"]
  Host -->|/api/*| Run
  Run --> GeminiAPI["Gemini API"]
```

## Handwriting

In the app today, "Write in my handwriting" finds the student's own letters on the page and replays those
pen strokes. A learned stroke model (a style encoder plus a stroke generator) is an early experiment and is
not part of the app.

## Screens

| | |
|---|---|
| ![A wrong step circled](images/01-mistake-circled.png) | ![Hint, then Solve it](images/02-hint-then-solve-it.png) |
| ![A lesson about the mistake](images/03-teach-me-lesson.png) | ![Graph and 3D surface](images/06-graph-and-3d-surface.png) |
| ![Worksheet PDF, solved step by step](images/05-worksheet-solve-it.png) | ![Circuit values and what-if](images/09-circuit-xray-what-if.png) |
