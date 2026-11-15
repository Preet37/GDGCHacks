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
