import { describe, expect, it } from 'vitest'
import { exportArea, EXPORT_PADDING, intersect, union, WORKSHEET_CONTEXT } from './page'

const ink = { x: 100, y: 1500, w: 300, h: 100 }
const sheets = { x: 0, y: 0, w: 900, h: 4000 }

describe('exportArea', () => {
  it('plain page: ink + padding', () => {
    expect(exportArea(ink, null)).toEqual({
      x: 100 - EXPORT_PADDING,
      y: 1500 - EXPORT_PADDING,
      w: 300 + EXPORT_PADDING * 2,
      h: 100 + EXPORT_PADDING * 2,
    })
  })

  it('nothing on the page: null', () => {
    expect(exportArea(null, null)).toBeNull()
  })

  it('worksheet: crops to the handwriting plus context, not the whole PDF', () => {
    const r = exportArea(ink, sheets)!
    expect(r.y).toBe(1500 - WORKSHEET_CONTEXT)
    expect(r.h).toBe(100 + WORKSHEET_CONTEXT * 2)
    // clipped to the page content on the left
    expect(r.x).toBe(-EXPORT_PADDING)
  })

  it('worksheet + Help selection on a printed problem far away: includes the selection', () => {
    const help = { x: 50, y: 200, w: 400, h: 80 }
    const r = exportArea(ink, sheets, help)!
    expect(r.y).toBeLessThanOrEqual(200)
    expect(r.y + r.h).toBeGreaterThanOrEqual(1600)
  })

  it('worksheet with no handwriting yet: the whole worksheet', () => {
    expect(exportArea(null, sheets)!.h).toBe(4000 + EXPORT_PADDING * 2)
  })
})

describe('rect helpers', () => {
  it('union and intersect', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 }
    const b = { x: 5, y: 5, w: 10, h: 10 }
    expect(union(a, b)).toEqual({ x: 0, y: 0, w: 15, h: 15 })
    expect(intersect(a, b)).toEqual({ x: 5, y: 5, w: 5, h: 5 })
    expect(intersect(a, { x: 20, y: 20, w: 1, h: 1 })).toBeNull()
  })
})
