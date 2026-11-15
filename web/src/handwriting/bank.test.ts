import { afterEach, describe, expect, it, vi } from 'vitest'
import { BANK_KEY, clearBank, emptyBank, getBank, knownChars, learnLine, MAX_SAMPLES, metricsOf, sampleCount, saveBank } from './bank'
import { groupLines, measureLine } from './lines'
import { bankFrom, writeLine } from './testHand'

const statsOf = (text: string, tag: string) => measureLine(groupLines(writeLine(text, 100, 300, 40).chars)[0], (c) => `${tag}${c.ids[0]}`)!

describe('the glyph bank', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearBank()
  })

  it('learns each piece of ink once', () => {
    const bank = emptyBank()
    expect(learnLine(bank, statsOf('y = 2x + 1', 'a'))).toBe(6)
    expect(learnLine(bank, statsOf('y = 2x + 1', 'a'))).toBe(0) // the same strokes again
    expect(bank.lines).toBe(1)
    expect(learnLine(bank, statsOf('y = 2x + 1', 'b'))).toBe(6) // the same text, written again
    expect(bank.samples.x).toHaveLength(2)
    expect(sampleCount(bank)).toBe(12)
    expect(knownChars(bank).sort().join('')).toBe('+12=xy')
  })

  it('keeps a few samples per character, dropping exponents first, then the oldest', () => {
    const bank = emptyBank()
    learnLine(bank, statsOf('x^2 + 2x', 'a'))
    for (let i = 0; i < MAX_SAMPLES + 2; i++) learnLine(bank, statsOf('2x + 1', `n${i}`))
    expect(bank.samples['2']).toHaveLength(MAX_SAMPLES)
    expect(bank.samples['2'].some((s) => s.sup)).toBe(false)
    expect(bank.samples['2'].at(-1)!.src).toBe(`n${MAX_SAMPLES + 1}0`)
  })

  it('has sane metrics before anything is learned', () => {
    const m = metricsOf(emptyBank())
    expect(m.xHeight).toBeNull()
    expect(m.slant).toBe(0)
    expect(m.squeeze).toBe(1)
    expect(m.loose).toBeGreaterThan(m.tight)
  })

  it('notices a narrow hand', () => {
    const bank = emptyBank()
    const w = writeLine('y = 3x + 20', 100, 300, 40)
    for (const c of w.chars) {
      c.strokes = c.strokes.map((s) => s.map((p) => ({ ...p, x: c.rect.x + (p.x - c.rect.x) * 0.7 })))
      c.rect = { ...c.rect, w: c.rect.w * 0.7 }
    }
    learnLine(bank, measureLine(w.chars)!)
    expect(metricsOf(bank).squeeze).toBeCloseTo(0.7, 1)
    expect(metricsOf(bankFrom(['y = 3x + 20'])).squeeze).toBeCloseTo(1, 1)
  })

  it('is kept in localStorage and survives a bad or full store', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    clearBank()
    const bank = getBank()
    learnLine(bank, statsOf('y = 2x + 1', 'a'))
    saveBank(bank)
    expect(JSON.parse(store.get(BANK_KEY)!).samples.x).toHaveLength(1)

    store.set(BANK_KEY, '{not json')
    clearBank()
    store.set(BANK_KEY, '{"v":0}')
    expect(sampleCount(getBank())).toBe(0)

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
      removeItem: () => {},
    })
    expect(() => saveBank(bank)).not.toThrow()
    expect(getBank()).toBe(bank) // still there in memory
  })
})
