import type { LessonMark } from '../contract'
import {
  areaPolygon,
  areaUnder,
  bendAt,
  fmt,
  lerpView,
  logLabel,
  logTicks,
  markAt,
  matchMarks,
  niceTicks,
  secantThrough,
  tangentAt,
  xAtFrac,
  xFrac,
  type Curve,
  type Fn,
  type Scene,
  type View,
} from './geometry'
import { easeInOut, easeOut, FADE_MS, REVEAL_MS, REVEAL_STAGGER_MS, span, TWEEN_MS } from './timing'

/** Ink for the curves (first one is the notebook's own dark ink), and the teacher's coloured pens for marks. */
export const CURVE_COLORS = ['#1d2740', '#d9730d', '#0e8f80', '#7c4ddb']
export const MARK_COLORS: Record<string, string> = { red: '#de3b2f', blue: '#2563eb', green: '#17964b', black: '#1d2740' }
const GRID = '#e3e8f1'
const GRID_FAINT = '#f0f3f8'
const AXIS = '#7d879c'
const TICK_TEXT = '#727c92'
const PAPER = '#ffffff'
const FONT = 'KaTeX_Main, "Times New Roman", serif'
const SAMPLES = 260

export interface FrameInput {
  scene: Scene | null
  /** what was on screen before this step (null = nothing: everything draws on) */
  prev: Scene | null
  /** ms since the step changed */
  since: number
  /** 0..1 position of the step's moving marks */
  motion: number
}

interface Geo {
  left: number
  top: number
  w: number
  h: number
  view: View
  sx: (x: number) => number
  sy: (y: number) => number
}

interface Ticks {
  xs: number[]
  /** x grid lines without a number (the 2..9 lines between decades on a log axis) */
  xMinor: number[]
  xLabels: { v: number; text: string }[]
  ys: number[]
  yLabels: { v: number; text: string }[]
}

const TICK_FONT = `15px ${FONT}`
const minus = (s: string) => s.replace('-', '−')

function ticksFor(view: View, w: number, h: number): Ticks {
  const ys = niceTicks(view.y0, view.y1, h < 240 ? 4 : 6)
  const yLabels = ys.map((v) => ({ v, text: minus(fmt(v, 4)) }))
  if (view.xlog) {
    const t = logTicks(view.x0, view.x1)
    return { xs: t.major, xMinor: t.minor, xLabels: t.labels.map((v) => ({ v, text: logLabel(v) })), ys, yLabels }
  }
  const xs = niceTicks(view.x0, view.x1, w < 420 ? 6 : 8)
  return { xs, xMinor: [], xLabels: xs.map((v) => ({ v, text: minus(fmt(v, 4)) })), ys, yLabels }
}

/**
 * The plot area inside a w x h canvas. The numbers live in gutters to the left of and below it,
 * so they never sit under a curve or a label.
 */
function geo(ctx: CanvasRenderingContext2D, view: View, ticks: Ticks, w: number, h: number): Geo {
  ctx.font = TICK_FONT
  let widest = 0
  for (const l of ticks.yLabels) widest = Math.max(widest, ctx.measureText(l.text).width)
  const left = Math.round(Math.min(64, Math.max(26, widest + 12)))
  const top = 12
  const pw = Math.max(40, w - left - 16)
  const ph = Math.max(40, h - top - 26)
  return {
    left,
    top,
    w: pw,
    h: ph,
    view,
    sx: (x) => left + xFrac(view, x) * pw,
    sy: (y) => top + (1 - (y - view.y0) / (view.y1 - view.y0)) * ph,
  }
}

function markColor(m: LessonMark): string {
  return MARK_COLORS[m.color ?? 'red'] ?? MARK_COLORS.red
}

function withAlpha(ctx: CanvasRenderingContext2D, alpha: number, fn: () => void) {
  if (alpha <= 0.003) return
  ctx.save()
  ctx.globalAlpha *= alpha
  fn()
  ctx.restore()
}

function drawAxes(ctx: CanvasRenderingContext2D, g: Geo, ticks: Ticks) {
  const { view } = g
  const right = g.left + g.w
  const bottom = g.top + g.h
  const inX = (px: number) => px >= g.left - 0.5 && px <= right + 0.5
  const inY = (py: number) => py >= g.top - 0.5 && py <= bottom + 0.5

  ctx.lineWidth = 1
  if (ticks.xMinor.length) {
    ctx.strokeStyle = GRID_FAINT
    ctx.beginPath()
    for (const x of ticks.xMinor) {
      const px = Math.round(g.sx(x)) + 0.5
      if (!inX(px)) continue
      ctx.moveTo(px, g.top)
      ctx.lineTo(px, bottom)
    }
    ctx.stroke()
  }
  ctx.strokeStyle = GRID
  ctx.beginPath()
  for (const x of ticks.xs) {
    const px = Math.round(g.sx(x)) + 0.5
    if (!inX(px)) continue
    ctx.moveTo(px, g.top)
    ctx.lineTo(px, bottom)
  }
  for (const y of ticks.ys) {
    const py = Math.round(g.sy(y)) + 0.5
    if (!inY(py)) continue
    ctx.moveTo(g.left, py)
    ctx.lineTo(right, py)
  }
  ctx.stroke()

  // axes sit on zero when zero is in view, otherwise along the nearest edge (a log axis has no zero)
  const zeroX = view.xlog ? g.left : g.sx(0)
  const ax = Math.round(Math.min(right, Math.max(g.left, zeroX))) + 0.5
  const ay = Math.round(Math.min(bottom, Math.max(g.top, g.sy(0)))) + 0.5
  ctx.strokeStyle = AXIS
  ctx.fillStyle = AXIS
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(g.left, ay)
  ctx.lineTo(right, ay)
  ctx.moveTo(ax, bottom)
  ctx.lineTo(ax, g.top)
  ctx.stroke()
  // arrowheads at the positive ends
  ctx.beginPath()
  ctx.moveTo(right + 7, ay)
  ctx.lineTo(right - 3, ay - 4.5)
  ctx.lineTo(right - 3, ay + 4.5)
  ctx.closePath()
  ctx.moveTo(ax, g.top - 7)
  ctx.lineTo(ax - 4.5, g.top + 3)
  ctx.lineTo(ax + 4.5, g.top + 3)
  ctx.closePath()
  ctx.fill()

  // numbers: below the plot and to its left, never inside it
  ctx.font = TICK_FONT
  ctx.fillStyle = TICK_TEXT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  let lastRight = -Infinity
  for (const l of ticks.xLabels) {
    const px = g.sx(l.v)
    if (!inX(px)) continue
    const half = ctx.measureText(l.text).width / 2
    const cx = Math.min(Math.max(px, g.left - 4 + half), right + 10 - half)
    if (cx - half < lastRight + 8) continue // too close to the one before: skip it
    ctx.fillText(l.text, cx, bottom + 6)
    lastRight = cx + half
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const l of ticks.yLabels) {
    const py = g.sy(l.v)
    if (!inY(py)) continue
    ctx.fillText(l.text, g.left - 7, py)
  }
}

function tracePath(ctx: CanvasRenderingContext2D, g: Geo, fn: Fn) {
  const limit = g.h * 6
  let pen = false
  let lastY = 0
  ctx.beginPath()
  for (let i = 0; i <= SAMPLES; i++) {
    // evenly spaced across the screen, so a log axis is sampled log-spaced
    const t = i / SAMPLES
    const y = fn(xAtFrac(g.view, t))
    if (!Number.isFinite(y)) {
      pen = false
      continue
    }
    const px = g.left + t * g.w
    const py = Math.max(-limit, Math.min(limit + g.h, g.sy(y)))
    // a jump of several plot heights between neighbours is an asymptote, not a stroke
    if (pen && Math.abs(py - lastY) > g.h * 3) pen = false
    if (pen) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
    pen = true
    lastY = py
  }
}

/** Draw one curve. `reveal` 0..1 = how much of it has been drawn on, left to right. */
function drawCurve(ctx: CanvasRenderingContext2D, g: Geo, fn: Fn, color: string, reveal: number, alpha: number) {
  if (reveal <= 0 || alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.beginPath()
  ctx.rect(g.left, g.top - 2, g.w * reveal, g.h + 4)
  ctx.clip()
  ctx.strokeStyle = color
  ctx.lineWidth = 3.25
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  tracePath(ctx, g, fn)
  ctx.stroke()
  ctx.restore()
  if (reveal < 1) {
    // the pen tip
    const y = fn(xAtFrac(g.view, reveal))
    const py = g.sy(y)
    if (Number.isFinite(y) && py >= g.top && py <= g.top + g.h) {
      ctx.save()
      ctx.globalAlpha *= alpha
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(g.left + reveal * g.w, py, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
}

function dot(ctx: CanvasRenderingContext2D, px: number, py: number, color: string, r = 6.5) {
  ctx.beginPath()
  ctx.arc(px, py, r + 2, 0, Math.PI * 2)
  ctx.fillStyle = PAPER
  ctx.fill()
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A place a label may go: where its anchor is and which way the text runs from it. */
interface Spot {
  x: number
  y: number
  align: CanvasTextAlign
}

/** A label waiting to be drawn. Labels go on last, over every line, each in the first spot that is free. */
interface Label {
  text: string
  spots: Spot[]
  color: string
  size: number
  /** on a small paper plate (readouts) instead of a halo */
  plate: boolean
  alpha: number
  /** labels with the same key and text say the same thing: only the first is drawn */
  key?: string
}

function labelRect(ctx: CanvasRenderingContext2D, g: Geo, l: Label, s: Spot): Rect & { tx: number; ty: number } {
  ctx.font = `600 ${l.size}px ${FONT}`
  const tw = ctx.measureText(l.text).width
  const half = s.align === 'center' ? tw / 2 : 0
  const minX = g.left + 6 + (s.align === 'right' ? tw : half)
  const maxX = g.left + g.w - 6 - (s.align === 'left' ? tw : half)
  const tx = Math.min(Math.max(s.x, minX), Math.max(minX, maxX))
  const ty = Math.min(Math.max(s.y, g.top + l.size * 0.72 + 2), g.top + g.h - l.size * 0.72 - 2)
  const x = s.align === 'center' ? tx - tw / 2 : s.align === 'right' ? tx - tw : tx
  return { x: x - 6, y: ty - l.size * 0.72, w: tw + 12, h: l.size * 1.44, tx, ty }
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Draw the queued labels: each takes its first spot that is clear of the labels and points already there. */
function drawLabels(ctx: CanvasRenderingContext2D, g: Geo, labels: Label[], avoid: Rect[]) {
  const taken = [...avoid]
  const said = new Set<string>()
  for (const l of labels) {
    if (l.key) {
      const k = `${l.key}|${l.text}`
      if (said.has(k)) continue
      said.add(k)
    }
    let best: ReturnType<typeof labelRect> | null = null
    let bestCost = Infinity
    for (const s of l.spots) {
      const r = labelRect(ctx, g, l, s)
      // a spot that had to be pushed back inside the plot is a little worse than one that fits as asked
      const cost = taken.reduce((sum, t) => sum + overlap(r, t), 0) + (Math.abs(r.tx - s.x) + Math.abs(r.ty - s.y)) * 0.5
      if (cost < bestCost) {
        best = r
        bestCost = cost
      }
      if (cost === 0) break
    }
    if (!best) continue
    taken.push(best)
    const r = best
    withAlpha(ctx, l.alpha, () => {
      ctx.font = `600 ${l.size}px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      if (l.plate) {
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.beginPath()
        ctx.roundRect(r.x - 2, r.y, r.w + 4, r.h, 8)
        ctx.fill()
      } else {
        ctx.lineJoin = 'round'
        ctx.lineWidth = 6
        ctx.strokeStyle = 'rgba(255,255,255,0.92)'
        ctx.strokeText(l.text, r.x + 6, r.ty)
      }
      ctx.fillStyle = l.color
      ctx.fillText(l.text, r.x + 6, r.ty)
    })
  }
}

/** Unit direction on screen, pointing right, of a line with `slope` (dy/dx) through the curve at x. */
function screenDir(g: Geo, x: number, slope: number): [number, number] {
  const { view } = g
  // screen px per unit of x here: constant on a linear axis, shrinking with x on a log one
  const dx = view.xlog ? g.w / (x * Math.log(view.x1 / view.x0)) : g.w / (view.x1 - view.x0)
  const dy = -slope * (g.h / (view.y1 - view.y0))
  const len = Math.hypot(dx, dy) || 1
  return [dx / len, dy / len]
}

function strokeSegment(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, color: string, width = 3) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.stroke()
}

/**
 * "slope = 2" beside a line: first on the side the curve bends away from (so it doesn't sit on the
 * curve), else on the other side. On a log axis the readout is the rise per decade, which is what
 * the straight line on screen shows.
 */
function slopeLabel(ctx: CanvasRenderingContext2D, g: Geo, px: number, py: number, dir: [number, number], value: number, bend: number, clear: number, color: string, expr: number): Label {
  // normal to the line, pointing down the screen when the curve bends up (and the other way otherwise)
  let nx = -dir[1]
  let ny = dir[0]
  if ((ny < 0) === (bend >= 0)) {
    nx = -nx
    ny = -ny
  }
  const text = `slope = ${minus(fmt(value, 2))}${g.view.xlog ? ' per decade' : ''}`
  ctx.font = `600 19px ${FONT}`
  const tw = ctx.measureText(text).width
  const off = 20 + Math.abs(nx) * (tw / 2) + Math.abs(ny) * 14
  const spot = (k: number, extra: number): Spot => ({ x: px + nx * k * (off + extra), y: py + ny * k * (off + extra), align: 'center' })
  return { text, spots: [spot(1, clear), spot(-1, 0), spot(1, clear + 34), spot(-1, 34)], color, size: 19, plate: true, alpha: 1, key: `slope${expr}` }
}

/** Draw one mark's lines and points, and queue its label. `labels` null = no label (a mark that is fading away). */
function drawMark(ctx: CanvasRenderingContext2D, g: Geo, curves: Curve[], mark: LessonMark, at: { x?: number; x2?: number }, grow: number, labels: Label[] | null, dots: Rect[]) {
  const color = markColor(mark)
  const fn = curves[mark.expr ?? 0]?.fn ?? null
  const { x, x2 } = at
  const log = !!g.view.xlog
  const half = g.w * 0.24
  const say = (l: Label) => labels?.push(l)
  const point = (px: number, py: number, r = 6.5) => {
    dot(ctx, px, py, color, r)
    dots.push({ x: px - r - 3, y: py - r - 3, w: 2 * r + 6, h: 2 * r + 6 })
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(g.left, g.top, g.w, g.h)
  ctx.clip()
  switch (mark.type) {
    case 'point': {
      if (!fn || x === undefined) break
      const y = fn(x)
      if (Number.isFinite(y)) point(g.sx(x), g.sy(y), 6.5 * (0.4 + 0.6 * grow))
      break
    }
    case 'tangent': {
      if (!fn || x === undefined) break
      const t = tangentAt(fn, x)
      if (!t) break
      const [dx, dy] = screenDir(g, t.x, t.slope)
      const px = g.sx(t.x)
      const py = g.sy(t.y)
      if (!Number.isFinite(px)) break
      const len = half * grow
      strokeSegment(ctx, px - dx * len, py - dy * len, px + dx * len, py + dy * len, color)
      point(px, py)
      say(slopeLabel(ctx, g, px, py, [dx, dy], log ? t.slope * t.x * Math.LN10 : t.slope, bendAt(fn, t.x), 0, color, mark.expr ?? 0))
      break
    }
    case 'secant': {
      if (!fn || x === undefined || x2 === undefined) break
      const s = secantThrough(fn, x, x2)
      if (!s) break
      const ax = g.sx(s.x)
      const ay = g.sy(s.y)
      const bx = g.sx(s.x2)
      const by = g.sy(s.y2)
      if (!Number.isFinite(ax) || !Number.isFinite(bx)) break
      // the straight line through the two points as they are on screen; the tangent's direction once they meet
      const gap = Math.hypot(bx - ax, by - ay)
      let dir = screenDir(g, s.x, s.slope)
      if (gap > 1.5) dir = bx >= ax ? [(bx - ax) / gap, (by - ay) / gap] : [(ax - bx) / gap, (ay - by) / gap]
      const [dx, dy] = dir
      // reach past both points, and never shorter than a tangent would be drawn
      const mx = (ax + bx) / 2
      const my = (ay + by) / 2
      const len = Math.max(half, gap / 2 + 46) * grow
      strokeSegment(ctx, mx - dx * len, my - dy * len, mx + dx * len, my + dy * len, color)
      point(ax, ay)
      point(bx, by)
      // how far the curve sags away from the chord half-way: the readout goes beyond that
      const xm = log ? Math.sqrt(s.x * s.x2) : (s.x + s.x2) / 2
      const ym = fn(xm)
      const sagPx = Number.isFinite(ym) ? g.sy(ym) - my : 0
      const bend = Math.abs(sagPx) > 0.5 ? Math.sign(sagPx) : bendAt(fn, xm)
      const decades = Math.log10(s.x2 / s.x)
      const value = log ? (Math.abs(decades) > 1e-9 ? (s.y2 - s.y) / decades : s.slope * s.x * Math.LN10) : s.slope
      say(slopeLabel(ctx, g, mx, my, [dx, dy], value, bend, Math.min(Math.abs(sagPx), 60), color, mark.expr ?? 0))
      break
    }
    case 'area': {
      if (!fn || x === undefined || x2 === undefined) break
      const pts = areaPolygon(fn, x, x2, 80, log)
      if (pts.length < 3) break
      ctx.beginPath()
      pts.forEach(([ux, uy], i) => (i ? ctx.lineTo(g.sx(ux), g.sy(uy)) : ctx.moveTo(g.sx(ux), g.sy(uy))))
      ctx.closePath()
      ctx.save()
      ctx.globalAlpha *= 0.2 * grow
      ctx.fillStyle = color
      ctx.fill()
      ctx.restore()
      ctx.save()
      ctx.globalAlpha *= 0.75
      for (const edge of [pts[1], pts[pts.length - 2]]) strokeSegment(ctx, g.sx(edge[0]), g.sy(0), g.sx(edge[0]), g.sy(edge[1]), color, 2)
      ctx.restore()
      const lo = Math.min(x, x2)
      const hi = Math.max(x, x2)
      if (g.sx(hi) - g.sx(lo) > 30) {
        const cx = (g.sx(lo) + g.sx(hi)) / 2
        const ym = fn(xAtFrac(g.view, (cx - g.left) / g.w))
        const text = `area ≈ ${minus(fmt(areaUnder(fn, lo, hi, 80, log), 2))}`
        const midY = Number.isFinite(ym) ? (g.sy(0) + g.sy(ym)) / 2 : g.sy(0) - 16
        say({ text, spots: [{ x: cx, y: midY, align: 'center' }, { x: cx, y: midY - 30, align: 'center' }, { x: cx, y: midY + 30, align: 'center' }], color, size: 19, plate: true, alpha: 1 })
      }
      break
    }
    case 'vline': {
      if (x === undefined) break
      const px = g.sx(x)
      if (!Number.isFinite(px)) break
      ctx.setLineDash([7, 6])
      const end = g.top + g.h - g.h * grow
      strokeSegment(ctx, px, g.top + g.h, px, end, color, 2.25)
      ctx.setLineDash([])
      // beside the line, not on it: the dashes would run through the "="
      const text = `x = ${minus(fmt(x, x !== 0 && Math.abs(x) < 0.1 ? 4 : 2))}`
      const y = g.top + 16
      const right: Spot = { x: px + 9, y, align: 'left' }
      const left: Spot = { x: px - 9, y, align: 'right' }
      const first = px > g.left + g.w * 0.7 ? [left, right] : [right, left]
      say({ text, spots: [...first, { ...first[0], y: y + 28 }, { ...first[1], y: y + 28 }], color, size: 17, plate: false, alpha: 1 })
      break
    }
    case 'hline': {
      if (typeof mark.y !== 'number') break
      const py = g.sy(mark.y)
      ctx.setLineDash([7, 6])
      strokeSegment(ctx, g.left, py, g.left + g.w * grow, py, color, 2.25)
      ctx.setLineDash([])
      const text = `y = ${minus(fmt(mark.y, 2))}`
      const rx = g.left + g.w - 8
      say({
        text,
        spots: [
          { x: rx, y: py - 15, align: 'right' },
          { x: rx, y: py + 15, align: 'right' },
          { x: g.left + 8, y: py - 15, align: 'left' },
          { x: g.left + 8, y: py + 15, align: 'left' },
        ],
        color,
        size: 17,
        plate: false,
        alpha: 1,
      })
      break
    }
    case 'label': {
      if (!mark.text || x === undefined) break
      const onCurve = typeof mark.y !== 'number'
      const y = onCurve ? (fn ? fn(x) : NaN) : (mark.y as number)
      const px = g.sx(x)
      const py = g.sy(y)
      if (!Number.isFinite(y) || !Number.isFinite(px)) break
      if (onCurve) point(px, py, 4.5)
      // text goes on the side with more room, above the point if it can
      const toLeft = px > g.left + g.w * 0.55
      const a: Spot = { x: px + (toLeft ? -16 : 16), y: py - 18, align: toLeft ? 'right' : 'left' }
      const b: Spot = { x: px + (toLeft ? 16 : -16), y: py - 18, align: toLeft ? 'left' : 'right' }
      say({ text: mark.text, spots: [a, { ...a, y: py + 20 }, b, { ...b, y: py + 20 }, { ...a, y: py - 44 }], color, size: 20, plate: false, alpha: 1 })
      break
    }
  }
  ctx.restore()
}

/** Draw one frame of a plot2d scene into a w x h canvas (CSS pixels; the context is already scaled). */
export function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, input: FrameInput) {
  ctx.clearRect(0, 0, w, h)
  const { scene, since, motion } = input
  if (!scene || scene.kind !== 'plot2d') return
  const prev = input.prev && input.prev.kind === 'plot2d' && input.prev !== scene ? input.prev : null
  const same = input.prev === scene
  const view = prev ? lerpView(prev.view, scene.view, easeInOut(span(since, 0, TWEEN_MS))) : scene.view
  const ticks = ticksFor(view, w, h)
  const g = geo(ctx, view, ticks, w, h)

  // the whole plot fades up the first time it appears
  const appear = prev || same ? 1 : easeOut(span(since, 0, 500))
  ctx.save()
  ctx.globalAlpha = appear
  drawAxes(ctx, g, ticks)

  // curves that are leaving fade out; curves that stay stay; new ones are drawn on left to right
  const before = new Set((prev?.curves ?? []).map((c) => c.src))
  const now = new Set(scene.curves.map((c) => c.src))
  if (prev) {
    const out = 1 - span(since, 0, FADE_MS)
    prev.curves.forEach((c, i) => {
      if (c.fn && !now.has(c.src)) drawCurve(ctx, g, c.fn, CURVE_COLORS[i % CURVE_COLORS.length], 1, out)
    })
  }
  let fresh = 0
  scene.curves.forEach((c, i) => {
    if (!c.fn) return
    const color = CURVE_COLORS[i % CURVE_COLORS.length]
    if (same || before.has(c.src)) return drawCurve(ctx, g, c.fn, color, 1, 1)
    const r = easeInOut(span(since, 150 + fresh * REVEAL_STAGGER_MS, REVEAL_MS))
    fresh++
    drawCurve(ctx, g, c.fn, color, r, 1)
  })

  // marks: ones that continue from the last step move on from where they stopped; others fade.
  // Lines and points first, then every label on top, each where it is clear of the others.
  const log = !!scene.view.xlog
  const labels: Label[] = []
  const dots: Rect[] = []
  const prevMarks = prev?.marks ?? []
  const from = same ? scene.marks.map((_, i) => i) : matchMarks(prevMarks, scene.marks)
  if (prev) {
    const kept = new Set(from)
    const out = 1 - span(since, 0, FADE_MS * 0.8)
    prevMarks.forEach((m, i) => {
      // a mark on its way out keeps its line for a moment but not its label (two readouts would pile up)
      if (!kept.has(i)) withAlpha(ctx, out, () => drawMark(ctx, g, prev.curves, m, markAt(m, 1, !!prev.view.xlog), 1, null, []))
    })
  }
  const markDelay = fresh ? 150 + REVEAL_MS * 0.75 : 120
  scene.marks.forEach((m, i) => {
    const start = markAt(m, 0, log)
    const at = markAt(m, motion, log)
    let alpha = 1
    let grow = 1
    if (same) {
      // nothing to bring in
    } else if (from[i] >= 0) {
      // settle from where the last step left this mark to where this step starts it
      const k = easeInOut(span(since, 0, TWEEN_MS))
      const was = markAt(prevMarks[from[i]], 1, !!prev?.view.xlog)
      if (k < 1 && motion === 0) {
        if (typeof was.x === 'number' && typeof start.x === 'number') at.x = was.x + (start.x - was.x) * k
        if (typeof was.x2 === 'number' && typeof start.x2 === 'number') at.x2 = was.x2 + (start.x2 - was.x2) * k
      }
    } else {
      alpha = span(since, markDelay + i * 120, FADE_MS)
      grow = easeOut(span(since, markDelay + i * 120, FADE_MS * 1.6))
    }
    const mine: Label[] = []
    withAlpha(ctx, alpha, () => drawMark(ctx, g, scene.curves, m, at, grow, mine, dots))
    for (const l of mine) labels.push({ ...l, alpha })
  })
  // labels keep off the two axis lines as well, where a free spot allows it
  const zeroX = g.view.xlog ? g.left : Math.min(g.left + g.w, Math.max(g.left, g.sx(0)))
  const zeroY = Math.min(g.top + g.h, Math.max(g.top, g.sy(0)))
  const axes: Rect[] = [
    { x: g.left, y: zeroY - 4, w: g.w + 8, h: 8 },
    { x: zeroX - 4, y: g.top - 8, w: 8, h: g.h + 8 },
  ]
  drawLabels(ctx, g, labels, [...dots, ...axes])
  ctx.restore()
}
