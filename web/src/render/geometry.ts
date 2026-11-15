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
}

export const FIGURE_BASE_W = 360
export const FIGURE_BASE_H = 260
const NOTE_WIDTH_EM = 12

export function feedbackSizes(lineH: number): FeedbackSizes {
  const h = lineH > 0 && Number.isFinite(lineH) ? lineH : DEFAULT_LINE_H
  const noteFont = clamp(h * 0.4, 18, 64)
  const figureH = clamp(h * 3.5, FIGURE_BASE_H, 720)
  return {
    noteFont,
    inlineFont: clamp(h * 0.75, 18, 160),
    readingFont: clamp(h * 0.22, 12, 32),
    noteWidth: noteFont * NOTE_WIDTH_EM,
    gap: clamp(h * 0.25, 12, 48),
    inlineGap: clamp(h * 0.15, 6, 32),
    pad: clamp(h * 0.12, 8, 24),
    stroke: clamp(h * 0.04, BASE_STROKE, 7),
    figureW: (figureH * FIGURE_BASE_W) / FIGURE_BASE_H,
    figureH,
  }
}

/** Top-left of a one-line text of `font` px written straight after `rect`, centred on it vertically. */
export function inlineAt(rect: PageRect, font: number, gap: number): { x: number; y: number } {
  return { x: rect.x + rect.w + gap, y: rect.y + rect.h / 2 - (font * TEXT_LINE_HEIGHT) / 2 }
}
