# Handwriting: the tutor writes in the student's own hand

Behind the "Write in my handwriting" chip (off by default). When it can't imitate the hand yet, every
function here returns `null` / does nothing and the caller draws text the usual way.

## Wiring (4 places)

```ts
import { HandwritingToggle, handForAction, harvestGlyphs } from './handwriting'
```

1. **Server** (`server/main.py`): `import glyphs` and `app.include_router(glyphs.router)`.
   Model: `GLYPHS_MODEL`, else `GEMINI_MODEL`. Use the full Flash model, not flash-lite (see Accuracy).

2. **Toggle** (`HelpButton.tsx`, next to "Show what AI read"): `<HandwritingToggle editor={editor} />`.
   With `editor` it starts learning from the page as soon as it is switched on.

3. **Learn** (`sync/tutor.ts`, after a check reply has been applied): `void harvestGlyphs(this.editor)`.
   Don't await it. It does nothing when the toggle is off, when a request is already running, or when
   fewer than 3 student strokes are new since the last time; each stroke is sent at most once.
   Optional: `harvestGlyphs(editor, { area })` with the page rect that was sent for the check.

4. **Write** (`render/apply.ts`, where shapes are made):

   ```ts
   const shapes = response.actions.flatMap((a) => (handForAction(editor, a, bounds, ctx) ? [] : shapesForAction(a, bounds, ctx)))
   ```

   `handForAction` handles an inline note (the tutor finishing a line) and a `solution` (steps written
   one under another below the line). Anything else, toggle off, or hand not known yet: `null`.
   Also add `'hand'` to `MARK_KINDS` in `apply.ts` if handwriting should be replaced by place as
   well as by `line_id` (it is already replaced/cleared by `line_id`).

Lower level, if you place things yourself:

```ts
const at = placeAfter(editor, lineRect)            // { x, baseline, xHeight, anchor } straight after the line's ink
const r = writeInHand(editor, '3 x^{2} + 2', { ...at, line_id })   // HandResult | null
writeLinesInHand(editor, steps, { x, baseline, xHeight, line_id }) // all lines or null
```

`HandResult` = `{ ids, rect, mode: 'hand' | 'font', done: Promise<boolean> }`. Strokes are drawn one
after another at pen speed (`{ animate: false }` for all at once). If the line is cleared mid-writing
the rest is dropped and `done` resolves `false`.

## What it does

- **harvest.ts**: exports the new student strokes as a PNG (`exportPng`), `POST /api/glyphs` returns a box per
  character, **assign.ts** gives each pen stroke to the box holding most of its points (strokes through
  several boxes are dropped along with those characters; equals/minus signs the model missed are picked
  up from the leftover flat strokes), **lines.ts** finds each line's baseline, x-height and exponents and
  stores every character as strokes in x-heights from the baseline, **bank.ts** keeps up to 5 samples per
  character plus the hand's gaps, lean, digit height and letter width in `localStorage['tutor.glyphs.v1']`
  (one bank per device).
- **layout.ts**: text goes through `mathToPlain`, then one glyph per character: a learned sample (never the
  same one twice running), slight random size/turn/baseline changes, the student's own gaps, exponents
  at 62% raised.
- **hershey.ts**: characters not learned yet come from an embedded single-stroke font (Hershey Simplex,
  public domain), leaned, widened and sized like the hand.
- **write.ts**: real tldraw `draw` shapes in the student's pen (colour, size, pen flag from their newest
  stroke near the line), `meta: { ai: true, line_id, kind: 'hand', ax, ay, aw, ah }`: not exported to the
  server, not learned from, cleared with the line.

## The fallback rule (`chooseMode`)

- fewer than 6 different characters learned, or a character neither the bank nor the font has, or a line break: `null` (nothing drawn)
- at least 60% of the string's characters are in the bank: `'hand'`, font only for the missing ones
- less: `'font'`, the whole string in the stroke font shaped like the hand (operators still the student's own)

## Accuracy of the boxes (real Pencil ink, 4 recorded pages, 59 characters)

| model | found | wrong label | boxes |
|---|---|---|---|
| gemini-3.5-flash, thinking low | 55/59 (93%) | 0 | tight; all 4 misses were `=` |
| gemini-3.5-flash-lite, thinking low (2 pages) | 27/32 | 0 | usable; misses every `=` and `-` |
| gemini-3.5-flash-lite, thinking minimal (2 pages) | 27/32 | 3 invented | loose, off by up to half a character |

With the flash boxes, and the ink blobs of those PNGs standing in for strokes, assignment kept 58 of 59
characters (the 4 missed `=` were recovered from leftover strokes; one prime touching a bracket was lost),
split all 8 lines correctly and recognised all 4 exponents.

## Not verified

Real Pencil stroke data on an iPad (the recordings are images only): point density, pressure, joined-up
writing, and whether a replayed sample looks right at pen thickness. Test page-side changes with
`?dev` and a harness that injects `draw` shapes and stubs `/api/glyphs`.
