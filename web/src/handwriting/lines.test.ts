import { describe, expect, it } from 'vitest'
import { FONT_CAP } from './hershey'
import { groupLines, measureLine, MAX_POINTS } from './lines'
import { writeLine } from './testHand'

const ys = (flat: number[]) => flat.filter((_, i) => i % 3 === 1)
const xs = (flat: number[]) => flat.filter((_, i) => i % 3 === 0)

describe('groupLines', () => {
  it('splits characters into lines, each left to right, exponents and primes with their line', () => {
    const w = writeLine("f'(x) = 6x", 100, 500, 40, writeLine('y = 3x^2 + 1', 100, 300, 40))
    const lines = groupLines([...w.chars].reverse())
    expect(lines.map((l) => l.map((c) => c.char).join(''))).toEqual(['y=3x2+1', "f'(x)=6x"])
  })
})

describe('measureLine', () => {
  const w = writeLine('y = 3x^2 + 12x - 7', 100, 300, 40)
  const stats = measureLine(groupLines(w.chars)[0])!

  it('finds the baseline and the x-height of the line', () => {
    expect(stats.baseline).toBeCloseTo(300, 0)
    expect(stats.xHeight).toBeCloseTo(40, 0)
    expect(stats.cap).toBeCloseTo(FONT_CAP, 1)
    expect(Math.abs(stats.slope)).toBeLessThan(0.01)
  })

  it('follows a baseline that drifts upwards', () => {
    const tilted = writeLine('2x + 31x + 17x', 100, 300, 40)
    for (const c of tilted.chars) {
      const dy = -(c.rect.x - 100) * 0.05
      c.rect = { ...c.rect, y: c.rect.y + dy }
      c.strokes = c.strokes.map((s) => s.map((p) => ({ ...p, y: p.y + dy })))
    }
    const t = measureLine(groupLines(tilted.chars)[0])!
    expect(t.slope).toBeCloseTo(-0.05, 1)
    // a sample still stands on the baseline: the drift is not baked into it
    const one = t.samples.find((s) => s.c === '7')!
    expect(Math.max(...one.s.flatMap(ys))).toBeCloseTo(0, 1)
  })

  it('stores each character in the common frame: left edge at 0, standing on the baseline, in x-heights', () => {
    const x = stats.samples.find((s) => s.c === 'x')!
    expect(Math.min(...x.s.flatMap(xs))).toBeCloseTo(0, 2)
    expect(Math.max(...x.s.flatMap(ys))).toBeCloseTo(0, 2)
    expect(Math.min(...x.s.flatMap(ys))).toBeCloseTo(-1, 1)
    const three = stats.samples.find((s) => s.c === '3')!
    expect(Math.min(...three.s.flatMap(ys))).toBeCloseTo(-FONT_CAP, 1)
    expect(three.w).toBeGreaterThan(0.5)
    // a descender hangs below the baseline, an operator floats above it
    const y = stats.samples.find((s) => s.c === 'y')!
    expect(Math.max(...y.s.flatMap(ys))).toBeGreaterThan(0.3)
    const eq = stats.samples.find((s) => s.c === '=')!
    expect(Math.max(...eq.s.flatMap(ys))).toBeLessThan(-0.2)
  })

  it('recognises an exponent and stores it at full size on the baseline', () => {
    const two = stats.samples.filter((s) => s.c === '2')
    expect(two).toHaveLength(2)
    const raised = two.find((s) => s.sup)!
    const normal = two.find((s) => !s.sup)!
    expect(raised).toBeTruthy()
    expect(Math.max(...raised.s.flatMap(ys))).toBeCloseTo(0, 2)
    expect(Math.min(...raised.s.flatMap(ys))).toBeCloseTo(Math.min(...normal.s.flatMap(ys)), 1)
    expect(raised.w).toBeCloseTo(normal.w, 1)
    // and the exponent did not drag the baseline up
    expect(stats.baseline).toBeCloseTo(300, 0)
  })

  it('measures the gaps: wider around operators than between neighbours', () => {
    const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]
    expect(med(stats.tight)).toBeCloseTo(0.2, 1)
    expect(med(stats.loose)).toBeCloseTo(0.5, 1)
  })

  it('keeps samples small', () => {
    for (const s of stats.samples) for (const flat of s.s) expect(flat.length).toBeLessThanOrEqual(MAX_POINTS * 3)
  })

  it('measures the lean of the writing from its stems', () => {
    const leaning = writeLine('f(1) + 1 = 11', 100, 300, 40)
    for (const c of leaning.chars) c.strokes = c.strokes.map((s) => s.map((p) => ({ ...p, x: p.x - 0.3 * (p.y - 300) })))
    expect(measureLine(leaning.chars)!.slant).toBeCloseTo(0.3, 1)
    expect(measureLine(writeLine('1 + 1', 100, 300, 40).chars)!.slant).toBeCloseTo(0, 1)
    // an x and a 7 are diagonal in anyone's hand: they say nothing about the lean
    expect(measureLine(writeLine('7x', 100, 300, 40).chars)!.slant).toBeNull()
  })

  it('gives up on a line with nothing standing on a baseline', () => {
    expect(measureLine(writeLine('= + -', 100, 300, 40).chars)).toBeNull()
  })

  it('works from digits alone when there are no small letters', () => {
    const digits = measureLine(writeLine('12 + 7 = 19', 100, 300, 40).chars)!
    expect(digits.xHeight).toBeCloseTo(40, 0)
    expect(digits.cap).toBeNull()
  })
})
