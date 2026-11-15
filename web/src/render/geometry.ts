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
  /** the tutor finishing the student's line: ~75% of the line height */
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
    inlineFont: fit(h * 0.75, MIN_SCREEN_FONT, 0.14),
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
 * quartile of stroke heights (dots and dashes are shorter than the text) plus room for
 * ascenders, never more than the box.
 */
export function textHeight(line: PageRect, ink?: PageRect[]): number {
  const hs = strokesIn(line, ink)
    .map((s) => s.h)
    .filter((v) => v > 0)
    .sort((a, b) => a - b)
  if (hs.length < 3) return line.h
  return Math.min(line.h, hs[Math.floor((hs.length - 1) * 0.75)] * 1.4)
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

/**
 * Where to put something next to `anchor`. `sizes` are the shapes it may take, best first
 * (a note: its normal width, then narrower and taller). The requested side is tried first,
 * then right, below, above; the first spot that covers nothing and stays on screen wins,
 * otherwise the least crowded one. The viewport only counts if the anchor is on screen.
 */
export function placeBeside(
  anchor: PageRect,
  sizes: { w: number; h: number }[],
  preferred: Side,
  gap: number,
  ctx: RenderContext = DEFAULT_CONTEXT,
): PageRect {
  const obstacles = [...(ctx.ink ?? []), ...(ctx.taken ?? [])]
  const view = ctx.view && overlapArea(ctx.view, expand(anchor, 1)) > 0 ? ctx.view : undefined
  const sides: Side[] = [preferred, ...(['right', 'below', 'above'] as Side[]).filter((s) => s !== preferred)]
  let best: PageRect | null = null
  let bestCost = Infinity
  for (const size of sizes) {
    for (const side of sides) {
      const r = sideRect(anchor, side, size.w, size.h, gap)
      const cost = crowding(r, obstacles, view)
      if (cost === 0) return r
      if (cost < bestCost) {
        best = r
        bestCost = cost
      }
    }
  }
  return best ?? sideRect(anchor, preferred, sizes[0]?.w ?? 0, sizes[0]?.h ?? 0, gap)
}

/** Rough size of `text` wrapped to `width` at `font` px in the handwriting font. */
export function estimateText(text: string, font: number, width: number): { w: number; h: number } {
  const perLine = Math.max(1, Math.floor(width / (font * CHAR_EM)))
  let lines = 0
  for (const para of text.split('\n')) lines += Math.max(1, Math.ceil(para.length / perLine))
  return { w: width, h: lines * font * TEXT_LINE_HEIGHT }
}
