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
export function beside(rect: PageRect, side: 'right' | 'below', gap: number): { x: number; y: number } {
  return side === 'below' ? { x: rect.x, y: rect.y + rect.h + gap } : { x: rect.x + rect.w + gap, y: rect.y }
}
