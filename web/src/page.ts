import type { Editor, TLShape } from 'tldraw'
import { isAiShape } from './render/actions'
import { clamp, type PageRect } from './render/geometry'
import { shapeUse } from './practice/kind'
import { isWorksheetShape } from './worksheet'

export const EXPORT_PADDING = 32
/** With a worksheet underneath, how much printed context around the handwriting to include. */
export const WORKSHEET_CONTEXT = 240

/** Everything on the page that isn't tutor feedback: handwriting, plus any imported worksheet. */
export function studentShapes(editor: Editor): TLShape[] {
  return editor.getCurrentPageShapes().filter((s) => !isAiShape(s))
}

/**
 * Everything that goes into the image sent for a check: the student's shapes, plus the practice
 * problems the tutor wrote for them to work on (see practice/kind.ts). No other tutor shape.
 */
export function checkShapes(editor: Editor): TLShape[] {
  return editor.getCurrentPageShapes().filter((s) => shapeUse(s).exported)
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

// ---------------------------------------------------------------------------------------
// The window: the part of the page that is sent for one check. Never the whole canvas:
// either the working around the strokes that just changed, or what is on screen (Help).
// ---------------------------------------------------------------------------------------

/** A stroke this tall must still be readable in a 1280 px image: the window is at most this many line heights. */
export const LEGIBLE_LINES = 40
/** Ink closer to the working than this many line heights is part of the same working. */
export const NEAR_LINES = 2.5

export function rectOf(b: { x: number; y: number; w: number; h: number }): PageRect {
  return { x: b.x, y: b.y, w: b.w, h: b.h }
}

export function intersects(a: PageRect, b: PageRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

/** Empty space between two rects (0 if they touch or overlap). */
export function rectDistance(a: PageRect, b: PageRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(dx, dy)
}

/** Fraction of `inner` that lies inside `outer` (0 to 1). A zero-area rect counts by its centre. */
export function coverage(inner: PageRect, outer: PageRect): number {
  if (inner.w <= 0 || inner.h <= 0) {
    const cx = inner.x + inner.w / 2
    const cy = inner.y + inner.h / 2
    return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h ? 1 : 0
  }
  const hit = intersect(inner, outer)
  return hit ? (hit.w * hit.h) / (inner.w * inner.h) : 0
}

/**
 * Typical height of a line of writing, from the strokes it is made of: the upper quartile,
 * since many strokes (dots, dashes, small letters) are shorter than the line.
 */
export function lineHeight(strokes: PageRect[]): number {
  const hs = strokes.map((r) => r.h).filter((h) => h > 0).sort((a, b) => a - b)
  return hs.length ? hs[Math.floor((hs.length - 1) * 0.75)] : 0
}

export interface WindowLimits {
  maxW: number
  maxH: number
  /** ink within this distance of the working joins it */
  gap: number
}

/** Limits for a window around writing of height `lineH`, seen through viewport `view`. */
export function windowLimits(lineH: number, view: PageRect): WindowLimits {
  const legible = Math.max(lineH * LEGIBLE_LINES, 600)
  return {
    maxW: Math.min(view.w, legible),
    maxH: Math.min(view.h, legible),
    // between 8% and 20% of the screen, so a jotted dot or one tall stroke doesn't decide it
    gap: clamp(lineH * NEAR_LINES, Math.min(view.w, view.h) * 0.08, Math.min(view.w, view.h) * 0.2),
  }
}

/**
 * Where to look: the newest change, plus older unsent changes as long as they still fit
 * in one window. `changed` is oldest first. Far-away changes are left for a later check.
 */
export function seedRect(changed: PageRect[], lim: WindowLimits): PageRect | null {
  let seed: PageRect | null = null
  for (let i = changed.length - 1; i >= 0; i--) {
    const u: PageRect = union(seed, changed[i])!
    if (!seed || (u.w <= lim.maxW && u.h <= lim.maxH)) seed = u
  }
  return seed
}

/** A drawing (diagram, sketch) reaches this fraction of its size, so writing beside it joins it. */
export const FIGURE_REACH = 0.4

/**
 * How far ink can be from the working and still join it. Handwriting: the usual gap. A big shape
 * (a drawn circuit, a sketched graph) reaches further, up to twice the gap, because answers are
 * written beside or under a drawing rather than one line-height away.
 */
export function reachOf(r: PageRect, lim: WindowLimits): number {
  return Math.max(lim.gap, Math.min(FIGURE_REACH * Math.max(r.w, r.h), lim.gap * 2))
}

/** Grow `seed` over nearby ink (nearest first), never past the size limits. */
export function clusterAround(seed: PageRect, ink: PageRect[], lim: WindowLimits): PageRect {
  let area = seed
  // a perfectly straight stroke has zero height or width; give it some, or coverage() judges it by its
  // centre alone and the window never stretches to its ends
  ink = ink.map((r) => ({ ...r, w: Math.max(r.w, 1), h: Math.max(r.h, 1) }))
  let rest = ink.filter((r) => coverage(r, area) < 1)
  for (;;) {
    const near = rest
      .map((r) => ({ r, d: rectDistance(r, area) }))
      .filter((c) => c.d <= reachOf(c.r, lim))
      .sort((a, b) => a.d - b.d)
    const next = near.find((c) => {
      const u = union(area, c.r)!
      return u.w <= lim.maxW && u.h <= lim.maxH
    })
    if (!next) return area
    area = union(area, next.r)!
    rest = rest.filter((r) => r !== next.r && coverage(r, area) < 1)
  }
}

/** Padding around the working; over a worksheet, also some of the printed text around it. */
export function withContext(working: PageRect, sheets: PageRect[], view: PageRect): PageRect {
  const padded = grow(working, EXPORT_PADDING)
  const under = sheets.filter((s) => intersects(s, padded))
  if (!under.length) return padded
  const mx = Math.max(EXPORT_PADDING, Math.min(WORKSHEET_CONTEXT, view.w * 0.25))
  const my = Math.max(EXPORT_PADDING, Math.min(WORKSHEET_CONTEXT, view.h * 0.25))
  const wide = { x: working.x - mx, y: working.y - my, w: working.w + mx * 2, h: working.h + my * 2 }
  // printed context stops at the edge of the worksheet
  const content = grow(under.reduce<PageRect>((acc, s) => union(acc, s)!, working), EXPORT_PADDING)
  return intersect(wide, content) ?? padded
}

/**
 * Auto check: the working around the strokes that changed since the last send.
 * `changed` oldest first; `ink` = every handwriting shape; `sheets` = worksheet pages.
 * `feedback` = what the tutor has written on the page (notes, graphs). It is not sent, but it
 * joins the working like ink does: a hint under a line pushes the student's next line further
 * down, and without the hint as a stepping stone that line would be sent on its own, where a
 * wrong step can't be told from a new problem.
 */
export function autoWindow(changed: PageRect[], ink: PageRect[], sheets: PageRect[], view: PageRect, feedback: PageRect[] = []): PageRect | null {
  const lineH = lineHeight(changed)
  const lim = windowLimits(lineH, view)
  const seed = seedRect(changed, lim)
  return seed && withContext(withLineAbove(clusterAround(seed, [...ink, ...feedback], lim), ink, lineH, lim), sheets, view)
}

/**
 * How far up (in line heights) to look for the line a new step follows from. Generous because
 * lineHeight() reads short strokes (x, 3, -) and so runs small; capped by ABOVE_MAX_FRACTION.
 */
export const ABOVE_LINES = 6
/** ...but never more than this share of the window height. */
export const ABOVE_MAX_FRACTION = 0.3

/**
 * Add the nearest line of writing directly above the working (it overlaps horizontally), within
 * ABOVE_LINES line heights (at most ABOVE_MAX_FRACTION of the window height). A step can only be checked against the line before it, and students
 * often leave a blank line between steps, which is wider than the normal grouping gap.
 */
export function withLineAbove(area: PageRect, ink: PageRect[], lineH: number, lim: WindowLimits): PageRect {
  const reach = Math.max(lim.gap, Math.min(lineH * ABOVE_LINES, lim.maxH * ABOVE_MAX_FRACTION))
  const above = ink.filter(
    (r) =>
      r.y + r.h <= area.y + 1 &&
      area.y - (r.y + r.h) <= reach &&
      r.x < area.x + area.w &&
      r.x + r.w > area.x,
  )
  if (!above.length) return area
  const nearest = above.reduce((a, b) => (b.y + b.h > a.y + a.h ? b : a))
  const grown = union(area, nearest)!
  if (grown.w > lim.maxW || grown.h > lim.maxH) return area
  return clusterAround(grown, ink, lim) // pull in the rest of that line
}

/** Help: the selection with the working around it, or simply what is on screen. */
export function helpWindow(selection: PageRect | undefined, ink: PageRect[], sheets: PageRect[], view: PageRect): PageRect {
  if (!selection) return rectOf(view)
  const inside = ink.filter((r) => intersects(r, selection))
  const lim = windowLimits(lineHeight(inside.length ? inside : [selection]), view)
  return withContext(clusterAround(selection, ink, lim), sheets, view)
}

// ---------------------------------------------------------------------------------------
// What the student is pointing at when they tap Help without selecting anything.
// ---------------------------------------------------------------------------------------

/**
 * The last thing the student drew: the newest stroke and the strokes drawn just before it that
 * belong with it (the rest of that line of writing; an underline or a circle is one stroke and
 * stands alone). `strokes` = ink in view, oldest first. Walking back in time stops at the first
 * stroke that is on another row or far along the row, so it never swallows the lines above.
 */
export function recentCluster(strokes: PageRect[], lineH: number): PageRect | null {
  if (!strokes.length) return null
  let area = strokes[strokes.length - 1]
  for (let i = strokes.length - 2; i >= 0; i--) {
    const s = strokes[i]
    const cy = s.y + s.h / 2
    const sameRow = cy >= area.y - lineH * 0.5 && cy <= area.y + area.h + lineH * 0.5
    const dx = Math.max(0, s.x - (area.x + area.w), area.x - (s.x + s.w))
    if (!sameRow || dx > lineH * 3) break
    area = union(area, s)!
  }
  return area
}

/**
 * The area to send as `help_box` when nothing is selected: the last thing drawn, stretched up
 * and down by a line height, so that what an underline is drawn under, or what a circle is
 * drawn around, is inside it. Null if there is no ink in view.
 */
export function pointedAt(strokes: PageRect[], view: PageRect): PageRect | null {
  // a line height: from the writing in view, never less than a sliver of the screen (an underline alone has no height)
  const lineH = Math.max(lineHeight(strokes), Math.min(view.w, view.h) * 0.04)
  const c = recentCluster(strokes, lineH)
  return c && { x: c.x, y: c.y - lineH, w: c.w, h: c.h + lineH * 2 }
}
