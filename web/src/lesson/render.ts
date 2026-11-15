import { createShapeId, type Editor } from 'tldraw'
import type { Action, Lesson, LessonMark, LessonStep, LessonVisual } from '../contract'
import { aiMeta } from '../render/actions'
import { dock } from './dock'
import { focusLesson, studentInk } from './focus'
import { markerSize, markerSpot } from './layout'

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
  if (v.x_log === true) out.x_log = true
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
  const out: Lesson = { title: typeof lesson.title === 'string' ? lesson.title : '', steps }
  // "Your turn": kept only when it has a problem to write on the page.
  const p = lesson.practice as Partial<NonNullable<Lesson['practice']>> | undefined
  if (p && typeof p === 'object' && typeof p.problem === 'string' && p.problem.trim()) {
    out.practice = {
      prompt: typeof p.prompt === 'string' && p.prompt.trim() ? p.prompt : 'Your turn.',
      problem: p.problem,
      plain: typeof p.plain === 'string' && p.plain.trim() ? p.plain : p.problem,
      ...(typeof p.ask === 'string' && p.ask.trim() ? { ask: p.ask } : {}),
    }
  }
  return out
}

/**
 * Play the lesson of a `lesson` action. The lesson opens in the docked panel (never on top of the
 * work) and starts playing; a small marker is left on the page in the corner of `rect` (page
 * space, the free spot found next to the line) nearest the writing. The marker stores the Lesson, so it opens again from a
 * saved page, and the line it is about (`about`, page space), so the practice problem that follows
 * the lesson can be written under that work. The camera moves, if it has to, so the line stays in view beside the panel.
 * Never throws.
 */
export async function renderLesson(
  editor: Editor,
  action: Action,
  rect: { x: number; y: number; w: number; h: number },
  about?: { x: number; y: number; w: number; h: number } | null,
): Promise<void> {
  try {
    const lesson = action.type === 'lesson' ? cleanLesson(action.lesson) : null
    if (!lesson) {
      console.warn('lesson skipped: nothing to play', action)
      return
    }
    const spot = markerSpot(rect, studentInk(editor), markerSize(editor.getZoomLevel()))
    const id = createShapeId()
    const key = JSON.stringify(lesson)
    // the same lesson asked for again: one marker is enough
    const twins = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === SHAPE_TYPE && JSON.stringify((s.props as { lesson?: unknown }).lesson) === key)
      .map((s) => s.id)
    editor.run(
      () => {
        if (twins.length) editor.deleteShapes(twins)
        editor.createShapes([
          { id, type: SHAPE_TYPE, x: spot.x, y: spot.y, meta: aiMeta('lesson', action.line_id, about), props: { w: spot.w, h: spot.h, lesson } },
        ])
      },
      { history: 'ignore', ignoreShapeLock: true },
    )
    dock.open(lesson)
    focusLesson(editor, spot)
  } catch (err) {
    console.warn('lesson skipped', action.lesson, err)
  }
}
