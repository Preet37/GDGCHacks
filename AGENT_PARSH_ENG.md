# Agent brief: Parsh's side, Part 2 (Engineering Notebook)

You are Parsh's agent. Part 1 (the math tutor notebook) is done and live; Preet and his agent are making small fixes on `main`. **You build Part 2 alone, on its own branch.** Read `docs/ENGINEERING.md` first: it is the spec. Then `README.md`, `docs/STATUS.md` and the end of `AGENT_LOG.md` for how Part 1 works and what was learned.

When you report to Parsh, use plain, simple words.

## Branch rules (most important)

1. **All your work goes on the branch `engineering`. Every commit, every push.** Never commit to `main`, never push to `main`, never open a merge into `main`, never force-push. Before every push, run `git branch --show-current` and stop if it doesn't say `engineering`.
2. Setup (once):
   ```bash
   git fetch origin
   git checkout -b engineering origin/main      # or: git checkout engineering && git pull --rebase origin engineering, if it already exists
   git push -u origin engineering
   ```
3. Push after every finished task: `git push origin engineering`.
4. Keep up with Preet's fixes: at the start of each task, `git fetch origin && git merge origin/main` into `engineering` (a merge commit, not a rebase of pushed work). If there's a conflict in a file Preet changed, keep his version and re-apply your change on top. Tests must pass before you push the merge.
5. Merging into `main` is a human decision after an iPad rehearsal. When the merge gate (task 10) passes, post `READY TO MERGE` in your log and stop.

## Production is off-limits

- **Never deploy to the live service `tutor-api` or the live Hosting site** from this branch. Judges use those.
- Your server goes to a separate Cloud Run service, **`tutor-api-eng`** (task 1 adds `server/deploy_eng.sh`). Test the page with the dev server pointed at it: `cd web && API_TARGET=<tutor-api-eng URL> npm run dev -- --host --port 5174`. The iPad can open `http://<laptop-ip>:5174` on the same wifi.
- If Parsh wants a public https link for the iPad (voice needs https), use a Hosting **preview channel**, never the live one: `npx firebase-tools hosting:channel:deploy eng --expires 2d`. Note: preview channels send `/api/**` to `tutor-api` (live), so for engineering features use the dev page instead, unless you also make a branch-only `firebase.json` change, and **don't**: it would break `main` when merged.

## Gemini budget

Prepaid credit ran out twice tonight. Each `/api/check` is about 21,000 input tokens. Rules:

- Build and test offline first: pytest and Vitest, `?mock`, `?dev`, and the example JSONs. Every task adds tests.
- **At most 40 paid Gemini calls for all of Part 2.** Count them in each log entry ("paid calls: 3 this task, 17 total").
- `POST /api/circuit/solve` uses no Gemini; play with it freely.
- If you get a `402` / out-of-credit or a quota `429`: stop paid calls, post `BLOCKED`, and tell Parsh.

## Rules carried over from Part 1

- **No hard-coding by topic.** Teaching behavior lives in `server/prompts/*.md`. New abilities are new tools or new `FigureSpec` kinds that the page draws generically.
- **No red mark without a checker verdict of `incorrect`.** New checkers feed `result.verdicts` so `guard.py` handles them like `verify_step`.
- **Figures are built from what was read, in code.** The netlist and force list in a `figure` come from the read line's `plain` (and the solver's result), filled in by `guard.py`, not copied by the model.
- **Contract changes are additive and optional** (new optional fields, new enum values), so `main`'s page and saved pages keep working. Update `contract/contract.ts`, `server/models.py` and `contract/examples/*.json` in the same commit. `web/src/contract.ts` follows `contract/contract.ts` as on `main`.
- Unknown figure kinds must be ignored by the page, never crash it.
- Small commits. Run `npm test` (in `web/`) and `pytest -q` (in `server/`) before every push.

## Your log

Write to **`AGENT_LOG_ENG.md`** (new file, on the `engineering` branch only), not `AGENT_LOG.md`, so merging never fights over the shared log. Append only. You can *read* `AGENT_LOG.md` on `origin/main` to see what Preet's agent changed.

```
## [time] PARSH-ENG-AGENT · [DONE | WORKING ON | QUESTION | BLOCKED | READY TO MERGE]
**Task:** number and name
**What I built:** files and what they do, 2 to 4 lines
**Tests:** which, pass/fail · paid calls: N this task, N total
**How to try it:** URL / steps
**Next:** what I'm doing now
**Need from Parsh:** questions, or "nothing"
```

Stuck on one bug for more than 20 minutes: post `BLOCKED` with what you tried, then move to the next task.

## Tasks, in order

Times are targets. If a task runs over, cut its stretch parts, not later tasks. Tasks 1 to 5 plus 9 and 10 are the core; 6 to 8 add to it.

### 1. Branch, log, deploy script, contract (11:45 PM to 12:30 AM)
- Create and push `engineering` (see Branch rules). Create `AGENT_LOG_ENG.md`.
- `server/deploy_eng.sh`: copy of `deploy.sh` that deploys service **`tutor-api-eng`**. Same `.env`.
- Contract additions from `docs/ENGINEERING.md` ("Contract additions"): `FigureSpec.kind` + `circuit`/`fbd` fields, `CircuitElement.box`, `CircuitFigure`, `CircuitSolution`, `Force`, `FbdFigure`. Mirror in `models.py`.
- Examples: `contract/examples/circuit_figure.json` (series circuit with node positions and `reveal: true`), `circuit_hidden.json` (`reveal: false`), `units_wrong.json`, `fbd.json`.
- *Done when:* every example loads into the Pydantic `CheckResponse` and the TS type check passes; all old tests pass.

### 2. Free re-solve endpoint (12:30 to 1:00 AM)
- `POST /api/circuit/solve` in `main.py`: body `{elements}` → `circuits.solve_circuit(elements)` as JSON. No Gemini. Bad input → `{ok: false, detail}` with status 200 (the card shows the reason), never a 500.
- Make sure `solve_circuit` ignores extra keys like `box`.
- *Done when:* pytest covers a divider, a changed value, and a broken circuit; `curl` on a local server answers in under 200 ms.

### 3. Read: where each part is drawn (1:00 to 1:45 AM)
- `read.md`, "Circuit diagrams": each element in the netlist also gets `box` (where its symbol is drawn), and the line gets node positions: add `"nodes": [{"id": "n1", "at": [y, x]}]` to the `{"circuit": ...}` JSON, a point on each node's wire away from symbols. Keep everything else the same.
- Test offline by extending the circuit tests with a stored model reply. Then **at most 4 paid calls**: one clean drawn circuit image (generate it like `server/testpage.py` does, or use a photo Parsh takes) through the read step, and check that the boxes land on the symbols. Save the image and reply under `server/tests/data/` for offline tests.
- *Done when:* boxes for 3 of 3 elements are within about 5% of the symbols on the test image.

### 4. Circuit figure from code (1:45 to 2:30 AM)
- `guard.py` (or a new `server/engineering.py` called from it): when the reading has a circuit line, build the `figure` action **in code** from that line's `plain` plus `solve_circuit`'s result: `kind: "circuit"`, `elements`, `nodes`, `solution`, and `reveal` true only if the student has written an answer line in that problem, the problem's hint level is 3, or a line in the problem asks to "simulate", "explore" or "what if". Gemini decides *whether* to show it (a `figure` action with `kind: "circuit"` and the `line_id`, per the `tutor.md` rule); code fills in the contents.
- `tutor.md`: the "When figures appear" rules from `docs/ENGINEERING.md`.
- *Done when:* offline tests: a wrong-answer reply carries the red mark AND a hidden-numbers figure; a right answer carries a revealed figure; a circuit with no answer and no request carries no figure. **At most 3 paid calls** to confirm on `tutor-api-eng`.

### 5. Page: x-ray labels + what-if card (2:30 to 4:00 AM)
- `web/src/render/circuit.ts` + a tldraw shape `web/src/shapes/CircuitCardShape.tsx` (registered like `Surface3dShape`):
  - **X-ray labels** on the student's drawing, `meta.ai = true` with the circuit's `line_id`: node voltage in small blue text at each `nodes[].at`; for each element, its current with a small arrow showing direction, next to its `box`. Convert boxes with `boxToPage` like everything else. Hidden when `reveal` is false.
  - **What-if card** beside the circuit (placement like figures: avoid ink, print and buttons): one row per element, `R2  [ 2 kΩ ]  − +`, values editable by tapping (stepper in 1-2-5 steps, or type). Every edit calls `/api/circuit/solve` (debounce 250 ms) and updates the labels and a small "I = 1.8 mA" summary. "Reset" restores the drawn values. If `reveal` is false the card shows elements and values but "?" for results, plus "Write your answer to unlock".
  - `ok: false` from the endpoint: the card shows the reason in gray and keeps the last good numbers.
  - The card must not trigger a check (it's an AI shape) and must survive save/reload (Firestore).
- Unit tests for label placement and card state; a headless run with `?mock` / `?dev` on the example JSONs.
- *Done when:* with `circuit_figure.json` loaded via `?dev`, labels sit on the drawing, and changing R2 updates every label from the real endpoint in under a second.

### 6. Units checker (4:00 to 4:45 AM)
- `server/units.py`: `check_units(expression)` with `sympy.physics.units`: parses quantities (`5 kg`, `9.8 m/s^2`, `49 N`, `2.2 kΩ`, `3 mA`), checks every side of the equation has the same dimension, and if numbers are given, the same value (1% tolerance). `{verdict, detail}`; `unknown` on anything it can't parse; never raises.
- Register as a Gemini tool in `teach.py`; `read.md`: keep units in `plain` (`F = 2*kg * 9.8*m/s = 19.6*N`); `tutor.md`: a short "Units" section (call `check_units` on any line with units; mark only `incorrect`; hint asks about the unit, not the number).
- *Done when:* pytest: right/wrong dimension, right dimension with wrong number, prefixes, unparseable → `unknown`. **At most 3 paid calls** with demo E-4.

### 7. Free-body diagrams (4:45 to 6:00 AM)
- `read.md`: a drawn force diagram is ONE line, `plain = {"fbd": {...}}` (bodies, surfaces with angle, forces with label, angle in degrees from +x, magnitude if written, where drawn). Givens written beside it are ordinary lines.
- `server/forces.py`: `check_forces(forces, givens, accel)` sums components with SymPy, returns balanced / not balanced with the leftover, and checks any magnitude the student wrote. Register in `teach.py`; `tutor.md` "Force diagrams": Gemini lists the `expected` forces, uses the ladder (1: "what keeps it from sliding?", 2: clean diagram with the missing force dashed, 3: the magnitude, worked).
- `web/src/render/fbd.ts`: `kind: "fbd"` → a clean SVG (ramp at the right angle, body, labelled arrows; `expected` forces not drawn by the student shown dashed) as an image shape placed like a `plot2d` figure.
- *Done when:* pytest for balance on a ramp, at rest and accelerating; the `fbd.json` example renders through `?dev`. **At most 5 paid calls** with demo E-5.
- Stretch (only if everything above is done by 5:30 AM): tap the diagram to open it in 3D, reusing the Three.js setup from `Surface3dShape`.

### 8. Engineering demo harness (alongside 5 to 7)
- `web/e2e/demo_eng.mjs`: draws demo E-1 to E-5 from `docs/ENGINEERING.md` with pen strokes (`lib.mjs` `stroke` / `write`; a resistor is a zigzag polyline, a source is two plates), against the dev page on `tutor-api-eng`, and checks each promise. Save screenshots to `web/e2e/eng/`.
- *Done when:* it runs end to end once (**at most 8 paid calls**), results written to `web/e2e/RESULTS_ENG.md`.

### 9. Docs (by 6:15 AM)
- Update `docs/ENGINEERING.md` with what really works, the measured times, and any change to the spec. Add an "Engineering" section to `docs/DEMO.md` **on this branch** with the exact iPad steps for E-1 to E-5 and what to do if each fails.

### 10. Merge gate (by 6:30 AM), then stop
Post `READY TO MERGE` only if all of these are true; otherwise post what's missing and stop:
- [ ] `engineering` is merged up to date with `origin/main`; all server and web tests pass; `npm run build` passes.
- [ ] Part 1's demo set still passes against `tutor-api-eng` (`node web/e2e/demo.mjs` with `API_TARGET` set; 5 paid calls, counted). Part 2 must not break Part 1.
- [ ] Demos E-1, E-2, E-3 pass on the iPad through the dev page (Parsh does this; you give him the steps and the URL).
- [ ] Old saved pages and a page with no engineering content load without errors.
- [ ] A list of exactly what would change on the live site if merged: which deploys (Cloud Run `tutor-api` and Hosting), in which order (Hosting first if the page must accept the new figure kinds).

After `READY TO MERGE`, do nothing else unless Parsh asks. **Do not merge and do not deploy to production yourself.**
