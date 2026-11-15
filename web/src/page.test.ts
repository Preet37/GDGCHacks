import { describe, expect, it } from 'vitest'
import {
  autoWindow,
  clusterAround,
  withLineAbove,
  reachOf,
  coverage,
  exportArea,
  EXPORT_PADDING,
  hasWorksheet,
  helpWindow,
  markOnSheet,
  intersect,
  LEGIBLE_LINES,
  pointedAt,
  recentCluster,
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

describe('the line above comes along', () => {
  const lim = { maxW: 1000, maxH: 700, gap: 80 }
  // ~34-unit handwriting: line 1 at y 200-234 as letter strokes, line 2 written one blank line lower
  const letters = (y: number) => Array.from({ length: 10 }, (_, i) => ({ x: 260 + i * 34, y, w: 20, h: 34 }))

  it('a step written a blank line below still gets the line it follows from', () => {
    const line2 = letters(310)
    const area = clusterAround(line2[0], line2, lim)
    const out = withLineAbove(area, [...letters(200), ...line2], 34, lim)
    expect(out.y).toBe(200)
    expect(out.x).toBe(260)
    expect(out.w).toBe(326) // all of line 1, not just one letter
  })

  it('a step written two blank lines below still gets it (lineHeight runs small)', () => {
    const line2 = letters(360)
    const area = clusterAround(line2[0], line2, lim)
    expect(withLineAbove(area, [...letters(200), ...line2], 25, lim).y).toBe(200)
  })

  it('writing far above (beyond 6 line heights / 30% of the window) is not pulled in', () => {
    const line2 = letters(520)
    const area = clusterAround(line2[0], line2, lim)
    expect(withLineAbove(area, [...letters(200), ...line2], 34, lim).y).toBe(520)
  })

  it('writing above but off to the side is not pulled in', () => {
    const line2 = letters(310)
    const side = [{ x: 900, y: 250, w: 60, h: 34 }]
    const area = clusterAround(line2[0], line2, lim)
    expect(withLineAbove(area, [...side, ...line2], 34, lim)).toEqual(area)
  })
})


describe('a hint between two lines does not split them', () => {
  const view = { x: 0, y: 0, w: 820, h: 1000 }
  const letters = (y: number, x0 = 100) => Array.from({ length: 10 }, (_, i) => ({ x: x0 + i * 40, y, w: 26, h: 40 }))
  const line1 = letters(100)
  // a four-line hint under line 1 pushed line 2 far down: further than the gap, and than the "line above" reach
  const hint = { x: 100, y: 160, w: 260, h: 330 }
  const line2 = letters(520, 150)

  it('without the hint in the picture, line 2 would go alone', () => {
    const win = autoWindow(line2, [...line1, ...line2], [], view)!
    expect(win.y).toBeGreaterThan(400)
  })

  it('the hint joins them: the window holds both lines', () => {
    const win = autoWindow(line2, [...line1, ...line2], [], view, [hint])!
    expect(win.y).toBeLessThanOrEqual(100)
    expect(win.y + win.h).toBeGreaterThanOrEqual(560)
  })

  it('feedback far from the new writing changes nothing', () => {
    const far = { x: 100, y: 2000, w: 260, h: 120 }
    expect(autoWindow(line2, [...line1, ...line2], [], view, [far])).toEqual(autoWindow(line2, [...line1, ...line2], [], view))
  })
})

describe('what the student pointed at (Help with nothing selected)', () => {
  const view = { x: 0, y: 0, w: 1000, h: 800 }
  const letters = (y: number, x0 = 100, n = 8) => Array.from({ length: n }, (_, i) => ({ x: x0 + i * 40, y, w: 26, h: 40 }))

  it('nothing drawn: nothing', () => {
    expect(pointedAt([], view)).toBeNull()
  })

  it('an underline is taken alone, with a line of room above it for what it is under', () => {
    // two lines of working written first, then an underline somewhere else
    const underline = { x: 500, y: 600, w: 180, h: 3 }
    const box = pointedAt([...letters(100), ...letters(170), underline], view)!
    expect(box.x).toBe(500)
    expect(box.w).toBe(180)
    expect(box.y).toBeLessThanOrEqual(600 - 40) // one line of writing above the stroke
    expect(box.y + box.h).toBeGreaterThanOrEqual(603 + 40)
    expect(box.y).toBeGreaterThan(400) // and not the working further up
  })

  it('an underline on a bare worksheet still reaches the printed line above it', () => {
    const box = pointedAt([{ x: 200, y: 300, w: 160, h: 2 }], view)!
    expect(box.y).toBeLessThanOrEqual(300 - 30) // 4% of the screen when there is no writing to measure
  })

  it('the last line written is the whole line, not its last stroke, and not the lines above', () => {
    const last = letters(240, 120)
    const box = pointedAt([...letters(100), ...letters(170), ...last], view)!
    expect(box.x).toBe(120)
    expect(box.x + box.w).toBe(120 + 7 * 40 + 26)
    expect(box.y).toBe(240 - 40)
    expect(box.y + box.h).toBe(280 + 40)
  })

  it('recentCluster keeps a superscript and an equals sign, and stops at a stroke far along the row', () => {
    const line = [
      { x: 700, y: 205, w: 30, h: 40 }, // older, far to the right on the same row
      { x: 100, y: 200, w: 26, h: 40 },
      { x: 130, y: 185, w: 14, h: 18 }, // superscript
      { x: 160, y: 212, w: 30, h: 3 }, // =
      { x: 160, y: 224, w: 30, h: 3 },
      { x: 205, y: 200, w: 26, h: 40 },
    ]
    expect(recentCluster(line, 40)).toEqual({ x: 100, y: 185, w: 131, h: 55 })
  })
})

describe('has_worksheet: is an imported worksheet in the picture that is sent', () => {
  const win = { x: 0, y: 0, w: 800, h: 600 }
  it('is false with no worksheet on the page, or none in the window', () => {
    expect(hasWorksheet([], win)).toBe(false)
    expect(hasWorksheet([{ x: 0, y: 2000, w: 800, h: 1000 }], win)).toBe(false)
    expect(hasWorksheet([{ x: 900, y: 0, w: 800, h: 1000 }], win)).toBe(false)
  })
  it('is true when any worksheet page reaches into the window', () => {
    expect(hasWorksheet([{ x: 0, y: 2000, w: 800, h: 1000 }, { x: 700, y: 500, w: 800, h: 1000 }], win)).toBe(true)
    expect(hasWorksheet([{ x: -100, y: -100, w: 2000, h: 2000 }], win)).toBe(true)
  })
})

describe('markOnSheet', () => {
  const sheet = { x: 0, y: 0, w: 3000, h: 4000 }
  const circle = { x: 200, y: 1500, w: 700, h: 120 }
  it('is null when nothing was drawn on the print', () => {
    expect(markOnSheet([], [sheet])).toBeNull()
    expect(markOnSheet([{ x: 3400, y: 900, w: 300, h: 200 }], [sheet])).toBeNull()
    expect(markOnSheet([circle], [])).toBeNull()
  })
  it('takes the last mark on the print, not later scribbles in the margin', () => {
    const margin = { x: 3300, y: 1100, w: 300, h: 300 }
    expect(markOnSheet([circle, margin], [sheet])).toEqual(circle)
  })
  it('joins a circle and the arrow that leaves it', () => {
    const arrow = { x: 850, y: 1300, w: 2300, h: 280 } // runs off the page edge, mostly on it
    const m = markOnSheet([{ x: 300, y: 300, w: 400, h: 100 }, circle, arrow], [sheet])!
    expect(m.x).toBe(200)
    expect(m.y).toBe(1300)
    expect(m.x + m.w).toBe(3150)
  })
})
