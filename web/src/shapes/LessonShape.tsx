import { lazy, Suspense } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLShape } from 'tldraw'
import type { Lesson } from '../contract'
import { CARD_H, CARD_W } from '../lesson/size'

export const LESSON_TYPE = 'lesson'

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    lesson: { w: number; h: number; lesson: Lesson }
  }
}

export type LessonShape = TLShape<typeof LESSON_TYPE>

// The player (canvas drawing, KaTeX and its fonts, narration) is only loaded when a lesson is on the page.
const LessonCard = lazy(() => import('../lesson/LessonCard'))

const range = T.arrayOf(T.number)
const color = T.literalEnum('red', 'green', 'blue', 'black')

/** Only the Lesson is stored, so a saved page plays it again from the same data. */
const lessonProp = T.object({
  title: T.string,
  steps: T.arrayOf(
    T.object({
      say: T.string,
      write: T.string.optional(),
      caption: T.string.optional(),
      visual: T.object({
        kind: T.literalEnum('plot2d', 'surface3d'),
        expressions: T.arrayOf(T.string),
        x_range: range,
        y_range: range.optional(),
        marks: T.arrayOf(
          T.object({
            type: T.literalEnum('point', 'tangent', 'secant', 'area', 'vline', 'hline', 'label'),
            expr: T.number.optional(),
            x: T.number.optional(),
            x2: T.number.optional(),
            y: T.number.optional(),
            to_x: T.number.optional(),
            to_x2: T.number.optional(),
            text: T.string.optional(),
            color: color.optional(),
          }),
        ).optional(),
      }).optional(),
    }),
  ),
}) as unknown as T.Validator<Lesson>

function Placeholder({ title }: { title: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        border: '1px solid #dfe4ee',
        borderRadius: 20,
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
        font: '600 20px system-ui, sans-serif',
        color: '#69738a',
      }}
    >
      {title}
    </div>
  )
}

export class LessonShapeUtil extends BaseBoxShapeUtil<LessonShape> {
  static override type = LESSON_TYPE
  static override props: RecordProps<LessonShape> = { w: T.number, h: T.number, lesson: lessonProp }

  override getDefaultProps(): LessonShape['props'] {
    return { w: CARD_W, h: CARD_H, lesson: { title: '', steps: [] } }
  }

  override canEdit() {
    return false
  }

  override isAspectRatioLocked() {
    return true
  }

  override component(shape: LessonShape) {
    const { w, h, lesson } = shape.props
    return (
      <HTMLContainer>
        <Suspense fallback={<Placeholder title={lesson.title} />}>
          <LessonCard shapeId={shape.id} lesson={lesson} w={w} h={h} />
        </Suspense>
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: LessonShape) {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, (20 * shape.props.w) / CARD_W)
    return path
  }
}
