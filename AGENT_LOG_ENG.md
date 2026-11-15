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
