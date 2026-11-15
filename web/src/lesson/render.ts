import { createShapeId, type Editor } from 'tldraw'
import type { Action, Lesson, LessonMark, LessonStep, LessonVisual } from '../contract'
import { aiMeta } from '../render/actions'
import { requestAutoplay } from './autoplay'
import { CARD_H, CARD_W } from './size'

/** Must match LessonShapeUtil.type (web/src/shapes/LessonShape.tsx, registered in App.tsx). */
const SHAPE_TYPE = 'lesson'

const MARK_TYPES = ['point', 'tangent', 'secant', 'area', 'vline', 'hline', 'label']
const COLORS = ['red', 'green', 'blue', 'black']

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function pair(r: unknown): [number, number] | undefined {
  if (!Array.isArray(r) || r.length < 2) return undefined
  const a = Number(r[0])
  const b = Number(r[1])
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : undefined
}

function cleanMark(m: Partial<LessonMark> | null | undefined): LessonMark | null {
  if (!m || !MARK_TYPES.includes(m.type as string)) return null
  const out: LessonMark = { type: m.type as LessonMark['type'] }
  for (const k of ['expr', 'x', 'x2', 'y', 'to_x', 'to_x2'] as const) {
    const v = num(m[k])
    if (v !== undefined) out[k] = v
  }
  if (typeof m.text === 'string' && m.text) out.text = m.text
  if (COLORS.includes(m.color as string)) out.color = m.color
  return out
}

function cleanVisual(v: Partial<LessonVisual> | null | undefined): LessonVisual | undefined {
  if (!v || !Array.isArray(v.expressions)) return undefined
  const out: LessonVisual = {
    kind: v.kind === 'surface3d' ? 'surface3d' : 'plot2d',
    expressions: v.expressions.map(String),
    x_range: pair(v.x_range) ?? [-5, 5],
  }
  const y = pair(v.y_range)
  if (y) out.y_range = y
  if (Array.isArray(v.marks)) out.marks = v.marks.flatMap((m) => cleanMark(m) ?? [])
  return out
}

/**
 * The lesson as plain JSON for the shape's props: known fields only, no undefined, numbers that are
 * numbers. Whatever the model sent, the result is safe to store and to play. null = nothing to play.
 */
export function cleanLesson(lesson: Partial<Lesson> | null | undefined): Lesson | null {
  if (!lesson || !Array.isArray(lesson.steps)) return null
  const steps = lesson.steps.flatMap((s: Partial<LessonStep> | null): LessonStep[] => {
    if (!s || typeof s !== 'object') return []
    const step: LessonStep = { say: typeof s.say === 'string' ? s.say : '' }
    if (typeof s.write === 'string' && s.write.trim()) step.write = s.write
    if (typeof s.caption === 'string' && s.caption.trim()) step.caption = s.caption
    const visual = cleanVisual(s.visual)
    if (visual) step.visual = visual
    return step.say || step.write || step.caption || step.visual ? [step] : []
  })
  if (!steps.length) return null
  return { title: typeof lesson.title === 'string' ? lesson.title : '', steps }
}

export interface Size {
  w: number
  h: number
}

/**
 * How big the card is, in page units: about half the screen wide (so it can be watched from where
 * the student sits), never narrower than the space the handwriting suggested or than a width at
 * which the controls are comfortable to tap, and never so big that it doesn't fit on screen.
 */
export function lessonSize(suggested: Size, view: Size, zoom: number): Size {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1
  const fitW = Math.min(view.w * 0.92, ((view.h * 0.94) / CARD_H) * CARD_W)
  const want = Math.max(view.w * 0.5, 460 / z, Math.min(suggested.w, view.w * 0.62))
  const w = Math.max(240, Math.min(want, 760 / z, fitW))
  return { w, h: (w * CARD_H) / CARD_W }
}

/** Screen space taken by the page's own controls (Help column on the right, toolbar below), in px. */
const CLEAR = { left: 20, top: 56, right: 112, bottom: 96 }

/** If the card isn't fully on screen, slide the page just enough to bring it into view. */
function bringIntoView(editor: Editor, card: { x: number; y: number; w: number; h: number }) {
  const view = editor.getViewportPageBounds()
  const z = editor.getZoomLevel() || 1
  const shift = (lo: number, size: number, vLo: number, vSize: number, padLo: number, padHi: number) => {
    const min = vLo + padLo / z
    const max = vLo + vSize - padHi / z
    if (size > max - min) return lo - min // doesn't fit: show its start
    if (lo < min) return lo - min
    if (lo + size > max) return lo + size - max
    return 0
  }
  const dx = shift(card.x, card.w, view.x, view.w, CLEAR.left, CLEAR.right)
  const dy = shift(card.y, card.h, view.y, view.h, CLEAR.top, CLEAR.bottom)
  if (!dx && !dy) return
  const cam = editor.getCamera()
  editor.setCamera({ x: cam.x - dx, y: cam.y - dy, z: cam.z }, { animation: { duration: 450 } })
}

/**
 * Put a lesson card for a `lesson` action on the page at `rect` (page space; the top-left is kept,
 * the size is the card's own) and start playing it. Only the Lesson is stored in the shape, so it
 * plays again from a saved page. Never throws.
 */
export async function renderLesson(editor: Editor, action: Action, rect: { x: number; y: number; w: number; h: number }): Promise<void> {
  try {
    const lesson = action.type === 'lesson' ? cleanLesson(action.lesson) : null
    if (!lesson) {
      console.warn('lesson skipped: nothing to play', action)
      return
    }
    const view = editor.getViewportPageBounds()
    const size = lessonSize(rect, view, editor.getZoomLevel())
    const id = createShapeId()
    requestAutoplay(id)
    editor.run(
      () =>
        editor.createShapes([
          { id, type: SHAPE_TYPE, x: rect.x, y: rect.y, meta: aiMeta('lesson', action.line_id), props: { w: size.w, h: size.h, lesson } },
        ]),
      { history: 'ignore', ignoreShapeLock: true },
    )
    bringIntoView(editor, { x: rect.x, y: rect.y, ...size })
  } catch (err) {
    console.warn('lesson skipped', action.lesson, err)
  }
}
