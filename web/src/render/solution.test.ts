import { describe, expect, it, vi } from 'vitest'
import type { Action, CheckResponse } from '../contract'
import solutionJson from '../../../contract/examples/solution.json'
import { INLINE_LETTER_EM } from './actions'
import { drawnByHand, staleShapeIds, wantsHand, type OldShape } from './apply'
import { CHAR_EM, TEXT_LINE_HEIGHT, type PageRect, type RenderContext } from './geometry'
import { STEP_PITCH_EM, equalsSignX, solutionLayout, solutionShapes } from './solution'

const frame = { x: 0, y: 0, w: 1000, h: 1000 }
const reply = solutionJson as unknown as CheckResponse
const action = reply.actions[0]
const line: PageRect = { x: 80, y: 150, w: 340, h: 80 } // the action's box in page units

/** "3x² − 3 = 0" as stroke boxes: letters 50 tall from x = 90, an equals sign (two bars) centred on x = 330. */
const ink: PageRect[] = [
  { x: 90, y: 170, w: 30, h: 50 },
  { x: 130, y: 180, w: 30, h: 40 },
  { x: 165, y: 160, w: 15, h: 20 },
  { x: 200, y: 193, w: 30, h: 2 },
  { x: 250, y: 170, w: 30, h: 50 },
  { x: 315, y: 186, w: 30, h: 2 },
  { x: 315, y: 200, w: 30, h: 2 },
  { x: 370, y: 170, w: 30, h: 50 },
]
const ctxOf = (extra: Partial<RenderContext> = {}): RenderContext => ({ zoom: 1, ink, taken: [], lines: new Map([['L1', line]]), ...extra })
const overlap = (a: PageRect, b: PageRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('solutionLayout', () => {
  it('writes every step, converted to readable text, one under another below the line', () => {
    const lay = solutionLayout(action, frame, ctxOf())!
    expect(lay.steps.map((s) => s.text)).toEqual(['3x² = 3', 'x² = 1', 'x = ±1'])
    expect(lay.moved).toBe(false)
    expect(lay.steps[0].y).toBeGreaterThanOrEqual(220) // below the ink of the line
    for (let i = 1; i < lay.steps.length; i++) expect(lay.steps[i].y - lay.steps[i - 1].y).toBeCloseTo(lay.pitch)
    expect(lay.rect.y).toBe(lay.steps[0].y)
    expect(lay.rect.h).toBeCloseTo(lay.pitch * 2 + lay.font * TEXT_LINE_HEIGHT)
  })

  it('is as tall as the letters on the line (the inline answer rule)', () => {
    const lay = solutionLayout(action, frame, ctxOf())!
    expect(lay.font).toBeCloseTo(50 * INLINE_LETTER_EM)
    // the same writing twice the size gets steps twice the size
    const big = ink.map((r) => ({ x: r.x * 2, y: r.y * 2, w: r.w * 2, h: r.h * 2 }))
    const lay2 = solutionLayout(action, { x: 0, y: 0, w: 2000, h: 2000 }, { zoom: 1, ink: big })!
    expect(lay2.font).toBeCloseTo(lay.font * 2)
  })

  it('lines the equals signs up under each other and under the student\'s own', () => {
    expect(equalsSignX(line, ink)).toBe(330)
    const lay = solutionLayout(action, frame, ctxOf())!
    expect(lay.equalsX).toBe(330)
    for (const s of lay.steps) {
      const eq = s.x + (s.text.indexOf('=') + 0.5) * lay.font * CHAR_EM
      expect(eq).toBeCloseTo(330)
    }
  })

  it('starts where the student\'s line starts when their equals sign is not found or is too far off', () => {
    const noEquals = ink.filter((r) => r.h > 2)
    const lay = solutionLayout(action, frame, ctxOf({ ink: noEquals }))!
    expect(Math.min(...lay.steps.map((s) => s.x))).toBeCloseTo(90) // the first stroke, not the read box
    const eqs = lay.steps.map((s) => s.x + (s.text.indexOf('=') + 0.5) * lay.font * CHAR_EM)
    expect(eqs[1]).toBeCloseTo(eqs[0])
    expect(eqs[2]).toBeCloseTo(eqs[0])
    // an equals sign at the far end of a long line: the steps stay at the left, lined up with each other
    const far = [...noEquals, { x: 800, y: 186, w: 30, h: 2 }, { x: 800, y: 200, w: 30, h: 2 }]
    const wide = { ...action, box: [150, 80, 230, 900] as Action['box'] }
    const lay2 = solutionLayout(wide, frame, { zoom: 1, ink: far })!
    expect(Math.min(...lay2.steps.map((s) => s.x))).toBeCloseTo(90)
  })

  it('a step with no equals sign starts at the left edge of the block', () => {
    const lay = solutionLayout({ ...action, steps: ['x^2 = 1', '\\text{so}', 'x = \\pm 1'] }, frame, ctxOf({ ink: ink.filter((r) => r.h > 2) }))!
    expect(lay.steps[1].x).toBeCloseTo(lay.rect.x)
  })

  it('follows the student\'s own line spacing when there is a line above', () => {
    const def = solutionLayout(action, frame, ctxOf())!
    expect(def.pitch).toBeCloseTo(def.font * STEP_PITCH_EM)
    const above: PageRect = { x: 80, y: 30, w: 300, h: 80 } // centres 120 apart
    const lay = solutionLayout(action, frame, ctxOf({ lines: new Map([['L0', above], ['L1', line]]) }))!
    expect(lay.pitch).toBeCloseTo(120)
    expect(lay.steps[0].y + (lay.font * TEXT_LINE_HEIGHT) / 2).toBeCloseTo(190 + 120) // one spacing below the middle of the ink
  })

  it('never lands on ink, feedback or print: with no room below, the block goes beside the working', () => {
    const below: PageRect = { x: 90, y: 260, w: 300, h: 60 } // the next problem, straight under the line
    for (const extra of [{ ink: [...ink, below] }, { taken: [below] }, { printed: [below] }] as Partial<RenderContext>[]) {
      const ctx = ctxOf(extra)
      const lay = solutionLayout(action, frame, ctx)!
      expect(lay.moved).toBe(true)
      expect(lay.rect.x).toBeGreaterThan(400) // right of the line's last stroke
      expect(Math.min(...lay.steps.map((s) => s.x))).toBeCloseTo(lay.rect.x)
      for (const o of [...ink, below]) expect(overlap(lay.rect, o)).toBe(false)
      for (const s of lay.steps) expect(s.x + s.w).toBeLessThanOrEqual(lay.rect.x + lay.rect.w + 1e-6)
    }
    // printed worksheet content found on the image itself counts too
    const printedArea = (r: PageRect) => (overlap(r, below) ? 1 : 0)
    expect(solutionLayout(action, frame, ctxOf({ printedArea }))!.moved).toBe(true)
  })

  it('claims its space, so later feedback keeps clear of it', () => {
    const ctx = ctxOf()
    const lay = solutionLayout(action, frame, ctx)!
    expect(ctx.taken).toEqual([lay.rect])
  })

  it('has nothing to draw without steps or a box', () => {
    expect(solutionLayout({ ...action, steps: [] }, frame, ctxOf())).toBeNull()
    expect(solutionLayout({ ...action, box: undefined }, frame, ctxOf())).toBeNull()
  })
})

describe('solution shapes', () => {
  const lay = solutionLayout(action, frame, ctxOf())!
  const shapes = solutionShapes(action, lay, 'blue')

  it('one handwriting-font text per step, tagged as this line\'s solution, in the ink colour', () => {
    expect(shapes).toHaveLength(3)
    for (const [i, s] of shapes.entries()) {
      expect(s.type).toBe('text')
      expect(s.meta).toMatchObject({ ai: true, line_id: 'L1', kind: 'solution', step: i })
      expect(s.props).toMatchObject({ font: 'draw', color: 'blue', autoSize: true })
      expect([s.x, s.y]).toEqual([lay.steps[i].x, lay.steps[i].y])
    }
  })

  it('a new solution for the same line replaces the old one, by id or by place', () => {
    const old: OldShape[] = shapes.map((s, i) => ({ id: `shape:${i}`, meta: s.meta as Record<string, unknown> }))
    const all = ['shape:0', 'shape:1', 'shape:2']
    expect(staleShapeIds(old, reply, frame, ctxOf())).toEqual(all)
    const renamed = { actions: [{ ...action, line_id: 'L9' }], clear_line_ids: [] }
    expect(staleShapeIds(old, renamed, frame)).toEqual(all)
    expect(staleShapeIds(old, { actions: [], clear_line_ids: ['L1'] }, frame)).toEqual(all)
    // feedback for another line leaves it alone
    const other: Action = { type: 'note', line_id: 'L5', box: [600, 80, 660, 400], text: 'Nice' }
    expect(staleShapeIds(old, { actions: [other], clear_line_ids: [] }, frame)).toEqual([])
  })

  it('handwritten tutor ink is replaced the same way', () => {
    const hand: OldShape[] = [{ id: 'ink', meta: { ai: true, line_id: 'L1', kind: 'hand', ax: 80, ay: 150, aw: 340, ah: 80 } }]
    expect(staleShapeIds(hand, reply, frame, ctxOf())).toEqual(['ink'])
    expect(staleShapeIds(hand, { actions: [{ ...action, line_id: 'L9' }], clear_line_ids: [] }, frame)).toEqual(['ink'])
  })
})

describe('handwriting routing', () => {
  const inline: Action = { type: 'note', box: [260, 80, 340, 300], line_id: 'L2', color: 'black', side: 'inline', text: '$12x$' }
  const hint: Action = { type: 'note', box: [260, 80, 340, 300], line_id: 'L2', color: 'red', side: 'right', text: 'Check the power rule' }

  it('only inline answers and solutions are candidates, and only with the toggle on', () => {
    expect(wantsHand(inline, true)).toBe(true)
    expect(wantsHand(action, true)).toBe(true)
    expect(wantsHand(inline, false)).toBe(false)
    expect(wantsHand(action, false)).toBe(false)
    expect(wantsHand(hint, true)).toBe(false)
    expect(wantsHand({ type: 'circle', box: [0, 0, 10, 10] }, true)).toBe(false)
    expect(wantsHand({ type: 'solution', box: [0, 0, 10, 10], steps: [] }, true)).toBe(false)
  })

  it('toggle off: the writer is never called', () => {
    const write = vi.fn(() => ({}))
    expect(drawnByHand(inline, false, write)).toBe(false)
    expect(drawnByHand(action, false, write)).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('toggle on, hand not learned (the writer returns null) or failing: drawn the usual way', () => {
    expect(drawnByHand(inline, true, () => null)).toBe(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(drawnByHand(action, true, () => { throw new Error('no') })).toBe(false)
    warn.mockRestore()
  })

  it('toggle on and the hand is known: written by hand, not drawn as text', () => {
    const write = vi.fn(() => ({ ids: [] }))
    expect(drawnByHand(inline, true, write)).toBe(true)
    expect(drawnByHand(action, true, write)).toBe(true)
    expect(write).toHaveBeenCalledTimes(2)
    expect(drawnByHand(hint, true, write)).toBe(false)
    expect(write).toHaveBeenCalledTimes(2)
  })
})

describe('no room below', () => {
  const below: PageRect = { x: 90, y: 260, w: 300, h: 60 }
  const word: PageRect = { x: 470, y: 180, w: 130, h: 40 } // "solve", written after the line

  it('the block starts level with the line, right of everything written on that row', () => {
    const lay = solutionLayout(action, frame, ctxOf({ ink: [...ink, below, word] }))!
    expect(lay.moved).toBe(true)
    expect(lay.rect.x).toBeGreaterThan(600)
    expect(lay.steps[0].y + (lay.font * TEXT_LINE_HEIGHT) / 2).toBeCloseTo(190) // on the line's own row
    for (const o of [...ink, below, word]) expect(overlap(lay.rect, o)).toBe(false)
  })

  it('with no room on screen to the right either, it goes wherever is free, never over writing', () => {
    const view = { x: 0, y: 0, w: 700, h: 1000 }
    const lay = solutionLayout(action, frame, ctxOf({ ink: [...ink, below, word], view }))!
    expect(lay.moved).toBe(true)
    for (const o of [...ink, below, word]) expect(overlap(lay.rect, o)).toBe(false)
    expect(lay.rect.x + lay.rect.w).toBeLessThanOrEqual(700)
  })
})
