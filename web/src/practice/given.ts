import type { Action, GivenLine } from '../contract'
import { coverage } from '../page'
import { boxToPage, pageToBox, type PageRect } from '../render/geometry'
import { isGivenShape, practiceRole } from './kind'

export interface PlacedShape {
  meta: Record<string, unknown>
  /** page bounds */
  rect: PageRect
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * The `given` lines for a request that sends window `win`: one per practice line (problem, ask)
 * that is mostly inside it, top to bottom, with its box over the sent image.
 */
export function givenLines(shapes: PlacedShape[], win: PageRect): GivenLine[] {
  return shapes
    .filter((s) => isGivenShape(s) && str(s.meta.latex) && coverage(s.rect, win) > 0.5)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .map((s) => ({ box: pageToBox(s.rect, win), latex: str(s.meta.latex), plain: str(s.meta.plain) || str(s.meta.latex) }))
}

export interface OpenPractice {
  id: string
  /** page bounds of the problem line */
  rect: PageRect
}

/** The practice problems (not yet solved) whose problem line is in the window. */
export function openPractices(shapes: PlacedShape[], win: PageRect): OpenPractice[] {
  return shapes
    .filter((s) => practiceRole(s) === 'problem' && s.meta.solved !== true && str(s.meta.practice_id) && coverage(s.rect, win) > 0.5)
    .map((s) => ({ id: str(s.meta.practice_id), rect: s.rect }))
}

/**
 * Which practice problems a reply says are solved. The server sends a short green note when the
 * final answer under a practice problem is right; the note belongs to the nearest practice problem
 * that starts above it. A note with no box counts only if there is one practice in the window.
 * `win` = the page area the reply's boxes are over.
 */
export function solvedPractices(actions: Action[], open: OpenPractice[], win: PageRect): string[] {
  const out = new Set<string>()
  for (const a of actions) {
    if (a.type !== 'note' || a.color !== 'green' || !open.length) continue
    if (!a.box) {
      if (open.length === 1) out.add(open[0].id)
      continue
    }
    const r = boxToPage(a.box, win)
    const mid = r.y + r.h / 2
    const above = open.filter((p) => p.rect.y <= mid).sort((p, q) => q.rect.y - p.rect.y)
    if (above.length) out.add(above[0].id)
  }
  return [...out]
}
