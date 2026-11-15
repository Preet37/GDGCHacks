# Part 2: Engineering Notebook

Branch: `engineering`. Nothing here is on `main` until a human merges it after an iPad rehearsal.

## In one paragraph

The same notebook, now for engineering and physics homework. Draw a circuit, a free-body diagram or a physics equation with units by hand, the way you would on paper. The tutor reads the drawing, checks it with real solvers (circuit analysis, unit analysis, force balance), and gives hints in the usual 3 steps. Once the student has worked the problem, the drawing comes alive: voltages and currents appear on **their own circuit**, they can tap a resistor, change its value and watch every number update, and a messy force sketch becomes a clean diagram they can check and spin in 3D. Engineering homework is drawn, so the tutor has to understand drawings, not only equations.

## Why this is the right Part 2

- **Builds on what works.** `server/circuits.py` (DC nodal analysis), `solve_circuit` as a Gemini tool, circuit reading in `read.md`, the checker-backed guard, `plot2d`/`surface3d` figures and lessons are already in `main`. Part 2 makes those visible and adds two more checkers.
- **Same rule as Part 1: Gemini reads and decides, code computes and draws.** No topic-specific branches. New subjects are new tools (`check_units`, `check_forces`) and new `FigureSpec` kinds (`circuit`, `fbd`) that the page draws generically.
- **Rubric fit, stronger.** Multimodal reading of *diagrams* (not just text), structured output (netlists and force lists as JSON), more function calling (three checkers), and an interactive result a judge can touch.
- **Cheap to explore.** Changing a resistor value re-solves on the server with **no Gemini call** (`POST /api/circuit/solve`), so the demo can be played with freely without spending credit.

## What the student can do

| # | Feature | What the student sees | Checked by |
| --- | --- | --- | --- |
| E1 | **Circuit checking** (exists on `main`) | Draw a circuit, write `I = 9 mA` beside it, pause: red circle + a question if wrong. Help gives the 3 hints. | `solve_circuit` + `check_claim` |
| E2 | **Circuit x-ray** | After the student has written an answer (or reached hint 3, or written "simulate"/"explore"), small blue labels appear **on their own drawing**: the voltage at each node, the current and direction through each element. | `solve_circuit` |
| E3 | **What-if card** | Beside the circuit: a card listing each element with its value. Tap a value, change it (stepper or typed), and every label and number updates in under a second. A "Reset" button returns to the drawn values. | `POST /api/circuit/solve` (SymPy, no Gemini) |
| E4 | **"Is this your circuit?"** | When the reading is unsure, the card shows the netlist as Gemini read it with an `ask` bubble, so a misread drawing is fixed before anything is marked. | read confidence |
| E5 | **Units check** | Write `F = 5 kg · 9.8 m/s = 49 N`: the unit mistake is circled ("What are the units of acceleration?"). Works on any physics line with units. | `check_units` (SymPy units) |
| E6 | **Free-body diagrams** | Sketch a block on a ramp with arrows. The tutor checks which forces are there and whether they balance. A missing force (for example friction) is pointed at with a question. After the hint ladder, a clean diagram appears beside the sketch, with the missing force dashed. | `check_forces` (component sums with SymPy) + Gemini |
| E7 | **3D view of forces** (stretch) | Tap the clean diagram to open it in 3D (block, ramp, force arrows) and spin it with the Pencil, reusing the `surface3d` Three.js setup. | n/a |

Every red mark still needs a checker verdict of `incorrect`, through the same guard as Part 1.

## How it works

```
Pencil sketch ──▶ /api/check (unchanged pipeline)
                    read.md:  circuit → ONE line, plain = {"circuit":[...]}   + element/node positions (NEW)
                              force diagram → ONE line, plain = {"fbd":{...}}   (NEW)
                              physics lines keep units in `plain`               (NEW)
                    teach.py tools: verify_step · compute_step · solve_circuit
                                    + check_units (NEW) · check_forces (NEW)
                    guard.py: red marks only on `incorrect`; builds figure specs from the
                              READ netlist / force list in code, never copied by the model (NEW)
                    ▼
                  actions: circle / note / ask / figure{kind:"circuit"|"fbd"} (NEW kinds)
                    ▼
web/src/render:   circuit.ts → x-ray labels on the student's ink + the what-if card shape
                  fbd.ts     → clean SVG force diagram (2D), optional 3D via Three.js
                    ▼
What-if edits ──▶ POST /api/circuit/solve {elements} → solve_circuit → labels update (no Gemini)
```

### Contract additions (all optional, so `main` and old pages keep working)

```ts
// FigureSpec.kind gains "circuit" | "fbd"
export interface FigureSpec {
  kind: "plot2d" | "surface3d" | "circuit" | "fbd";
  expressions: string[];            // [] for circuit / fbd
  x_range: [number, number];        // [0, 1] for circuit / fbd (unused)
  // ...existing fields...
  circuit?: CircuitFigure;          // kind "circuit" only
  fbd?: FbdFigure;                  // kind "fbd" only
}

export interface CircuitElement {
  id: string; kind: "resistor" | "vsource" | "isource";
  a: string; b: string; value: string;   // same netlist as circuits.py
  box?: Box;                              // where it is drawn, 0-1000 over the sent image (NEW, from the read step)
}
export interface CircuitFigure {
  elements: CircuitElement[];
  nodes?: { id: string; at: [number, number] }[];   // [y, x] 0-1000: a point on each node's wire, for voltage labels
  solution?: CircuitSolution;                         // filled by code from solve_circuit
  reveal: boolean;                                    // false = show the card, hide the numbers (the student hasn't tried yet)
}
export interface CircuitSolution {
  node_voltages: Record<string, number>;
  currents: Record<string, number>;       // amps, a -> b
  element_voltages?: Record<string, number>;
  power?: Record<string, number>;
}

export interface Force { id: string; label: string; angle_deg: number; magnitude?: string; on: string; at?: [number, number] }
export interface FbdFigure {
  bodies: { id: string; shape: "box" | "point" | "beam"; at?: [number, number] }[];
  surfaces?: { id: string; angle_deg: number }[];   // a ramp at 30 degrees, a floor at 0
  forces: Force[];                                   // what the student drew
  expected?: Force[];                                // what should be there (from check_forces); shown dashed only at hint 2+
}

// New endpoint (no Gemini):
// POST /api/circuit/solve  { elements: CircuitElement[] } -> { ok: true, ...CircuitSolution } | { ok: false, detail: string }
```

`server/models.py` and `contract/examples/` change in the same commit as `contract/contract.ts`, as on `main`.

### New server tools

- **`check_units(line_id, expression)`**: parses quantities with units (`5 kg`, `9.8 m/s^2`, `49 N`, `2.2 kΩ`) with `sympy.physics.units`, and checks that every side of the equation has the same dimension and, when numbers are given, the same value (1% tolerance). Returns `{verdict, detail}` like `verify_step`, e.g. `incorrect: left side kg*m/s, right side N (kg*m/s^2)`.
- **`check_forces(fbd_line_id, forces, givens)`**: takes the forces as read (label, angle, magnitude expression) plus any givens (`m = 2 kg`, `θ = 30°`, `μ = 0.3`, `a = 0` for "at rest"), sums the x and y components with SymPy, and reports whether they balance (or equal `m·a`). Which forces *should* be on the diagram is Gemini's call, written down as `expected` in `submit_feedback`; the code only checks the arithmetic of the balance and any magnitudes the student wrote.

Both feed `result.verdicts`, so `guard.py` drops red marks on anything a checker called correct, exactly as it already does for `verify_step` and circuit claims.

### When figures appear (prompt rules, `tutor.md`)

- `circuit` figure: whenever a circuit is on the page and either (a) the student has written at least one answer about it, (b) the problem reached hint level 3, or (c) the student wrote or said "simulate", "explore", "what if". `reveal` is false until (a) or (b): before that, the card shows the elements without numbers, so the tutor never gives the answer first.
- `fbd` figure: in help mode at hint level 2+, or when the free-body diagram checks correct (a green "Nice: forces balance" plus the clean diagram).
- The page decides nothing: it draws what it gets.

## Demo (engineering set)

| # | Write / draw | Should happen |
| --- | --- | --- |
| E-1 | 9 V source, 1 kΩ and 2 kΩ in series. Beside it: `I = 9 mA` | Red circle on `9 mA`: "What is the total resistance in the loop?" |
| E-2 | Fix it to `I = 3 mA` | Circle clears; x-ray labels appear on the drawing (node voltages 9 V / 6 V, 3 mA arrows); what-if card beside it |
| E-3 | On the card, change R2 to 4 kΩ | Every label updates (I = 1.8 mA) in under a second, no Gemini call |
| E-4 | `F = 2 kg · 9.8 m/s = 19.6 N` | Units mistake circled: "What are the units of acceleration?" |
| E-5 | Block on a 30° ramp with arrows for gravity and normal only, "at rest" | Help: "What keeps it from sliding?" → hint 2: clean diagram with friction dashed → hint 3: `f = mg sin 30° = 9.8 N` |
| E-6 (stretch) | Tap the clean diagram | It opens in 3D; spin it with the Pencil |

Pitch line: *"Engineering homework is drawn. Every other AI tutor reads text. Ours reads your circuit, checks it with a real solver, and then lets you play with it."*

## Not in Part 2

AC/phasors, capacitors and inductors in time, op-amps, beams and moments, 3D statics with more than one body, auto-layout of a brand-new schematic (we label the student's own drawing instead). Mention these as next steps in the pitch.

## Running it

Same as `main` (see `README.md`). To test against the branch's server without touching production:

```bash
./server/deploy_eng.sh                     # deploys Cloud Run service tutor-api-eng (never tutor-api)
cd web && API_TARGET=<tutor-api-eng URL> npm run dev -- --host --port 5174
# iPad: http://<laptop-ip>:5174/?page=eng-1   (no voice on http; everything else works)
```
