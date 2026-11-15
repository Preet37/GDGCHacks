import type { CharInk } from './assign'
import { classOf, sits } from './chars'
import { FONT_CAP } from './hershey'
import { median, slantOf, thin } from './strokes'
import type { Rect, Stroke } from './types'

/** One learned example of a character, in a frame every line shares. */
export interface Sample {
  /** the character */
  c: string
  /**
   * its strokes, each a flat list x,y,z,x,y,z...: x from the left edge of the ink, y from the
   * baseline (up is negative), both in x-heights of the line it came from; z is pen pressure
   */
  s: number[][]
  /** width of the ink, in x-heights */
  w: number
  /** written as a raised exponent: kept at the size and place of a normal character */
  sup?: 1
  /** where it came from (id of its first stroke), so the same ink is never learned twice */
  src?: string
}

/** What one line of handwriting says about the hand. */
export interface LineStats {
  samples: Sample[]
  /** y of the baseline at the line's left end, and its slope, in page units */
  baseline: number
  slope: number
  /** height of a small letter (x), page units */
  xHeight: number
  /** tall characters (digits, capitals) over small ones; null if the line has only one kind */
  cap: number | null
  /** gaps between neighbouring characters, in x-heights: plain neighbours, and around an operator */
  tight: number[]
  loose: number[]
  /** lean of the writing (sideways per unit upwards); null if the line has no upright stems to measure */
  slant: number | null
  rect: Rect
}

/** Points kept per stroke: enough for the shape of a letter, small enough to store hundreds. */
export const MAX_POINTS = 36
/** Baselines drift, they don't climb: steeper than this is a bad fit. */
const MAX_SLOPE = 0.2

/** Characters with an upright stem: their lean is the lean of the hand (an x or a 7 is diagonal anyway). */
const STEMS = '1bdfhlpqtgjBDEFHIJLPT()[]|+'

const r2 = (v: number) => Math.round(v * 100) / 100

/** Split characters into lines of writing (top to bottom), each sorted left to right. */
export function groupLines(chars: CharInk[]): CharInk[][] {
  if (!chars.length) return []
  const standing = chars.filter((c) => sits(c.char))
  const h = median((standing.length ? standing : chars).map((c) => c.rect.h)) || 1
  const sorted = [...chars].sort((a, b) => a.rect.y + a.rect.h / 2 - (b.rect.y + b.rect.h / 2))
  const lines: CharInk[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    // exponents and primes sit up to most of a line height above their line; the next line is further
    if (cur.rect.y + cur.rect.h / 2 - (prev.rect.y + prev.rect.h / 2) > h) lines.push([])
    lines[lines.length - 1].push(cur)
  }
  return lines.map((l) => l.sort((a, b) => a.rect.x - b.rect.x))
}

function fitLine(pts: { x: number; y: number }[]): { at0: number; slope: number } {
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
  const slope = sxx > 0 ? sxy / sxx : 0
  return { at0: my - slope * mx, slope }
}

function pack(strokes: Stroke[], x0: number, yOf: (x: number) => number, unit: number): number[][] {
  return strokes.map((s) => thin(s, MAX_POINTS).flatMap((p) => [r2((p.x - x0) / unit), r2((p.y - yOf(p.x)) / unit), r2(p.z ?? 0.5)]))
}

/**
 * Measure one line (its characters, left to right) and turn each character into a sample.
 * Returns null when the line has nothing standing on a baseline to measure against.
 */
export function measureLine(line: CharInk[], srcOf?: (c: CharInk) => string | undefined): LineStats | null {
  const standing = line.filter((c) => sits(c.char) && c.rect.h > 0)
  if (!standing.length) return null
  const typicalH = median(standing.map((c) => c.rect.h))

  // first guess at the baseline, then set aside what is written clearly above it (exponents)
  const rough = median(standing.map((c) => c.rect.y + c.rect.h))
  const raised = new Set(
    standing.length >= 2 ? standing.filter((c) => c.rect.y + c.rect.h < rough - typicalH * 0.45 && c.rect.h < typicalH * 1.3) : [],
  )
  const onLine = standing.filter((c) => !raised.has(c))
  if (!onLine.length) return null

  const feet = onLine.map((c) => ({ x: c.rect.x + c.rect.w / 2, y: c.rect.y + c.rect.h }))
  const x0 = Math.min(...line.map((c) => c.rect.x))
  let slope = 0
  let at0 = median(feet.map((p) => p.y))
  const span = Math.max(...feet.map((p) => p.x)) - Math.min(...feet.map((p) => p.x))
  if (feet.length >= 4 && span > typicalH * 3) {
    const fit = fitLine(feet)
    if (Math.abs(fit.slope) <= MAX_SLOPE) {
      slope = fit.slope
      at0 = fit.at0
    }
  }
  const baseAt = (x: number) => at0 + slope * x

  const smalls = onLine.filter((c) => classOf(c.char) === 'small').map((c) => c.rect.h)
  const talls = onLine.filter((c) => classOf(c.char) === 'tall').map((c) => c.rect.h)
  const xHeight = smalls.length ? median(smalls) : median(talls) / FONT_CAP
  if (!(xHeight > 0)) return null
  // people often write x as tall as their digits: never let "tall" come out shorter than "small"
  const cap = smalls.length && talls.length ? Math.max(1, median(talls) / xHeight) : null
  const tallH = xHeight * (cap ?? FONT_CAP)

  const samples: Sample[] = []
  for (const c of line) {
    const kind = classOf(c.char)
    // nothing a person writes as one character is this big next to its neighbours (except an integral sign)
    if (c.rect.w > xHeight * 5 || c.rect.h > xHeight * 8) continue
    if (c.char === '=' && c.strokes.length < 2 && c.rect.h < xHeight * 0.15) continue // half an equals sign
    let s: number[][]
    let w: number
    if (raised.has(c)) {
      // an exponent: blow it up to the size a normal character of its kind has, standing on the baseline
      const unit = c.rect.h / (kind === 'small' ? 1 : tallH / xHeight)
      const foot = c.rect.y + c.rect.h
      s = pack(c.strokes, c.rect.x, () => foot, unit)
      w = c.rect.w / unit
    } else if (sits(c.char)) {
      // stands on the baseline: any drift of this one character is left out
      const foot = c.rect.y + c.rect.h
      s = pack(c.strokes, c.rect.x, () => foot, xHeight)
      w = c.rect.w / xHeight
    } else {
      s = pack(c.strokes, c.rect.x, baseAt, xHeight)
      w = c.rect.w / xHeight
    }
    const sample: Sample = { c: c.char, s, w: r2(w) }
    if (raised.has(c)) sample.sup = 1
    const src = srcOf?.(c)
    if (src) sample.src = src
    samples.push(sample)
  }

  const tight: number[] = []
  const loose: number[] = []
  const row = line.filter((c) => !raised.has(c) && classOf(c.char) !== 'high')
  for (let i = 1; i < row.length; i++) {
    const gap = (row[i].rect.x - (row[i - 1].rect.x + row[i - 1].rect.w)) / xHeight
    if (gap > 2.5) continue // a space between two expressions, not between two characters
    const around = classOf(row[i].char) === 'float' || classOf(row[i - 1].char) === 'float'
    ;(around ? loose : tight).push(r2(Math.max(-0.3, gap)))
  }

  const stems = line.filter((c) => STEMS.includes(c.char))
  const xs = line.map((c) => c.rect.x + c.rect.w)
  const top = Math.min(...line.map((c) => c.rect.y))
  const bottom = Math.max(...line.map((c) => c.rect.y + c.rect.h))
  return {
    samples,
    baseline: baseAt(x0),
    slope,
    xHeight,
    cap,
    tight,
    loose,
    slant: stems.length ? slantOf(stems.flatMap((c) => c.strokes)) : null,
    rect: { x: x0, y: top, w: Math.max(...xs) - x0, h: bottom - top },
  }
}
