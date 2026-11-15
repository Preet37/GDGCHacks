import { useEffect, useRef, useSyncExternalStore } from 'react'
import { HTMLContainer, Rectangle2d, ShapeUtil, T, useEditor, type RecordProps, type TLShape } from 'tldraw'
import type { Lesson } from '../contract'
import { dock } from '../lesson/dock'
import { focusLesson } from '../lesson/focus'

export const LESSON_TYPE = 'lesson'

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    lesson: { w: number; h: number; lesson: Lesson }
  }
}

export type LessonShape = TLShape<typeof LESSON_TYPE>

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
        x_log: T.boolean.optional(),
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
  practice: T.object({ prompt: T.string, problem: T.string, plain: T.string, ask: T.string.optional() }).optional(),
}) as unknown as T.Validator<Lesson>

/** The marker is never bigger than this on the page, whatever was stored (older pages kept a whole card here). */
const MAX_SIDE = 64

function side(shape: LessonShape): number {
  const s = Math.min(shape.props.w, shape.props.h)
  return Number.isFinite(s) && s > 0 ? Math.min(MAX_SIDE, s) : 34
}

/**
 * The small round "play" badge a lesson leaves next to the line it is about. Tapping it opens the
 * lesson in the docked panel again.
 */
function Marker({ shape }: { shape: LessonShape }) {
  const editor = useEditor()
  const ref = useRef<HTMLButtonElement>(null)
  const { lesson } = shape.props
  const key = JSON.stringify(lesson)
  const open = useSyncExternalStore(dock.subscribe, () => dock.get()?.key === key)
  const s = side(shape)

  // Native listeners: they run before tldraw's (so a tap neither inks nor drags the marker), and
  // they act on touchend / click, which iOS counts as a user gesture, so the voice may start.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let touchAt = -1e9
    const act = () => {
      dock.open(lesson, { fromTap: true })
      void focusLesson(editor, lesson)
    }
    const on = (e: Event) => {
      editor.markEventAsHandled(e)
      e.stopPropagation()
      if (e.type === 'touchend') {
        e.preventDefault() // no synthetic click afterwards
        touchAt = performance.now()
        act()
      } else if (e.type === 'click' && performance.now() - touchAt > 700) act()
    }
    const types = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'click', 'dblclick', 'contextmenu']
    for (const t of types) el.addEventListener(t, on, { passive: false })
    return () => {
      for (const t of types) el.removeEventListener(t, on)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, shape.id, key])

  return (
    <button
      ref={ref}
      data-lesson-marker={open ? 'open' : 'closed'}
      aria-label={`Open the lesson: ${lesson.title || 'lesson'}`}
      title={lesson.title}
      style={{
        width: s,
        height: s,
        boxSizing: 'border-box',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `${Math.max(1.5, s * 0.06)}px solid #2563eb`,
        borderRadius: '50%',
        background: open ? '#2563eb' : '#fff',
        color: open ? '#fff' : '#2563eb',
        boxShadow: '0 1px 4px rgba(37, 99, 235, 0.25)',
        pointerEvents: 'all',
        touchAction: 'manipulation',
        cursor: 'pointer',
      }}
    >
      <svg viewBox="0 0 24 24" width={s * 0.56} height={s * 0.56} aria-hidden="true" style={{ marginLeft: s * 0.05 }}>
        <path d="M8 5.2v13.6a.9.9 0 0 0 1.37.77l11-6.8a.9.9 0 0 0 0-1.54l-11-6.8A.9.9 0 0 0 8 5.2z" fill="currentColor" />
      </svg>
    </button>
  )
}

export class LessonShapeUtil extends ShapeUtil<LessonShape> {
  static override type = LESSON_TYPE
  static override props: RecordProps<LessonShape> = { w: T.number, h: T.number, lesson: lessonProp }

  override getDefaultProps(): LessonShape['props'] {
    return { w: 34, h: 34, lesson: { title: '', steps: [] } }
  }

  override getGeometry(shape: LessonShape) {
    const s = side(shape)
    return new Rectangle2d({ width: s, height: s, isFilled: true })
  }

  override canEdit() {
    return false
  }

  override canResize() {
    return false
  }

  override component(shape: LessonShape) {
    return (
      <HTMLContainer>
        <Marker shape={shape} />
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: LessonShape) {
    const s = side(shape)
    const path = new Path2D()
    path.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2)
    return path
  }
}
