import { describe, expect, it } from 'vitest'
import { FIGURE_H, FIGURE_W, figureRect, toPlotExpr } from './figure'

describe('figureRect', () => {
  const bounds = { x: 0, y: 0, w: 1000, h: 1000 }
  it('sits to the right of the box by default', () => {
    expect(figureRect({ type: 'figure', box: [150, 80, 210, 380] }, bounds)).toEqual({
      x: 396,
      y: 150,
      w: FIGURE_W,
      h: FIGURE_H,
    })
  })

  it('sits below when side=below', () => {
    const r = figureRect({ type: 'figure', box: [150, 80, 210, 380], side: 'below' }, bounds)
    expect(r.x).toBe(80)
    expect(r.y).toBe(226)
  })
})

describe('toPlotExpr', () => {
  it('normalises common forms', () => {
    expect(toPlotExpr('x^2 - 4')).toBe('x^2 - 4')
    expect(toPlotExpr('x**2 + 3x')).toBe('x^2 + 3*x')
    expect(toPlotExpr('f(x) = 2sin(x)')).toBe('2*sin(x)')
    expect(toPlotExpr('y = (x+1)(x-1)')).toBe('(x+1)*(x-1)')
  })
})
