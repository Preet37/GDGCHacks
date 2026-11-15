import { describe, expect, it } from 'vitest'
import { FIGURE_H, FIGURE_W, figureRect, sampleYRange, toPlotExpr } from './figure'

describe('figureRect', () => {
  const bounds = { x: 0, y: 0, w: 1000, h: 1000 }
  it('sits to the right of the box by default', () => {
    expect(figureRect({ type: 'figure', box: [150, 80, 210, 380] }, bounds)).toEqual({
      x: 395,
      y: 150,
      w: FIGURE_W,
      h: FIGURE_H,
    })
  })

  it('sits below when side=below', () => {
    const r = figureRect({ type: 'figure', box: [150, 80, 210, 380], side: 'below' }, bounds)
    expect(r.x).toBe(80)
    expect(r.y).toBe(225)
  })

  it('grows with the handwriting: about 3.5 line heights tall, same aspect', () => {
    const r = figureRect({ type: 'figure', box: [150, 80, 210, 380] }, { x: 0, y: 0, w: 2500, h: 2500 })
    expect(r.h).toBe(525)
    expect(r.w / r.h).toBeCloseTo(FIGURE_W / FIGURE_H)
    expect(r.x).toBeCloseTo(950 + 37.5)
    expect(r.y).toBe(375)
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

describe('sampleYRange', () => {
  it('covers the whole curve with padding', () => {
    const [lo, hi] = sampleYRange(['x^2 - 4'], [-5, 5])!
    expect(lo).toBeLessThan(-4) // the vertex is inside the window
    expect(lo).toBeGreaterThan(-8)
    expect(hi).toBeGreaterThan(21)
    expect(hi).toBeLessThan(25)
  })

  it('covers every expression', () => {
    const [lo, hi] = sampleYRange(['sin(x)', 'x + 10'], [0, 5])!
    expect(lo).toBeLessThan(-0.9)
    expect(hi).toBeGreaterThan(15)
  })

  it('ignores non-finite samples and clips asymptotes', () => {
    const [lo, hi] = sampleYRange(['1/x'], [-5, 5])!
    expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true)
    expect(hi).toBeLessThan(20)
    expect(lo).toBeGreaterThan(-20)
    const [tlo, thi] = sampleYRange(['tan(x)'], [-5, 5])!
    expect(thi - tlo).toBeLessThan(60)
    const [slo, shi] = sampleYRange(['sqrt(x)'], [-4, 4])! // complex for x < 0: skipped
    expect(slo).toBeLessThan(0)
    expect(shi).toBeGreaterThan(2)
    expect(shi).toBeLessThan(3)
  })

  it('gives a flat line some room, and gives up on nonsense', () => {
    expect(sampleYRange(['3'], [-1, 1])).toEqual([2, 4])
    expect(sampleYRange(['((('], [-1, 1])).toBeUndefined()
    expect(sampleYRange([], [-1, 1])).toBeUndefined()
  })
})
