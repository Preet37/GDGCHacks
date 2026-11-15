import { b64Vecs, createShapeId, type Editor, type TLDrawShape, type TLShapeId, type TLShapePartial } from 'tldraw'
import { aiMeta } from '../render/actions'
import type { PageRect } from '../render/geometry'
import { getBank, metricsOf, type Bank } from './bank'
import { isStudentStroke, measuredLines } from './harvest'
import { layoutText, type Layout, type LayoutOptions, type WriteMode } from './layout'
import { boundsOf, densify, median, strokeLength } from './strokes'
import type { Stroke } from './types'

/** Where a line of handwriting goes. */
export interface HandPlacement {
  /** left edge of the first character, page units */
  x: number
  /** y of the baseline the characters stand on, page units */
  baseline: number
  /** height of a small letter (x), page units */
  xHeight: number
  /** the tutor line this belongs to: the shapes are cleared and replaced with it */
  line_id?: string | null
  /** page rect of the writing this is about (kept on the shapes, like other tutor feedback) */
  anchor?: PageRect | null
  /** shrink the writing (down to 60%) so the line is no wider than this, page units */
  maxWidth?: number
}

export interface WriteOptions extends LayoutOptions {
  /** draw the strokes one after another at pen speed (default true) */
  animate?: boolean
  /** glyph bank to use (default: this device's) */
  bank?: Bank
}

export interface HandResult {
  /** the draw shapes, one per pen stroke, in writing order (all exist once `done` resolves) */
  ids: TLShapeId[]
  /** page rect the writing covers */
  rect: PageRect
  /** 'hand': the student's own characters; 'font': the stroke font shaped like their hand */
  mode: WriteMode
  /** resolves when the last stroke is on the page (true), or the writing was removed part-way (false) */
  done: Promise<boolean>
}

type Pen = Pick<TLDrawShape['props'], 'color' | 'size' | 'dash' | 'isPen' | 'scale'>

/** The pen the student is writing with: taken from their newest stroke (near `rect` if given). */
export function studentPen(editor: Editor, rect?: PageRect | null): Pen {
  const strokes = editor.getCurrentPageShapesSorted().filter(isStudentStroke)
  const near = rect
    ? strokes.filter((s) => {
        const b = editor.getShapePageBounds(s)
        return !!b && b.x <= rect.x + rect.w && rect.x <= b.x + b.w && b.y <= rect.y + rect.h && rect.y <= b.y + b.h
      })
    : []
  const last = (near.length ? near : strokes).at(-1)
  if (!last) return { color: 'black', size: 'm', dash: 'draw', isPen: false, scale: 1 }
  const { color, size, dash, isPen, scale } = last.props
  return { color, size, dash, isPen, scale }
}

/**
 * Where to carry on writing after the handwriting in `line` (a page rect, e.g. the line the tutor
 * read): straight after its last stroke, on its baseline, at its size. Uses the line's measured
 * baseline when the line has been learned from, else reads it off the strokes.
 */
export function placeAfter(editor: Editor, line: PageRect, bank: Bank = getBank()): HandPlacement {
  const m = metricsOf(bank)
  const rects: PageRect[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (!isStudentStroke(s)) continue
    const b = editor.getShapePageBounds(s)
    if (!b) continue
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    if (cx >= line.x - 4 && cx <= line.x + line.w + 4 && cy >= line.y - 4 && cy <= line.y + line.h + 4) rects.push({ x: b.x, y: b.y, w: b.w, h: b.h })
  }
  const right = Math.max(line.x + line.w, ...rects.map((r) => r.x + r.w))

  // a line that was learned from knows its baseline exactly
  const known = [...measuredLines()].reverse().find((l) => {
    const ox = Math.min(l.rect.x + l.rect.w, line.x + line.w) - Math.max(l.rect.x, line.x)
    const oy = Math.min(l.rect.y + l.rect.h, line.y + line.h) - Math.max(l.rect.y, line.y)
    return ox > 0 && oy > Math.min(l.rect.h, line.h) * 0.5
  })
  if (known) {
    const gap = m.loose * known.xHeight
    return { x: right + gap, baseline: known.baseline + known.slope * (right + gap - known.rect.x), xHeight: known.xHeight, anchor: line }
  }

  // otherwise: tall strokes stand on the baseline, and the tallest ones are as high as a digit
  const hs = rects.map((r) => r.h).sort((a, b) => a - b)
  const tall = hs.length ? hs[Math.floor((hs.length - 1) * 0.75)] : line.h * 0.7
  const standing = rects.filter((r) => r.h >= tall * 0.6)
  const baseline = standing.length ? median(standing.map((r) => r.y + r.h)) : line.y + line.h * 0.85
  const xHeight = Math.max(4, tall / m.cap)
  return { x: right + m.loose * xHeight, baseline, xHeight, anchor: line }
}

/** Milliseconds of writing per x-height of ink, and the pause for lifting the pen. */
const MS_PER_X = 45
const LIFT_MS = 45
const MAX_MS = 2600

interface Planned {
  id: TLShapeId
  pts: Stroke
  /** share of the stroke's length reached at each point */
  along: number[]
  start: number
  end: number
}

/** Page-space strokes for a layout placed at `at`. */
export function strokesOnPage(layout: Layout, at: HandPlacement): { strokes: Stroke[]; unit: number } {
  let unit = at.xHeight
  if (at.maxWidth && layout.width * unit > at.maxWidth) unit = Math.max(unit * 0.6, at.maxWidth / layout.width)
  const strokes = layout.glyphs.flatMap((g) => g.strokes.map((s) => s.map((p) => ({ x: at.x + p.x * unit, y: at.baseline + p.y * unit, z: p.z }))))
  return { strokes, unit }
}

function shapeFor(id: TLShapeId, pts: Stroke, pen: Pen, meta: ReturnType<typeof aiMeta>, isComplete: boolean): TLShapePartial<TLDrawShape> & { x: number; y: number } {
  const o = pts[0]
  const local = pts.map((p) => ({ x: p.x - o.x, y: p.y - o.y, z: pen.isPen ? (p.z ?? 0.5) : 0.5 }))
  return {
    id,
    type: 'draw',
    x: o.x,
    y: o.y,
    meta,
    props: {
      ...pen,
      fill: 'none',
      segments: [{ type: 'free', path: b64Vecs.encodePoints(local) }],
      isComplete,
      isClosed: false,
      scaleX: 1,
      scaleY: 1,
    },
  }
}

/**
 * Write `text` (the tutor's answer: `12x`, `3 x^{2} + 2`, `x = \pm 1`) on the page in the student's
 * own handwriting, as real pen strokes in their pen, tagged as tutor feedback
 * (`meta: { ai: true, line_id, kind: 'hand' }`).
 *
 * Returns null, having drawn nothing, when the hand isn't known well enough yet or the text has
 * something that can't be written (a line break, an unknown symbol): the caller then draws the
 * text the usual way.
 */
export function writeInHand(editor: Editor, text: string, at: HandPlacement, opts: WriteOptions = {}): HandResult | null {
  if (!text.trim() || /\n/.test(text.trim())) return null
  if (!(at.xHeight > 0) || !Number.isFinite(at.x) || !Number.isFinite(at.baseline)) return null
  const layout = layoutText(text, opts.bank ?? getBank(), opts)
  if (!layout) return null

  const { strokes, unit } = strokesOnPage(layout, at)
  const pen = studentPen(editor, at.anchor)
  const meta = aiMeta('hand', at.line_id, at.anchor)
  // points about 2 screen px apart at the size written, like real pen input
  const spacing = Math.max(1, unit * 0.04)
  const planned: Planned[] = []
  let clock = 0
  let total = 0
  for (const raw of strokes) {
    const pts = densify(raw, spacing)
    if (pts.length < 2) continue
    const len = strokeLength(pts)
    const along = [0]
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / (len || 1))
    const ms = Math.max(30, (len / unit) * MS_PER_X)
    planned.push({ id: createShapeId(), pts, along, start: clock, end: clock + ms })
    clock += ms + LIFT_MS
    total = clock - LIFT_MS
  }
  if (!planned.length) return null
  const speed = total > MAX_MS ? MAX_MS / total : 1
  for (const p of planned) {
    p.start *= speed
    p.end *= speed
  }

  const b = boundsOf(planned.map((p) => p.pts))!
  const ids = planned.map((p) => p.id)
  const run = (fn: () => void) => editor.run(fn, { history: 'ignore', ignoreShapeLock: true })
  const animate = opts.animate !== false && typeof requestAnimationFrame === 'function'

  let done: Promise<boolean>
  if (!animate) {
    run(() => editor.createShapes(planned.map((p) => shapeFor(p.id, p.pts, pen, meta, true))))
    done = Promise.resolve(true)
  } else {
    done = new Promise((resolve) => {
      const made = new Set<TLShapeId>()
      const finished = new Set<TLShapeId>()
      let t0: number | null = null
      const frame = (now: number) => {
        t0 ??= now
        const t = now - t0
        // the line was cleared or replaced while it was being written: stop, and leave nothing behind
        if ([...made].some((id) => !editor.getShape(id))) {
          run(() => editor.deleteShapes([...made].filter((id) => editor.getShape(id))))
          resolve(false)
          return
        }
        run(() => {
          for (const p of planned) {
            if (finished.has(p.id) || t < p.start) continue
            const share = Math.min(1, (t - p.start) / Math.max(1, p.end - p.start))
            let n = p.along.findIndex((a) => a > share)
            n = share >= 1 || n < 0 ? p.pts.length : Math.max(2, n)
            const shape = shapeFor(p.id, p.pts.slice(0, n), pen, meta, share >= 1)
            if (made.has(p.id)) editor.updateShape(shape)
            else editor.createShape(shape)
            made.add(p.id)
            if (share >= 1) finished.add(p.id)
          }
        })
        if (finished.size === planned.length) {
          // belt and braces: nothing is left looking like a stroke still being drawn
          const open = planned.filter((p) => (editor.getShape(p.id) as TLDrawShape | undefined)?.props.isComplete === false)
          if (open.length) run(() => editor.updateShapes(open.map((p) => shapeFor(p.id, p.pts, pen, meta, true))))
          resolve(true)
        }
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  }
  return { ids, rect: { x: b.x, y: b.y, w: b.w, h: b.h }, mode: layout.mode, done }
}

export interface LinesPlacement extends HandPlacement {
  /** distance from one baseline to the next, in x-heights (default: about the student's own line spacing) */
  lineGap?: number
}

/**
 * Write several lines one under another (a worked solution), each after the one before has been
 * written. All or nothing: null, with nothing drawn, if any line can't be written by hand.
 */
export function writeLinesInHand(editor: Editor, lines: string[], at: LinesPlacement, opts: WriteOptions = {}): HandResult | null {
  const bank = opts.bank ?? getBank()
  const texts = lines.map((l) => l.trim()).filter(Boolean)
  if (!texts.length || texts.some((l) => /\n/.test(l) || !layoutText(l, bank, { ...opts, seed: 1 }))) return null
  const step = (at.lineGap ?? metricsOf(bank).cap + 1.6) * at.xHeight
  const ids: TLShapeId[] = []
  let rect: PageRect | null = null
  let mode: WriteMode = 'hand'
  const add = (r: HandResult) => {
    ids.push(...r.ids)
    if (r.mode === 'font') mode = 'font'
    const x = Math.min(rect?.x ?? r.rect.x, r.rect.x)
    const y = Math.min(rect?.y ?? r.rect.y, r.rect.y)
    rect = { x, y, w: Math.max(rect ? rect.x + rect.w : -Infinity, r.rect.x + r.rect.w) - x, h: Math.max(rect ? rect.y + rect.h : -Infinity, r.rect.y + r.rect.h) - y }
  }
  const animate = opts.animate !== false && typeof requestAnimationFrame === 'function'
  let chain: Promise<boolean> = Promise.resolve(true)
  texts.forEach((text, i) => {
    const where = { ...at, baseline: at.baseline + step * i }
    if (!animate) {
      const r = writeInHand(editor, text, where, opts)
      if (r) add(r)
      return
    }
    chain = chain.then(async (ok) => {
      if (!ok) return false
      const r = writeInHand(editor, text, where, opts)
      if (!r) return true
      add(r)
      return r.done
    })
  })
  // the rect is known before the writing is: it is what the lines will cover
  const m = metricsOf(bank)
  const widest = Math.max(...texts.map((l) => layoutText(l, bank, { ...opts, seed: 1 })!.width))
  const planned: PageRect = { x: at.x, y: at.baseline - m.cap * at.xHeight, w: widest * at.xHeight, h: step * (texts.length - 1) + (m.cap + 0.4) * at.xHeight }
  return { ids, rect: rect ?? planned, mode, done: chain }
}
