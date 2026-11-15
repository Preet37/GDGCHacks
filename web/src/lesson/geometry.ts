import { compile } from 'mathjs'
import type { Lesson, LessonMark, LessonVisual } from '../contract'
import { sampleYRange, toPlotExpr } from '../render/figure'

/** A real function of x. Returns NaN where it is undefined. */
export type Fn = (x: number) => number

/** The part of the plane a plot shows. */
export interface View {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Compile a math.js expression in x. null if it can't be parsed. The function itself never throws. */
export function compileExpr(expr: string): Fn | null {
  let node: { evaluate: (scope: { x: number }) => unknown }
  try {
    node = compile(toPlotExpr(String(expr)))
  } catch {
    return null
  }
  return (x) => {
    try {
      const y = node.evaluate({ x })
      return typeof y === 'number' && Number.isFinite(y) ? y : NaN
    } catch {
      return NaN
    }
  }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function lerpView(a: View, b: View, t: number): View {
  return { x0: lerp(a.x0, b.x0, t), x1: lerp(a.x1, b.x1, t), y0: lerp(a.y0, b.y0, t), y1: lerp(a.y1, b.y1, t) }
}

/** Slope of f at x by central difference (one-sided next to a gap). NaN if f isn't defined around x. */
export function slopeAt(f: Fn, x: number): number {
  const h = 1e-4 * Math.max(1, Math.abs(x))
  const a = f(x - h)
  const b = f(x + h)
  if (Number.isFinite(a) && Number.isFinite(b)) return (b - a) / (2 * h)
  const m = f(x)
  if (Number.isFinite(m) && Number.isFinite(b)) return (b - m) / h
  if (Number.isFinite(m) && Number.isFinite(a)) return (m - a) / h
  return NaN
}

/** Which way the curve bends at x: > 0 bends up, < 0 bends down, 0 if straight or unknown. */
export function bendAt(f: Fn, x: number): number {
  const h = 1e-3 * Math.max(1, Math.abs(x))
  const v = f(x - h) - 2 * f(x) + f(x + h)
  return Number.isFinite(v) ? Math.sign(Math.abs(v) < 1e-9 ? 0 : v) : 0
}

export interface Line {
  /** a point on the line */
  x: number
  y: number
  slope: number
}

/** The tangent to f at x, or null where f has none. */
export function tangentAt(f: Fn, x: number): Line | null {
  const y = f(x)
  const slope = slopeAt(f, x)
  return Number.isFinite(y) && Number.isFinite(slope) ? { x, y, slope } : null
}

export interface Secant extends Line {
  x2: number
  y2: number
}

/**
 * The line through the curve at x and x2. When the two points (nearly) meet it becomes the tangent,
 * so a secant that closes in ends exactly on the tangent instead of dividing by zero.
 */
export function secantThrough(f: Fn, x: number, x2: number): Secant | null {
  const y = f(x)
  const y2 = f(x2)
  if (!Number.isFinite(y) || !Number.isFinite(y2)) return null
  const gap = x2 - x
  if (Math.abs(gap) < 1e-6 * Math.max(1, Math.abs(x))) {
    const slope = slopeAt(f, x)
    return Number.isFinite(slope) ? { x, y, x2, y2, slope } : null
  }
  return { x, y, x2, y2, slope: (y2 - y) / gap }
}

/**
 * The region between the curve and the x axis from a to b, as a closed polygon:
 * along the axis at a, up over the curve, back down at b. Samples where f is undefined are left out.
 */
export function areaPolygon(f: Fn, a: number, b: number, n = 80): [number, number][] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const pts: [number, number][] = [[lo, 0]]
  const steps = hi > lo ? n : 0
  for (let i = 0; i <= steps; i++) {
    const x = steps ? lo + ((hi - lo) * i) / steps : lo
    const y = f(x)
    if (Number.isFinite(y)) pts.push([x, y])
  }
  pts.push([hi, 0])
  return pts
}

/** Signed area under f from a to b (trapezoid rule over the same samples as areaPolygon). */
export function areaUnder(f: Fn, a: number, b: number, n = 80): number {
  const pts = areaPolygon(f, a, b, n)
  let sum = 0
  for (let i = 1; i < pts.length; i++) sum += ((pts[i][1] + pts[i - 1][1]) / 2) * (pts[i][0] - pts[i - 1][0])
  return b >= a ? sum : -sum
}

/** Where a mark is after a fraction `p` (0..1, already eased) of its step. */
export function markAt(mark: LessonMark, p: number): { x: number | undefined; x2: number | undefined } {
  const move = (from: number | undefined, to: number | undefined) =>
    typeof from === 'number' && typeof to === 'number' ? lerp(from, to, p) : (from ?? to)
  return { x: move(mark.x, mark.to_x), x2: move(mark.x2, mark.to_x2) }
}

export function markMoves(mark: LessonMark): boolean {
  return (
    (typeof mark.to_x === 'number' && typeof mark.x === 'number' && mark.to_x !== mark.x) ||
    (typeof mark.to_x2 === 'number' && typeof mark.x2 === 'number' && mark.to_x2 !== mark.x2)
  )
}

/** Round tick positions (1, 2 or 5 times a power of ten) covering lo..hi, about `target` of them. */
export function niceTicks(lo: number, hi: number, target = 7): number[] {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return []
  const raw = (hi - lo) / Math.max(1, target)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow
  const out: number[] = []
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) out.push(Number((k * step).toPrecision(12)))
  return out
}

/** A short number for a readout: at most `digits` decimals, no trailing zeros, never "-0". */
export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '?'
  const s = v.toFixed(digits).replace(/\.?0+$/, '')
  return s === '-0' || s === '' ? '0' : s
}

export interface Curve {
  src: string
  /** null = the expression couldn't be parsed; it is skipped */
  fn: Fn | null
}

/** One step's picture, ready to draw. */
export interface Scene {
  kind: 'plot2d' | 'surface3d'
  curves: Curve[]
  view: View
  marks: LessonMark[]
  /** the visual it came from (surface3d needs the raw spec) */
  visual: LessonVisual
}

function pair(r: unknown): [number, number] | null {
  if (!Array.isArray(r) || r.length < 2) return null
  const a = Number(r[0])
  const b = Number(r[1])
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null
  return a < b ? [a, b] : [b, a]
}

const fnCache = new Map<string, Fn | null>()
function cachedFn(src: string): Fn | null {
  if (!fnCache.has(src)) fnCache.set(src, compileExpr(src))
  return fnCache.get(src) ?? null
}

/** Turn a LessonVisual into a Scene: compile what can be compiled, and work out a y range if none was given. */
export function buildScene(visual: LessonVisual): Scene {
  const expressions = (Array.isArray(visual.expressions) ? visual.expressions : []).map(String)
  const [x0, x1] = pair(visual.x_range) ?? [-5, 5]
  const kind = visual.kind === 'surface3d' ? 'surface3d' : 'plot2d'
  const curves = kind === 'plot2d' ? expressions.map((src) => ({ src, fn: cachedFn(src) })) : []
  let ys = kind === 'plot2d' ? pair(visual.y_range) : null
  if (!ys && kind === 'plot2d') {
    try {
      ys = pair(sampleYRange(expressions, [x0, x1]))
    } catch {
      ys = null
    }
  }
  const [y0, y1] = ys ?? [-5, 5]
  const marks = (Array.isArray(visual.marks) ? visual.marks : []).filter((m) => m && typeof m.type === 'string')
  return { kind, curves, view: { x0, x1, y0, y1 }, marks, visual }
}

/** The scene shown at each step: a step without a visual keeps the one before it (null until the first one). */
export function scenesFor(lesson: Lesson): (Scene | null)[] {
  let last: Scene | null = null
  let lastVisual: LessonVisual | undefined
  return lesson.steps.map((step) => {
    if (step.visual && step.visual !== lastVisual) {
      lastVisual = step.visual
      try {
        last = buildScene(step.visual)
      } catch {
        // keep the previous picture
      }
    }
    return last
  })
}

/**
 * Pair each mark of a step with the mark it continues from the step before (same type and curve,
 * in order), so a line that is already on screen moves on from where it stopped instead of blinking.
 * Returns, per mark, the index of its predecessor or -1.
 */
export function matchMarks(prev: LessonMark[], next: LessonMark[]): number[] {
  const used = new Set<number>()
  return next.map((m) => {
    const i = prev.findIndex((p, k) => !used.has(k) && p.type === m.type && (p.expr ?? 0) === (m.expr ?? 0))
    if (i >= 0) used.add(i)
    return i
  })
}
