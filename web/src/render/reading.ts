import { createShapeId, toRichText, type TLShapePartial } from 'tldraw'
import type { ReadLine } from '../contract'
import { aiMeta } from './actions'
import { BASE_FONT, boxToPage, DEFAULT_CONTEXT, feedbackSizes, textHeight, type PageRect, type RenderContext } from './geometry'
import { mathToPlain } from './text'

export function isPrinted(line: ReadLine): boolean {
  return line.source === 'printed'
}

/** Small gray text under each handwritten line showing what the tutor read, sized to the writing and readable at the current zoom. */
export function readingShapes(lines: ReadLine[], bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): TLShapePartial[] {
  return lines
    .filter((l) => !isPrinted(l))
    .map((l) => {
      const r = boxToPage(l.box, bounds)
      return {
        id: createShapeId(),
        type: 'text',
        x: r.x,
        y: r.y + r.h + 2 / (ctx.zoom > 0 ? ctx.zoom : 1),
        meta: aiMeta('reading', null),
        opacity: 0.8,
        props: {
          richText: toRichText(mathToPlain(l.latex) + (l.confidence === 'low' ? '  (?)' : '')),
          font: 'sans',
          size: 's',
          color: 'grey',
          scale: feedbackSizes(textHeight(r, ctx.ink), ctx).readingFont / BASE_FONT,
        },
      }
    })
}
