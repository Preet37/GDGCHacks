import { classOf } from './chars'
import { FONT_CAP, fontGlyph } from './hershey'
import type { LineStats, Sample } from './lines'
import { median } from './strokes'

/** Everything learned about one person's handwriting. Plain data: it is stored as JSON. */
export interface Bank {
  v: 1
  /** examples of each character, newest last */
  samples: Record<string, Sample[]>
  /** measurements, one entry per line learned from (newest last) */
  tight: number[]
  loose: number[]
  slant: number[]
  cap: number[]
  xHeight: number[]
  /** how many lines have been learned from */
  lines: number
}

export const BANK_KEY = 'tutor.glyphs.v1'
/** Examples kept per character: enough that repeats differ, few enough to store. */
export const MAX_SAMPLES = 5
const MAX_MEASURES = 60

/** Gaps used before the student's own are known, in x-heights. */
export const DEFAULT_TIGHT = 0.2
export const DEFAULT_LOOSE = 0.5

export function emptyBank(): Bank {
  return { v: 1, samples: {}, tight: [], loose: [], slant: [], cap: [], xHeight: [], lines: 0 }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const keep = (list: number[], more: number[]) => [...list, ...more.filter(Number.isFinite)].slice(-MAX_MEASURES)

/** Add what one line taught. Returns how many new samples were kept. */
export function learnLine(bank: Bank, line: LineStats): number {
  let added = 0
  for (const sample of line.samples) {
    const list = (bank.samples[sample.c] ??= [])
    if (sample.src && list.some((s) => s.src === sample.src)) continue
    list.push(sample)
    added++
    // when full, an example learned from an exponent goes before a full-size one, else the oldest
    while (list.length > MAX_SAMPLES) {
      const sup = list.findIndex((s) => s.sup)
      list.splice(sup >= 0 && list.some((s) => !s.sup) ? sup : 0, 1)
    }
  }
  if (!added) return 0
  bank.tight = keep(bank.tight, line.tight)
  bank.loose = keep(bank.loose, line.loose)
  bank.slant = keep(bank.slant, line.slant === null ? [] : [line.slant])
  bank.cap = keep(bank.cap, line.cap === null ? [] : [line.cap])
  bank.xHeight = keep(bank.xHeight, [line.xHeight])
  bank.lines++
  return added
}

export interface HandMetrics {
  /** gap between two plain neighbours, and around an operator, in x-heights */
  tight: number
  loose: number
  /** lean of the writing: sideways per unit upwards */
  slant: number
  /** height of digits and capitals, in x-heights */
  cap: number
  /** how wide the student's characters are next to the stroke font's (1 = the same) */
  squeeze: number
  /** height of a small letter on the page, in page units (null until a line has been learned) */
  xHeight: number | null
}

export function metricsOf(bank: Bank): HandMetrics {
  const or = (list: number[], fallback: number) => (list.length ? median(list) : fallback)
  const slant = clamp(or(bank.slant, 0), -0.45, 0.6)
  const cap = clamp(or(bank.cap, FONT_CAP), 1, 2)

  // width of the student's letters and digits over the font's, with the lean taken out of both
  const ratios: number[] = []
  for (const [char, list] of Object.entries(bank.samples)) {
    const kind = classOf(char)
    const glyph = kind === 'small' || kind === 'tall' ? fontGlyph(char) : null
    if (!glyph) continue
    const fontW = (glyph.inkRight - glyph.inkLeft) * (kind === 'tall' ? cap / FONT_CAP : 1)
    if (fontW < 0.3) continue // a 1 or an l has no width to compare
    for (const s of list) {
      // stand the sample upright again, then measure it
      let lo = Infinity
      let hi = -Infinity
      for (const flat of s.s)
        for (let i = 0; i + 1 < flat.length; i += 3) {
          const x = flat[i] + slant * flat[i + 1]
          if (x < lo) lo = x
          if (x > hi) hi = x
        }
      if (hi > lo) ratios.push((hi - lo) / fontW)
    }
  }
  return {
    tight: clamp(or(bank.tight, DEFAULT_TIGHT), 0.06, 0.6),
    loose: clamp(or(bank.loose, DEFAULT_LOOSE), 0.25, 1.1),
    slant,
    cap,
    squeeze: ratios.length >= 3 ? clamp(median(ratios), 0.6, 1.35) : 1,
    xHeight: bank.xHeight.length ? median(bank.xHeight) : null,
  }
}

export function sampleCount(bank: Bank): number {
  return Object.values(bank.samples).reduce((n, l) => n + l.length, 0)
}

export function knownChars(bank: Bank): string[] {
  return Object.keys(bank.samples).filter((c) => bank.samples[c].length > 0)
}

function isBank(v: unknown): v is Bank {
  const b = v as Bank
  return !!b && b.v === 1 && typeof b.samples === 'object' && b.samples !== null && ['tight', 'loose', 'slant', 'cap', 'xHeight'].every((k) => Array.isArray((b as unknown as Record<string, unknown>)[k]))
}

let memory: Bank | null = null

/** The bank for this device: from memory, else from localStorage, else empty. Never throws. */
export function getBank(): Bank {
  if (memory) return memory
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(BANK_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    memory = isBank(parsed) ? parsed : emptyBank()
  } catch {
    memory = emptyBank()
  }
  return memory
}

/** Keep the bank in memory and write it to localStorage (a full or blocked store is ignored). */
export function saveBank(bank: Bank = getBank()) {
  memory = bank
  try {
    localStorage.setItem(BANK_KEY, JSON.stringify(bank))
  } catch {
    // private window or quota: the bank still works for this session
  }
}

/** Forget the learned handwriting. */
export function clearBank() {
  memory = emptyBank()
  try {
    localStorage.removeItem(BANK_KEY)
  } catch {
    // nothing stored
  }
}
