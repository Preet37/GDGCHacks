import type { Editor, TLShape, TLShapeId } from 'tldraw'
import type { Action, CheckResponse } from '../contract'
import { anchorOf, cardRect, isAiShape, lineRect, shapesForAction, sizesFor } from './actions'
import { drawFigures } from './figure'
import { boxToPage, overlapRatio, type PageRect, type RenderContext } from './geometry'
import { mathToSpeech } from './text'

type LessonModule = { renderLesson: (editor: Editor, action: Action, rect: PageRect) => Promise<void> }
// The lesson player lives in ../lesson/render (loaded only when a lesson arrives). The glob
// resolves to nothing if that module isn't there, so a lesson action is then simply not drawn.
const lessonModules = import.meta.glob<LessonModule>('../lesson/render.ts')

/** Feedback written on or beside a line: these are replaced when new feedback arrives for the same writing. */
const MARK_KINDS = new Set(['note', 'ask', 'circle', 'underline'])
/** Two boxes are the same writing if they share this much of the smaller one. */
export const SAME_WRITING = 0.5

/** Line ids whose old feedback must go: anything re-addressed by an action, plus clear_line_ids. */
export function lineIdsToReplace(response: Pick<CheckResponse, 'actions' | 'clear_line_ids'>): Set<string> {
  const ids = new Set(response.clear_line_ids)
  for (const action of response.actions) if (action.line_id) ids.add(action.line_id)
  return ids
}

export function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(mathToSpeech(text)))
}

function rectOf(b: { x: number; y: number; w: number; h: number }): PageRect {
  return { x: b.x, y: b.y, w: b.w, h: b.h }
}

/** How the page is being looked at right now: zoom, viewport, and the student's strokes. */
export function renderContext(editor: Editor): RenderContext {
  const ink: PageRect[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (isAiShape(s) || s.meta?.worksheet === true) continue
    const b = editor.getShapePageBounds(s)
    if (b) ink.push(rectOf(b))
  }
  return { zoom: editor.getZoomLevel(), view: rectOf(editor.getViewportPageBounds()), ink }
}

export interface OldShape {
  id: string
  meta: Record<string, unknown>
  /** page bounds, used for marks drawn before anchors were recorded */
  rect?: PageRect | null
}

/**
 * Which existing tutor shapes a reply replaces.
 * - By id: everything belonging to a line the reply re-addresses or clears. A lesson card only
 *   goes when its line is cleared or gets a new lesson, not because a hint arrived for the line.
 * - By place: a line can come back under another id (read again from a different window of the
 *   page, or renamed by the model), so marks (notes, asks, circles, underlines, never figures or
 *   lessons) anchored on the same writing as a new mark go too, whatever their id.
 */
export function staleShapeIds(
  shapes: OldShape[],
  response: Pick<CheckResponse, 'actions' | 'clear_line_ids'>,
  bounds: PageRect,
  ctx: RenderContext = { zoom: 1 },
): string[] {
  const replace = lineIdsToReplace(response)
  const cleared = new Set(response.clear_line_ids)
  const newLessons = new Set(response.actions.flatMap((a) => (a.type === 'lesson' && a.line_id ? [a.line_id] : [])))
  const marked: PageRect[] = []
  for (const a of response.actions) {
    if (!MARK_KINDS.has(a.type)) continue
    const r = lineRect(a, bounds, ctx)
    if (r && r.w > 0 && r.h > 0) marked.push(r)
  }
  return shapes
    .filter((s) => {
      if (!isAiShape(s)) return false
      const kind = s.meta.kind
      const id = s.meta.line_id
      if (typeof id === 'string') {
        if (kind === 'lesson' ? cleared.has(id) || newLessons.has(id) : replace.has(id)) return true
      }
      if (typeof kind !== 'string' || !MARK_KINDS.has(kind)) return false
      const anchor = anchorOf(s) ?? (kind === 'circle' || kind === 'underline' ? s.rect : null)
      return !!anchor && marked.some((r) => overlapRatio(anchor, r) >= SAME_WRITING)
    })
    .map((s) => s.id)
}

/** Hand a lesson action to ../lesson/render, if that module is present. Never throws. */
function drawLesson(editor: Editor, action: Action, rect: PageRect) {
  const load = lessonModules['../lesson/render.ts']
  if (!load) return
  load()
    .then((m) => m.renderLesson(editor, action, rect))
    .catch((err) => console.warn('lesson skipped', err))
}

/** Draw a CheckResponse onto the page. `bounds` = page-space area of the image that was sent. */
export function applyResponse(editor: Editor, response: CheckResponse, bounds: PageRect) {
  const ctx = renderContext(editor)
  ctx.lines = new Map(response.lines.map((l) => [l.line_id, boxToPage(l.box, bounds)]))

  const existing = editor.getCurrentPageShapes().filter(isAiShape)
  const rects = new Map<string, PageRect | null>()
  for (const s of existing) {
    const b = editor.getShapePageBounds(s)
    rects.set(s.id, b ? rectOf(b) : null)
  }
  const stale = new Set(staleShapeIds(existing.map((s: TLShape) => ({ id: s.id, meta: s.meta, rect: rects.get(s.id) })), response, bounds, ctx))

  // what stays on the page is in the way of what is drawn now (the gray reading labels are not)
  ctx.taken = existing.flatMap((s) => {
    const r = rects.get(s.id)
    return r && !stale.has(s.id) && s.meta.kind !== 'reading' ? [r] : []
  })

  const shapes = response.actions.flatMap((a) => shapesForAction(a, bounds, ctx))

  editor.run(
    () => {
      if (stale.size) editor.deleteShapes([...stale] as TLShapeId[])
      if (shapes.length) editor.createShapes(shapes)
    },
    { history: 'ignore', ignoreShapeLock: true },
  )

  drawFigures(editor, response.actions, bounds, ctx)

  for (const action of response.actions) {
    if (action.type !== 'lesson' || !action.lesson) continue
    const sz = sizesFor(action, bounds, ctx)
    drawLesson(editor, action, cardRect(action, bounds, ctx, sz.lessonW, sz.lessonH))
  }

  for (const action of response.actions) if (action.type === 'speak' && action.text) speak(action.text)
}
