import { createShapeId, getIndices, toRichText, type TLDefaultColorStyle, type TLShapePartial } from 'tldraw'
import type { Action } from '../contract'
import {
  BASE_FONT,
  BASE_STROKE,
  DEFAULT_LINE_H,
  beside,
  boxToPage,
  expand,
  feedbackSizes,
  inlineAt,
  type FeedbackSizes,
  type PageRect,
} from './geometry'
import { mathToPlain } from './text'

/** Every shape the tutor draws carries this meta, so we can find and replace it later. */
export interface AiMeta {
  [key: string]: string | boolean | null
  ai: true
  line_id: string | null
  kind: string
}

export function aiMeta(kind: string, line_id?: string | null): AiMeta {
  return { ai: true, line_id: line_id ?? null, kind }
}

export function isAiShape(shape: { meta: Record<string, unknown> }): boolean {
  return shape.meta?.ai === true
}

type Shape = TLShapePartial & { x: number; y: number }

/** Page rect of the action's box, or a zero-size spot at the top-right of the sent area if it has none. */
export function anchorRect(action: Action, bounds: PageRect): PageRect {
  return action.box ? boxToPage(action.box, bounds) : { x: bounds.x + bounds.w, y: bounds.y, w: 0, h: 0 }
}

/** Sizes for this action's feedback, from the height of the handwriting it is about. */
export function sizesFor(action: Action, bounds: PageRect): FeedbackSizes {
  return feedbackSizes(action.box ? boxToPage(action.box, bounds).h : DEFAULT_LINE_H)
}

export function circleShapes(action: Action, bounds: PageRect): Shape[] {
  if (!action.box) return []
  const sz = sizesFor(action, bounds)
  const r = expand(boxToPage(action.box, bounds), sz.pad)
  return [
    {
      id: createShapeId(),
      type: 'geo',
      x: r.x,
      y: r.y,
      meta: aiMeta('circle', action.line_id),
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

export function underlineShapes(action: Action, bounds: PageRect): Shape[] {
  if (!action.box) return []
  const sz = sizesFor(action, bounds)
  const r = boxToPage(action.box, bounds)
  const [a, b] = getIndices(2)
  return [
    {
      id: createShapeId(),
      type: 'line',
      x: r.x,
      y: r.y + r.h + sz.pad / 2,
      meta: aiMeta('underline', action.line_id),
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

/** A wrapped block of handwriting-font text beside or below the action's box. */
function textShape(kind: string, action: Action, bounds: PageRect, text: string, color: TLDefaultColorStyle): Shape[] {
  const sz = sizesFor(action, bounds)
  const at = beside(anchorRect(action, bounds), action.side === 'below' ? 'below' : 'right', sz.gap)
  const scale = sz.noteFont / BASE_FONT
  return [
    {
      id: createShapeId(),
      type: 'text',
      x: at.x,
      y: at.y,
      meta: aiMeta(kind, action.line_id),
      // `w` is in unscaled units: the shape is laid out at size 's' and then scaled up.
      props: { richText: toRichText(text), font: 'draw', size: 's', scale, color, textAlign: 'start', autoSize: false, w: sz.noteWidth / scale },
    },
  ]
}

/** The tutor finishing the student's line: one line of text straight after the box, at the handwriting's size. */
function inlineShape(action: Action, bounds: PageRect, text: string): Shape[] {
  const sz = sizesFor(action, bounds)
  const at = inlineAt(anchorRect(action, bounds), sz.inlineFont, sz.inlineGap)
  return [
    {
      id: createShapeId(),
      type: 'text',
      x: at.x,
      y: at.y,
      meta: aiMeta('note', action.line_id),
      props: {
        richText: toRichText(text),
        font: 'draw',
        size: 's',
        scale: sz.inlineFont / BASE_FONT,
        color: action.color ?? 'black',
        textAlign: 'start',
        autoSize: true,
      },
    },
  ]
}

export function noteShapes(action: Action, bounds: PageRect): Shape[] {
  if (!action.text) return []
  const text = mathToPlain(action.text)
  if (action.side === 'inline' && action.box) return inlineShape(action, bounds, text)
  return textShape('note', action, bounds, text, action.color ?? 'red')
}

export function askShapes(action: Action, bounds: PageRect): Shape[] {
  const lines = [mathToPlain(action.text ?? 'Did you mean...?')]
  for (const option of action.options ?? []) lines.push(`• ${mathToPlain(option)}`)
  return textShape('ask', action, bounds, lines.join('\n'), 'blue')
}

/** Shapes for one action. figure and speak draw nothing here (figures are async, speak is audio). */
export function shapesForAction(action: Action, bounds: PageRect): Shape[] {
  switch (action.type) {
    case 'circle':
      return circleShapes(action, bounds)
    case 'underline':
      return underlineShapes(action, bounds)
    case 'note':
      return noteShapes(action, bounds)
    case 'ask':
      return askShapes(action, bounds)
    default:
      return []
  }
}
