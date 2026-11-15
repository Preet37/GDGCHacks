import { createShapeId, getIndices, toRichText, type TLDefaultColorStyle, type TLShapePartial } from 'tldraw'
import type { Action } from '../contract'
import {
  BASE_FONT,
  BASE_STROKE,
  CHAR_EM,
  DEFAULT_CONTEXT,
  DEFAULT_LINE_H,
  MIN_SCREEN_FONT,
  TEXT_LINE_HEIGHT,
  boxToPage,
  clamp,
  estimateText,
  expand,
  feedbackSizes,
  gapBetween,
  inlineAt,
  leaderEnds,
  letterHeight,
  overlapRatio,
  placeBeside,
  strokesIn,
  textHeight,
  type FeedbackSizes,
  type PageRect,
  type RenderContext,
  type Side,
} from './geometry'
import { mathToPlain } from './text'

/** Every shape the tutor draws carries this meta, so we can find and replace it later. */
export interface AiMeta {
  [key: string]: string | number | boolean | null
  ai: true
  line_id: string | null
  kind: string
}

/**
 * `anchor` = the page rect of the writing this shape is about. It is kept on the shape so that
 * later feedback for the same writing can replace it even if the line's id has changed.
 */
export function aiMeta(kind: string, line_id?: string | null, anchor?: PageRect | null): AiMeta {
  const meta: AiMeta = { ai: true, line_id: line_id ?? null, kind }
  if (anchor && anchor.w > 0 && anchor.h > 0) Object.assign(meta, { ax: anchor.x, ay: anchor.y, aw: anchor.w, ah: anchor.h })
  return meta
}

/** The anchor stored by aiMeta, if the shape has one. */
export function anchorOf(shape: { meta: Record<string, unknown> }): PageRect | null {
  const { ax, ay, aw, ah } = shape.meta ?? {}
  return [ax, ay, aw, ah].every((v) => typeof v === 'number' && Number.isFinite(v))
    ? { x: ax as number, y: ay as number, w: aw as number, h: ah as number }
    : null
}

export function isAiShape(shape: { meta: Record<string, unknown> }): boolean {
  return shape.meta?.ai === true
}

type Shape = TLShapePartial & { x: number; y: number }

/** Page rect of the action's box, or a zero-size spot at the top-right of the sent area if it has none. */
export function anchorRect(action: Action, bounds: PageRect): PageRect {
  return action.box ? boxToPage(action.box, bounds) : { x: bounds.x + bounds.w, y: bounds.y, w: 0, h: 0 }
}

function unionRect(a: PageRect, b: PageRect): PageRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/**
 * The whole line the action is about: the line that was read under its line_id if there is one
 * (the action's own box may be narrowed to one term), else its box. Null if neither is known.
 */
export function lineRect(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): PageRect | null {
  const line = action.line_id ? ctx.lines?.get(action.line_id) : undefined
  const box = action.box ? boxToPage(action.box, bounds) : null
  if (!line) return box
  // a box somewhere else entirely (a figure beside another line) stands for itself
  if (box && overlapRatio(line, box) < 0.5) return box
  return line
}

/** Sizes for this action's feedback, from the height of the handwriting it is about (not of a sliver of it). */
export function sizesFor(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): FeedbackSizes {
  const line = lineRect(action, bounds, ctx)
  return feedbackSizes(line ? textHeight(line, ctx.ink) : DEFAULT_LINE_H, ctx)
}

/** Remember that `rect` is now taken, so later feedback in the same reply keeps clear of it. */
function claim(ctx: RenderContext, rect: PageRect) {
  ctx.taken?.push(rect)
}

/** The box, stretched over the strokes that belong to it (a read box is often a little short of the ink). */
function inkedRect(rect: PageRect, ctx: RenderContext): PageRect {
  return strokesIn(rect, ctx.ink).reduce(unionRect, rect)
}

/**
 * The line plus feedback already written on it (an inline answer, a note beside it): a card is
 * placed beside all of that, so it never lands on top of the answer it is about.
 */
export function withFeedback(rect: PageRect, ctx: RenderContext, gap: number): PageRect {
  const near = (t: PageRect) =>
    t.y < rect.y + rect.h && t.y + t.h > rect.y && t.x < rect.x + rect.w + gap * 2 && t.x + t.w > rect.x - gap * 2
  return (ctx.taken ?? []).filter(near).reduce(unionRect, rect)
}

function preferredSide(action: Action): Side {
  return action.side === 'below' ? 'below' : 'right'
}

/**
 * Page rect for a `w` x `h` card (a graph, a lesson) next to the action's box: the requested
 * side if there is room, else wherever there is. The spot is claimed.
 */
export function cardRect(action: Action, bounds: PageRect, ctx: RenderContext, w: number, h: number): PageRect {
  const sz = sizesFor(action, bounds, ctx)
  const anchor = withFeedback(inkedRect(anchorRect(action, bounds), ctx), ctx, sz.gap)
  const r = placeBeside(anchor, [{ w, h }], preferredSide(action), sz.gap, ctx)
  claim(ctx, r)
  return r
}

export function circleShapes(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): Shape[] {
  if (!action.box) return []
  const sz = sizesFor(action, bounds, ctx)
  const r = expand(boxToPage(action.box, bounds), sz.pad)
  claim(ctx, r)
  return [
    {
      id: createShapeId(),
      type: 'geo',
      x: r.x,
      y: r.y,
      meta: aiMeta('circle', action.line_id, lineRect(action, bounds, ctx)),
      props: {
        geo: 'ellipse',
        w: r.w,
        h: r.h,
        color: action.color ?? 'red',
        fill: 'none',
        dash: 'draw',
        size: 's',
        scale: sz.stroke / BASE_STROKE,
      },
    },
  ]
}

export function underlineShapes(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): Shape[] {
  if (!action.box) return []
  const sz = sizesFor(action, bounds, ctx)
  const r = boxToPage(action.box, bounds)
  const [a, b] = getIndices(2)
  return [
    {
      id: createShapeId(),
      type: 'line',
      x: r.x,
      y: r.y + r.h + sz.pad / 2,
      meta: aiMeta('underline', action.line_id, lineRect(action, bounds, ctx)),
      props: {
        color: action.color ?? 'red',
        dash: 'draw',
        size: 's',
        scale: sz.stroke / BASE_STROKE,
        points: {
          [a]: { id: a, index: a, x: 0, y: 0 },
          [b]: { id: b, index: b, x: r.w, y: 0 },
        },
      },
    },
  ]
}

/** How much narrower a note may be wrapped to make it fit somewhere. */
const NARROWER = [1, 0.7, 0.5]

/** A wrapped block of handwriting-font text next to the action's box, on whichever side has room. */
function textShape(kind: string, action: Action, bounds: PageRect, ctx: RenderContext, text: string, color: TLDefaultColorStyle): Shape[] {
  const sz = sizesFor(action, bounds, ctx)
  const scale = sz.noteFont / BASE_FONT
  // no wider than the text itself needs
  const longest = Math.max(...text.split('\n').map((l) => l.length))
  const full = Math.min(sz.noteWidth, (longest + 1) * sz.noteFont * CHAR_EM)
  const widths = NARROWER.map((f) => Math.max(full * f, Math.min(full, sz.noteFont * 6)))
  const anchor = inkedRect(anchorRect(action, bounds), ctx)
  const r = placeBeside(
    anchor,
    widths.filter((w, i) => widths.indexOf(w) === i).map((w) => estimateText(text, sz.noteFont, w)),
    preferredSide(action),
    sz.gap,
    ctx,
  )
  claim(ctx, r)
  const about = lineRect(action, bounds, ctx)
  const shapes: Shape[] = [
    {
      id: createShapeId(),
      type: 'text',
      x: r.x,
      y: r.y,
      meta: aiMeta(kind, action.line_id, about),
      // `w` is in unscaled units: the shape is laid out at size 's' and then scaled up.
      props: { richText: toRichText(text), font: 'draw', size: 's', scale, color, textAlign: 'start', autoSize: false, w: r.w / scale },
    },
  ]
  // no room beside the line, so the note is somewhere else: a thin line says what it is about
  if (anchor.w > 0 && anchor.h > 0 && gapBetween(r, anchor) > sz.gap * LEADER_BEYOND) shapes.push(leaderShape(r, anchor, action, about, color, sz))
  return shapes
}

/** A note further from its line than this many gaps gets a leader line. */
export const LEADER_BEYOND = 2

function leaderShape(from: PageRect, to: PageRect, action: Action, about: PageRect | null, color: TLDefaultColorStyle, sz: FeedbackSizes): Shape {
  const { a, b } = leaderEnds(from, to)
  const [i, j] = getIndices(2)
  return {
    id: createShapeId(),
    type: 'line',
    x: a.x,
    y: a.y,
    opacity: 0.6,
    meta: aiMeta('leader', action.line_id, about),
    props: {
      color,
      dash: 'solid',
      size: 's',
      scale: (sz.stroke / BASE_STROKE) * 0.6,
      points: {
        [i]: { id: i, index: i, x: 0, y: 0 },
        [j]: { id: j, index: j, x: b.x - a.x, y: b.y - a.y },
      },
    },
  }
}

/** Font size of an inline answer over the height of a typical handwritten letter on the line. */
export const INLINE_LETTER_EM = 1.3

/** The tutor finishing the student's line: one line of text straight after the box, at the handwriting's size. */
function inlineShape(action: Action, bounds: PageRect, ctx: RenderContext, text: string): Shape[] {
  const sz = sizesFor(action, bounds, ctx)
  const box = anchorRect(action, bounds)
  const line = lineRect(action, bounds, ctx)
  const anchor = line ? unionRect(box, line) : box
  // as tall as the student's own letters: the font's digits and capitals are ~0.75 em, so 1.3 x a
  // typical letter. The box-based size is the floor (and stands in when the strokes are unknown);
  // a tight box around a short line ("x =") must not make the answer smaller than the writing.
  const letters = letterHeight(anchor, ctx.ink)
  let font = letters === null ? sz.inlineFont : clamp(letters * INLINE_LETTER_EM, sz.inlineFont, sz.inlineFont * 1.5)
  let at = inlineAt(anchor, font, sz.inlineGap, ctx.ink)
  // an answer that would run off the screen is written smaller (never below readable) so it fits
  const room = ctx.view ? ctx.view.x + ctx.view.w - sz.inlineGap - at.x : Infinity
  const wide = text.length * font * CHAR_EM
  if (room > 0 && wide > room) {
    font = Math.max(font * (room / wide), Math.min(font, MIN_SCREEN_FONT / ctx.zoom))
    at = inlineAt(anchor, font, sz.inlineGap, ctx.ink)
  }
  claim(ctx, { x: at.x, y: at.y, w: text.length * font * CHAR_EM, h: font * TEXT_LINE_HEIGHT })
  return [
    {
      id: createShapeId(),
      type: 'text',
      x: at.x,
      y: at.y,
      meta: aiMeta('note', action.line_id, line),
      props: {
        richText: toRichText(text),
        font: 'draw',
        size: 's',
        scale: font / BASE_FONT,
        color: action.color ?? 'black',
        textAlign: 'start',
        autoSize: true,
      },
    },
  ]
}

/**
 * Is this note the tutor finishing the student's line? Either it says so (side "inline"), or it is
 * written in the student's ink colour (black, per the contract) beside the line rather than below it.
 */
export function isInlineNote(action: Action): boolean {
  if (!action.box) return false
  return action.side === 'inline' || (action.color === 'black' && action.side !== 'below' && !/\n/.test(action.text ?? ''))
}

export function noteShapes(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): Shape[] {
  if (!action.text) return []
  const text = mathToPlain(action.text)
  if (isInlineNote(action)) return inlineShape(action, bounds, ctx, text)
  return textShape('note', action, bounds, ctx, text, action.color ?? 'red')
}

export function askShapes(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): Shape[] {
  const lines = [mathToPlain(action.text ?? 'Did you mean...?')]
  for (const option of action.options ?? []) lines.push(`• ${mathToPlain(option)}`)
  return textShape('ask', action, bounds, ctx, lines.join('\n'), 'blue')
}

/**
 * Shapes for one action. figure, lesson and speak draw nothing here (figures and lessons are async,
 * speak is audio). `ctx` says how the page is being looked at; if it has a `taken` list, the
 * space each note ends up in is added to it.
 */
export function shapesForAction(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): Shape[] {
  switch (action.type) {
    case 'circle':
      return circleShapes(action, bounds, ctx)
    case 'underline':
      return underlineShapes(action, bounds, ctx)
    case 'note':
      return noteShapes(action, bounds, ctx)
    case 'ask':
      return askShapes(action, bounds, ctx)
    default:
      return []
  }
}
