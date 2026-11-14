import { createShapeId, getIndices, toRichText, type TLDefaultColorStyle, type TLShapePartial } from 'tldraw'
import type { Action } from '../contract'
import { beside, boxToPage, expand, type PageRect } from './geometry'
import { mathToPlain } from './text'

/** Every shape the tutor draws carries this meta, so we can find and replace it later. */
export interface AiMeta {
  [key: string]: string | boolean | null
  ai: true
  line_id: string | null
  kind: string
}

const CIRCLE_PAD = 8
const NOTE_GAP = 16
const NOTE_WIDTH = 320

export function aiMeta(kind: string, line_id?: string | null): AiMeta {
  return { ai: true, line_id: line_id ?? null, kind }
}

export function isAiShape(shape: { meta: Record<string, unknown> }): boolean {
  return shape.meta?.ai === true
}

type Shape = TLShapePartial & { x: number; y: number }

export function circleShapes(action: Action, bounds: PageRect): Shape[] {
  if (!action.box) return []
  const r = expand(boxToPage(action.box, bounds), CIRCLE_PAD)
  return [
    {
      id: createShapeId(),
      type: 'geo',
      x: r.x,
      y: r.y,
      meta: aiMeta('circle', action.line_id),
      props: { geo: 'ellipse', w: r.w, h: r.h, color: action.color ?? 'red', fill: 'none', dash: 'draw', size: 's' },
    },
  ]
}

export function underlineShapes(action: Action, bounds: PageRect): Shape[] {
  if (!action.box) return []
  const r = boxToPage(action.box, bounds)
  const [a, b] = getIndices(2)
  return [
    {
      id: createShapeId(),
      type: 'line',
      x: r.x,
      y: r.y + r.h + 4,
      meta: aiMeta('underline', action.line_id),
      props: {
        color: action.color ?? 'red',
        dash: 'draw',
        size: 's',
        points: {
          [a]: { id: a, index: a, x: 0, y: 0 },
          [b]: { id: b, index: b, x: r.w, y: 0 },
        },
      },
    },
  ]
}

function textShape(kind: string, action: Action, bounds: PageRect, text: string, color: TLDefaultColorStyle): Shape[] {
  // Without a box, put it at the top-right corner of the exported area.
  const r: PageRect = action.box ? boxToPage(action.box, bounds) : { x: bounds.x + bounds.w, y: bounds.y, w: 0, h: 0 }
  const at = beside(r, action.side ?? 'right', NOTE_GAP)
  return [
    {
      id: createShapeId(),
      type: 'text',
      x: at.x,
      y: at.y,
      meta: aiMeta(kind, action.line_id),
      props: { richText: toRichText(text), font: 'draw', size: 's', color, textAlign: 'start', autoSize: false, w: NOTE_WIDTH },
    },
  ]
}

export function noteShapes(action: Action, bounds: PageRect): Shape[] {
  if (!action.text) return []
  return textShape('note', action, bounds, mathToPlain(action.text), action.color ?? 'red')
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
