import { describe, expect, it } from 'vitest'
import type { CheckResponse } from '../contract'
import wrongDerivative from '../../../contract/examples/wrong_derivative.json'
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
})
