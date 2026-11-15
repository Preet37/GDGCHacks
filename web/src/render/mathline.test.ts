import { describe, expect, it } from 'vitest'
import { TEXT_LINE_HEIGHT } from './geometry'
import { domMathMeasure, estimateMath, needsTypeset, stepTex, texHtml } from './mathline'

describe('needsTypeset', () => {
  it('is true for what plain text cannot show', () => {
    for (const tex of ['\\frac{4x^4}{4} + \\frac{2x^2}{2} + C', '\\dfrac{dy}{dx} = 3x^2', 'x = \\sqrt{2}', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', '\\int x^2 \\, dx', 'x^{n+1}', 'a_{ij}', 'e^{-x}', '\\sum_{i=1}^{n} i']) {
      expect(needsTypeset(tex), tex).toBe(true)
    }
  })

  it('is false for a line that reads well as text', () => {
    for (const tex of ['3x^2 = 3', 'x^2 = 1', 'x = \\pm 1', 'x^4 + x^2 + C', '2 \\cdot 3 = 6', '\\sin 30^\\circ = 0.5', 'x_1 + x_2 = 5', 'x = 2 or x = 3']) {
      expect(needsTypeset(tex), tex).toBe(false)
    }
  })
})

describe('stepTex', () => {
  it('sets fractions full size and leaves the LaTeX as it is', () => {
    expect(stepTex('x = \\frac{1}{2}')).toBe('\\displaystyle x = \\frac{1}{2}')
    expect(stepTex(' \\sin 30^\\circ = \\frac{1}{2} ')).toBe('\\displaystyle \\sin 30^\\circ = \\frac{1}{2}')
  })

  it('keeps words as words, with their spaces', () => {
    expect(stepTex('x = 2 or x = -3')).toBe('\\displaystyle x = 2 \\text{ or } x = -3')
    expect(stepTex('Divide both sides by 3')).toBe('\\displaystyle \\text{Divide both sides by } 3')
    expect(stepTex('sin x = \\frac{1}{2}')).toBe('\\displaystyle \\sin  x = \\frac{1}{2}')
    expect(stepTex('v = u + at')).toBe('\\displaystyle v = u + at') // a product, not a word
    expect(stepTex('b^2 - 4ac')).toBe('\\displaystyle b^2 - 4ac')
    expect(stepTex('\\text{area} = \\operatorname{lcm}(a, b)')).toBe('\\displaystyle \\text{area} = \\operatorname{lcm}(a, b)')
  })

  it('takes inline $math$ among words', () => {
    expect(stepTex('So $x = \\frac{1}{2}$ here')).toBe('\\displaystyle \\text{So }x = \\frac{1}{2}\\text{ here}')
    expect(stepTex('50% of \\(x\\)')).toBe('\\displaystyle \\text{50\\% of }x')
  })

  it('gives KaTeX something it can typeset', () => {
    for (const s of ['x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', 'x = 2 or x = -3', 'Divide both sides by 3', 'So $x = \\frac{1}{2}$ here', '\\int (4x^3 + 2x)\\,dx', '50% of \\(x\\)']) {
      const html = texHtml(stepTex(s))
      expect(html, s).toContain('katex')
    }
    expect(texHtml(stepTex('x = 2 or x = -3'))).toContain('or')
  })

  it('texHtml is null for what KaTeX cannot read', () => {
    expect(texHtml('\\frac{1}{')).toBeNull()
    expect(texHtml(stepTex('a & b \\\\ c'))).toBeNull()
  })
})

describe('estimateMath', () => {
  const line = 20 * TEXT_LINE_HEIGHT
  it('a stacked fraction is about two lines tall, a nested one taller, plain math one line', () => {
    expect(estimateMath('\\displaystyle x^4 + x^2 + C', 20).h).toBeCloseTo(line)
    expect(estimateMath('\\displaystyle \\frac{4x^4}{4} + \\frac{2x^2}{2}', 20).h).toBeCloseTo(line * 2)
    expect(estimateMath('\\displaystyle \\frac{\\frac{a}{b}}{c}', 20).h).toBeGreaterThan(line * 2.5)
    const root = estimateMath('\\displaystyle \\sqrt{x}', 20).h
    expect(root).toBeGreaterThan(line)
    expect(root).toBeLessThan(line * 2)
  })

  it('scales with the font and says where the equals sign is', () => {
    const a = estimateMath('x = \\frac{1}{2}', 20)
    const b = estimateMath('x = \\frac{1}{2}', 40)
    expect(b.w).toBeCloseTo(a.w * 2)
    expect(b.h).toBeCloseTo(a.h * 2)
    expect(a.eq).toBeGreaterThan(0)
    expect(a.eq!).toBeLessThan(a.w)
    expect(estimateMath('x + 1', 20).eq).toBeNull()
  })

  it('is what domMathMeasure falls back to where nothing is laid out', () => {
    expect(domMathMeasure()('x = \\frac{1}{2}', 20)).toEqual(estimateMath('x = \\frac{1}{2}', 20))
  })
})
