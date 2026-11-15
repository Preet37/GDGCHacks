import type { Editor, TLShape, TLShapeId } from 'tldraw'
import type { Action, CheckResponse } from '../contract'
import { handForAction, handwritingEnabled, studentPen } from '../handwriting'
import { anchorOf, cardRect, isAiShape, isInlineNote, lineRect, shapesForAction, sizesFor } from './actions'
import { shapeUse } from '../practice/kind'
import { drawFigures, notice } from './figure'
import { TEXT_LINE_HEIGHT, boxToPage, overlapRatio, type PageRect, type RenderContext } from './geometry'
import { sheetInk } from './sheetInk'
import { domMathMeasure } from './mathline'
import { fontMeasure, headingShape, panTo, revealSolution, solutionLayout, solutionShapes } from './solution'
import { mathToPlain, mathToSpeech } from './text'

type LessonModule = { renderLesson: (editor: Editor, action: Action, rect: PageRect, about?: PageRect | null) => Promise<void> }
// The lesson player lives in ../lesson/render (loaded only when a lesson arrives). The glob
// resolves to nothing if that module isn't there, so a lesson action is then simply not drawn.
const lessonModules = import.meta.glob<LessonModule>('../lesson/render.ts')

/** Feedback written on or beside a line: these are replaced when new feedback arrives for the same writing. */
const MARK_KINDS = new Set(['note', 'ask', 'circle', 'underline', 'leader', 'solution', 'hand'])

/**
 * Should this action be tried in the student's own handwriting? Only the two things the tutor
 * writes as if it were the student (an answer finishing their line, the steps of a full solve),
 * and only with "Write in my handwriting" on. Whether the hand is known well enough is found out
 * by trying: handForAction draws nothing and returns null if not, and the action is drawn as text.
 */
export function wantsHand(action: Action, enabled: boolean): boolean {
  if (!enabled) return false
  if (action.type === 'solution') return !!action.steps?.length && !!action.box
  return action.type === 'note' && !!action.text && isInlineNote(action)
}

/**
 * Draw one action in the student's hand if it should be and can be; false = draw it the usual way.
 * `write` is handForAction (a parameter so the decision can be tested without an editor); anything
 * it throws counts as "can't".
 */
export function drawnByHand(action: Action, enabled: boolean, write: (action: Action) => unknown): boolean {
  if (!wantsHand(action, enabled)) return false
  try {
    return !!write(action)
  } catch (err) {
    console.warn('handwriting skipped', err)
    return false
  }
}
/** Two boxes are the same writing if they share this much of the smaller one. */
export const SAME_WRITING = 0.5

/**
 * Line ids whose old feedback must go: anything re-addressed by an action, plus clear_line_ids.
 * A lesson doesn't count: it is played beside the work and never replaces the marks or the
 * finished answer already on that line (it only replaces an older lesson, see staleShapeIds).
 */
export function lineIdsToReplace(response: Pick<CheckResponse, 'actions' | 'clear_line_ids'>): Set<string> {
  const ids = new Set(response.clear_line_ids)
  for (const action of response.actions) if (action.line_id && action.type !== 'lesson') ids.add(action.line_id)
  return ids
}

let speaker: ((text: string) => void) | null = null

/** Hand `speak` actions to `fn` in place of the browser's voice (null = the browser's voice again). */
export function setSpeaker(fn: ((text: string) => void) | null) {
  speaker = fn
}

export function speak(text: string) {
  if (speaker) return speaker(text)
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(mathToSpeech(text)))
}

function rectOf(b: { x: number; y: number; w: number; h: number }): PageRect {
  return { x: b.x, y: b.y, w: b.w, h: b.h }
}

/** What floats over the canvas: the tutor's own buttons, and the editor's panels and toolbars. */
const CHROME = '.tutor-controls > *, .tutor-subtitle, .tlui-style-panel__wrapper, .tlui-menu-zone, .tlui-main-toolbar__inner, .tlui-navigation-panel'

/** How the page is being looked at right now: zoom, viewport, and the student's strokes. */
export function renderContext(editor: Editor): RenderContext {
  const ink: PageRect[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (isAiShape(s) || s.meta?.worksheet === true) continue
    const b = editor.getShapePageBounds(s)
    if (b) ink.push(rectOf(b))
  }
  // the buttons and panels floating over the canvas: feedback under them could not be read
  const chrome: PageRect[] = []
  if (typeof document !== 'undefined') {
    for (const el of document.querySelectorAll(CHROME)) {
      const b = el.getBoundingClientRect()
      if (b.width <= 0 || b.height <= 0) continue
      const a = editor.screenToPage({ x: b.left, y: b.top })
      const z = editor.screenToPage({ x: b.right, y: b.bottom })
      chrome.push({ x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y })
    }
  }
  // printed worksheet text is kept clear of too: half a note gap around every printed cell
  const { sheets, printedArea } = sheetInk(editor)
  const margin = 5 / editor.getZoomLevel()
  return {
    zoom: editor.getZoomLevel(),
    view: rectOf(editor.getViewportPageBounds()),
    ink,
    sheets,
    chrome,
    printedArea: (r) => printedArea({ x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 }),
  }
}

/**
 * What each read line's problem says, by line_id, as readable text: the printed line of its
 * problem if that was read, else the problem's first line.
 */
export function problemTexts(lines: CheckResponse['lines']): Map<string, string> {
  const out = new Map<string, string>()
  for (const l of lines) {
    const same = lines.filter((o) => o.problem_id === l.problem_id)
    const first = same.find((o) => o.source === 'printed') ?? same.find((o) => o.relation === 'start') ?? same[0] ?? l
    const text = mathToPlain(first.latex || first.plain || '')
    if (text) out.set(l.line_id, text)
  }
  return out
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
 * A practice problem is never replaced: it is what the student is working on, not feedback.
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
      if (!isAiShape(s) || !shapeUse(s).replaceable) return false
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
function drawLesson(editor: Editor, action: Action, rect: PageRect, about: PageRect | null) {
  const load = lessonModules['../lesson/render.ts']
  if (!load) return
  load()
    .then((m) => m.renderLesson(editor, action, rect, about))
    .catch((err) => {
      console.warn('lesson skipped', err)
      notice("Couldn't load the lesson player. Reload the page and tap Teach me again.")
    })
}

/** What drawing a reply did, for the "what happened" line (see sync/status.ts). */
export interface Drawn {
  /** actions that put something on the page (or were spoken) */
  drawn: number
  /** old tutor shapes removed */
  removed: number
}

/**
 * Draw a CheckResponse onto the page. `bounds` = page-space area of the image that was sent.
 * `printed` = page rects of printed worksheet lines read on earlier checks (the reply's own are
 * added): nothing is written over them. `labels` = page rects of the gray "what the AI read" labels
 * that will be showing under the lines: notes and graphs keep clear of those too.
 */
export function applyResponse(editor: Editor, response: CheckResponse, bounds: PageRect, printed: PageRect[] = [], labels: PageRect[] = []): Drawn {
  const ctx = renderContext(editor)
  ctx.lines = new Map(response.lines.map((l) => [l.line_id, boxToPage(l.box, bounds)]))
  ctx.printed = [...printed, ...response.lines.filter((l) => l.source === 'printed').map((l) => boxToPage(l.box, bounds))]

  ctx.problems = problemTexts(response.lines)
  ctx.headings = new Map()

  const existing = editor.getCurrentPageShapes().filter(isAiShape)
  const rects = new Map<string, PageRect | null>()
  for (const s of existing) {
    const b = editor.getShapePageBounds(s)
    rects.set(s.id, b ? rectOf(b) : null)
  }
  const stale = new Set(staleShapeIds(existing.map((s: TLShape) => ({ id: s.id, meta: s.meta, rect: rects.get(s.id) })), response, bounds, ctx))

  // what stays on the page is in the way of what is drawn now (the gray reading labels and leader lines are not)
  ctx.taken = existing.flatMap((s) => {
    const r = rects.get(s.id)
    return r && !stale.has(s.id) && s.meta.kind !== 'reading' && s.meta.kind !== 'leader' ? [r] : []
  })

  ctx.taken.push(...labels)

  const takenBefore = ctx.taken.length // everything placed from here on is appended
  // the old feedback goes first: handwriting is drawn straight onto the page, where the old answer was
  if (stale.size) editor.run(() => editor.deleteShapes([...stale] as TLShapeId[]), { history: 'ignore', ignoreShapeLock: true })
  let drawn = 0
  const hand = handwritingEnabled()
  const solutions: PageRect[] = [] // revealed step by step, the camera following: not part of the one-off reveal below
  const batches = response.actions.map((a) => {
    if (drawnByHand(a, hand, (action) => handForAction(editor, action, bounds, ctx))) {
      drawn++
      if (a.type === 'solution') {
        const rect = ctx.taken!.at(-1)!
        solutions.push(rect)
        panTo(editor, rect)
      }
      return []
    }
    if (a.type !== 'solution') return shapesForAction(a, bounds, ctx)
    try {
      const layout = solutionLayout(a, bounds, ctx, fontMeasure(), domMathMeasure())
      if (!layout) return []
      solutions.push(layout.rect)
      // black = the student's ink colour: the pen their line was written with
      const color = !a.color || a.color === 'black' ? studentPen(editor, layout.anchor).color : a.color
      void revealSolution(editor, solutionShapes(a, layout, color), layout)
      drawn++
    } catch (err) {
      console.warn('solution not drawn', err)
    }
    return []
  })
  // a solution with no room on the worksheet was put beside the page: its "Solution to: ..." line
  for (const h of ctx.headings.values()) {
    const rect = { x: h.x, y: h.y, w: h.w, h: h.font * TEXT_LINE_HEIGHT }
    ctx.taken.push(rect)
    solutions.push(rect)
    try {
      editor.run(() => editor.createShapes([headingShape(h)]), { history: 'ignore', ignoreShapeLock: true })
    } catch (err) {
      console.warn('solution heading not drawn', err)
    }
  }
  editor.run(
    () => {
      for (const shapes of batches) {
        if (!shapes.length) continue
        // one action at a time: a shape the editor refuses must not take the rest of the reply with it
        try {
          editor.createShapes(shapes)
          drawn++
        } catch (err) {
          console.warn('feedback not drawn', err)
        }
      }
    },
    { history: 'ignore', ignoreShapeLock: true },
  )

  drawn += drawFigures(editor, response.actions, bounds, ctx)
  // notes and graphs; a lesson opens in its own panel and looks after the camera itself
  const placed = ctx.taken.slice(takenBefore).filter((r) => !solutions.includes(r))

  for (const action of response.actions) {
    if (action.type !== 'lesson' || !action.lesson) continue
    const sz = sizesFor(action, bounds, ctx)
    drawLesson(editor, action, cardRect(action, bounds, ctx, sz.lessonW, sz.lessonH), lineRect(action, bounds, ctx))
    drawn++
  }

  for (const action of response.actions) {
    if (action.type !== 'speak' || !action.text) continue
    speak(action.text)
    drawn++
  }
  reveal(editor, placed, response, bounds, ctx)
  return { drawn, removed: stale.size }
}

/** Feedback this much off screen is brought into view. */
export const REVEAL_BEYOND = 0.3

/**
 * Feedback that had to go off screen to keep off the writing (a graph beside a full worksheet page)
 * would never be seen: `placed` = where things went. The rects among them that the student cannot
 * see, joined with the lines they are about; null if everything is in view, or if none of those
 * lines is on screen (the student is looking somewhere else: the camera is left alone).
 */
export function revealBounds(placed: PageRect[], about: PageRect[], view: PageRect): PageRect | null {
  const seen = (r: PageRect) => {
    const w = Math.min(r.x + r.w, view.x + view.w) - Math.max(r.x, view.x)
    const h = Math.min(r.y + r.h, view.y + view.h) - Math.max(r.y, view.y)
    return w > 0 && h > 0 ? (w * h) / (r.w * r.h) : 0
  }
  const hidden = placed.filter((r) => r.w > 0 && r.h > 0 && seen(r) < 1 - REVEAL_BEYOND)
  const anchors = about.filter((r) => r.w > 0 && r.h > 0 && seen(r) > 0)
  if (!hidden.length || !anchors.length) return null
  const all = [...placed.filter((r) => r.w > 0 && r.h > 0), ...anchors] // what is already in view stays in view
  const x = Math.min(...all.map((r) => r.x))
  const y = Math.min(...all.map((r) => r.y))
  return { x, y, w: Math.max(...all.map((r) => r.x + r.w)) - x, h: Math.max(...all.map((r) => r.y + r.h)) - y }
}

/** Move the camera (never zooming in) so off-screen feedback and the line it is about are both in view. */
function reveal(editor: Editor, placed: PageRect[], response: CheckResponse, bounds: PageRect, ctx: RenderContext) {
  if (!ctx.view || !placed.length) return
  const about = response.actions.flatMap((a) => {
    const r = lineRect(a, bounds, ctx)
    return r ? [r] : []
  })
  const target = revealBounds(placed, about, ctx.view)
  if (!target) return
  try {
    const zoom = editor.getZoomLevel()
    const inset = 24 / zoom
    const view = ctx.view
    if (target.w + inset * 2 > view.w || target.h + inset * 2 > view.h) {
      // too far apart for this zoom: step back just enough to see both
      editor.zoomToBounds(target, { targetZoom: zoom, inset: 24, animation: { duration: 350 } })
      return
    }
    // otherwise slide the page the least it takes, so the student's place on it barely moves
    const slide = (lo: number, size: number, tLo: number, tSize: number) => Math.min(tLo - inset, Math.max(lo, tLo + tSize + inset - size))
    const x = slide(view.x, view.w, target.x, target.w)
    const y = slide(view.y, view.h, target.y, target.h)
    editor.setCamera({ x: -x, y: -y, z: zoom }, { animation: { duration: 350 } })
  } catch (err) {
    console.warn('could not bring feedback into view', err)
  }
}
