# Engineering demo results

Run 2026-11-15, about 12:45 AM · dev page (`npm run dev`, `API_TARGET` = Cloud Run `tutor-api-eng`, never production) ·
real pen strokes via `web/e2e/lib.mjs` (zigzag resistors, two-plate battery, ramp + block + arrows) · harness
`web/e2e/demo_eng.mjs` · screenshots in `web/e2e/eng/`.

**Result: E-1, E-2, E-3, E-4 pass. E-5 passes on the server; one bug found in it and fixed (not re-run live).**
Paid `/api/check` calls for this task: 8 (2 on a first run that crashed on a harness bug after E-1, then 6).

| Demo | What | Result | What happened | Time |
| --- | --- | --- | --- | --- |
| E-1 | 9 V, 1 kΩ + 2 kΩ in series, `I = 9 mA` | PASS | `solve_circuit(L1) = ok; L2=incorrect` → red circle + "What is the total resistance of the two resistors in series?" | 7.8 s |
| E-2 | Same circuit, `I = 3 mA` | PASS | `L2=correct`, no red; x-ray labels on the drawing `9 V`, `6 V`, `3 mA ↑` (battery), `3 mA →` (R1), `3 mA ↓` (R2); what-if card "I = 3 mA" | 5.0 s |
| E-3 | On the card, R2 → 4 kΩ | PASS | card "I = 1.8 mA", labels `7.2 V` and `1.8 mA` ×3, **0 `/api/check` calls** | 431 ms incl. 250 ms debounce |
| E-4 | `F = 2 kg * 9.8 m/s = 19.6 N` | PASS | read `F = 2*kg * 9.8*m/s = 19.6*N`, `check_units(L1) = incorrect` → red circle + "What are the units of acceleration?" | 4.3 s |
| E-5 | Block on a 30° ramp, only `mg` and `N`, "at rest", "m = 2 kg"; Help ×3 | PASS (server) / see notes | auto: `check_forces = incorrect`, "…what force stops it from sliding…"; hint 1 (level 1): "What force grips the surface and prevents it from sliding?" (doesn't name friction); hint 2 (level 2): clean diagram, drawn [N, mg], expected [N, mg, f], "Here's your diagram with the missing friction force dashed"; hint 3 (level 3): "f = mg sin 30° = (2)(9.8)(0.5) = 9.8 N up the incline" | 4.5–5.8 s per hint |

Notes on E-5:

- The harness first reported FAIL: the page prefetches the next hint on its own (Part 1's hint chain), so the
  harness matched taps to the wrong replies. The server's own log (`/api/debug/recent`) shows the ladder was exactly
  right, level by level. `demo_eng.mjs` now judges the ladder by the hint level each reply carries.
- **Bug found and fixed:** Gemini's `expected` list put friction at 150°, so the dashed arrow pointed up and to the
  LEFT. Up the slope is 30°. Now, when exactly one expected force is missing, the server takes its direction from
  `check_forces` (where the leftover force must be cancelled), not from the model (`engineering.fix_missing_direction`,
  test `test_a_wrong_direction_for_the_missing_force_is_corrected_by_physics`). Verified offline; not re-run live
  because this task's 8 paid calls were used.
- Part 1 display glitch seen in the hint-3 note: `\sin 30^\circ` showed as "sin 30^\." (note text renderer on
  `main`, reported to Preet's side).
