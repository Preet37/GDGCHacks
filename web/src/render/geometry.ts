import type { Box } from '../contract'

/** A rectangle in tldraw page space. */
export interface PageRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Convert a contract Box ([ymin, xmin, ymax, xmax], 0-1000 over the sent image)
 * into page space, given the page-space bounds of the exported image.
 */
export function boxToPage(box: Box, bounds: PageRect): PageRect {
  const [ymin, xmin, ymax, xmax] = box
  const x = bounds.x + (xmin / 1000) * bounds.w
  const y = bounds.y + (ymin / 1000) * bounds.h
  return {
    x,
    y,
    w: ((xmax - xmin) / 1000) * bounds.w,
    h: ((ymax - ymin) / 1000) * bounds.h,
  }
}

/** Inverse of boxToPage: a page-space rect expressed as a Box over `bounds`. */
export function pageToBox(rect: PageRect, bounds: PageRect): Box {
  const clamp = (v: number) => Math.round(Math.min(1000, Math.max(0, v)))
  return [
    clamp(((rect.y - bounds.y) / bounds.h) * 1000),
    clamp(((rect.x - bounds.x) / bounds.w) * 1000),
    clamp(((rect.y + rect.h - bounds.y) / bounds.h) * 1000),
    clamp(((rect.x + rect.w - bounds.x) / bounds.w) * 1000),
  ]
}

export function expand(rect: PageRect, pad: number): PageRect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 }
}

/** Top-left point for something placed next to `rect`. */
export function beside(rect: PageRect, side: 'right' | 'below' | 'inline', gap: number): { x: number; y: number } {
  return side === 'below' ? { x: rect.x, y: rect.y + rect.h + gap } : { x: rect.x + rect.w + gap, y: rect.y }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** tldraw text at size 's', scale 1: 18 px font, 1.35 line height (default theme). */
export const BASE_FONT = 18
export const TEXT_LINE_HEIGHT = 1.35
/** tldraw stroke at size 's', scale 1. */
export const BASE_STROKE = 2
/** Line height assumed when an action has no box to measure. */
export const DEFAULT_LINE_H = 60
/** Average glyph width of the handwriting font, in em (for estimating how a note wraps). */
export const CHAR_EM = 0.6

/**
 * How the student is looking at the page while feedback is drawn. Sizes follow the handwriting,
 * and their limits are what reads well on screen at this zoom, never fixed page units.
 */
export interface RenderContext {
  /** screen px per page unit */
  zoom: number
  /** the viewport in page units; missing = unknown (no on-screen placement limits) */
  view?: PageRect
  /** student strokes in page units: used to measure the writing and kept clear of */
  ink?: PageRect[]
  /** other things on the page that feedback must not cover (existing tutor shapes); grows as feedback is placed */
  taken?: PageRect[]
  /** page rect of each line that was read, by line_id: the whole line, where an action's box may be a part of it */
  lines?: Map<string, PageRect>
  /** printed worksheet text that was read (line boxes, page units): feedback is never written over it */
  printed?: PageRect[]
  /** page area of printed worksheet content under a rect, measured on the worksheet image itself (see sheetInk.ts) */
  printedArea?: (r: PageRect) => number
  /** the worksheet pages, in page units: a note with no room on the page goes in the margin beside one */
  sheets?: PageRect[]
  /** parts of the page that are under buttons and panels right now (page units): nothing is placed there */
  chrome?: PageRect[]
}

/** Viewport assumed when none is known, in screen px. */
const DEFAULT_SCREEN = { w: 1024, h: 768 }
export const DEFAULT_CONTEXT: RenderContext = { zoom: 1 }

/** Smallest text the tutor writes, in screen px. */
export const MIN_SCREEN_FONT = 14
const MIN_READING_SCREEN_FONT = 11

function viewSize(ctx: RenderContext): { w: number; h: number } {
  const zoom = ctx.zoom > 0 && Number.isFinite(ctx.zoom) ? ctx.zoom : 1
  return ctx.view && ctx.view.w > 0 && ctx.view.h > 0 ? ctx.view : { w: DEFAULT_SCREEN.w / zoom, h: DEFAULT_SCREEN.h / zoom }
}

/**
 * Sizes for feedback drawn next to one handwritten line, all derived from that line's
 * height in page units so marks stay in proportion with the writing they are about.
 * Font sizes are page-space px; divide by BASE_FONT / BASE_STROKE for a tldraw `scale`.
 */
export interface FeedbackSizes {
  /** hints, asks: ~40% of the line height */
  noteFont: number
  /** the tutor finishing the student's line: ~90% of the line height, so its letters are about as tall as the student's */
  inlineFont: number
  /** small gray "what I read" text: ~22% */
  readingFont: number
  /** page-space wrap width of a note */
  noteWidth: number
  /** space between the line and a note or figure */
  gap: number
  /** space between the end of the line and an inline answer */
  inlineGap: number
  /** padding of a circle around its box, and drop of an underline below it */
  pad: number
  /** circle / underline stroke width */
  stroke: number
  figureW: number
  figureH: number
  /** a lesson card: about half the viewport wide */
  lessonW: number
  lessonH: number
}

export const FIGURE_BASE_W = 360
export const FIGURE_BASE_H = 260
const NOTE_WIDTH_EM = 12
/**
 * Font size of an inline answer over the height of the handwriting (textHeight: a typical stroke
 * plus room for ascenders). The font's digits are ~0.7 em and its small letters ~0.5 em tall, so
 * at 0.9 they come out about as tall as the student's own small letters.
 */
export const INLINE_FONT_RATIO = 0.9

/**
 * `lineH` = height of the handwriting in page units. Every limit is a screen quantity
 * (px at the current zoom, or a fraction of the viewport), so the same writing seen at
 * another zoom gets feedback of the same on-screen proportions.
 */
export function feedbackSizes(lineH: number, ctx: RenderContext = DEFAULT_CONTEXT): FeedbackSizes {
  const h = lineH > 0 && Number.isFinite(lineH) ? lineH : DEFAULT_LINE_H
  const zoom = ctx.zoom > 0 && Number.isFinite(ctx.zoom) ? ctx.zoom : 1
  const px = 1 / zoom // one screen px in page units
  const view = viewSize(ctx)
  const short = Math.min(view.w, view.h)
  /** between `minPx` screen px and `maxFrac` of the viewport's shorter side */
  const fit = (v: number, minPx: number, maxFrac: number) => clamp(v, minPx * px, Math.max(minPx * px, short * maxFrac))

  const noteFont = fit(h * 0.4, MIN_SCREEN_FONT, 0.055)
  const gap = fit(h * 0.25, 10, 0.05)
  // a graph: at least a third of the shorter side of the screen, more beside big writing
  let figureH = clamp(h * 3.5, short / 3, short * 0.6)
  let figureW = (figureH * FIGURE_BASE_W) / FIGURE_BASE_H
  if (figureW > view.w * 0.9) {
    figureW = view.w * 0.9
    figureH = (figureW * FIGURE_BASE_H) / FIGURE_BASE_W
  }
  const lessonW = view.w * 0.5
  return {
    noteFont,
    inlineFont: fit(h * INLINE_FONT_RATIO, MIN_SCREEN_FONT, 0.16),
    readingFont: fit(h * 0.22, MIN_READING_SCREEN_FONT, 0.03),
    noteWidth: Math.min(noteFont * NOTE_WIDTH_EM, view.w * 0.45),
    gap,
    inlineGap: fit(h * 0.3, 8, 0.05),
    pad: gap / 2,
    stroke: fit(h * 0.04, BASE_STROKE, 0.009),
    figureW,
    figureH,
    lessonW,
    lessonH: Math.min(lessonW * 0.8, view.h * 0.85),
  }
}

// ---------------------------------------------------------------------------------------
// Measuring the handwriting
// ---------------------------------------------------------------------------------------

function overlapArea(a: PageRect, b: PageRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Share of the smaller rect that the two have in common (0 to 1). */
export function overlapRatio(a: PageRect, b: PageRect): number {
  const small = Math.min(a.w * a.h, b.w * b.h)
  return small > 0 ? overlapArea(a, b) / small : 0
}

/** Strokes that belong to the writing in `rect` (their centre is inside it). */
export function strokesIn(rect: PageRect, ink: PageRect[] | undefined): PageRect[] {
  if (!ink) return []
  return ink.filter((s) => {
    const cx = s.x + s.w / 2
    const cy = s.y + s.h / 2
    return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h
  })
}

/**
 * Height of the main text of a line. Its box can be much taller than the text (an integral
 * sign, a fraction), so when the strokes are known the typical stroke decides: the upper
 * quartile of stroke heights plus room for ascenders, never more than the box. Flat strokes
 * (the bars of "=", a minus, a fraction line, dots) say nothing about the height of the
 * writing and are left out, or a short line like "x =" would measure as a few pixels tall.
 */
export function textHeight(line: PageRect, ink?: PageRect[]): number {
  const letters = letterHeight(line, ink)
  return letters === null ? line.h : Math.min(line.h, letters * 1.4)
}

/**
 * How tall the student's letters are on this line: the upper quartile of the heights of its
 * upright strokes (flat ones and dots left out). Null if the strokes are not known.
 */
export function letterHeight(line: PageRect, ink?: PageRect[]): number | null {
  const upright = strokesIn(line, ink).filter((s) => s.h > 0 && s.h >= s.w * 0.35)
  if (!upright.length) return null
  const sorted = upright.map((s) => s.h).sort((a, b) => a - b)
  const median = sorted[Math.floor((sorted.length - 1) / 2)]
  const hs = sorted.filter((h) => h >= median * 0.3) // dots
  return hs[Math.floor((hs.length - 1) * 0.75)]
}

/**
 * Top-left of a one-line text of `font` px written straight after `rect`. Vertically it sits on
 * the lower-middle of the box, where the main text of a line runs even when a tall symbol
 * stretches the box upwards; with the strokes known it lines up with the last thing written
 * (the "=") and starts after the last stroke.
 */
export function inlineAt(rect: PageRect, font: number, gap: number, ink?: PageRect[]): { x: number; y: number } {
  let right = rect.x + rect.w
  let centre = rect.y + rect.h * 0.58
  const strokes = strokesIn(expand(rect, gap), ink)
  if (strokes.length) {
    right = Math.max(right, ...strokes.map((s) => s.x + s.w))
    // the trailing strokes: those ending within one text height of the end of the line
    const reach = Math.max(font, gap * 2)
    const tail = strokes.filter((s) => s.x + s.w >= right - reach)
    const top = Math.min(...tail.map((s) => s.y))
    const bottom = Math.max(...tail.map((s) => s.y + s.h))
    centre = clamp((top + bottom) / 2, rect.y + rect.h * 0.3, rect.y + rect.h * 0.8)
  }
  return { x: right + gap, y: centre - (font * TEXT_LINE_HEIGHT) / 2 }
}

// ---------------------------------------------------------------------------------------
// Finding room
// ---------------------------------------------------------------------------------------

export type Side = 'right' | 'below' | 'above'

/** The rect of a `w` x `h` thing placed on `side` of `anchor`. */
export function sideRect(anchor: PageRect, side: Side, w: number, h: number, gap: number): PageRect {
  if (side === 'below') return { x: anchor.x, y: anchor.y + anchor.h + gap, w, h }
  if (side === 'above') return { x: anchor.x, y: anchor.y - gap - h, w, h }
  return { x: anchor.x + anchor.w + gap, y: anchor.y, w, h }
}

function contains(outer: PageRect, r: PageRect): boolean {
  return r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h
}

/** How badly `r` is placed: area over things already there, plus area off screen. 0 = free. */
export function crowding(r: PageRect, obstacles: PageRect[], view?: PageRect): number {
  let cost = 0
  for (const o of obstacles) {
    // a straight stroke has no area of its own: give it a little
    cost += overlapArea(r, { x: o.x, y: o.y, w: Math.max(o.w, 1), h: Math.max(o.h, 1) })
  }
  if (view && !contains(view, r)) cost += r.w * r.h - overlapArea(r, view)
  return cost
}

/** Empty space between two rects (0 if they touch or overlap). */
export function gapBetween(a: PageRect, b: PageRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(dx, dy)
}

/** Everything feedback must not be drawn over: the student's ink, other feedback, printed text that was read. */
function obstaclesOf(ctx: RenderContext): PageRect[] {
  return [...(ctx.ink ?? []), ...(ctx.taken ?? []), ...(ctx.printed ?? []), ...(ctx.chrome ?? [])]
}

/**
 * Area of `r` that lies over writing: ink, feedback already on the page, and printed worksheet
 * text (the lines that were read, and whatever the worksheet image itself shows there). 0 = free.
 */
export function coveredArea(r: PageRect, ctx: RenderContext, obstacles = obstaclesOf(ctx)): number {
  return crowding(r, obstacles) + (ctx.printedArea?.(r) ?? 0)
}

/** The first free `w` x `h` spot going straight down from below `anchor`, past everything in the way. */
function slideBelow(anchor: PageRect, w: number, h: number, gap: number, ctx: RenderContext, obstacles: PageRect[]): PageRect | null {
  const r = { x: anchor.x, y: anchor.y + anchor.h + gap, w, h }
  for (let i = 0; i < 400; i++) {
    const hit = obstacles.filter((o) => overlapArea(r, { x: o.x, y: o.y, w: Math.max(o.w, 1), h: Math.max(o.h, 1) }) > 0)
    if (hit.length) r.y = Math.max(...hit.map((o) => o.y + o.h)) + gap
    else if ((ctx.printedArea?.(r) ?? 0) > 0) r.y += gap
    else return r
  }
  return null
}

/** The free `w` x `h` spot on screen that is nearest to `anchor` (searched on a grid), or null. */
function nearestFree(anchor: PageRect, w: number, h: number, gap: number, view: PageRect, ctx: RenderContext, obstacles: PageRect[]): PageRect | null {
  const inset = gap / 2
  const x0 = view.x + inset
  const y0 = view.y + inset
  const x1 = view.x + view.w - inset - w
  const y1 = view.y + view.h - inset - h
  if (x1 < x0 || y1 < y0) return null
  const step = Math.max(gap, view.w / 64, view.h / 64)
  const spots: { r: PageRect; d: number; skew: number }[] = []
  // the grid passes through the anchor's own left edge and top, so "straight below" and "level with it" are on it
  const startX = x0 + ((((anchor.x - x0) % step) + step) % step)
  const startY = y0 + ((((anchor.y - y0) % step) + step) % step)
  for (let y = startY; y <= y1; y += step) {
    for (let x = startX; x <= x1; x += step) {
      const r = { x, y, w, h }
      // equally near: the one lined up with the anchor (level with it, or straight under it)
      spots.push({ r, d: gapBetween(r, anchor), skew: Math.min(Math.abs(y - anchor.y), Math.abs(x - anchor.x)) })
    }
  }
  spots.sort((a, b) => a.d - b.d || a.skew - b.skew)
  for (const s of spots) {
    if (s.d >= gap * 0.99 && coveredArea(s.r, ctx, obstacles) === 0) return s.r
  }
  return null
}

/** Spots in the margins beside the worksheet page `anchor` is on, level with it: left and right, nearest first. */
function marginSpots(anchor: PageRect, w: number, h: number, gap: number, ctx: RenderContext): PageRect[] {
  const out: PageRect[] = []
  for (const sheet of ctx.sheets ?? []) {
    if (overlapArea(sheet, expand(anchor, 1)) <= 0) continue
    out.push({ x: sheet.x + sheet.w + gap, y: anchor.y, w, h }, { x: sheet.x - gap - w, y: anchor.y, w, h })
  }
  return out.sort((a, b) => gapBetween(a, anchor) - gapBetween(b, anchor))
}

/**
 * Where to put something next to `anchor`. `sizes` are the shapes it may take, best first
 * (a note: its normal width, then narrower and taller). It never goes on top of writing if
 * that can be helped, in this order:
 * 1. beside the anchor: the requested side, then right, below, above;
 * 2. straight below, past whatever is in the way (below the whole working), if that is on screen;
 * 3. the nearest free spot on screen;
 * 4. on a worksheet: the margin beside the page, level with the anchor;
 * 5. straight below everything, even off screen.
 * Only if all of that fails does it take the least bad side. The viewport only counts if the
 * anchor is on screen. A spot away from the anchor is for the caller to join up (a leader line).
 */
export function placeBeside(
  anchor: PageRect,
  sizes: { w: number; h: number }[],
  preferred: Side,
  gap: number,
  ctx: RenderContext = DEFAULT_CONTEXT,
): PageRect {
  const obstacles = obstaclesOf(ctx)
  const view = ctx.view && overlapArea(ctx.view, expand(anchor, 1)) > 0 ? ctx.view : undefined
  const over = (r: PageRect) => coveredArea(r, ctx, obstacles)
  const off = (r: PageRect) => (view && !contains(view, r) ? r.w * r.h - overlapArea(r, view) : 0)
  const sides: Side[] = [preferred, ...(['right', 'below', 'above'] as Side[]).filter((s) => s !== preferred)]
  let best: PageRect | null = null
  let bestCost = Infinity
  for (const size of sizes) {
    for (const side of sides) {
      const r = sideRect(anchor, side, size.w, size.h, gap)
      // covering writing is far worse than hanging off the screen
      const cost = over(r) * 8 + off(r)
      if (cost === 0) return r
      if (cost < bestCost) {
        best = r
        bestCost = cost
      }
    }
  }
  const below = sizes.map((size) => slideBelow(anchor, size.w, size.h, gap, ctx, obstacles))
  for (const r of below) if (r && off(r) === 0) return r
  if (view) {
    for (const size of sizes) {
      const r = nearestFree(anchor, size.w, size.h, gap, view, ctx, obstacles)
      if (r) return r
    }
  }
  for (const size of sizes) {
    for (const r of marginSpots(anchor, size.w, size.h, gap, ctx)) if (over(r) === 0) return r
  }
  return below.find((r) => r) ?? best ?? sideRect(anchor, preferred, sizes[0]?.w ?? 0, sizes[0]?.h ?? 0, gap)
}

/**
 * The two ends of a leader line from something placed at `from` to the writing at `to`: the
 * nearest points of the two rects (edge to edge, never through either).
 */
export function leaderEnds(from: PageRect, to: PageRect): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const axis = (f0: number, f1: number, t0: number, t1: number): [number, number] => {
    if (f0 > t1) return [f0, t1]
    if (f1 < t0) return [f1, t0]
    const mid = (Math.max(f0, t0) + Math.min(f1, t1)) / 2
    return [mid, mid]
  }
  const [ax, bx] = axis(from.x, from.x + from.w, to.x, to.x + to.w)
  const [ay, by] = axis(from.y, from.y + from.h, to.y, to.y + to.h)
  return { a: { x: ax, y: ay }, b: { x: bx, y: by } }
}

/** Rough size of `text` wrapped to `width` at `font` px in the handwriting font. */
export function estimateText(text: string, font: number, width: number): { w: number; h: number } {
  const perLine = Math.max(1, Math.floor(width / (font * CHAR_EM)))
  let lines = 0
  for (const para of text.split('\n')) lines += Math.max(1, Math.ceil(para.length / perLine))
  return { w: width, h: lines * font * TEXT_LINE_HEIGHT }
}
