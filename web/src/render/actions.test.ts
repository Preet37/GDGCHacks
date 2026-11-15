import { describe, expect, it } from 'vitest'
import type { CheckResponse } from '../contract'
import wrongDerivative from '../../../contract/examples/wrong_derivative.json'
import finishLine from '../../../contract/examples/finish_line.json'
import hintLevel1 from '../../../contract/examples/hint_level_1.json'
import { shapesForAction } from './actions'
import { lineIdsToReplace } from './apply'
import { mathToPlain } from './text'

const bounds = { x: 0, y: 0, w: 1000, h: 1000 }
const wrong = wrongDerivative as unknown as CheckResponse

describe('shapesForAction with wrong_derivative.json', () => {
  const [circle, note] = wrong.actions

  it('draws a red ellipse around the box, padded, unfilled, tagged as AI', () => {
    const [s] = shapesForAction(circle, bounds)
    expect(s.type).toBe('geo')
    expect(s.props).toMatchObject({ geo: 'ellipse', color: 'red', fill: 'none' })
    // box [200,300,260,400] -> x 300..400, y 200..260, padded by 8
    expect(s.x).toBe(292)
    expect(s.y).toBe(192)
    expect(s.props).toMatchObject({ w: 116, h: 76 })
    expect(s.meta).toEqual({ ai: true, line_id: 'L2', kind: 'circle' })
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
    expect(json).toContain('x^2')
    expect(json).toContain('x_2')
  })

  it('figure and speak draw nothing here', () => {
    expect(shapesForAction({ type: 'speak', text: 'hi' }, bounds)).toEqual([])
    expect(shapesForAction({ type: 'figure', box: [0, 0, 1, 1] }, bounds)).toEqual([])
  })
})

describe('feedback scales with the handwriting', () => {
  // the sent image covers 2500 page units, so the 60-unit boxes are 150 px tall
  const big = { x: 0, y: 0, w: 2500, h: 2500 }
  const [circle, note] = wrong.actions
  type TextProps = { scale: number; w: number; size: string; autoSize: boolean; color: string; font: string }

  it('note text is ~40% of the line height, with width and gap to match', () => {
    const [s] = shapesForAction(note, big)
    const p = s.props as TextProps
    expect(p.size).toBe('s')
    expect(p.scale * 18).toBeCloseTo(60) // 18 px base font -> 60 px for 150 px writing
    expect(p.w * p.scale).toBeCloseTo(720)
    expect(s.x).toBeCloseTo(1000 + 37.5)
    expect(s.y).toBe(500)
  })

  it('small writing still gets readable text', () => {
    const [s] = shapesForAction(note, { x: 0, y: 0, w: 300, h: 300 })
    expect((s.props as TextProps).scale).toBe(1)
  })

  it('circle and underline get a thicker stroke and more padding', () => {
    const [c] = shapesForAction(circle, big)
    expect((c.props as { scale: number }).scale).toBe(3)
    expect(c.x).toBe(750 - 18)
    const [u] = shapesForAction({ type: 'underline', box: [200, 300, 260, 400] }, big)
    expect((u.props as { scale: number }).scale).toBe(3)
    expect(u.y).toBe(650 + 9)
  })

  it('inline note continues the line: after its right edge, centred, near the writing size, black', () => {
    const [action] = (finishLine as unknown as CheckResponse).actions
    const [s] = shapesForAction(action, big) // box [260,80,340,300] -> x 200..750, y 650..850
    const p = s.props as TextProps
    expect(s.type).toBe('text')
    expect(p).toMatchObject({ font: 'draw', color: 'black', autoSize: true })
    expect(JSON.stringify(p)).toContain('"12x"')
    expect(JSON.stringify(p)).not.toContain('$')
    const font = p.scale * 18
    expect(font / 200).toBeGreaterThanOrEqual(0.7)
    expect(font / 200).toBeLessThanOrEqual(0.8)
    expect(s.x).toBeGreaterThan(750)
    expect(s.x).toBeLessThan(750 + 40)
    expect(s.y + (font * 1.35) / 2).toBeCloseTo(750) // centred on the line
    expect(s.meta).toEqual({ ai: true, line_id: 'L2', kind: 'note' })
  })

  it('inline note takes the given colour', () => {
    const [s] = shapesForAction({ type: 'note', box: [0, 0, 100, 100], side: 'inline', color: 'green', text: '$x$' }, big)
    expect(s.props).toMatchObject({ color: 'green' })
  })
})

describe('lineIdsToReplace', () => {
  it('includes action line ids and clear_line_ids', () => {
    const ids = lineIdsToReplace({ actions: wrong.actions, clear_line_ids: ['L7'] })
    expect([...ids].sort()).toEqual(['L2', 'L7'])
  })
})

describe('mathToPlain', () => {
  it('strips dollars and common LaTeX', () => {
    expect(mathToPlain('Which rule handles $x \\sin x$?')).toBe('Which rule handles x sin x?')
    expect(mathToPlain('$\\frac{1}{2}x^{2}$')).toBe('(1)/(2)x^2')
  })

  it('turns simple LaTeX into readable text', () => {
    expect(mathToPlain('\\text{graph this}')).toBe('graph this')
    expect(mathToPlain('$\\sqrt{x} \\le 2\\pi$')).toBe('√(x) ≤ 2π')
    expect(mathToPlain('$\\left(x \\cdot y\\right) \\to \\infty$')).toBe('(x · y) → ∞')
  })
})
