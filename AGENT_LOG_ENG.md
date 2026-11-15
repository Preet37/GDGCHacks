# Agent log: Part 2 (Engineering Notebook)

Branch `engineering` only. Append only. Part 1's shared log is `AGENT_LOG.md` on `main`.
Spec: `docs/ENGINEERING.md` · brief: `AGENT_PARSH_ENG.md` · test server: Cloud Run `tutor-api-eng` (never `tutor-api`).

Template:

## [time] PARSH-ENG-AGENT · [DONE | WORKING ON | QUESTION | BLOCKED | READY TO MERGE]
**Task:**
**What I built:**
**Tests:** · paid calls: N this task, N total
**How to try it:**
**Next:**
**Need from Parsh:**

---

## 12:09 AM PARSH-ENG-AGENT · DONE
**Task:** 1. Branch, log, deploy script, contract
**What I built:** branch `engineering` from `origin/main` @ 2bd3337, with the spec at `docs/ENGINEERING.md` and the brief at `AGENT_PARSH_ENG.md`. `server/deploy_eng.sh` deploys Cloud Run service **`tutor-api-eng`** (same `.env`; never `tutor-api`). Contract, additive and optional: `FigureSpec.kind` gains `"circuit" | "fbd"` plus `circuit?` / `fbd?`; new `CircuitElement` (with `box`), `CircuitFigure` (`elements`, `nodes`, `solution`, `reveal`), `CircuitSolution`, `Force`, `FbdFigure`, and the `/api/circuit/solve` request/response types. Mirrored in `server/models.py`. Examples: `circuit_figure.json` (9 V, 1k + 2k series, node positions, revealed), `circuit_hidden.json` (wrong `I = 9 mA`: red mark + card with numbers hidden), `units_wrong.json`, `fbd.json` (block on a 30° ramp, friction expected).
**Tests:** `server/tests/test_contract_eng.py` (+4: the circuit example's numbers equal `solve_circuit`'s; hidden card goes with a red mark; fbd's missing force is friction; old figure kinds load without the new fields). Server 307 passed / 5 live skipped; web `tsc -b` clean, Vitest 437 passed (the page already ignores unknown figure kinds). · paid calls: 0 this task, 0 total
**How to try it:** n/a (contract only)
**Next:** 2. `POST /api/circuit/solve`
**Need from Parsh:** nothing

## 12:10 AM PARSH-ENG-AGENT · DONE
**Task:** 2. Free re-solve endpoint
**What I built:** `POST /api/circuit/solve` in `server/main.py`: `{elements}` -> `circuits.solve_circuit(elements)` as JSON (`ok`, `node_voltages`, `element_voltages`, `currents`, `power`, `ground_chosen` when no ground was drawn). No Gemini. The body is read raw so anything malformed (not JSON, no `elements`, not a list, non-objects) gets `{ok: false, detail}` with **status 200**, never a 422 or 500. `solve_circuit` already ignores extra keys, so elements can be sent with their `box`.
**Tests:** `server/tests/test_circuit_solve_route.py` (+9: the example divider sent WITH boxes -> 3 mA / 6 V; R2 -> 4k re-solves to 1.8 mA / 7.2 V (demo E-3); contradictory sources, bad value, empty, wrong types, missing `elements`, not JSON -> `ok: false` + reason, all 200). Server 316 passed / 5 live skipped. Local server: **first call 169 ms (loads SymPy), then about 3 ms** each. · paid calls: 0 this task, 0 total
**How to try it:** `curl -X POST <server>/api/circuit/solve -H 'Content-Type: application/json' -d '{"elements":[{"id":"V1","kind":"vsource","a":"n1","b":"0","value":"9"},{"id":"R1","kind":"resistor","a":"n1","b":"n2","value":"1k"},{"id":"R2","kind":"resistor","a":"n2","b":"0","value":"2k"}]}'`
**Next:** 3. Read: where each part is drawn
**Need from Parsh:** nothing

## 12:12 AM PARSH-ENG-AGENT · DONE
**Task:** 3. Read: where each part is drawn
**What I built:** `server/prompts/read.md` "Circuit diagrams": every element gets `box` (tight around its SYMBOL only: zigzag / plates / circle, not its written label, not wires), and the JSON gets `"nodes": [{"id", "at": [y, x]}]` (a point on each node's wire away from symbols, ground included). New `server/engineering.py`: `parse_circuit(plain)` -> (elements with cleaned boxes, nodes with cleaned points); bad boxes/points are dropped one by one, never raised; old lines without positions still parse. `circuit_lines(lines)`.
**Tests:** `server/tests/test_engineering_read.py` (+7 offline). Paid check on `tests/data/circuit_series.png` (sketch: 9 V, R1 = 1k top, R2 = 2k right): 1st read put the written labels inside R1/R2's boxes (R2 off by 84/1000 sideways), so I tightened the rule to "symbol only, not the label"; 2nd read: **V1 off (0, 0), R1 (2, 1), R2 (4, 2)** in 0-1000 units, so **3 of 3 within 0.5%** (target 5%); nodes n1, n2, 0 each on their wire. 2nd reply stored as `tests/data/circuit_series_read.json`; the box and wire checks now run offline. Server 323 passed / 5 live skipped. · paid calls: 2 this task, 2 total
**How to try it:** `pytest tests/test_engineering_read.py`
**Next:** 4. Circuit figure from code
**Need from Parsh:** nothing

## 12:17 AM PARSH-ENG-AGENT · DONE
**Task:** 4. Circuit figure from code
**What I built:** `server/engineering.py` `circuit_figures()`, called from `guard.merge` (not in explain mode): for each circuit line, a `figure` `{kind: "circuit", circuit: {elements (with boxes), nodes, solution, reveal}}` built from the READ netlist + `solve_circuit`; any circuit figure the model wrote is replaced. Shown when the student wrote an answer about it, hint level 3, or "simulate/explore/what if" (written or asked). **Spec decision:** the spec says reveal on "an answer", but its own done-when wants a WRONG answer to get hidden numbers, so I reveal only on a solver-checked CORRECT answer (no incorrect ones) or hint level 3; a hidden figure carries **no `solution` at all**, so the answer isn't even in the data. Re-sent only when that problem's lines or hint level changed (so the card isn't redrawn and the student's what-if edits aren't reset on every pause). The figure's line isn't added to `flagged_line_ids` (like lessons), so later feedback on the circuit isn't silenced. "solve" lines are requests, not answers. `teach.py` figure enum allows `"circuit"`. `tutor.md`: "Circuit figures (when figures appear)". `server/deploy_eng.sh` -> **`tutor-api-eng` is up**: https://tutor-api-eng-191803288552.us-central1.run.app (prod `tutor-api` untouched, still `00028-bej`).
**Tests:** `test_engineering_figure.py` (+10 through the real `guard.merge`, circuit line from the stored Gemini read): wrong answer -> red circle + note + hidden figure with no solution; right answer -> revealed, 3 mA / 6 V, boxes + nodes; no answer/no request -> none; hint 3 reveals; "simulate" or a spoken "what if" -> hidden card; no change -> no resend; model's fake contents replaced; circuit line not flagged; explain adds none; "solve" isn't an answer. Server 333 passed / 5 live skipped. **Live on tutor-api-eng** (2 paid checks): wrong `I = 9 mA` -> `solve_circuit L2=incorrect`, red circle + "What is the total resistance of R1 and R2 in series?" + figure `reveal=false` (6.4 s); right `I = 3 mA` -> `L2=correct`, no marks, figure `reveal=true` (5.5 s). `/api/circuit/solve` live: R2 = 4k -> 1.8 mA. · paid calls: 2 this task, 4 total
**How to try it:** POST `tests/data/circuit_series.png` / `circuit_series_right.png` to `<tutor-api-eng>/api/check`.
**Next:** 5. Page: x-ray labels + what-if card
**Need from Parsh:** nothing

## 12:22 AM PARSH-ENG-AGENT · DONE
**Task:** 5. Page: x-ray labels + what-if card
**What I built:** `web/src/render/circuit.ts`: `figure` kind `circuit` -> blue **x-ray labels** on the student's own drawing (node voltage just above each `nodes[].at`; each element's current + direction arrow just past its `box` on the side facing the middle of the circuit, so it doesn't land on the student's "R2 = 2kΩ" outside) and the **what-if card**. Arrow direction comes from node a's point towards node b's, flipped for negative current, not from the symbol's shape (a battery's plates are wide but current crosses them). Value parsing/SI formatting, 1-2-5 stepper, typed values. `web/src/shapes/CircuitCardShape.tsx` (registered in `App.tsx` like `Surface3dShape`): one row per element (`R2 [2 kΩ] − +`, tap the value to type), current per row, "I = …" summary, Reset; every edit is saved to the shape's props at once and re-solved via `POST /api/circuit/solve` (debounce 250 ms, older request aborted), updating the card AND its labels. Hidden (`reveal: false`): "?" for results, "Write your answer to unlock", no labels, no solver calls. `ok: false`: reason in gray, last good numbers kept. `sync/api.ts` `solveCircuit()` (never throws). `render/figure.ts` dispatches `circuit`; unknown kinds are still skipped.
**Tests:** `web/src/render/circuit.test.ts` (+12: parsing, SI, 1-2-5 both ways, typed values, label text and arrows on the example, placement on the side facing the circuit, summary, shapes for revealed/hidden/empty, JSON props). Web 449 passed, `tsc -b` clean, build exit 0. **Headless Chrome**, dev page -> local server (`MOCK=1`, real solver), the stored sketch on the canvas + `circuit_figure.json` applied over it: labels on the wires/symbols (9 V, 6 V, 3 mA → / ↑ / ↓); **R2 -> 4k: card + every label updated (7.2 V, 1.8 mA) in 275 ms incl. the 250 ms debounce; only `/api/circuit/solve` was called, no `/api/check`**; stepper 4k -> 5k gives 1.5 mA; Reset -> 3 mA; R2 = 0 -> "R2: resistance must be positive", keeps 3 mA; after a **reload** the card still shows 4 kΩ / 1.8 mA and the labels 7.2 V / 1.8 mA; hidden example: "?" x3, unlock text, 0 labels, 0 solver calls after an edit; no console errors. · paid calls: 0 this task, 4 total
**How to try it:** `cd web && API_TARGET=https://tutor-api-eng-191803288552.us-central1.run.app npm run dev -- --host --port 5174`, open `/?dev`, write anything, tap `circuit_figure.json` (positions match the example's sketch, not your ink).
**Next:** 6. Units checker
**Need from Parsh:** nothing

## 12:26 AM PARSH-ENG-AGENT · DONE
**Task:** 6. Units checker
**What I built:** `server/units.py` `check_units(expression)`: splits on `=`, skips sides that are only a name (`F`), converts every side with a number to SI base units with `sympy.physics.units` (unit names mapped whole, so the `m` in `mA` is never metres), and requires the same dimension and, with numbers, the same value (1%). Details name the unit a student knows: "`19.6*N` is N (kg*m/s^2)". Unreadable -> `unknown`; never raises. Registered in `teach.py` as the `check_units` tool; its verdict goes into `result.verdicts` (correct wins, like `verify_step`), so the guard handles it the same way. `read.md`: physics lines keep units in `plain` as written (wrong ones too). `tutor.md` "Units": call `check_units` (not `verify_step`, which would read kg/m/N as letters), mark only `incorrect`, the hint asks about the unit, not the number. `tutor-api-eng` redeployed (`00002-jmj`).
**Tests:** `test_units.py` (+19: E-4, right dimension + number, wrong number (2% off) vs within 1%, mA·kΩ = V, V·mA = mW, km/h·h = km, m/s = km/h, energy, missing units, 6 unreadable -> unknown), `test_units_teach.py` (+3: an incorrect verdict keeps the red mark; a correct one drops a red circle; tool offered). Server 355 passed / 5 live skipped. **Demo E-4 live on tutor-api-eng** (1 paid check, 7.1 s): read `F = 2*kg * 9.8*m/s = 19.6*N` -> `check_units(L1) = incorrect` -> red circle on the middle part + **"What are the units of acceleration?"**. Image stored as `server/tests/data/units_e4.png`. · paid calls: 1 this task, 5 total
**How to try it:** write `F = 2 kg · 9.8 m/s = 19.6 N` on the dev page (pointed at tutor-api-eng) and pause.
**Next:** 7. Free-body diagrams
**Need from Parsh:** nothing

## 12:33 AM PARSH-ENG-AGENT · DONE
**Task:** 7. Free-body diagrams (3D stretch not done yet; core tasks first)
**What I built:** `server/forces.py` `check_forces(forces, givens, accel, expected)`: SymPy component sums; magnitudes are numbers, expressions in the givens ("m*g", "mg sin(30)"), the label itself ("mg" with m, g given) or unknown; solves ΣF = m·a for the unknowns. If they can't balance (or only with a negative push), returns the leftover and `missing_angle_deg` (where the missing force must point); `expected` (the tutor's list) is solved the same way for hint 3. Nothing with a size -> `unknown` (no fake "balanced" with every force 0). Never raises. `teach.py` tool `check_forces(fbd_line_id, givens, accel?, expected)`: the DRAWN forces come from the read line in code, not the model; result kept in `TeachResult.fbd`, verdict in `result.verdicts`. `engineering.parse_fbd` / `fbd_figures` (from `guard.merge`): help at hint 2+ -> clean diagram with `expected` (missing forces dashed); balanced -> green "Nice: these forces balance." + clean diagram; no circle around a whole drawing (the question stays). `read.md` "Force diagrams" (ONE line, `{"fbd": ...}`, angles from +x, never add a force the student left out); `tutor.md` "Force diagrams" (ladder; level 1 must not name the force). Web: `web/src/render/fbd.ts` -> SVG (ramp at its angle with the angle marked, block turned to the slope, solid drawn arrows, dashed blue "f?" for missing ones), drawn and placed like a plot2d via `render/figure.ts`.
**Tests:** `test_forces.py` (+13: E-5 ramp at rest is missing 9.8 N at 30°; with friction balances f = 9.8 / N = 16.97; frictionless ramp accelerating at g·sin30 = m·a; wrong acceleration; flat floor N = 19.6; a written 15 N caught; hanging mass T = 23.6; "mg sin(30)"; a push can't pull; label "mg" counts; nothing sized -> unknown; 3 unreadable), `test_fbd_teach.py` (+7 through teach + guard). `fbd.test.ts` (+6). Server 375 / 5 live skipped; web 455, `tsc` clean. `?dev` -> `fbd.json`: diagram renders (screenshot checked), no console errors. **Demo E-5 live on tutor-api-eng** (4 paid checks; sketch `server/tests/data/fbd_e5.png`): read the diagram exactly (ramp 30°, N 120°, mg 270°; "at rest", "m = 2 kg" as givens); auto: `check_forces = incorrect`, "What keeps the block from sliding down the ramp?"; Help 2: clean diagram, drawn [N, mg], expected [mg, N, f] (friction dashed); Help 3: "f = mg sin 30° = 9.8 N up the ramp" (+ spoken). Found 2 things and fixed them offline (no re-run): hint 1 had said "think about the friction force" (prompt now forbids naming it at level 1), and auto drew a red circle around the whole sketch (removed for force diagrams). · paid calls: 4 this task, 9 total
**How to try it:** dev page on tutor-api-eng: draw a block on a ramp with only gravity and normal, write "at rest", tap Help 3 times.
**Next:** merge main (Preet's 6ea3d5c), then 8. engineering demo harness
**Need from Parsh:** nothing

## 12:49 AM PARSH-ENG-AGENT · DONE
**Task:** 8. Engineering demo harness
**What I built:** `web/e2e/demo_eng.mjs`: draws E-1 to E-5 with pen strokes (`lib.mjs`): zigzag resistors, a two-plate battery, wires, labels, a ramp with a block sitting on the slope and arrows; runs them on the dev page against `tutor-api-eng`, checks each promise, stops before `MAX_PAID = 8`, writes `web/e2e/RESULTS_ENG.md`; screenshots in `web/e2e/eng/`. E-2/E-3 can run alone (`node web/e2e/demo_eng.mjs 2 3`: circuit drawn with the right answer, 1 check). E-5 is judged by the hint level each reply carries (the page prefetches hints on its own). **Bug found by the run and fixed:** Gemini put the missing friction at 150° in `expected` (dashed arrow pointing up-LEFT; up the slope is 30°). `engineering.fix_missing_direction`: when exactly one expected force is missing, its direction comes from `check_forces` (where the leftover must be cancelled), then the expected set is re-checked; the tool tells the model. `tutor-api-eng` now `00005-zrj`.
**Tests:** **live: E-1 PASS** (red circle + "What is the total resistance of the two resistors in series?", 7.8 s), **E-2 PASS** (no red, labels 9 V / 6 V / 3 mA ↑ → ↓, card "I = 3 mA", 5.0 s), **E-3 PASS** (R2 -> 4k: "I = 1.8 mA", labels 7.2 V / 1.8 mA, **0 /api/check**, 431 ms incl. debounce), **E-4 PASS** ("What are the units of acceleration?", 4.3 s), **E-5: server ladder correct per `/api/debug/recent`** (hint 1 doesn't name friction; hint 2 the clean diagram with f dashed; hint 3 "f = mg sin 30° = 9.8 N up the incline"), harness had mis-paired taps (fixed); direction bug fixed + offline test, not re-run live. Pre-run: two free dry runs on the mock server caught a block drawn inside the ramp, a clipped "m = 2 kg", and a units line too wide for one capture window (it cost 2 checks); all fixed before paying. Server 377 / 5 live skipped. · paid calls: 8 this task (2 on a first run that crashed after E-1: Puppeteer has no `textContent`/`fill`; then 6), 17 total
**How to try it:** see the run line at the top of `web/e2e/demo_eng.mjs`.
**Next:** 9. Docs
**Need from Parsh:** nothing. FYI for Preet's side (Part 1, `main`): the note renderer shows `\sin 30^\circ` as "sin 30^\." (seen in E-5 hint 3).

## 12:50 AM PARSH-ENG-AGENT · DONE
**Task:** 9. Docs
**What I built:** `docs/ENGINEERING.md` "What really works": status per feature (E1–E3, E5, E6 work; E4 is covered by Part 1's low-confidence `ask`, no card variant; E7 3D not built), measured times, reading accuracy, paid calls so far; "Changes to the spec, and why" (reveal only after a checked-correct answer or hint 3, hidden figures carry no solution; re-send only on change; figures decided in code; "solve" is a request; arrows follow the wires, labels face the circuit's middle; the missing force's direction comes from physics; no circle around a whole diagram; label-as-size and no fake balance; solve endpoint answers bad input with 200); "Known limits". `docs/DEMO.md` (this branch only): "(e) Engineering demo": how to start the dev page on tutor-api-eng, the iPad URL, and exact steps for E-1 to E-5 with what should happen, the time, and what to do if it doesn't.
**Tests:** docs only. · paid calls: 0 this task, 17 total
**How to try it:** `docs/DEMO.md` section (e).
**Next:** 10. Merge gate (merge Preet's 7ccc1fa first)
**Need from Parsh:** nothing yet; task 10 needs you on the iPad for E-1, E-2, E-3.

## 1:00 AM PARSH-ENG-AGENT · WORKING ON
**Task:** 10. Merge gate: **4 of 5 met. Not READY TO MERGE yet: waiting for Parsh's iPad run of E-1, E-2, E-3.**
**What I built:** merged `origin/main` @ 7ccc1fa into `engineering` (one conflict in `web/src/render/figure.ts`, both sides' imports kept). `tutor-api-eng` redeployed from the merged branch (`00006-67x`). Dev page for the iPad is running: `http://10.0.0.65:5174/?page=eng-1` (laptop, same wifi; `API_TARGET` = tutor-api-eng).
**Tests / gate:**
- [x] `engineering` merged up to date with `origin/main`; server 377 passed / 5 live skipped; web 463 passed; `tsc -b` clean; `npm run build` exit 0.
- [x] Part 1's demo set against `tutor-api-eng` (`node web/e2e/demo.mjs` with `API_TARGET`): **5/5 PASS** (wrong derivative, sign error, wrong integral, correct work, graph), same feedback as production. Part 2 doesn't break Part 1.
- [ ] Demos E-1, E-2, E-3 on the iPad through the dev page: **Parsh**, steps in `docs/DEMO.md` section (e). (The harness passed them live; see `web/e2e/RESULTS_ENG.md`.)
- [x] Old saved pages + pages with no engineering content load without errors on the engineering page: a Part 1 page saved by main at 4:45 PM (`e2e_mwgztebm`) loads (draw + note + circle), no check sent on load, no console errors; a Part 1 page saved by the engineering page reloads; a page with a circuit card reloads with the card and its 5 labels.
- [x] **What changes on the live site if merged** (below).
**What would change on the live site if merged** (humans decide):
1. **Hosting first** (`firebase deploy --only hosting` from the merged `main`), **then Cloud Run** `tutor-api` (tagged no-traffic, test, promote). Hosting first so the page already knows the new `circuitcard` shape and the `circuit`/`fbd` figure kinds when the server starts sending them. (The current live page ignores unknown figure kinds, so neither order crashes.)
2. Cloud Run `tutor-api`: new `POST /api/circuit/solve` (no Gemini); new tools `check_units`, `check_forces`; `read.md` additions (circuit element boxes + node points, units kept in `plain`, force diagrams as one line); `tutor.md` sections (Units, Force diagrams, Circuit figures); `guard.py` builds circuit/fbd figures in code. No new env vars, no new Python packages (`sympy.physics.units` ships with SymPy). Firestore rules unchanged.
3. Hosting: new tldraw shape `circuitcard` (what-if card), x-ray labels, `fbd` diagrams; `firebase.json` unchanged.
4. **Saved pages:** today, a page that was used on the engineering dev page (has a `circuitcard`) opens EMPTY on the live site (tldraw can't load an unknown shape). It is NOT overwritten (checked: the card was still in Firestore after the live page opened it). After the Hosting deploy it loads normally. Until then use separate `?page=` names for engineering rehearsals.
5. Rollback: Cloud Run to the previous revision; Hosting to the previous release (Firebase console -> Hosting -> release history).
**Paid calls:** 5 this task, **22 of 40 total**.
**Next:** stop. When Parsh posts that E-1..E-3 passed on the iPad, I post READY TO MERGE. If one fails, I fix it on this branch.
**Need from Parsh:** run E-1, E-2, E-3 on the iPad at http://10.0.0.65:5174/?page=eng-1 (steps: `docs/DEMO.md` (e)) and tell me what you see.

## 1:12 AM PARSH-ENG-AGENT · WORKING ON
**Task:** 10. Merge gate: Parsh's manual run (1:06 to 1:10 AM)
**What I built:** nothing.
**Tests:** Parsh ran the demos by hand on the dev page (`localhost:5174/?page=eng-1`, laptop browser with mouse/trackpad, not yet the iPad), against tutor-api-eng, freehand drawing (battery drawn as a box, labels "R=1k" / "R=2k"):
- **E-1 PASS:** `I = 9mA` -> red circle + "What is the total resistance of R1 and R2 in series?"; the card appeared with "?" and "Write your answer to unlock".
- **E-2 PASS:** fixed to `I = 3mA` -> red cleared; x-ray labels on his drawing: 9 V, 6 V, 3 mA → (R1), 3 mA ↑ (battery), 3 mA ↓ (R2); card "I = 3 mA". "Show what AI read": "circuit: V1 = 9V, R1 = 1kΩ, R2 = 2kΩ", "I = 3mA"; status "read 2 lines, 1 action (figure), 6.0 s".
- **E-3 PASS:** R2 stepped to 5 kΩ -> card + every label 1.5 mA, node 7.5 V (9 V / 6 kΩ: correct).
- E-4 PASS: `F = 2 kg · 9.8 m/s = 19.6 N` -> circled + "What are the units of acceleration?".
- E-5 partly: freehand ramp + N + mg (no "at rest"/"m = 2 kg" written) -> auto checks `check_forces = unknown` (no force has a size: correctly no fake balance, no marks); Help 1: "What keeps the block from sliding down the ramp? Think about the surface contact." (doesn't name friction). Hints 2/3 not shown in his screenshots.
· paid calls: about 6-8 for his run (the debug log only keeps the latest per instance), so **about 29 of 40 total**.
**How to try it:** n/a
**Next:** if Parsh accepts the laptop run for the gate's "on the iPad" item (or runs E-1..E-3 once on the iPad), I post READY TO MERGE and stop.
**Need from Parsh:** iPad run of E-1..E-3, or say the laptop run counts.
