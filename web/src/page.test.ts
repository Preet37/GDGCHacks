import { describe, expect, it } from 'vitest'
import {
  autoWindow,
  clusterAround,
  reachOf,
  coverage,
  exportArea,
  EXPORT_PADDING,
  helpWindow,
  intersect,
  LEGIBLE_LINES,
  rectDistance,
  seedRect,
  union,
  WORKSHEET_CONTEXT,
} from './page'

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

describe('check window', () => {
  const view = { x: 0, y: 0, w: 1000, h: 700 }
  // two workings far apart: A near the origin, B 5000 units to the right
  const lineA1 = [0, 60, 120, 180].map((x) => ({ x: 100 + x, y: 100, w: 50, h: 50 }))
  const lineA2 = [0, 60, 120].map((x) => ({ x: 100 + x, y: 190, w: 50, h: 50 }))
  const lineB = [0, 60, 120].map((x) => ({ x: 5100 + x, y: 100, w: 50, h: 50 }))
  const ink = [...lineA1, ...lineA2, ...lineB]

  it('auto: the working around the changed strokes, not ink far away', () => {
    const win = autoWindow([lineA2[2]], ink, [], view)!
    for (const r of [...lineA1, ...lineA2]) expect(coverage(r, win)).toBe(1)
    for (const r of lineB) expect(coverage(r, win)).toBe(0)
    expect(win).toEqual({ x: 100 - EXPORT_PADDING, y: 100 - EXPORT_PADDING, w: 230 + EXPORT_PADDING * 2, h: 140 + EXPORT_PADDING * 2 })
  })

  it('auto: changes in two far places: the newest one is sent, the other waits', () => {
    const win = autoWindow([lineA1[0], lineB[0]], ink, [], view)!
    for (const r of lineB) expect(coverage(r, win)).toBe(1)
    for (const r of lineA1) expect(coverage(r, win)).toBe(0)
  })

  it('auto: never grows past the viewport size (plus padding)', () => {
    const column = Array.from({ length: 40 }, (_, i) => ({ x: 100, y: i * 80, w: 300, h: 50 }))
    const win = autoWindow([column[39]], column, [], view)!
    expect(win.h).toBeLessThanOrEqual(view.h + EXPORT_PADDING * 2)
    expect(coverage(column[39], win)).toBe(1)
    expect(coverage(column[0], win)).toBe(0)
  })

  it('auto: tiny writing in a zoomed-out viewport stays legible', () => {
    const wide = { x: 0, y: 0, w: 20000, h: 14000 }
    const small = Array.from({ length: 200 }, (_, i) => ({ x: i * 25, y: 0, w: 20, h: 20 }))
    const win = autoWindow([small[0]], small, [], wide)!
    expect(win.w).toBeLessThanOrEqual(20 * LEGIBLE_LINES + EXPORT_PADDING * 2)
  })

  it('auto: nothing changed: no window', () => {
    expect(autoWindow([], ink, [], view)).toBeNull()
  })

  it('auto over a worksheet: adds printed context, clipped to the sheet', () => {
    const sheet = { x: 0, y: 0, w: 900, h: 4000 }
    const stroke = { x: 100, y: 1500, w: 300, h: 60 }
    const win = autoWindow([stroke], [stroke], [sheet], view)!
    expect(win.y).toBe(1500 - 175) // a quarter of the viewport height
    expect(win.x).toBe(-EXPORT_PADDING)
    expect(win.h).toBeLessThan(view.h)
  })

  it('help: the viewport when nothing is selected, the selection and its working otherwise', () => {
    expect(helpWindow(undefined, ink, [], view)).toEqual(view)
    const win = helpWindow({ x: 100, y: 190, w: 170, h: 50 }, ink, [], view)
    for (const r of lineA1) expect(coverage(r, win)).toBe(1)
    for (const r of lineB) expect(coverage(r, win)).toBe(0)
  })

  it('helpers', () => {
    expect(rectDistance({ x: 0, y: 0, w: 10, h: 10 }, { x: 13, y: 14, w: 5, h: 5 })).toBe(5)
    expect(coverage({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 100, h: 100 })).toBe(0.5)
    expect(seedRect([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5000, y: 0, w: 10, h: 10 }, { x: 5020, y: 0, w: 10, h: 10 }], { maxW: 1000, maxH: 700, gap: 50 })).toEqual({ x: 5000, y: 0, w: 30, h: 10 })
    expect(clusterAround({ x: 0, y: 0, w: 10, h: 10 }, [{ x: 30, y: 0, w: 10, h: 10 }, { x: 200, y: 0, w: 10, h: 10 }], { maxW: 1000, maxH: 700, gap: 50 })).toEqual({ x: 0, y: 0, w: 40, h: 10 })
  })
})

describe('drawings reach further', () => {
  const lim = { maxW: 2000, maxH: 2000, gap: 100 }

  it('an answer written under a big diagram joins it', () => {
    const answer = { x: 230, y: 530, w: 120, h: 40 }
    const diagram = { x: 200, y: 150, w: 415, h: 250 } // bottom at 400: 130 below, more than the gap
    expect(clusterAround(answer, [diagram], lim)).toEqual({ x: 200, y: 150, w: 415, h: 420 })
  })

  it('small handwriting the same distance away still stays separate', () => {
    const line = { x: 230, y: 530, w: 120, h: 40 }
    const other = { x: 230, y: 360, w: 120, h: 40 } // 130 above
    expect(clusterAround(line, [other], lim)).toEqual(line)
  })

  it('reach is capped at twice the gap', () => {
    expect(reachOf({ x: 0, y: 0, w: 5000, h: 4 }, lim)).toBe(200)
    expect(reachOf({ x: 0, y: 0, w: 50, h: 40 }, lim)).toBe(100)
  })

  it('a straight stroke is included end to end, not just its middle', () => {
    const seed = { x: 0, y: 0, w: 100, h: 100 }
    const plate = { x: -40, y: 50, w: 80, h: 0 } // centre inside, left end outside
    expect(clusterAround(seed, [plate], lim).x).toBe(-40)
  })
})
