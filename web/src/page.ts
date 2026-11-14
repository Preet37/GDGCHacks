import type { Editor, TLShape } from 'tldraw'
import { isAiShape } from './render/actions'
import type { PageRect } from './render/geometry'
import { isWorksheetShape } from './worksheet'

export const EXPORT_PADDING = 32
/** With a worksheet underneath, how much printed context around the handwriting to include. */
export const WORKSHEET_CONTEXT = 240

/** Everything on the page that isn't tutor feedback: handwriting, plus any imported worksheet. */
export function studentShapes(editor: Editor): TLShape[] {
  return editor.getCurrentPageShapes().filter((s) => !isAiShape(s))
}

export function union(a: PageRect | null, b: PageRect | null): PageRect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function intersect(a: PageRect, b: PageRect): PageRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const w = Math.min(a.x + a.w, b.x + b.w) - x
  const h = Math.min(a.y + a.h, b.y + b.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

function grow(r: PageRect, pad: number): PageRect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
}

/**
 * Page-space area to export. Plain page: all student shapes + padding. With a worksheet:
 * the handwriting plus some printed context around it (so a long PDF doesn't shrink the
 * handwriting to mush at 1280 px), plus the Help selection if there is one.
 */
export function exportArea(ink: PageRect | null, sheets: PageRect | null, help?: PageRect): PageRect | null {
  if (!sheets) {
    const all = union(ink, help ?? null)
    return all && grow(all, EXPORT_PADDING)
  }
  const focus = union(ink && grow(ink, WORKSHEET_CONTEXT), help ?? null)
  if (!focus) return grow(sheets, EXPORT_PADDING)
  const everything = grow(union(ink, sheets)!, EXPORT_PADDING)
  return intersect(focus, everything) ?? focus
}

function boundsOf(editor: Editor, shapes: TLShape[]): PageRect | null {
  let box: PageRect | null = null
  for (const s of shapes) {
    const b = editor.getShapePageBounds(s)
    if (b) box = union(box, { x: b.x, y: b.y, w: b.w, h: b.h })
  }
  return box
}

export function studentBounds(editor: Editor, shapes = studentShapes(editor), help?: PageRect): PageRect | null {
  const sheets = shapes.filter(isWorksheetShape)
  const ink = shapes.filter((s) => !isWorksheetShape(s))
  return exportArea(boundsOf(editor, ink), boundsOf(editor, sheets), help)
}
