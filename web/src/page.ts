import type { Editor, TLShape } from 'tldraw'
import { isAiShape } from './render/actions'
import type { PageRect } from './render/geometry'

export const EXPORT_PADDING = 32

/** Everything on the page that isn't tutor feedback: handwriting, plus any imported worksheet. */
export function studentShapes(editor: Editor): TLShape[] {
  return editor.getCurrentPageShapes().filter((s) => !isAiShape(s))
}

/** Page-space area we export: the student's shapes plus a bit of padding. */
export function studentBounds(editor: Editor, shapes = studentShapes(editor)): PageRect | null {
  let box: PageRect | null = null
  for (const s of shapes) {
    const b = editor.getShapePageBounds(s)
    if (!b) continue
    if (!box) {
      box = { x: b.x, y: b.y, w: b.w, h: b.h }
      continue
    }
    const x = Math.min(box.x, b.x)
    const y = Math.min(box.y, b.y)
    box = { x, y, w: Math.max(box.x + box.w, b.x + b.w) - x, h: Math.max(box.y + box.h, b.y + b.h) - y }
  }
  if (!box) return null
  return {
    x: box.x - EXPORT_PADDING,
    y: box.y - EXPORT_PADDING,
    w: box.w + EXPORT_PADDING * 2,
    h: box.h + EXPORT_PADDING * 2,
  }
}
