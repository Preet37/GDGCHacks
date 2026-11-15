/** Test helper: a made-up "student" who writes with the stroke font at a given size, as strokes plus true character boxes. */
import type { CharBox, CharInk } from './assign'
import { emptyBank, learnLine, type Bank } from './bank'
import { fontGlyph } from './hershey'
import { groupLines, measureLine } from './lines'
import { boundsOf } from './strokes'
import type { Stroke } from './types'

export interface Written {
  strokes: Stroke[]
  boxes: CharBox[]
  chars: CharInk[]
}

/**
 * Write `text` starting at (x, baseline) with small letters `u` tall. `^` raises the next character
 * (at 60% size); spaces are ignored: neighbours are 0.2 u apart, 0.5 u around an operator. Digits are 1.5 u tall (the font's own proportions).
 */
export function writeLine(text: string, x: number, baseline: number, u: number, into: Written = { strokes: [], boxes: [], chars: [] }): Written {
  let cx = x
  let raise = false
  let prev = ''
  for (const ch of text) {
    if (ch === ' ') continue
    if (ch === '^') {
      raise = true
      continue
    }
    const g = fontGlyph(ch)!
    const op = '+-='.includes(ch)
    if (prev) cx += u * (op || '+-='.includes(prev) ? 0.5 : 0.2)
    prev = raise ? prev : ch
    const k = u * (raise ? 0.6 : 1)
    const dy = raise ? -u * 0.9 : 0
    const mine = g.strokes.map((s) => s.map((p) => ({ x: cx + (p.x - g.inkLeft) * k, y: baseline + dy + p.y * k })))
    const rect = boundsOf(mine)!
    const ids = mine.map((_, i) => into.strokes.length + i)
    into.strokes.push(...mine)
    into.boxes.push({ char: ch, rect })
    into.chars.push({ char: ch, rect, strokes: mine, ids })
    cx += (g.inkRight - g.inkLeft) * k
    raise = false
  }
  return into
}

/** A bank that has learned from these lines of text. */
export function bankFrom(lines: string[], u = 40): Bank {
  const bank = emptyBank()
  lines.forEach((text, i) => {
    const w = writeLine(text, 100, 200 + i * 200, u)
    for (const line of groupLines(w.chars)) {
      const stats = measureLine(line, (c) => `s${i}_${c.ids[0]}`)
      if (stats) learnLine(bank, stats)
    }
  })
  return bank
}
