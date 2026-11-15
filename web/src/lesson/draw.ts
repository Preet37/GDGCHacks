import type { LessonMark } from '../contract'
import {
  areaPolygon,
  areaUnder,
  bendAt,
  fmt,
  lerp,
  lerpView,
  markAt,
  matchMarks,
  niceTicks,
  secantThrough,
  tangentAt,
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

function geo(view: View, w: number, h: number): Geo {
  const pad = 10
  const pw = w - pad * 2
  const ph = h - pad * 2
  return {
    left: pad,
    top: pad,
    w: pw,
    h: ph,
    view,
    sx: (x) => pad + ((x - view.x0) / (view.x1 - view.x0)) * pw,
    sy: (y) => pad + (1 - (y - view.y0) / (view.y1 - view.y0)) * ph,
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

function drawAxes(ctx: CanvasRenderingContext2D, g: Geo) {
  const { view } = g
  const xs = niceTicks(view.x0, view.x1, 8)
  const ys = niceTicks(view.y0, view.y1, 6)
  const right = g.left + g.w
  const bottom = g.top + g.h

  ctx.lineWidth = 1
  ctx.strokeStyle = GRID
  ctx.beginPath()
  for (const x of xs) {
    const px = Math.round(g.sx(x)) + 0.5
    ctx.moveTo(px, g.top)
    ctx.lineTo(px, bottom)
  }
  for (const y of ys) {
    const py = Math.round(g.sy(y)) + 0.5
    ctx.moveTo(g.left, py)
    ctx.lineTo(right, py)
  }
  ctx.stroke()

  // axes sit on zero when zero is in view, otherwise along the nearest edge
  const ax = Math.round(Math.min(right, Math.max(g.left, g.sx(0)))) + 0.5
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
  ctx.moveTo(right + 6, ay)
  ctx.lineTo(right - 4, ay - 4.5)
  ctx.lineTo(right - 4, ay + 4.5)
  ctx.closePath()
  ctx.moveTo(ax, g.top - 6)
  ctx.lineTo(ax - 4.5, g.top + 4)
  ctx.lineTo(ax + 4.5, g.top + 4)
  ctx.closePath()
  ctx.fill()

  ctx.font = `16px ${FONT}`
  ctx.fillStyle = TICK_TEXT
  ctx.strokeStyle = AXIS
  ctx.lineWidth = 1.25
  const below = ay + 22 <= bottom
  const leftOf = ax - 26 >= g.left
  ctx.textAlign = 'center'
  ctx.textBaseline = below ? 'top' : 'bottom'
  for (const x of xs) {
    const px = g.sx(x)
    if (px < g.left + 12 || px > right - 14) continue
    ctx.beginPath()
    ctx.moveTo(px, ay - 3.5)
    ctx.lineTo(px, ay + 3.5)
    ctx.stroke()
    if (Math.abs(px - ax) < 9) continue // the origin: no label
    ctx.fillText(fmt(x, 4).replace('-', '−'), px, below ? ay + 6 : ay - 6)
  }
  ctx.textAlign = leftOf ? 'right' : 'left'
  ctx.textBaseline = 'middle'
  for (const y of ys) {
    const py = g.sy(y)
    if (py < g.top + 14 || py > bottom - 10) continue
    ctx.beginPath()
    ctx.moveTo(ax - 3.5, py)
    ctx.lineTo(ax + 3.5, py)
    ctx.stroke()
    if (Math.abs(py - ay) < 9) continue
    ctx.fillText(fmt(y, 4).replace('-', '−'), leftOf ? ax - 8 : ax + 8, py)
  }
}

function tracePath(ctx: CanvasRenderingContext2D, g: Geo, fn: Fn) {
  const { x0, x1 } = g.view
  const limit = g.h * 6
  let pen = false
  let lastY = 0
  ctx.beginPath()
  for (let i = 0; i <= SAMPLES; i++) {
    const x = x0 + ((x1 - x0) * i) / SAMPLES
    const y = fn(x)
    if (!Number.isFinite(y)) {
      pen = false
      continue
    }
    const px = g.sx(x)
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
    const x = lerp(g.view.x0, g.view.x1, reveal)
    const y = fn(x)
    const py = g.sy(y)
    if (Number.isFinite(y) && py >= g.top && py <= g.top + g.h) {
      ctx.save()
      ctx.globalAlpha *= alpha
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(g.sx(x), py, 5, 0, Math.PI * 2)
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

/** Text with a paper-coloured halo so it stays readable over grid and curves; kept inside the plot. */
function haloText(ctx: CanvasRenderingContext2D, g: Geo, text: string, px: number, py: number, color: string, size = 19, align: CanvasTextAlign = 'center', plate = false) {
  ctx.font = `600 ${size}px ${FONT}`
  const tw = ctx.measureText(text).width
  const half = align === 'center' ? tw / 2 : 0
  const minX = g.left + 4 + (align === 'right' ? tw : half)
  const maxX = g.left + g.w - 4 - (align === 'left' ? tw : half)
  const x = Math.min(Math.max(px, minX), Math.max(minX, maxX))
  const y = Math.min(Math.max(py, g.top + size * 0.6 + 2), g.top + g.h - size * 0.6 - 2)
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  if (plate) {
    // readouts get a small paper label of their own, so numbers never tangle with the axis numbers
    const lx = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.roundRect(lx - 8, y - size * 0.72, tw + 16, size * 1.44, 8)
    ctx.fill()
  } else {
    ctx.lineJoin = 'round'
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'
    ctx.strokeText(text, x, y)
  }
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  return tw
}

/** Unit direction of a line of `slope` on screen, pointing right. */
function screenDir(g: Geo, slope: number): [number, number] {
  const dx = g.w / (g.view.x1 - g.view.x0)
  const dy = -slope * (g.h / (g.view.y1 - g.view.y0))
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

/** "slope = 2" beside a line, on the side the curve bends away from (so it never sits on the curve). */
function slopeChip(ctx: CanvasRenderingContext2D, g: Geo, px: number, py: number, dir: [number, number], slope: number, bend: number, clear: number, color: string) {
  // normal to the line, pointing down the screen when the curve bends up (and the other way otherwise)
  let nx = -dir[1]
  let ny = dir[0]
  if ((ny < 0) === (bend >= 0)) {
    nx = -nx
    ny = -ny
  }
  const text = `slope = ${fmt(slope, 2).replace('-', '−')}`
  ctx.font = `600 19px ${FONT}`
  const tw = ctx.measureText(text).width
  const off = clear + 18 + Math.abs(nx) * (tw / 2) + Math.abs(ny) * 8
  haloText(ctx, g, text, px + nx * off, py + ny * off, color, 19, 'center', true)
}

function drawMark(ctx: CanvasRenderingContext2D, g: Geo, curves: Curve[], mark: LessonMark, at: { x?: number; x2?: number }, grow: number) {
  const color = markColor(mark)
  const fn = curves[mark.expr ?? 0]?.fn ?? null
  const { x, x2 } = at
  const half = g.w * 0.24
  ctx.save()
  ctx.beginPath()
  ctx.rect(g.left, g.top, g.w, g.h)
  ctx.clip()
  switch (mark.type) {
    case 'point': {
      if (!fn || x === undefined) break
      const y = fn(x)
      if (Number.isFinite(y)) dot(ctx, g.sx(x), g.sy(y), color, 6.5 * (0.4 + 0.6 * grow))
      break
    }
    case 'tangent': {
      if (!fn || x === undefined) break
      const t = tangentAt(fn, x)
      if (!t) break
      const [dx, dy] = screenDir(g, t.slope)
      const px = g.sx(t.x)
      const py = g.sy(t.y)
      const len = half * grow
      strokeSegment(ctx, px - dx * len, py - dy * len, px + dx * len, py + dy * len, color)
      dot(ctx, px, py, color)
      slopeChip(ctx, g, px, py, [dx, dy], t.slope, bendAt(fn, t.x), 0, color)
      break
    }
    case 'secant': {
      if (!fn || x === undefined || x2 === undefined) break
      const s = secantThrough(fn, x, x2)
      if (!s) break
      const [dx, dy] = screenDir(g, s.slope)
      const ax = g.sx(s.x)
      const ay = g.sy(s.y)
      const bx = g.sx(s.x2)
      const by = g.sy(s.y2)
      // reach past both points, and never shorter than a tangent would be drawn
      const mx = (ax + bx) / 2
      const my = (ay + by) / 2
      const len = Math.max(half, Math.hypot(bx - ax, by - ay) / 2 + 46) * grow
      strokeSegment(ctx, mx - dx * len, my - dy * len, mx + dx * len, my + dy * len, color)
      dot(ctx, ax, ay, color)
      dot(ctx, bx, by, color)
      // how far the curve sags away from the chord half-way: the readout goes beyond that
      const xm = (s.x + s.x2) / 2
      const ym = fn(xm)
      const sag = Number.isFinite(ym) ? ym - (s.y + s.y2) / 2 : 0
      const sagPx = Math.abs(g.sy(ym) - my) || 0
      const bend = Math.abs(sag) > 1e-9 ? -Math.sign(sag) : bendAt(fn, xm)
      slopeChip(ctx, g, mx, my, [dx, dy], s.slope, bend, Math.min(sagPx, 60), color)
      break
    }
    case 'area': {
      if (!fn || x === undefined || x2 === undefined) break
      const pts = areaPolygon(fn, x, x2)
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
        const xm = (lo + hi) / 2
        const ym = fn(xm)
        const text = `area ≈ ${fmt(areaUnder(fn, lo, hi), 2).replace('-', '−')}`
        const midY = Number.isFinite(ym) ? (g.sy(0) + g.sy(ym)) / 2 : g.sy(0) - 16
        haloText(ctx, g, text, g.sx(xm), midY, color, 19, 'center', true)
      }
      break
    }
    case 'vline': {
      if (x === undefined) break
      const px = g.sx(x)
      ctx.setLineDash([7, 6])
      const end = lerp(g.top + g.h, g.top, grow)
      strokeSegment(ctx, px, g.top + g.h, px, end, color, 2.25)
      ctx.setLineDash([])
      haloText(ctx, g, `x = ${fmt(x, 2).replace('-', '−')}`, px, g.top + 16, color, 17)
      break
    }
    case 'hline': {
      if (typeof mark.y !== 'number') break
      const py = g.sy(mark.y)
      ctx.setLineDash([7, 6])
      strokeSegment(ctx, g.left, py, lerp(g.left, g.left + g.w, grow), py, color, 2.25)
      ctx.setLineDash([])
      haloText(ctx, g, `y = ${fmt(mark.y, 2).replace('-', '−')}`, g.left + g.w - 8, py - 14, color, 17, 'right')
      break
    }
    case 'label': {
      if (!mark.text || x === undefined) break
      const onCurve = typeof mark.y !== 'number'
      const y = onCurve ? (fn ? fn(x) : NaN) : (mark.y as number)
      if (!Number.isFinite(y)) break
      const px = g.sx(x)
      const py = g.sy(y)
      if (onCurve) dot(ctx, px, py, color, 4.5)
      // text goes on the side with more room
      const toLeft = px > g.left + g.w * 0.55
      haloText(ctx, g, mark.text, px + (toLeft ? -12 : 12), py - 18, color, 20, toLeft ? 'right' : 'left')
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
  const g = geo(view, w, h)

  // the whole plot fades up the first time it appears
  const appear = prev || same ? 1 : easeOut(span(since, 0, 500))
  ctx.save()
  ctx.globalAlpha = appear
  drawAxes(ctx, g)

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

  // marks: ones that continue from the last step move on from where they stopped; others fade
  const prevMarks = prev?.marks ?? []
  const from = same ? scene.marks.map((_, i) => i) : matchMarks(prevMarks, scene.marks)
  if (prev) {
    const kept = new Set(from)
    const out = 1 - span(since, 0, FADE_MS * 0.8)
    prevMarks.forEach((m, i) => {
      if (!kept.has(i)) withAlpha(ctx, out, () => drawMark(ctx, g, prev.curves, m, markAt(m, 1), 1))
    })
  }
  const markDelay = fresh ? 150 + REVEAL_MS * 0.75 : 120
  scene.marks.forEach((m, i) => {
    const start = markAt(m, 0)
    const at = markAt(m, motion)
    let alpha = 1
    let grow = 1
    if (same) {
      // nothing to bring in
    } else if (from[i] >= 0) {
      // settle from where the last step left this mark to where this step starts it
      const k = easeInOut(span(since, 0, TWEEN_MS))
      const was = markAt(prevMarks[from[i]], 1)
      if (k < 1 && motion === 0) {
        if (typeof was.x === 'number' && typeof start.x === 'number') at.x = lerp(was.x, start.x, k)
        if (typeof was.x2 === 'number' && typeof start.x2 === 'number') at.x2 = lerp(was.x2, start.x2, k)
      }
    } else {
      alpha = span(since, markDelay + i * 120, FADE_MS)
      grow = easeOut(span(since, markDelay + i * 120, FADE_MS * 1.6))
    }
    withAlpha(ctx, alpha, () => drawMark(ctx, g, scene.curves, m, at, grow))
  })
  ctx.restore()
}
