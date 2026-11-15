import type { Editor } from 'tldraw'
import type { Action } from '../contract'
import { isInlineNote, lineRect } from '../render/actions'
import { boxToPage, DEFAULT_CONTEXT, TEXT_LINE_HEIGHT, type PageRect, type RenderContext } from '../render/geometry'
import { solutionLayout } from '../render/solution'
import { getBank, metricsOf } from './bank'
import { handwritingEnabled } from './enabled'
import { layoutText } from './layout'
import { placeAfter, writeInHand, writeLinesInHand, type HandResult, type WriteOptions } from './write'

/**
 * Draw one tutor action in the student's handwriting, if it is one that should be and can be:
 * - a note that finishes the student's line (`side: "inline"`) is written straight after the line;
 * - a `solution` is written step under step below the line.
 *
 * Returns null, having drawn nothing, when the toggle is off, the action is of another kind, or
 * the hand isn't known well enough yet: the caller then draws the action the usual way. Same
 * arguments as `shapesForAction`; the space used is added to `ctx.taken`.
 */
export function handForAction(editor: Editor, action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT, opts: WriteOptions = {}): HandResult | null {
  if (!handwritingEnabled()) return null
  const inline = action.type === 'note' && !!action.text && isInlineNote(action)
  const solution = action.type === 'solution' && !!action.steps?.length
  if (!inline && !solution) return null
  const line = lineRect(action, bounds, ctx) ?? (action.box ? boxToPage(action.box, bounds) : null)
  if (!line || !(line.w > 0) || !(line.h > 0)) return null

  const after = placeAfter(editor, line)
  const edge = ctx.view ? ctx.view.x + ctx.view.w - after.xHeight * 0.5 : Infinity
  let result: HandResult | null
  if (inline) {
    const room = edge - after.x
    result = writeInHand(editor, action.text!, { ...after, line_id: action.line_id, anchor: line, maxWidth: room > 0 && Number.isFinite(room) ? room : undefined }, opts)
  } else {
    // same place the text version would go (under the line, equals signs lined up, clear of ink and
    // print: see solutionLayout), measured with this hand's own character widths
    const bank = opts.bank ?? getBank()
    const u = after.xHeight
    const width = (text: string) => (text.trim() ? (layoutText(text, bank, { ...opts, seed: 1 })?.width ?? text.trim().length * 0.8) * u : 0)
    const lay = solutionLayout(action, bounds, { ...ctx, taken: [...(ctx.taken ?? [])] }, width)
    if (!lay || lay.steps.length !== action.steps!.filter((t) => t.trim()).length) return null
    const cap = metricsOf(bank).cap
    const first = lay.steps[0]
    const room = edge - lay.rect.x
    result = writeLinesInHand(
      editor,
      action.steps!,
      {
        x: first.x,
        xs: lay.steps.map((st) => st.x),
        baseline: first.y + (lay.font * TEXT_LINE_HEIGHT) / 2 + (cap * u) / 2,
        lineGap: lay.pitch / u,
        xHeight: u,
        line_id: action.line_id,
        anchor: line,
        maxWidth: room > 0 && Number.isFinite(room) ? room : undefined,
      },
      opts,
    )
  }
  if (result) ctx.taken?.push(result.rect)
  return result
}
