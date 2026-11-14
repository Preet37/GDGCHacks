import { describe, expect, it } from 'vitest'
import { layoutSheets, SHEET_GAP, SHEET_W } from './worksheet'

describe('layoutSheets', () => {
  it('scales pages to the sheet width and stacks them with a gap', () => {
    const rects = layoutSheets(
      [
        { w: 612, h: 792 },
        { w: 612, h: 792 },
      ],
      { x: 10, y: 20 },
    )
    const h = (792 / 612) * SHEET_W
    expect(rects[0]).toEqual({ x: 10, y: 20, w: SHEET_W, h })
    expect(rects[1].y).toBeCloseTo(20 + h + SHEET_GAP)
  })
})
