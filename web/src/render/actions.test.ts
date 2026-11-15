import { describe, expect, it } from 'vitest'
import type { CheckResponse } from '../contract'
import wrongDerivative from '../../../contract/examples/wrong_derivative.json'
import finishLine from '../../../contract/examples/finish_line.json'
import hintLevel1 from '../../../contract/examples/hint_level_1.json'
import { shapesForAction } from './actions'
import { lineIdsToReplace } from './apply'
import { cardRect, withFeedback } from './actions'

const bounds = { x: 0, y: 0, w: 1000, h: 1000 }
const wrong = wrongDerivative as unknown as CheckResponse

describe('shapesForAction with wrong_derivative.json', () => {
  const [circle, note] = wrong.actions

  it('draws a red ellipse around the box, padded, unfilled, tagged as AI', () => {
    const [s] = shapesForAction(circle, bounds)
    expect(s.type).toBe('geo')
    expect(s.props).toMatchObject({ geo: 'ellipse', color: 'red', fill: 'none' })
    // box [200,300,260,400] -> x 300..400, y 200..260, padded by 7.5 (an eighth of the line height)
    expect(s.x).toBe(292.5)
    expect(s.y).toBe(192.5)
    expect(s.props).toMatchObject({ w: 115, h: 75 })
    // the meta also records the writing it is about, so it can be replaced by place
    expect(s.meta).toEqual({ ai: true, line_id: 'L2', kind: 'circle', ax: 300, ay: 200, aw: 100, ah: 60 })
  })

  it('puts the note to the right of the box in handwriting font', () => {
    const [s] = shapesForAction(note, bounds)
    expect(s.type).toBe('text')
    expect(s.x).toBeGreaterThan(400)
    expect(s.y).toBe(200)
    expect(s.props).toMatchObject({ font: 'draw', color: 'red' })
    expect(JSON.stringify(s.props)).toContain('Check the derivative of 2x. What happens to the x?')
  })
})

describe('other action types', () => {
  it('note side=below sits under the box', () => {
    const [s] = shapesForAction((hintLevel1 as unknown as CheckResponse).actions[0], bounds)
    expect(s.y).toBeGreaterThan(170)
    expect(s.x).toBe(60)
    expect(s.props).toMatchObject({ color: 'blue' })
  })

  it('underline is a horizontal line under the box', () => {
    const [s] = shapesForAction({ type: 'underline', box: [100, 100, 200, 300], line_id: 'L1' }, bounds)
    expect(s.type).toBe('line')
    expect(s.y).toBeGreaterThan(200)
    const pts = Object.values((s.props as { points: Record<string, { x: number }> }).points)
    expect(pts.map((p) => p.x)).toEqual([0, 200])
  })

  it('ask lists the options in blue', () => {
    const [s] = shapesForAction(
      { type: 'ask', box: [0, 0, 100, 100], text: 'Did you mean...?', options: ['x^2', 'x_2'] },
      bounds,
    )
    expect(s.props).toMatchObject({ color: 'blue' })
    const json = JSON.stringify(s.props)
    expect(json).toContain('x²')
    expect(json).toContain('x₂')
  })

  it('figure and speak draw nothing here', () => {
    expect(shapesForAction({ type: 'speak', text: 'hi' }, bounds)).toEqual([])
    expect(shapesForAction({ type: 'figure', box: [0, 0, 1, 1] }, bounds)).toEqual([])
  })
})

describe('feedback scales with the handwriting', () => {
  // the sent image covers 2500 page units, so the 60-unit boxes are 150 px tall
  const big = { x: 0, y: 0, w: 2500, h: 2500 }
  const far = { zoom: 0.4, view: { x: 0, y: 0, w: 2560, h: 1920 } } // a 1024 x 768 screen zoomed out
  const [circle, note] = wrong.actions
  type TextProps = { scale: number; w: number; size: string; autoSize: boolean; color: string; font: string }

  it('note text is ~40% of the line height, with width and gap to match', () => {
    const [s] = shapesForAction(note, big, far)
    const p = s.props as TextProps
    expect(p.size).toBe('s')
    expect(p.scale * 18).toBeCloseTo(60) // 18 px base font -> 60 px for 150 px writing
    expect(p.w * p.scale).toBeCloseTo(720)
    expect(s.x).toBeCloseTo(1000 + 37.5)
    expect(s.y).toBe(500)
  })

  it('small writing still gets readable text: 14 px on screen at any zoom', () => {
    for (const zoom of [0.25, 1, 2]) {
      const [s] = shapesForAction(note, { x: 0, y: 0, w: 100, h: 100 }, { zoom, view: { x: 0, y: 0, w: 1024 / zoom, h: 768 / zoom } })
      expect((s.props as TextProps).scale * 18 * zoom).toBeCloseTo(14)
    }
  })

  it('the same page seen at zoom 1 and zoom 0.3 looks the same on screen', () => {
    const at = (zoom: number) => {
      const ctx = { zoom, view: { x: 0, y: 0, w: 1024 / zoom, h: 768 / zoom } }
      const b = { x: 0, y: 0, w: 1000 / zoom, h: 1000 / zoom } // same writing on screen = 1/zoom bigger on the page
      const [n] = shapesForAction(note, b, ctx)
      const [c] = shapesForAction(circle, b, ctx)
      const [i] = shapesForAction((finishLine as unknown as CheckResponse).actions[0], b, ctx)
      const p = n.props as TextProps
      return [n.x, n.y, p.scale, p.w * p.scale, c.x, (c.props as { scale: number }).scale, i.x, i.y, (i.props as TextProps).scale].map((v) => v * zoom)
    }
    const near = at(1)
    at(0.3).forEach((v, k) => expect(v).toBeCloseTo(near[k], 6))
  })

  it('circle and underline get a thicker stroke and more padding', () => {
    const [c] = shapesForAction(circle, big, far)
    expect((c.props as { scale: number }).scale).toBe(3)
    expect(c.x).toBe(750 - 18.75)
    const [u] = shapesForAction({ type: 'underline', box: [200, 300, 260, 400] }, big, far)
    expect((u.props as { scale: number }).scale).toBe(3)
    expect(u.y).toBe(650 + 9.375)
  })

  it('inline note continues the line: after its right edge, on the lower-middle, near the writing size, black', () => {
    const [action] = (finishLine as unknown as CheckResponse).actions
    const [s] = shapesForAction(action, big, far) // box [260,80,340,300] -> x 200..750, y 650..850
    const p = s.props as TextProps
    expect(s.type).toBe('text')
    expect(p).toMatchObject({ font: 'draw', color: 'black', autoSize: true })
    expect(JSON.stringify(p)).toContain('"12x"')
    expect(JSON.stringify(p)).not.toContain('$')
    const font = p.scale * 18
    expect(font / 200).toBeGreaterThanOrEqual(0.85)
    expect(font / 200).toBeLessThanOrEqual(0.95)
    expect(s.x).toBeGreaterThan(750)
    expect(s.x).toBeLessThan(750 + 70)
    const centre = s.y + (font * 1.35) / 2
    expect(centre).toBeGreaterThan(750) // below the middle of the box (650..850), where the text runs
    expect(centre).toBeLessThan(800)
    expect(s.meta).toMatchObject({ ai: true, line_id: 'L2', kind: 'note' })
  })

  it('inline note takes the given colour', () => {
    const [s] = shapesForAction({ type: 'note', box: [0, 0, 100, 100], side: 'inline', color: 'green', text: '$x$' }, big)
    expect(s.props).toMatchObject({ color: 'green' })
  })
})

describe('tall lines and narrowed boxes', () => {
  const far = { zoom: 0.4, view: { x: 0, y: 0, w: 2560, h: 1920 } }
  // "∫ 4x dx =" at x 100..900, y 400..800: the integral sign makes the box 400 tall, the text is ~120
  const ink = [
    { x: 100, y: 400, w: 60, h: 400 },
    { x: 220, y: 540, w: 70, h: 120 },
    { x: 320, y: 570, w: 60, h: 80 },
    { x: 330, y: 570, w: 60, h: 80 },
    { x: 430, y: 520, w: 80, h: 130 },
    { x: 530, y: 570, w: 60, h: 80 },
    { x: 540, y: 570, w: 60, h: 80 },
    { x: 800, y: 600, w: 100, h: 6 },
    { x: 800, y: 630, w: 100, h: 6 },
  ]
  const frame = { x: 0, y: 0, w: 1000, h: 1000 }
  const lineBox: [number, number, number, number] = [400, 100, 800, 900]
  type TextProps = { scale: number; autoSize: boolean }

  it('an inline answer is sized from the text, not the integral sign, and sits level with the "="', () => {
    const [s] = shapesForAction({ type: 'note', side: 'inline', color: 'black', box: lineBox, text: '$2x^2 + C$' }, frame, { ...far, ink })
    const font = (s.props as TextProps).scale * 18
    expect(font).toBeGreaterThan(90)
    expect(font).toBeLessThan(160) // 75% of the 400 box would be 300
    expect(s.x).toBeGreaterThan(900) // clear of the "="
    expect(s.y + (font * 1.35) / 2).toBeCloseTo(618) // the "=" spans 600..636
  })

  it('an answer near the edge of the screen is written smaller so it stays on it', () => {
    const view = { x: 0, y: 0, w: 1300, h: 1920 }
    const [s] = shapesForAction({ type: 'note', side: 'inline', box: lineBox, text: '$2x^2 + C$' }, frame, { zoom: 0.4, view, ink })
    const font = (s.props as TextProps).scale * 18
    expect(font).toBeLessThan(90)
    expect(font).toBeGreaterThanOrEqual(14 / 0.4)
    expect(s.x + 7 * font * 0.6).toBeLessThanOrEqual(1300)
    expect(s.y + (font * 1.35) / 2).toBeCloseTo(618) // still level with the "="
  })

  it('a black note beside a line is the tutor finishing it, whatever side it asked for', () => {
    const [s] = shapesForAction({ type: 'note', side: 'right', color: 'black', box: lineBox, text: '$2x^2 + C$' }, frame, { ...far, ink })
    expect((s.props as TextProps).autoSize).toBe(true)
    expect(s.y).toBeGreaterThan(500) // not up at the top of the box
  })

  it('a box narrowed to one term is not what feedback is sized from', () => {
    const lines = new Map([['L1', { x: 100, y: 400, w: 800, h: 150 }]])
    const sliver = { type: 'note' as const, line_id: 'L1', box: [470, 600, 490, 640] as [number, number, number, number], text: 'Check this term' }
    const [s] = shapesForAction(sliver, frame, { ...far, lines })
    expect((s.props as TextProps).scale * 18).toBeCloseTo(60) // 40% of the 150 line, not of the 20 sliver
    const [c] = shapesForAction({ ...sliver, type: 'circle' }, frame, { ...far, lines })
    expect(c.meta).toMatchObject({ ax: 100, ay: 400, aw: 800, ah: 150 })
  })
})

describe('notes find room', () => {
  const view = { x: 0, y: 0, w: 1024, h: 768 }
  const frame = { x: 0, y: 0, w: 1000, h: 1000 }
  const note = { type: 'note' as const, box: [300, 300, 360, 500] as [number, number, number, number], text: 'What is the derivative of $2x$?' }

  it('right by default, below when more writing follows on the line', () => {
    const [free] = shapesForAction(note, frame, { zoom: 1, view })
    expect(free.x).toBeGreaterThan(500)
    expect(free.y).toBe(300)
    const [moved] = shapesForAction(note, frame, { zoom: 1, view, ink: [{ x: 540, y: 305, w: 200, h: 50 }] })
    expect(moved.x).toBe(300)
    expect(moved.y).toBeGreaterThan(360)
  })

  it('an ask asked for below goes beside the line when the next line is there', () => {
    const ask = { type: 'ask' as const, side: 'below' as const, box: note.box, text: 'Did you mean...?', options: ['x^2', 'x_2'] }
    const [s] = shapesForAction(ask, frame, { zoom: 1, view, ink: [{ x: 300, y: 390, w: 180, h: 60 }] })
    expect(s.x).toBeGreaterThan(500)
    expect(s.y).toBe(300)
  })

  it('wraps narrower rather than run off the screen', () => {
    const edge = { ...note, box: [300, 600, 360, 800] as [number, number, number, number] }
    const ink = [{ x: 600, y: 390, w: 300, h: 60 }, { x: 600, y: 200, w: 300, h: 60 }] // lines above and below
    const [s] = shapesForAction(edge, frame, { zoom: 1, view, ink })
    const p = s.props as { w: number; scale: number }
    expect(s.x + p.w * p.scale).toBeLessThanOrEqual(1024)
  })

  it('two notes in one reply do not land on each other', () => {
    const ctx = { zoom: 1, view, taken: [] }
    const [a] = shapesForAction(note, frame, ctx)
    const [b] = shapesForAction({ ...note, text: 'Another thought about this' }, frame, ctx)
    expect([a.x, a.y]).not.toEqual([b.x, b.y])
  })
})

describe('notes on a worksheet keep off the printed text', () => {
  // iPad photos: hints for "a) G(s) = 1/(s(s+5))" were written straight over problem b) and the next heading
  const view = { x: 0, y: 0, w: 1000, h: 1300 }
  const frame = { x: 0, y: 0, w: 1000, h: 1000 }
  const sheet = { x: 50, y: 0, w: 900, h: 1300 }
  const hint = { type: 'note' as const, color: 'blue' as const, side: 'below' as const, line_id: 'L1', box: [300, 100, 340, 300] as [number, number, number, number], text: 'Rewrite $G(s)$ in standard Bode form to find the DC gain and corner frequencies.' }
  const lines = new Map([['L1', { x: 100, y: 300, w: 200, h: 40 }]])
  // printed lines read around it: the next problem right below, a paragraph to the right
  const printed = [
    { x: 100, y: 350, w: 260, h: 40 },
    { x: 100, y: 400, w: 700, h: 50 },
  ]
  const rectOfShape = (s: { x: number; y: number; props?: unknown }) => {
    const p = s.props as { w: number; scale: number }
    return { x: s.x, y: s.y, w: p.w * p.scale }
  }

  it('goes beside the line when the lines under it are printed text', () => {
    const shapes = shapesForAction(hint, frame, { zoom: 1, view, lines, printed, sheets: [sheet] })
    expect(shapes).toHaveLength(1) // right next to its line: no leader needed
    const r = rectOfShape(shapes[0])
    // not below (the next problem is there), not right (a paragraph starts under it): above the line
    expect(r.x).toBe(100)
    expect(shapes[0].y).toBeLessThan(300)
  })

  it('with text all around (per the worksheet image) it goes to free paper, joined to its line by a leader', () => {
    // print everywhere on the page between y 200 and y 700; blank below that
    const printedArea = (r: { x: number; y: number; w: number; h: number }) => {
      const x = Math.min(r.x + r.w, 950) - Math.max(r.x, 50)
      const y = Math.min(r.y + r.h, 700) - Math.max(r.y, 200)
      return x > 0 && y > 0 ? x * y : 0
    }
    const shapes = shapesForAction(hint, frame, { zoom: 1, view, lines, printedArea, sheets: [sheet] })
    expect(shapes.map((s) => (s.meta as { kind: string }).kind)).toEqual(['note', 'leader'])
    const [note, leader] = shapes
    expect(note.y).toBeGreaterThanOrEqual(700)
    expect(printedArea({ x: note.x, y: note.y, w: rectOfShape(note).w, h: 60 })).toBe(0)
    // the leader runs from the note back to the line, thin, in the note's colour, and belongs to the same line
    expect(leader.type).toBe('line')
    expect(leader.meta).toMatchObject({ ai: true, line_id: 'L1', kind: 'leader' })
    expect(leader.props).toMatchObject({ color: 'blue' })
    expect((leader.props as { scale: number }).scale).toBeLessThan(1)
    const pts = Object.values((leader.props as { points: Record<string, { x: number; y: number }> }).points)
    const end = { x: leader.x + pts[1].x, y: leader.y + pts[1].y }
    expect(leader.y).toBe(note.y) // starts on the note's top edge
    expect(end.y).toBe(340) // ends on the bottom edge of the line it is about
    expect(end.x).toBeGreaterThanOrEqual(100)
    expect(end.x).toBeLessThanOrEqual(300)
  })

  it('a page with no room at all on screen: the margin beside the sheet, never the text', () => {
    const all = (r: { x: number; y: number; w: number; h: number }) => (Math.min(r.x + r.w, 950) > Math.max(r.x, 50) ? 1 : 0)
    const [note] = shapesForAction(hint, frame, { zoom: 1, view, lines, printedArea: all, sheets: [sheet] })
    const r = rectOfShape(note)
    expect(r.x + r.w <= 50 || r.x >= 950).toBe(true)
  })
})

describe('a finished answer is as big as the writing it finishes', () => {
  // iPad photo: "x =" answered with a "±1" a third of the height of the x
  const frame = { x: 0, y: 0, w: 1000, h: 1000 }
  const view = { x: 0, y: 0, w: 1100, h: 800 }
  const ink = [
    { x: 100, y: 404, w: 34, h: 36 }, // x, one stroke
    { x: 160, y: 414, w: 60, h: 3 }, // =
    { x: 160, y: 428, w: 62, h: 4 },
  ]
  const answer = { type: 'note' as const, side: 'inline' as const, color: 'black' as const, line_id: 'L5', box: [400, 100, 444, 224] as [number, number, number, number], text: '$\\pm 1$' }

  it('"x =": the answer is sized by the x, not by the bars of the equals sign', () => {
    const [s] = shapesForAction(answer, frame, { zoom: 1, view, ink, lines: new Map([['L5', { x: 100, y: 400, w: 124, h: 44 }]]) })
    const font = (s.props as { scale: number }).scale * 18
    // the font's digits are about 0.75 em tall: as tall as the 36-unit x (the font was 14, the screen minimum)
    expect(font * 0.75).toBeGreaterThan(36 * 0.9)
    expect(font * 0.75).toBeLessThan(36 * 1.1)
    expect(JSON.stringify(s.props)).toContain('±1')
  })
})

describe('lineIdsToReplace', () => {
  it('includes action line ids and clear_line_ids', () => {
    const ids = lineIdsToReplace({ actions: wrong.actions, clear_line_ids: ['L7'] })
    expect([...ids].sort()).toEqual(['L2', 'L7'])
  })
})

describe('cards go beside feedback already on the line', () => {
  it('withFeedback grows the line over an inline answer on the same row, not over far or other-row marks', () => {
    const line = { x: 300, y: 314, w: 80, h: 30 }
    const ctx = { zoom: 1, taken: [{ x: 383, y: 317, w: 40, h: 28 }, { x: 900, y: 317, w: 40, h: 28 }, { x: 300, y: 500, w: 80, h: 30 }] }
    expect(withFeedback(line, ctx, 16)).toEqual({ x: 300, y: 314, w: 123, h: 31 })
  })

  it('a lesson card never lands on the inline answer it is about', () => {
    const bounds = { x: 0, y: 0, w: 1000, h: 1000 }
    const answer = { x: 383, y: 317, w: 40, h: 28 }
    const ctx = { zoom: 1, view: { x: 0, y: 0, w: 1180, h: 820 }, ink: [{ x: 300, y: 314, w: 80, h: 30 }], taken: [answer] }
    const r = cardRect({ type: 'lesson', line_id: 'L2', box: [314, 300, 344, 380] }, bounds, ctx, 590, 650)
    const overlaps = r.x < answer.x + answer.w && r.x + r.w > answer.x && r.y < answer.y + answer.h && r.y + r.h > answer.y
    expect(overlaps).toBe(false)
  })
})

