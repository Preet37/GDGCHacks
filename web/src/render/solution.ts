import { createShapeId, toRichText, type Editor, type TLDefaultColorStyle, type TLShapeId, type TLShapePartial } from 'tldraw'
import type { Action } from '../contract'
import { aiMeta, anchorRect, lineRect, sizesFor, withFeedback, INLINE_LETTER_EM } from './actions'
import {
  BASE_FONT,
  CHAR_EM,
  DEFAULT_CONTEXT,
  MIN_SCREEN_FONT,
  TEXT_LINE_HEIGHT,
  clamp,
  coveredArea,
  letterHeight,
  placeBeside,
  strokesIn,
  expand,
  type PageRect,
  type RenderContext,
  type SolutionHeading,
} from './geometry'
import { MATH_EM, MATH_TYPE, freshMath, needsTypeset, stepTex, texHtml, type MathMeasure } from './mathline'
import { mathToPlain } from './text'

/** Pause between one worked step appearing and the next. */
export const STEP_PAUSE_MS = 800
/** Distance from one step to the next, over the font size, when the student's own spacing isn't known. */
export const STEP_PITCH_EM = 1.5
/** The student's own line spacing is followed within these limits (over the font size). */
export const PITCH_LIMITS: [number, number] = [1.25, 2.6]

/** The steps go under the student's own equals sign if that moves the block no further than this (over the font size). */
export const EQUALS_INDENT_EM = 2.5
export const EQUALS_OUTDENT_EM = 0.5
/** Clear space between a typeset step and the next, over the font size. */
export const STEP_GAP_EM = 0.4

export interface SolutionStep {
  text: string
  /** top-left of the text shape, page units */
  x: number
  y: number
  /** estimated width, page units */
  w: number
  /** height, page units: a text line, or the measured height of a typeset line (a stacked fraction is about two) */
  h: number
  /** set when the step is drawn typeset: what KaTeX is given (see stepTex) */
  tex?: string
}

export interface SolutionLayout {
  steps: SolutionStep[]
  /** font size, page units */
  font: number
  /** distance from one step to the next, page units */
  pitch: number
  /** what the whole block covers */
  rect: PageRect
  /** the student's line the steps continue */
  anchor: PageRect
  /** x the steps' equals signs share (null: no step has one) */
  equalsX: number | null
  /** there was no room below the line: the block is beside the working instead */
  moved: boolean
  /** on a worksheet with no room below: the block is beside the page, under this heading (inside `rect`) */
  heading?: SolutionHeading
}

/** Width of `text` at `font` px. The default guesses from the handwriting font's average glyph. */
export type Measure = (text: string, font: number) => number
const guess: Measure = (text, font) => text.length * font * CHAR_EM

function union(a: PageRect, b: PageRect): PageRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/**
 * Centre x of the first equals sign written on a line: two flat strokes, one over the other.
 * Null if the line has none (or its strokes aren't known).
 */
export function equalsSignX(line: PageRect, ink?: PageRect[]): number | null {
  const letters = letterHeight(line, ink) ?? line.h
  const flat = strokesIn(line, ink)
    .filter((s) => s.w > 0 && s.h <= s.w * 0.35)
    .sort((a, b) => a.x - b.x)
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i]
      const b = flat[j]
      const shared = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const apart = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2))
      if (shared >= Math.min(a.w, b.w) * 0.5 && apart > 0 && apart <= letters * 0.7 && Math.max(a.w, b.w) <= letters * 2) {
        const x0 = Math.min(a.x, b.x)
        return (x0 + Math.max(a.x + a.w, b.x + b.w)) / 2
      }
    }
  }
  return null
}

/** The first free `w` x `h` spot going right from the end of `from`, past everything in the way; null if that is off screen. */
function slideRight(from: PageRect, w: number, h: number, gap: number, ctx: RenderContext): PageRect | null {
  const obstacles = [...(ctx.ink ?? []), ...(ctx.taken ?? []), ...(ctx.printed ?? []), ...(ctx.chrome ?? [])]
  const r = { x: from.x + from.w + gap, y: from.y, w, h }
  const hits = (o: PageRect) => o.x < r.x + r.w && r.x < o.x + Math.max(o.w, 1) && o.y < r.y + r.h && r.y < o.y + Math.max(o.h, 1)
  for (let i = 0; i < 200; i++) {
    const hit = obstacles.filter(hits)
    if (hit.length) r.x = Math.max(...hit.map((o) => o.x + Math.max(o.w, 1))) + gap
    else if ((ctx.printedArea?.(r) ?? 0) > 0) r.x += gap
    else {
      const v = ctx.view
      return v && (r.x + r.w > v.x + v.w || r.y + r.h > v.y + v.h || r.y < v.y) ? null : r
    }
  }
  return null
}

/** Heading font over the steps' font, and the most of the problem's text it quotes. */
export const HEADING_EM = 0.6
export const HEADING_CHARS = 40

/** "Solution to: <the problem>" for a solution written away from its problem. */
export function headingText(problem?: string | null): string {
  const t = (problem ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return 'Solution (continued from the problem on the left)'
  return `Solution to: ${t.length > HEADING_CHARS ? t.slice(0, HEADING_CHARS).trimEnd() + '…' : t}`
}

const hits = (a: PageRect, b: PageRect) => a.x < b.x + Math.max(b.w, 1) && b.x < a.x + a.w && a.y < b.y + Math.max(b.h, 1) && b.y < a.y + a.h

/**
 * Where a `w` x `h` block goes when it has no room on the worksheet: on the blank canvas right of
 * the page `anchor` is on (and of any page beside that one), its top level with the anchor, then
 * down past whatever is already there (an earlier solution, ink, a graph).
 */
export function besideSheets(w: number, h: number, anchor: PageRect, sheets: PageRect[], obstacles: PageRect[], gap: number): PageRect {
  const on = sheets.filter((s) => hits(s, anchor))
  const right = (rs: PageRect[]) => Math.max(...rs.map((s) => s.x + s.w))
  const r = { x: (on.length ? right(on) : anchor.x + anchor.w) + gap, y: anchor.y, w, h }
  for (let i = 0; i < 400; i++) {
    const pages = sheets.filter((s) => hits(r, s))
    if (pages.length) {
      r.x = right(pages) + gap
      continue
    }
    const hit = obstacles.filter((o) => hits(r, o))
    if (!hit.length) break
    r.y = Math.max(...hit.map((o) => o.y + Math.max(o.h, 1))) + gap
  }
  return r
}

/** The line read just above `line` (same column), if there is one: its distance says how the student spaces their lines. */
function pitchAbove(line: PageRect, ctx: RenderContext): number | null {
  let best: number | null = null
  for (const other of ctx.lines?.values() ?? []) {
    const shared = Math.min(other.x + other.w, line.x + line.w) - Math.max(other.x, line.x)
    const d = line.y + line.h / 2 - (other.y + other.h / 2)
    if (shared <= 0 || d < line.h * 0.5) continue
    if (best === null || d < best) best = d
  }
  return best
}

/**
 * Where the worked steps of a `solution` go: one under another below the student's line, like the
 * next lines of their own working.
 * - size: as tall as the letters on that line (the rule inline answers use);
 * - left edge: where the student's line starts. Steps with an equals sign have them one under
 *   another, and under the student's own equals sign when that doesn't push the block out to the left;
 * - spacing: the student's own (the distance to the line above), else 1.5 x the font;
 * - never over ink, other feedback or printed text: with no room below, the whole block goes
 *   beside the working (placeBeside: right first, then wherever is free);
 * - on a worksheet with no room below (the next printed problem is in the way): the whole block
 *   goes on the blank canvas right of the page under a small "Solution to: ..." heading
 *   (besideSheets), one such block under another.
 * With `math` (how big a typeset line is), a solution with a step plain text can't show (a
 * fraction, a root: needsTypeset) has every step typeset; a step KaTeX can't read stays text.
 * Typeset lines are as tall as they are: a tall one pushes the next step down, and the block's
 * real height is what has to find room. Without `math` every step is a line of text.
 * The block is claimed in `ctx.taken`. Null if there is nothing to write or nowhere to anchor it.
 */
export function solutionLayout(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT, measure: Measure = guess, math?: MathMeasure | null): SolutionLayout | null {
  const raw = (action.steps ?? []).filter((s) => mathToPlain(s))
  const texts = raw.map((s) => mathToPlain(s))
  const typeset = !!math && raw.some(needsTypeset)
  const texs = raw.map((s) => {
    if (!typeset) return null
    const tex = stepTex(s)
    return texHtml(tex) === null ? null : tex
  })
  ctx.headings?.delete(action)
  if (!texts.length || !action.box) return null
  const box = anchorRect(action, bounds)
  const read = lineRect(action, bounds, ctx)
  const line = read ? union(box, read) : box
  if (!(line.w > 0) || !(line.h > 0)) return null
  const sz = sizesFor(action, bounds, ctx)
  const strokes = strokesIn(expand(line, sz.inlineGap), ctx.ink)
  const inked = strokes.reduce(union, line)

  const letters = letterHeight(line, ctx.ink)
  let font = letters === null ? sz.inlineFont : clamp(letters * INLINE_LETTER_EM, sz.inlineFont, sz.inlineFont * 1.5)
  const left = strokes.length ? Math.min(...strokes.map((s) => s.x)) : line.x

  const own = pitchAbove(line, ctx)
  const pitch = (font: number) => (own === null ? font * STEP_PITCH_EM : clamp(own, font * PITCH_LIMITS[0], font * PITCH_LIMITS[1]))

  const lineH = (font: number) => font * TEXT_LINE_HEIGHT
  /** each step's size and where its equals sign is; `top` is where a step as tall as `h0` starts */
  const build = (font: number, left: number, topFor: (h0: number) => number, alignTo: number | null) => {
    const boxes = texts.map((t, i) => {
      const tex = texs[i]
      if (tex && math) return { ...math(tex, font), tex }
      const at = t.indexOf('=')
      return { w: measure(t, font), h: lineH(font), eq: at < 0 ? null : measure(t.slice(0, at), font) + measure('=', font) / 2, tex: undefined }
    })
    const eqAt = boxes.map((b) => b.eq)
    const top = topFor(boxes[0].h)
    // text lines are one line spacing apart; a taller (typeset) line takes the room it needs
    const ys: number[] = []
    boxes.forEach((b, i) => {
      if (i === 0) return ys.push(top)
      const prev = boxes[i - 1]
      const step = typeset ? Math.max(pitch(font), (prev.h + b.h) / 2 + font * STEP_GAP_EM) : pitch(font)
      return ys.push(ys[i - 1] + prev.h / 2 + step - b.h / 2)
    })
    const lead = Math.max(0, ...eqAt.map((e) => e ?? 0))
    const any = eqAt.some((e) => e !== null)
    // under the student's own equals sign if the longest left-hand side still starts about where their line does
    let equalsX = any ? left + lead : null
    const indent = alignTo === null ? 0 : alignTo - lead - left
    if (any && alignTo !== null && indent >= -font * EQUALS_OUTDENT_EM && indent <= font * EQUALS_INDENT_EM) equalsX = alignTo
    // a step with no equals sign starts where the block does
    const steps: SolutionStep[] = texts.map((text, i) => {
      const step: SolutionStep = { text, x: equalsX === null ? left : equalsX - (eqAt[i] ?? lead), y: ys[i], w: boxes[i].w, h: boxes[i].h }
      if (boxes[i].tex) step.tex = boxes[i].tex
      return step
    })
    const x = Math.min(...steps.map((s) => s.x))
    const rect = { x, y: top, w: Math.max(...steps.map((s) => s.x + s.w)) - x, h: Math.max(...steps.map((s) => s.y + s.h)) - top }
    return { steps, rect, equalsX }
  }
  // the first step is one line spacing below the middle of the student's writing
  const middle = strokes.length ? inked.y + inked.h / 2 : line.y + line.h * 0.58
  const topFor = (font: number) => (h0: number) => Math.max(middle + pitch(font) - h0 / 2, inked.y + inked.h + font * 0.1)
  let made = build(font, left, topFor(font), equalsSignX(line, ctx.ink))
  // steps too long for the screen are written smaller (never below readable)
  const room = ctx.view ? ctx.view.x + ctx.view.w - sz.inlineGap - made.rect.x : Infinity
  if (room > 0 && made.rect.w > room) {
    font = Math.max(font * (room / made.rect.w), Math.min(font, MIN_SCREEN_FONT / ctx.zoom))
    made = build(font, left, topFor(font), equalsSignX(line, ctx.ink))
  }

  let moved = false
  let heading: SolutionHeading | undefined
  const onSheet = (ctx.sheets ?? []).some((s) => hits(s, line))
  // on a worksheet the steps also need a little clear paper under them
  const probe = onSheet ? { ...made.rect, h: made.rect.h + font * 0.3 } : made.rect
  if (onSheet && coveredArea(probe, ctx) > 0) {
    const hf = Math.min(font, Math.max(font * HEADING_EM, MIN_SCREEN_FONT / ctx.zoom))
    const text = headingText(action.line_id ? ctx.problems?.get(action.line_id) : null)
    const headH = hf * (TEXT_LINE_HEIGHT + 0.3)
    const headW = guess(text, hf)
    const obstacles = [...(ctx.ink ?? []), ...(ctx.taken ?? []), ...(ctx.printed ?? [])]
    const spot = besideSheets(Math.max(made.rect.w, headW), made.rect.h + headH, line, ctx.sheets ?? [], obstacles, sz.gap * 2)
    made = build(font, spot.x, () => spot.y + headH, null)
    const dx = spot.x - made.rect.x
    if (dx) {
      for (const s of made.steps) s.x += dx
      if (made.equalsX !== null) made.equalsX += dx
    }
    made.rect = spot
    heading = { text, x: spot.x, y: spot.y, font: hf, w: headW, anchor: line, line_id: action.line_id }
    ctx.headings?.set(action, heading)
    moved = true
  } else if (coveredArea(made.rect, ctx) > 0) {
    // no room under the line: to the right of the working, level with the line and past whatever is
    // written after it; failing that, wherever the placement code finds room
    const level = { x: inked.x, y: middle - (font * TEXT_LINE_HEIGHT) / 2, w: inked.w, h: font * TEXT_LINE_HEIGHT }
    const beside =
      slideRight(level, made.rect.w, made.rect.h, sz.gap * 2, ctx) ??
      placeBeside(withFeedback(inked, ctx, sz.gap), [{ w: made.rect.w, h: made.rect.h }], 'right', sz.gap, ctx)
    made = build(font, beside.x, () => beside.y, null)
    const dx = beside.x - made.rect.x // equals alignment may have pulled a step left of the spot
    if (dx) {
      for (const s of made.steps) s.x += dx
      made.rect.x += dx
      if (made.equalsX !== null) made.equalsX += dx
    }
    moved = true
  }
  ctx.taken?.push(made.rect)
  return { ...made, font, pitch: pitch(font), anchor: line, moved, heading }
}

type Shape = TLShapePartial & { x: number; y: number; id: TLShapeId }

/**
 * One shape per step, tagged `kind: 'solution'` so the next solution for the line replaces them:
 * a typeset line (MathShape) for a step laid out as one, text in the handwriting font otherwise.
 */
export function solutionShapes(action: Action, layout: SolutionLayout, color: TLDefaultColorStyle = 'black'): Shape[] {
  return layout.steps.map((s, i) => {
    const meta = { ...aiMeta('solution', action.line_id, layout.anchor), step: i }
    if (s.tex) return { id: createShapeId(), type: MATH_TYPE, x: s.x, y: s.y, meta, props: { w: s.w, h: s.h, tex: s.tex, color, size: layout.font * MATH_EM } }
    return {
      id: createShapeId(),
      type: 'text',
      x: s.x,
      y: s.y,
      meta,
      props: { richText: toRichText(s.text), font: 'draw', size: 's', scale: layout.font / BASE_FONT, color, textAlign: 'start', autoSize: true },
    }
  })
}

/** The heading of a solution written beside the worksheet: small gray text, replaced along with the steps. */
export function headingShape(h: SolutionHeading): Shape {
  return {
    id: createShapeId(),
    type: 'text',
    x: h.x,
    y: h.y,
    meta: { ...aiMeta('solution', h.line_id, h.anchor), step: -1 },
    props: { richText: toRichText(h.text), font: 'draw', size: 's', scale: h.font / BASE_FONT, color: 'grey', textAlign: 'start', autoSize: true },
  }
}

/** Width of text in the handwriting font, measured on a canvas once the font is there; the estimate otherwise. */
export function fontMeasure(): Measure {
  try {
    const family = 'tldraw_draw'
    if (typeof document === 'undefined' || !document.fonts?.check(`18px ${family}`)) return guess
    const c = document.createElement('canvas').getContext('2d')
    if (!c) return guess
    return (text, font) => {
      c.font = `${BASE_FONT}px ${family}`
      const w = c.measureText(text).width
      return w > 0 || !text ? (w * font) / BASE_FONT : guess(text, font)
    }
  } catch {
    return guess
  }
}

/** Slide the page the least it takes for `rect` to be on screen (never zooming). */
export function panTo(editor: Editor, rect: PageRect) {
  try {
    const b = editor.getViewportPageBounds()
    const zoom = editor.getZoomLevel()
    const inset = 24 / zoom
    if (rect.x >= b.x && rect.y >= b.y && rect.x + rect.w <= b.x + b.w && rect.y + rect.h <= b.y + b.h) return
    const slide = (lo: number, size: number, tLo: number, tSize: number) => (tSize + inset * 2 > size ? tLo - inset : Math.min(tLo - inset, Math.max(lo, tLo + tSize + inset - size)))
    editor.setCamera({ x: -slide(b.x, b.w, rect.x, rect.w), y: -slide(b.y, b.h, rect.y, rect.h), z: zoom }, { animation: { duration: 300 } })
  } catch (err) {
    console.warn('could not bring the step into view', err)
  }
}

/** Milliseconds per character while a step is being written on. */
const MS_PER_CHAR = 28
const WRITE_MAX_MS = 480
/** How long a typeset step takes to appear (the shape's own wipe). */
const MATH_WRITE_MS = 450

/**
 * Put the steps on the page one at a time: each is written on (its characters appear left to
 * right), the page follows the newest one, and the next starts STEP_PAUSE_MS later. If the steps
 * are removed part-way (the line was cleared, or a new solution replaced them) the rest never appear.
 * `animate: false` (or no timers): all at once. Resolves true when every step is on the page.
 */
export function revealSolution(editor: Editor, shapes: Shape[], layout: SolutionLayout, opts: { animate?: boolean; follow?: boolean } = {}): Promise<boolean> {
  const run = (fn: () => void) => editor.run(fn, { history: 'ignore', ignoreShapeLock: true })
  if (opts.animate === false || typeof requestAnimationFrame !== 'function') {
    run(() => editor.createShapes(shapes))
    return Promise.resolve(true)
  }
  const texts = shapes.map((_, i) => [...(layout.steps[i]?.text ?? '')])
  const made: TLShapeId[] = []
  const alive = () => made.every((id) => editor.getShape(id))
  const stop = () => run(() => editor.deleteShapes(made.filter((id) => editor.getShape(id))))
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  const writeOn = (shape: Shape, chars: string[]) =>
    new Promise<boolean>((resolve) => {
      if (shape.type !== 'text') {
        // a typeset line goes on whole; the shape wipes itself on the first time it is drawn
        freshMath.add(shape.id)
        run(() => editor.createShape(shape as TLShapePartial))
        made.push(shape.id)
        setTimeout(() => {
          freshMath.delete(shape.id)
          resolve(true)
        }, MATH_WRITE_MS)
        return
      }
      const total = Math.min(WRITE_MAX_MS, chars.length * MS_PER_CHAR)
      let t0: number | null = null
      let shown = 0
      const frame = (now: number) => {
        t0 ??= now
        if (made.length && !alive()) return resolve(false)
        const n = total <= 0 ? chars.length : Math.max(1, Math.min(chars.length, Math.ceil(((now - t0) / total) * chars.length)))
        if (n !== shown) {
          shown = n
          const props = { ...shape.props, richText: toRichText(chars.slice(0, n).join('')) }
          run(() => (made.includes(shape.id) ? editor.updateShape({ id: shape.id, type: 'text', props }) : editor.createShape({ ...shape, props } as TLShapePartial)))
          if (!made.includes(shape.id)) made.push(shape.id)
        }
        if (n >= chars.length) resolve(true)
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })

  return (async () => {
    for (let i = 0; i < shapes.length; i++) {
      if (i > 0) await wait(STEP_PAUSE_MS)
      if (made.length && !alive()) {
        stop()
        return false
      }
      const shape = shapes[i]
      if (opts.follow !== false) {
        const step = { x: shape.x, y: shape.y, w: layout.steps[i]?.w ?? 0, h: layout.steps[i]?.h ?? layout.font * TEXT_LINE_HEIGHT }
        const head = i === 0 ? layout.heading : undefined // the heading comes into view with the first step
        panTo(editor, head ? union(step, { x: head.x, y: head.y, w: head.w, h: head.font * TEXT_LINE_HEIGHT }) : step)
      }
      if (!(await writeOn(shape, texts[i]))) {
        stop()
        return false
      }
    }
    return true
  })().catch((err) => {
    console.warn('solution not finished', err)
    return false
  })
}
