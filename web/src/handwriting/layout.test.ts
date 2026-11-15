import { describe, expect, it } from 'vitest'
import { emptyBank, learnLine, metricsOf } from './bank'
import { FONT_CAP, fontGlyph } from './hershey'
import { chooseMode, gapBetween, layoutText, MIN_BANK_CHARS, SCRIPT_SCALE, tokenize } from './layout'
import { groupLines, measureLine } from './lines'
import { boundsOf } from './strokes'
import { bankFrom, writeLine } from './testHand'

const bank = bankFrom(['f(x) = 3x^2 + 12x - 7', 'y = 2x + 1', 'x = 4 - 6'])
const still = { seed: 1, jitter: 0 }

describe('tokenize', () => {
  it('reads the tutor\'s LaTeX-ish answers', () => {
    expect(tokenize('12x').map((t) => t.c).join('')).toBe('12x')
    expect(tokenize('3 x^{2} + 2').map((t) => `${t.c}${t.level || ''}`)).toEqual(['3', 'x', '21', '+', '2'])
    expect(tokenize('x = \\pm 1').map((t) => t.c)).toEqual(['x', '=', '±', '1'])
    expect(tokenize('$6x - 12$').map((t) => t.c).join('')).toBe('6x-12')
    expect(tokenize('\\frac{1}{2}').map((t) => t.c).join('')).toBe('1/2')
  })

  it('raises exponents and lowers indices, one character each', () => {
    expect(tokenize('x^{n+1}').map((t) => `${t.c}${t.level}`)).toEqual(['x0', 'n1', '+1', '11'])
    expect(tokenize('x^{10}').map((t) => t.level)).toEqual([0, 1, 1])
    expect(tokenize('a_1 + a_{2}').map((t) => `${t.c}${t.level}`)).toEqual(['a0', '1-1', '+0', 'a0', '2-1'])
    expect(tokenize("f'(x)").map((t) => t.c).join('')).toBe("f'(x)")
  })

  it('remembers where the spaces were', () => {
    expect(tokenize('x = 1').map((t) => t.spaced)).toEqual([false, true, true])
  })
})

describe('chooseMode (the fallback rule)', () => {
  it('does nothing until enough of the hand is known', () => {
    expect(chooseMode(tokenize('12x'), emptyBank())).toBeNull()
    const few = bankFrom(['x = 1'])
    expect(Object.keys(few.samples).length).toBeLessThan(MIN_BANK_CHARS)
    expect(chooseMode(tokenize('x = 1'), few)).toBeNull()
    expect(layoutText('x = 1', few)).toBeNull()
  })

  it('writes by hand when most of the characters have been learned', () => {
    expect(chooseMode(tokenize('12x'), bank)).toBe('hand')
    expect(chooseMode(tokenize('x = \\pm 1'), bank)).toBe('hand') // 3 of 4 known: the ± comes from the font
    expect(chooseMode(tokenize('3x^2 + 2'), bank)).toBe('hand')
  })

  it('writes the whole string in the font when too few are known, so it is not a ransom note', () => {
    expect(chooseMode(tokenize('5a + 9b = 80'), bank)).toBe('font')
    const l = layoutText('5a + 9b = 80', bank, still)!
    expect(l.mode).toBe('font')
    // letters and digits all come from the font, even ones the bank does not have... and none from the hand
    expect(l.glyphs.filter((g) => !'+='.includes(g.c)).every((g) => g.from === 'font')).toBe(true)
  })

  it('refuses a character that neither the bank nor the font can draw', () => {
    expect(chooseMode(tokenize('x = 🙂'), bank)).toBeNull()
    expect(layoutText('12 ∰ x', bank)).toBeNull()
  })

  it('has a font glyph for everything a tutor answer is made of', () => {
    for (const c of '0123456789abcdefghijklmnopqrstuvwxyzABCXYZ+-=/*()[].,\'<>±×·√∫π≠≤≥') expect(fontGlyph(c), c).not.toBeNull()
    expect(fontGlyph(' ')).toBeNull()
  })
})

describe('layoutText', () => {
  it('stands every full-size character on the baseline', () => {
    const l = layoutText('12x', bank, still)!
    expect(l.mode).toBe('hand')
    expect(l.glyphs.map((g) => g.c).join('')).toBe('12x')
    for (const g of l.glyphs) {
      const b = boundsOf(g.strokes)!
      expect(b.y + b.h).toBeCloseTo(0, 1)
      expect(g.from).toBe('hand')
    }
    // digits are taller than the x, as the student writes them
    const h = l.glyphs.map((g) => boundsOf(g.strokes)!.h)
    expect(h[0]).toBeCloseTo(FONT_CAP, 1)
    expect(h[2]).toBeCloseTo(1, 1)
  })

  it('goes left to right without overlaps, in order', () => {
    const l = layoutText('3x^2 + 12x - 7', bank, still)!
    for (let i = 1; i < l.glyphs.length; i++) expect(l.glyphs[i].x).toBeGreaterThanOrEqual(l.glyphs[i - 1].x + l.glyphs[i - 1].w - 1e-6)
    expect(l.width).toBeCloseTo(l.glyphs.at(-1)!.x + l.glyphs.at(-1)!.w, 5)
  })

  it('writes an exponent smaller and raised, close to its base', () => {
    const l = layoutText('3 x^{2} + 2', bank, still)!
    const [, x, sup, , two] = l.glyphs
    const sb = boundsOf(sup.strokes)!
    const tb = boundsOf(two.strokes)!
    expect(sup.level).toBe(1)
    expect(sb.h).toBeCloseTo(tb.h * SCRIPT_SCALE, 1)
    expect(sb.y + sb.h).toBeLessThan(-0.5) // its foot is well above the baseline
    expect(sb.y).toBeLessThan(tb.y) // and it reaches above the full-size digits
    expect(sup.x - (x.x + x.w)).toBeLessThan(0.15)
  })

  it('spaces with the student\'s own gaps: wide around operators, narrow between neighbours', () => {
    const m = metricsOf(bank)
    expect(m.tight).toBeCloseTo(0.2, 1)
    expect(m.loose).toBeCloseTo(0.5, 1)
    const l = layoutText('12x + 7', bank, still)!
    const gap = (i: number) => l.glyphs[i].x - (l.glyphs[i - 1].x + l.glyphs[i - 1].w)
    expect(gap(1)).toBeCloseTo(m.tight, 2) // 1|2
    expect(gap(2)).toBeCloseTo(m.tight, 2) // 2|x
    expect(gap(3)).toBeCloseTo(m.loose, 2) // x|+
    expect(gap(4)).toBeCloseTo(m.loose, 2) // +|7
  })

  it('keeps a sign with its number', () => {
    const m = metricsOf(bank)
    const t = tokenize('x = -3')
    expect(gapBetween(t, 3, m)).toBe(m.tight) // -|3
    expect(gapBetween(t, 2, m)).toBe(m.loose) // =|-
    const pm = tokenize('x = \\pm 1')
    expect(gapBetween(pm, 3, m)).toBe(m.tight)
  })

  it('varies size and position a little from one writing to the next, and repeats exactly with the same seed', () => {
    const a = layoutText('1 + 1', bank, { seed: 3 })!
    const b = layoutText('1 + 1', bank, { seed: 4 })!
    expect(JSON.stringify(a.glyphs)).not.toBe(JSON.stringify(b.glyphs))
    expect(JSON.stringify(layoutText('1 + 1', bank, { seed: 3 }))).toBe(JSON.stringify(a))
    // the variation is small: every character still stands within a tenth of an x-height of the baseline
    for (const g of [...a.glyphs, ...b.glyphs].filter((g) => g.c === '1')) {
      const r = boundsOf(g.strokes)!
      expect(Math.abs(r.y + r.h)).toBeLessThan(0.1)
    }
  })

  it('never picks the same sample twice in a row when there is a choice', () => {
    const b = bankFrom(['1 + 1 = 2', '2 - 1 = 1', '1 + 2 = 3'])
    // tag each sample of "1" by a distinct pressure value
    b.samples['1'].forEach((s, i) => s.s.forEach((flat) => flat.forEach((_, k) => k % 3 === 2 && (flat[k] = (i + 1) / 10))))
    for (let seed = 1; seed < 40; seed++) {
      const tags = layoutText('1111', b, { seed })!.glyphs.map((g) => g.strokes[0][0].z)
      for (let i = 1; i < tags.length; i++) expect(tags[i]).not.toBe(tags[i - 1])
    }
  })

  it('prefers a full-size sample over one learned from an exponent', () => {
    const b = bankFrom(['x^2 + 2x = 12', 'y = 3x + 1'])
    b.samples['2'].forEach((s) => s.s.forEach((flat) => flat.forEach((_, k) => k % 3 === 2 && (flat[k] = s.sup ? 0.9 : 0.1))))
    for (let seed = 1; seed < 20; seed++) expect(layoutText('2', b, { seed })!.glyphs[0].strokes[0][0].z).toBe(0.1)
  })

  it('shapes font characters like the hand: its lean and its digit height', () => {
    const leaning = emptyBank()
    const w = writeLine('f(1) + 1 = 11 + bd', 100, 300, 40)
    for (const c of w.chars) {
      c.strokes = c.strokes.map((s) => s.map((p) => ({ ...p, x: p.x - 0.3 * (p.y - 300) })))
      c.rect = boundsOf(c.strokes)!
    }
    learnLine(leaning, measureLine(groupLines(w.chars)[0])!)
    expect(metricsOf(leaning).slant).toBeCloseTo(0.3, 1)
    const l = layoutText('1 = 9', leaning, { ...still, mode: 'font' })!
    const nine = l.glyphs[2]
    expect(nine.from).toBe('font')
    // the top of the 9 is to the right of its foot
    const pts = nine.strokes.flat()
    const top = pts.reduce((a, p) => (p.y < a.y ? p : a))
    const foot = pts.reduce((a, p) => (p.y > a.y ? p : a))
    expect(top.x).toBeGreaterThan(foot.x)
  })
})
