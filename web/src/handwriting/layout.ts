import { mathToPlain } from '../render/text'
import { metricsOf, knownChars, type Bank, type HandMetrics } from './bank'
import { classOf } from './chars'
import { FONT_CAP, fontGlyph } from './hershey'
import type { Sample } from './lines'
import { boundsOf, resample, rng, roundCorners, strokeLength } from './strokes'
import type { Stroke } from './types'

/** One character to write. `level` 1 = raised (an exponent), -1 = lowered (an index). */
export interface Token {
  c: string
  level: -1 | 0 | 1
  /** there was a space before it in the text */
  spaced: boolean
}

const SUPER: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+', 'ⁿ': 'n' }
const SUB: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' }
const PLAIN: Record<string, string> = { '−': '-', '–': '-', '′': "'", '’': "'", '‘': "'", '`': "'", '∗': '*' }

/**
 * The characters of a line of math, in writing order. Takes what the tutor sends (LaTeX-ish,
 * `$...$`, calculator notation): `3 x^{2} + 2`, `x = \pm 1`, `12x`.
 */
export function tokenize(text: string): Token[] {
  const chars = [...mathToPlain(text)]
  const out: Token[] = []
  let spaced = false
  const push = (c: string, level: -1 | 0 | 1) => {
    out.push({ c: PLAIN[c] ?? c, level, spaced })
    spaced = false
  }
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (/\s/.test(c)) {
      spaced = out.length > 0
    } else if (SUPER[c]) {
      push(SUPER[c], 1)
    } else if (SUB[c]) {
      push(SUB[c], -1)
    } else if ((c === '^' || c === '_') && i + 1 < chars.length) {
      const level = c === '^' ? 1 : -1
      if (chars[i + 1] === '(') {
        // x^(n+1): the bracketed part is the exponent, written without its brackets
        let depth = 0
        let j = i + 1
        for (; j < chars.length; j++) {
          if (chars[j] === '(') depth++
          else if (chars[j] === ')' && --depth === 0) break
        }
        const body = chars.slice(i + 2, j).filter((ch) => !/\s/.test(ch))
        for (const ch of body) push(ch, level)
        i = j
      } else {
        push(chars[i + 1], level)
        i++
      }
    } else {
      push(c, 0)
    }
  }
  return out
}

/** Fewer different characters learned than this: there is no hand to imitate yet. */
export const MIN_BANK_CHARS = 6
/** Below this share of the string's characters in the bank, the whole string is written in the stroke font. */
export const MIN_COVERAGE = 0.6

export type WriteMode = 'hand' | 'font'

/**
 * How to write these characters:
 * - 'hand': the student's own characters, the stroke font only for the ones not learned yet
 * - 'font': everything in the stroke font (slanted and sized like the student's writing), because a
 *   line that is mostly font with one or two real characters in it looks like a ransom note
 * - null: don't (nothing learned yet, or a character neither the bank nor the font can draw)
 */
export function chooseMode(tokens: Token[], bank: Bank): WriteMode | null {
  if (!tokens.length) return null
  if (knownChars(bank).length < MIN_BANK_CHARS) return null
  let learned = 0
  for (const t of tokens) {
    if (bank.samples[t.c]?.length) learned++
    else if (!fontGlyph(t.c)) return null
  }
  return learned / tokens.length >= MIN_COVERAGE ? 'hand' : 'font'
}

export interface PlacedGlyph {
  c: string
  from: WriteMode
  level: -1 | 0 | 1
  /** strokes in x-heights: x from the start of the line, y from the baseline (up is negative) */
  strokes: Stroke[]
  /** left edge and width of the ink */
  x: number
  w: number
}

export interface Layout {
  mode: WriteMode
  glyphs: PlacedGlyph[]
  /** width of the whole line, in x-heights */
  width: number
  metrics: HandMetrics
}

/** Size of an exponent or index next to a full-size character. */
export const SCRIPT_SCALE = 0.62
/** An exponent stands this far up, as a share of the height of a digit. */
export const SUP_RAISE = 0.6
/** An index hangs this far below the baseline, in x-heights. */
export const SUB_DROP = 0.3
/** Operators in the stroke font are wider than people write them. */
const FONT_OP_SCALE = 0.72

function unpack(sample: Sample): Stroke[] {
  return sample.s.map((flat) => {
    const s: Stroke = []
    for (let i = 0; i + 2 < flat.length; i += 3) s.push({ x: flat[i], y: flat[i + 1], z: flat[i + 2] })
    return s
  })
}

/** The stroke font's version of a character, shaped like this hand: its slant, its digit height, a slight wobble. */
export function fontStrokes(char: string, m: HandMetrics, rand: () => number): Stroke[] | null {
  const glyph = fontGlyph(char)
  if (!glyph) return null
  const kind = classOf(char)
  const tall = m.cap / FONT_CAP
  const k = kind === 'float' ? FONT_OP_SCALE * tall : kind === 'small' || kind === 'hang' || kind === 'low' ? 1 : tall
  // one slow wave per glyph, so straight font lines bend a little like a hand does
  const phase = rand() * Math.PI * 2
  const amp = 0.025
  const strokes = glyph.strokes.map((raw) => {
    const smooth = roundCorners(raw)
    const pts = resample(smooth, Math.max(2, Math.ceil(strokeLength(smooth) / 0.08) + 1))
    return pts.map((p, i) => {
      const x = p.x * k * m.squeeze
      const y = p.y * k
      const wave = Math.sin(phase + (x + y) * 2.2 + i * 0.05) * amp
      return { x: x - m.slant * y + wave, y: y + Math.cos(phase + x * 2.6) * amp, z: 0.5 }
    })
  })
  const b = boundsOf(strokes)!
  return strokes.map((s) => s.map((p) => ({ ...p, x: p.x - b.x })))
}

/** Scale a glyph about its left edge on the baseline, turn it a little about its middle, and move it to (dx, dy). */
function place(strokes: Stroke[], left: number, width: number, scale: number, angle: number, dx: number, dy: number): Stroke[] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const cx = (width * scale) / 2
  const cy = -0.5 * scale
  return strokes.map((s) =>
    s.map((p) => {
      const x = (p.x - left) * scale - cx
      const y = p.y * scale - cy
      return { x: cx + x * cos - y * sin + dx, y: cy + x * sin + y * cos + dy, z: p.z }
    }),
  )
}

export interface LayoutOptions {
  /** same seed, same layout (for tests); default: different every time */
  seed?: number
  /** 0 = no variation between repeats, 1 = normal */
  jitter?: number
  /** write everything in the stroke font, or everything possible by hand, whatever the coverage */
  mode?: WriteMode
}

/**
 * Lay out one line of text in the student's hand. Units are x-heights; the caller scales to the page.
 * Null when it can't or shouldn't be written by hand (see chooseMode).
 */
export function layoutText(text: string, bank: Bank, opts: LayoutOptions = {}): Layout | null {
  const tokens = tokenize(text)
  const mode = chooseMode(tokens, bank) && (opts.mode ?? chooseMode(tokens, bank))
  if (!mode) return null
  const m = metricsOf(bank)
  const rand = rng(opts.seed ?? (Math.random() * 2 ** 32) >>> 0)
  const jitter = opts.jitter ?? 1
  const wob = (amount: number) => (rand() - 0.5) * 2 * amount * jitter
  const lastUsed = new Map<string, number>()

  const glyphs: PlacedGlyph[] = []
  let cursor = 0
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1]
    if (prev) cursor += gapBetween(tokens, i, m) + wob(0.03)

    let strokes: Stroke[] | null = null
    let from: WriteMode = 'font'
    // operators are a couple of plain bars in anyone's hand: the student's own are used even in a font line
    const list = mode === 'hand' || classOf(t.c) === 'float' ? bank.samples[t.c] : undefined
    if (list?.length) {
      // full-size examples first; an example learned from an exponent only when there is nothing else
      const full = list.map((s, idx) => ({ s, idx })).filter((e) => !e.s.sup)
      const pool = full.length ? full : list.map((s, idx) => ({ s, idx }))
      const fresh = pool.length > 1 ? pool.filter((e) => e.idx !== lastUsed.get(t.c)) : pool
      const pick = fresh[Math.floor(rand() * fresh.length)]
      lastUsed.set(t.c, pick.idx)
      strokes = unpack(pick.s)
      from = 'hand'
    } else {
      strokes = fontStrokes(t.c, m, rand)
    }
    if (!strokes) return

    const b = boundsOf(strokes)
    if (!b) return
    const script = t.level !== 0
    const scale = (script ? SCRIPT_SCALE : 1) * (1 + wob(0.04))
    const lift = t.level === 1 ? -SUP_RAISE * m.cap : t.level === -1 ? SUB_DROP : 0
    const placed = place(strokes, b.x, b.w, scale, wob(0.035), cursor, lift + wob(0.04))
    const pb = boundsOf(placed)!
    // rotation can push the ink left of the cursor: keep the gap that was asked for
    const shift = cursor - pb.x
    const final = shift ? placed.map((s) => s.map((p) => ({ ...p, x: p.x + shift }))) : placed
    glyphs.push({ c: t.c, from, level: t.level, strokes: final, x: cursor, w: pb.w })
    cursor += pb.w
  })
  if (!glyphs.length) return null
  return { mode, glyphs, width: cursor, metrics: m }
}

/** Space between token i-1 and token i, in x-heights. */
export function gapBetween(tokens: Token[], i: number, m: HandMetrics): number {
  const a = tokens[i - 1]
  const b = tokens[i]
  const before = tokens[i - 2]
  const ka = classOf(a.c)
  const kb = classOf(b.c)
  if (b.level !== 0) return a.level !== 0 ? m.tight * SCRIPT_SCALE : Math.min(m.tight, 0.12)
  if (kb === 'high' || kb === 'low') return Math.min(m.tight, 0.12)
  // a sign in front of a number (= -3, (-x) belongs to it
  const unary = (a.c === '-' || a.c === '+' || a.c === '±') && a.level === 0 && (!before || classOf(before.c) === 'float' || before.c === '(')
  if (unary) return m.tight
  if (ka === 'float' || kb === 'float') return m.loose
  if (b.spaced) return Math.max(m.loose, 0.6)
  return m.tight
}
