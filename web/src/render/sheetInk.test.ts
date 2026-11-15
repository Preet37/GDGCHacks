import { describe, expect, it } from 'vitest'
import { inkGrid, printedUnder } from './sheetInk'
import { placeBeside } from './geometry'

/** A white `w` x `h` image with black rectangles `[x, y, w, h]` on it. */
function image(w: number, h: number, blocks: [number, number, number, number][]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4).fill(255)
  for (const [bx, by, bw, bh] of blocks) {
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) px.set([20, 20, 20, 255], (y * w + x) * 4)
  }
  return px
}

describe('inkGrid', () => {
  // a 200 x 300 page: a heading, a paragraph and a one-pixel rule
  const px = image(200, 300, [
    [20, 20, 120, 10],
    [20, 100, 160, 40],
    [0, 200, 200, 1],
  ])
  const grid = inkGrid(px, 200, 300, 100)
  const sheet = { x: 1000, y: 500, w: 400, h: 600 } // the page drawn at twice the size, somewhere on the canvas

  it('keeps the page proportions', () => {
    expect(grid.cols).toBe(100)
    expect(grid.rows).toBe(150)
  })

  it('finds print under a rect, in page units, wherever the page is', () => {
    expect(printedUnder(grid, sheet, { x: 1040, y: 540, w: 240, h: 20 })).toBeCloseTo(240 * 20) // the heading exactly
    expect(printedUnder(grid, sheet, { x: 1000, y: 580, w: 400, h: 100 })).toBe(0) // blank between heading and paragraph
    expect(printedUnder(grid, sheet, { x: 1370, y: 700, w: 30, h: 80 })).toBe(0) // right of the paragraph
    expect(printedUnder(grid, sheet, { x: 1300, y: 690, w: 200, h: 40 })).toBeGreaterThan(0)
  })

  it('does not lose a hairline', () => {
    expect(printedUnder(grid, sheet, { x: 1100, y: 880, w: 100, h: 40 })).toBeGreaterThan(0)
  })

  it('is blank off the page', () => {
    expect(printedUnder(grid, sheet, { x: 0, y: 0, w: 900, h: 2000 })).toBe(0)
    expect(printedUnder(grid, sheet, { x: 1400, y: 500, w: 300, h: 600 })).toBe(0)
  })

  it('light marks (a faint watermark, JPEG noise) are paper', () => {
    const faint = new Uint8ClampedArray(40 * 40 * 4).fill(230)
    expect(printedUnder(inkGrid(faint, 40, 40, 10), { x: 0, y: 0, w: 40, h: 40 }, { x: 0, y: 0, w: 40, h: 40 })).toBe(0)
  })

  it('a note about a printed line goes on blank paper, not on the paragraph under it', () => {
    const heading = { x: 1040, y: 540, w: 240, h: 20 }
    const ctx = { zoom: 1, view: { x: 900, y: 400, w: 700, h: 900 }, sheets: [sheet], printedArea: (r: typeof heading) => printedUnder(grid, sheet, r) }
    // asked for "below": there is room between the heading and the paragraph for a short note only
    const small = placeBeside(heading, [{ w: 200, h: 80 }], 'below', 10, ctx)
    expect(small).toEqual({ x: 1040, y: 570, w: 200, h: 80 })
    const tall = placeBeside(heading, [{ w: 200, h: 200 }], 'below', 10, ctx)
    expect(printedUnder(grid, sheet, tall)).toBe(0)
  })
})
