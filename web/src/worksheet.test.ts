import { describe, expect, it } from 'vitest'
import { layoutSheets, placeSheets, SHEET_GAP_FRACTION, SHEET_VIEW_FRACTION } from './worksheet'

const letter = { w: 612, h: 792 }
const view = { x: 1000, y: 500, w: 1000, h: 700 }
const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('layoutSheets', () => {
  it('scales pages to the given width and stacks them with a gap', () => {
    const rects = layoutSheets([letter, letter], { x: 10, y: 20 }, 900, 40)
    const h = (792 / 612) * 900
    expect(rects[0]).toEqual({ x: 10, y: 20, w: 900, h })
    expect(rects[1].y).toBeCloseTo(20 + h + 40)
  })
})

describe('placeSheets', () => {
  it('empty viewport: in view, filling most of its width', () => {
    const [first, second] = placeSheets([letter, letter], view, [])
    expect(first.w).toBe(view.w * SHEET_VIEW_FRACTION)
    expect(first.x).toBeGreaterThan(view.x)
    expect(first.x + first.w).toBeLessThan(view.x + view.w)
    expect(first.y).toBeGreaterThan(view.y)
    expect(first.y).toBeLessThan(view.y + view.h / 4)
    expect(second.y).toBeCloseTo(first.y + first.h + first.w * SHEET_GAP_FRACTION)
  })

  it('ink far from the viewport does not matter', () => {
    const far = { x: -5000, y: -5000, w: 300, h: 80 }
    expect(placeSheets([letter], view, [far])).toEqual(placeSheets([letter], view, []))
  })

  it('never covers existing ink: goes to the nearest free side of all content', () => {
    const ink = [
      { x: 1100, y: 600, w: 400, h: 80 },
      { x: 1100, y: 750, w: 500, h: 80 },
      { x: 300, y: 2000, w: 200, h: 60 }, // far below and to the left
    ]
    const rects = placeSheets([letter, letter], view, ink)
    for (const r of rects) for (const i of ink) expect(hit(r, i)).toBe(false)
    // right of everything is the shortest move from this viewport
    expect(rects[0].x).toBeGreaterThan(1600)
    expect(rects[0].w).toBe(view.w * SHEET_VIEW_FRACTION)
  })

  it('a later page would land on ink below the viewport: the whole worksheet moves', () => {
    const ink = [{ x: 1200, y: 2500, w: 300, h: 80 }]
    const rects = placeSheets([letter, letter, letter], view, ink)
    for (const r of rects) expect(hit(r, ink[0])).toBe(false)
  })
})
