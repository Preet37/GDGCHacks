import type { Editor } from 'tldraw'
import type { Lesson } from '../contract'
import { workRect } from '../practice/write'
import { dock } from './dock'
import { dockLayout, obstacleRects, panFor, type Rect } from './layout'

/** Page rects of the student's own strokes (not the tutor's marks, not an imported worksheet), in the order drawn. */
export function studentInk(editor: Editor): Rect[] {
  const ink: Rect[] = []
  for (const s of editor.getCurrentPageShapesSorted()) {
    if (s.meta?.ai === true || s.meta?.worksheet === true) continue
    const b = editor.getShapePageBounds(s)
    if (b) ink.push({ x: b.x, y: b.y, w: b.w, h: b.h })
  }
  return ink
}

/** Everything that lies over the notebook and stays put: tldraw's menus, toolbars and style panel, and our buttons. */
const FIXED_UI = [
  '.tlui-menu-zone',
  '.tlui-helper-buttons',
  '.tlui-style-panel',
  '.tlui-toolbar',
  '.tutor-controls > *',
  '.lesson-pills',
  '.tutor-toast',
].join(', ')

/** Where those controls are right now, measured on the page, relative to the notebook's top-left corner (px). */
export function fixedUiRects(editor: Editor): { screen: { w: number; h: number }; obstacles: Rect[] } {
  const box = editor.getContainer().getBoundingClientRect()
  const screen = { w: box.width, h: box.height }
  const root = editor.getContainer().closest('.app-canvas') ?? editor.getContainer()
  const rects: Rect[] = []
  root.querySelectorAll(FIXED_UI).forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) rects.push({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height })
  })
  return { screen, obstacles: obstacleRects(rects, screen) }
}

/** The tutor's marks and notes on (or within `reach` of) the lines in `work`: page rects. */
function feedbackOn(editor: Editor, work: Rect, reach: number): Rect[] {
  const out: Rect[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (s.meta?.ai !== true || !FEEDBACK.has(s.meta.kind as string)) continue
    const b = editor.getShapePageBounds(s)
    if (b && b.x <= work.x + work.w + reach && b.x + b.w >= work.x - reach && b.y <= work.y + work.h + reach && b.y + b.h >= work.y - reach) out.push({ x: b.x, y: b.y, w: b.w, h: b.h })
  }
  return out
}
const FEEDBACK = new Set(['circle', 'underline', 'note', 'ask'])

const frame = () => new Promise<void>((done) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => done()) : setTimeout(done, 16)))

/**
 * Wait until the notebook has the size the open lesson panel leaves it and its controls have
 * settled there (the toolbar moves when the notebook gets narrow). Half a second at most.
 */
async function laidOut(editor: Editor) {
  let last = ''
  let steady = 0
  for (let i = 0; i < 30 && steady < 2; i++) {
    await frame()
    const box = editor.getContainer().getBoundingClientRect()
    const open = dock.get() && !dock.get()!.collapsed
    const want = open ? dockLayout(window.innerWidth, window.innerHeight).canvas : null
    const size = `${Math.round(box.width)}x${Math.round(box.height)}`
    const there = !want || (Math.abs(box.width - want.w) < 2 && Math.abs(box.height - want.h) < 2)
    steady = there && size === last ? steady + 1 : 0
    last = size
  }
}

let asked = 0

/**
 * A lesson has opened: slide the page, if it has to move, so the lines of the problem it is about
 * are beside the panel and clear of the notebook's own controls. The zoom is never changed, and
 * nothing moves if the lines are already in the clear. Closing or folding the panel moves nothing.
 */
export async function focusLesson(editor: Editor, lesson: Lesson) {
  const mine = ++asked
  try {
    await laidOut(editor)
    if (mine !== asked) return
    const ink = studentInk(editor)
    const focus = workRect(editor, lesson, ink)
    if (!(focus.w > 0 && focus.h > 0)) return
    const touching = ink.filter((r) => r.x <= focus.x + focus.w && r.x + r.w >= focus.x && r.y <= focus.y + focus.h && r.y + r.h >= focus.y)
    const { screen, obstacles } = fixedUiRects(editor)
    const cam = editor.getCamera()
    const next = panFor(focus, touching.at(-1) ?? null, cam, screen, obstacles, feedbackOn(editor, focus, 40 / (cam.z || 1)))
    if (Math.abs(next.x - cam.x) * cam.z < 0.5 && Math.abs(next.y - cam.y) * cam.z < 0.5) return
    editor.setCamera({ x: next.x, y: next.y, z: cam.z }, { animation: { duration: 450 } })
  } catch (err) {
    console.warn('lesson: could not move the page', err)
  }
}
