import { createShapeId, toRichText, type TLShapePartial } from 'tldraw'
import type { ReadLine } from '../contract'
import { aiMeta } from './actions'
import { BASE_FONT, boxToPage, feedbackSizes, type PageRect } from './geometry'
import { mathToPlain } from './text'

export function isPrinted(line: ReadLine): boolean {
  return line.source === 'printed'
}

/** Small gray text under each handwritten line showing what the tutor read. */
export function readingShapes(lines: ReadLine[], bounds: PageRect): TLShapePartial[] {
  return lines
    .filter((l) => !isPrinted(l))
    .map((l) => {
      const r = boxToPage(l.box, bounds)
      return {
        id: createShapeId(),
        type: 'text',
        x: r.x,
        y: r.y + r.h + 2,
        meta: aiMeta('reading', null),
        opacity: 0.8,
        props: {
          richText: toRichText(mathToPlain(l.latex) + (l.confidence === 'low' ? '  (?)' : '')),
          font: 'sans',
          size: 's',
          color: 'grey',
          scale: feedbackSizes(r.h).readingFont / BASE_FONT,
        },
      }
    })
}
