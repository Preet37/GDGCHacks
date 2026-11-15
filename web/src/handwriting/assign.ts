import { boundsOf, median } from './strokes'
import type { Rect, Stroke } from './types'

/** A character the server found: which one, and its box on the page. */
export interface CharBox {
  char: string
  rect: Rect
}

/** A character with the pen strokes that make it up. `rect` is the bounds of those strokes. */
export interface CharInk {
  char: string
  rect: Rect
  strokes: Stroke[]
  /** index (into the strokes given to assignStrokes) of each stroke, in the order written */
  ids: number[]
}

/** A stroke belongs to a box when at least this share of its points are inside it. */
export const OWN_SHARE = 0.6
/** Slack given to each box, as a share of its longer side. */
export const SLACK = 0.15
/** Characters that are one upright or one flat stroke: their box says little about their other dimension. */
const THIN = "1lIi|!'/()[],.:;"
const FLAT = '-=~_'
/** A stroke that is not owned but has this share of its points in a box spoils that box (a join, a long bar). */
export const TOUCH_SHARE = 0.2
/** The strokes found for a box must span at least this much of it, each way, or something is missing. */
export const MIN_FILL = 0.45

function grow(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
}

function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/**
 * Give each pen stroke to the character it is part of.
 *
 * A stroke belongs to the box that holds most of its points (boxes are read off a picture, so
 * they get a little slack). A stroke that runs through several boxes (a cursive join, a long
 * fraction bar) belongs to none, and the characters it runs through are dropped: half a letter
 * is worse than no letter. A character whose strokes don't fill its box is dropped as well.
 *
 * Strokes left over that look like an equals sign or a minus between two characters are added:
 * those flat little marks are what the reader misses most.
 */
export function assignStrokes(strokes: Stroke[], boxes: CharBox[]): CharInk[] {
  const sizes = boxes.map((b) => Math.max(b.rect.w, b.rect.h)).filter((v) => v > 0)
  const typical = median(sizes) || 0
  // a box read off a picture can be off by a good part of a character, and a bar at the very top
  // of a 7 or a 5 is lost with it: each box gets slack, and neighbours are told apart by who holds more
  const grown = boxes.map((b) => grow(b.rect, Math.min(Math.max(b.rect.w, b.rect.h) * SLACK, typical * SLACK * 1.5)))
  const owned: number[][] = boxes.map(() => [])
  const spoiled = new Set<number>()
  const loose: number[] = []

  strokes.forEach((stroke, si) => {
    if (!stroke.length) return
    const count = (r: Rect) => stroke.reduce((n, p) => n + (inside(r, p.x, p.y) ? 1 : 0), 0)
    const counts = grown.map(count)
    const tight = boxes.map((b, i) => (counts[i] ? count(b.rect) : 0))
    let best = -1
    const b = boundsOf([stroke])!
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const dist = (i: number) => Math.hypot(boxes[i].rect.x + boxes[i].rect.w / 2 - cx, boxes[i].rect.y + boxes[i].rect.h / 2 - cy)
    counts.forEach((n, i) => {
      if (n === 0) return
      // most points wins; then most points inside the box proper; then (overlapping boxes, e.g. an
      // x tucked into its brackets) the nearer box
      const better =
        best < 0 || n > counts[best] || (n === counts[best] && (tight[i] > tight[best] || (tight[i] === tight[best] && dist(i) < dist(best))))
      if (better) best = i
    })
    if (best >= 0 && counts[best] / stroke.length >= OWN_SHARE) {
      owned[best].push(si)
      return
    }
    const touched = counts.flatMap((n, i) => (n / stroke.length >= TOUCH_SHARE ? [i] : []))
    for (const i of touched) spoiled.add(i)
    if (!touched.length) loose.push(si)
  })

  const out: CharInk[] = []
  boxes.forEach((box, i) => {
    if (spoiled.has(i) || !owned[i].length) return
    const mine = owned[i].map((si) => strokes[si])
    const rect = boundsOf(mine)!
    // flat or thin characters (a dash, a 1) are only judged along their long side
    const wide = box.rect.w >= box.rect.h * 0.4 && !THIN.includes(box.char)
    const high = box.rect.h >= box.rect.w * 0.4 && !FLAT.includes(box.char)
    const fillW = box.rect.w > 0 ? overlap1d(rect.x, rect.x + rect.w, box.rect.x, box.rect.x + box.rect.w) / box.rect.w : 1
    const fillH = box.rect.h > 0 ? overlap1d(rect.y, rect.y + rect.h, box.rect.y, box.rect.y + box.rect.h) / box.rect.h : 1
    if ((wide && fillW < MIN_FILL) || (high && fillH < MIN_FILL)) return
    out.push({ char: box.char, rect, strokes: mine, ids: owned[i] })
  })

  out.push(...flatSigns(strokes, loose, out, typical))
  return out.sort((a, b) => Math.min(...a.ids) - Math.min(...b.ids))
}

/** Equals and minus signs among the strokes no box claimed. */
function flatSigns(strokes: Stroke[], loose: number[], found: CharInk[], typical: number): CharInk[] {
  if (!typical || !found.length) return []
  const flat = loose
    .map((si) => ({ si, r: boundsOf([strokes[si]])! }))
    .filter(({ r }) => r.w >= typical * 0.25 && r.w <= typical * 1.6 && r.h <= r.w * 0.45)
  // a sign is written between characters of a line: there is a character level with it on at least one side, close by
  const inLine = (r: Rect) =>
    found.some((g) => {
      const level = r.y + r.h / 2 >= g.rect.y - g.rect.h * 0.1 && r.y + r.h / 2 <= g.rect.y + g.rect.h * 1.1
      const gap = Math.max(g.rect.x - (r.x + r.w), r.x - (g.rect.x + g.rect.w))
      return level && gap < typical * 1.5 && gap > -typical * 0.2
    })
  const out: CharInk[] = []
  const used = new Set<number>()
  for (let i = 0; i < flat.length; i++) {
    if (used.has(i)) continue
    const a = flat[i]
    const j = flat.findIndex((b, k) => {
      if (k <= i || used.has(k)) return false
      const shared = overlap1d(a.r.x, a.r.x + a.r.w, b.r.x, b.r.x + b.r.w)
      const apart = Math.abs(b.r.y + b.r.h / 2 - (a.r.y + a.r.h / 2))
      return shared >= Math.min(a.r.w, b.r.w) * 0.5 && apart > 0 && apart <= typical * 0.7
    })
    if (j >= 0) {
      const both = [strokes[a.si], strokes[flat[j].si]]
      const rect = boundsOf(both)!
      used.add(i).add(j)
      if (inLine(rect)) out.push({ char: '=', rect, strokes: both, ids: [a.si, flat[j].si] })
    }
  }
  flat.forEach((a, i) => {
    if (used.has(i) || a.r.h > a.r.w * 0.3 || !inLine(a.r)) return
    // a minus has a character on both sides; a bar under or over something is not one
    const left = found.some((g) => g.rect.x + g.rect.w <= a.r.x + a.r.w * 0.3 && a.r.x - (g.rect.x + g.rect.w) < typical * 1.5)
    const right = found.some((g) => g.rect.x >= a.r.x + a.r.w * 0.7 && g.rect.x - (a.r.x + a.r.w) < typical * 1.5)
    const covered = found.some((g) => overlap1d(a.r.x, a.r.x + a.r.w, g.rect.x, g.rect.x + g.rect.w) > a.r.w * 0.5)
    if (left && right && !covered) out.push({ char: '-', rect: a.r, strokes: [strokes[a.si]], ids: [a.si] })
  })
  return out
}
