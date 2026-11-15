import { toRichText, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import type { Lesson, Practice } from '../contract'
import { dock } from '../lesson/dock'
import { cameraFor, canvasInsets } from '../lesson/layout'
import { clusterAround, lineHeight, rectOf, union, windowLimits } from '../page'
import { anchorOf, isAiShape } from '../render/actions'
import { renderContext } from '../render/apply'
import type { PageRect } from '../render/geometry'
import { fontMeasure } from '../render/solution'
import { isPracticeShape, practiceRole } from './kind'
import { practiceLayout, practiceShapes } from './layout'

export type PracticeStatus = 'open' | 'solved'

/** What the page can tell about where a lesson's problem is. */
export interface PracticeHost {
  /** page rect of the working on the problem that line `lineId` belongs to, if it has been read */
  workOf?: (lineId: string) => PageRect | null
}

let editor: Editor | null = null
let host: PracticeHost = {}
const statuses = new Map<string, PracticeStatus>()
const listeners = new Set<() => void>()

/** Where each practice stands, by `practiceKey`: undefined = not on the page. For the lesson panel and pill. */
export const practiceStatus = {
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  get: (key: string): PracticeStatus | undefined => statuses.get(key),
}

export function practiceKey(practice: Practice): string {
  return JSON.stringify(practice)
}

/** A practice with an unsolved copy on the page is open; one with only solved copies is solved. */
export function statusesOf(shapes: { meta: Record<string, unknown> }[]): Map<string, PracticeStatus> {
  const out = new Map<string, PracticeStatus>()
  for (const s of shapes) {
    if (practiceRole(s) !== 'problem' || typeof s.meta.practice !== 'string') continue
    const key = s.meta.practice
    if (s.meta.solved !== true) out.set(key, 'open')
    else if (!out.has(key)) out.set(key, 'solved')
  }
  return out
}

function refresh() {
  const next = editor ? statusesOf(editor.getCurrentPageShapes()) : new Map<string, PracticeStatus>()
  const same = next.size === statuses.size && [...next].every(([k, v]) => statuses.get(k) === v)
  if (same) return
  statuses.clear()
  for (const [k, v] of next) statuses.set(k, v)
  for (const fn of listeners) fn()
}

/** The page practice problems are written on. Returns the undo. */
export function bindPractice(e: Editor, h: PracticeHost = {}): () => void {
  editor = e
  host = h
  refresh()
  return () => {
    if (editor !== e) return
    editor = null
    host = {}
  }
}

const run = (e: Editor, fn: () => void) => e.run(fn, { history: 'ignore', ignoreShapeLock: true })

function boundsOf(e: Editor, shapes: TLShape[]): PageRect | null {
  let out: PageRect | null = null
  for (const s of shapes) {
    const b = e.getShapePageBounds(s)
    if (b) out = union(out, rectOf(b))
  }
  return out
}

const touches = (a: PageRect, b: PageRect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

/**
 * The student's working that the practice goes under: the problem the lesson was about (its
 * marker remembers the line), stretched over its strokes; without a marker, the writing on screen.
 */
export function workRect(e: Editor, lesson: Lesson | undefined, ink: PageRect[]): PageRect {
  const view = rectOf(e.getViewportPageBounds())
  const key = lesson && JSON.stringify(lesson)
  const marker = key ? e.getCurrentPageShapes().find((s) => s.type === 'lesson' && JSON.stringify((s.props as { lesson?: unknown }).lesson) === key) : undefined
  const over = (seed: PageRect) => ink.filter((r) => touches(r, seed)).reduce<PageRect>((a, r) => union(a, r)!, seed)
  if (marker) {
    const read = typeof marker.meta.line_id === 'string' ? host.workOf?.(marker.meta.line_id) : null
    // (a reading whose boxes no longer have writing in them says nothing about where the work is)
    if (read && ink.some((r) => touches(r, read))) return over(read)
    const b = e.getShapePageBounds(marker)
    const seed = anchorOf(marker) ?? (b ? rectOf(b) : null)
    if (seed) {
      const near = ink.filter((r) => touches(r, seed))
      return clusterAround(over(seed), ink, windowLimits(lineHeight(near.length ? near : ink), view))
    }
  }
  const seen = ink.filter((r) => touches(r, view))
  const all = (seen.length ? seen : ink).reduce<PageRect | null>(union, null)
  const z = e.getZoomLevel()
  return all ?? { x: view.x + 40 / z, y: view.y + 60 / z, w: 0, h: 0 }
}

/**
 * Slide the page (never zooming) so `rect` is clear of the notebook's controls. The lesson panel is
 * about to fold away, so the whole screen counts: a problem that will be in view then is not moved
 * (and the work above it stays where it is).
 */
function focus(e: Editor, rect: PageRect) {
  try {
    const canvas = { w: window.innerWidth, h: window.innerHeight }
    // the controls of the full-screen notebook: Help on the right, the toolbar below, the lesson pill on top
    const pad = { ...canvasInsets('right'), top: 100 }
    const cam = e.getCamera()
    // what doesn't fit at this zoom is cut off at the bottom: the problem itself is at the top
    const fit = { ...rect, w: Math.min(rect.w, (canvas.w - pad.left - pad.right) / cam.z), h: Math.min(rect.h, (canvas.h - pad.top - pad.bottom) / cam.z) }
    const next = cameraFor(fit, cam, canvas, pad)
    if (Math.abs(next.x - cam.x) < 0.5 && Math.abs(next.y - cam.y) < 0.5) return
    e.setCamera({ ...next, z: cam.z }, { animation: { duration: 400 } })
  } catch (err) {
    console.warn('practice: could not move the page', err)
  }
}

/** How long after the page starts moving the lesson panel folds away. */
export const COLLAPSE_AFTER_MS = 450

function settle(e: Editor, rect: PageRect) {
  focus(e, rect)
  setTimeout(() => dock.collapse(), COLLAPSE_AFTER_MS)
}

export type StartResult = 'written' | 'shown' | 'none'

/**
 * "Your turn": write `practice` on the page under the student's work, bring it into view and fold
 * the lesson panel away so there is room to write. If it is already on the page unsolved, that one
 * is shown instead. A solved one is only written again when asked for (`explicit`: a tap, not the
 * lesson ending). Never throws.
 */
export function startPractice(practice: Practice | undefined, opts: { lesson?: Lesson; explicit?: boolean } = {}): StartResult {
  const e = editor
  if (!e || !practice) return 'none'
  try {
    const key = practiceKey(practice)
    const mine = e.getCurrentPageShapes().filter((s) => isPracticeShape(s) && s.meta.practice === key)
    const open = mine.find((s) => practiceRole(s) === 'problem' && s.meta.solved !== true)
    if (open) {
      const rect = boundsOf(e, mine.filter((s) => s.meta.practice_id === open.meta.practice_id))
      if (rect) settle(e, { ...rect, h: rect.h * 2 })
      return 'shown'
    }
    if (mine.length && !opts.explicit) return 'none'

    const ctx = renderContext(e)
    // everything the tutor has on the page is kept clear of; the panel is about to go, so the screen's edges don't matter
    ctx.taken = e.getCurrentPageShapes().flatMap((s) => {
      const b = isAiShape(s) && s.meta.kind !== 'reading' && s.meta.kind !== 'leader' ? e.getShapePageBounds(s) : null
      return b ? [rectOf(b)] : []
    })
    const work = workRect(e, opts.lesson, ctx.ink ?? [])
    const layout = practiceLayout(practice, work, ctx, fontMeasure())
    const pen = e.getCurrentPageShapesSorted().findLast((s) => s.type === 'draw' && !isAiShape(s))
    // calm, and neither red (wrong), green (right) nor the student's own ink
    const color = (pen?.props as { color?: string } | undefined)?.color === 'violet' ? 'light-blue' : 'violet'
    const id = 'pr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    run(e, () => e.createShapes(practiceShapes(practice, layout, id, color)))
    refresh()
    settle(e, layout.rect)
    return 'written'
  } catch (err) {
    console.warn('practice not written', err)
    return 'none'
  }
}

export const SOLVED_TEXT = '✓ Solved'

/**
 * The practice is solved: its label becomes a green "Solved" with a tick, written on calmly, and
 * every shape of it remembers (so it stays solved after a reload).
 */
export function markSolved(e: Editor, practiceId: string) {
  const shapes = e.getCurrentPageShapes().filter((s) => isPracticeShape(s) && s.meta.practice_id === practiceId)
  const label = shapes.find((s) => practiceRole(s) === 'label')
  run(e, () => e.updateShapes(shapes.map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, solved: true } }))))
  refresh()
  if (!label) return
  const show = (text: string, opacity: number) =>
    run(e, () => {
      if (e.getShape(label.id)) e.updateShape({ id: label.id as TLShapeId, type: 'text', opacity, props: { richText: toRichText(text), color: 'green' } })
    })
  if (typeof requestAnimationFrame !== 'function') return show(SOLVED_TEXT, 1)
  // the tick first, then the word, fading up: about half a second in all
  const chars = [...SOLVED_TEXT]
  let t0: number | null = null
  let shown = 0
  const frame = (now: number) => {
    t0 ??= now
    const p = Math.min(1, (now - t0) / 550)
    const n = p < 0.3 ? 1 : Math.max(1, Math.ceil(((p - 0.3) / 0.7) * chars.length))
    if (n !== shown || p === 1) show(chars.slice(0, n).join(''), 0.35 + 0.65 * p)
    shown = n
    if (p < 1) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
