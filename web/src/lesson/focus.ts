import type { Editor } from 'tldraw'
import { cameraFor, canvasInsets, dockLayout, focusRect, type Rect } from './layout'

/** Page rects of the student's own strokes (not the tutor's marks, not an imported worksheet). */
export function studentInk(editor: Editor): Rect[] {
  const ink: Rect[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (s.meta?.ai === true || s.meta?.worksheet === true) continue
    const b = editor.getShapePageBounds(s)
    if (b) ink.push({ x: b.x, y: b.y, w: b.w, h: b.h })
  }
  return ink
}

/**
 * Move the page, if it has to move, so the lesson's marker and the writing beside it are in the
 * part of the screen the panel leaves to the notebook.
 */
export function focusLesson(editor: Editor, marker: Rect) {
  try {
    const layout = dockLayout(window.innerWidth, window.innerHeight)
    const cam = editor.getCamera()
    const ink = studentInk(editor)
    const focus = focusRect(marker, ink, 260 / (cam.z || 1))
    const next = cameraFor(focus, cam, layout.canvas, canvasInsets(layout.side))
    if (Math.abs(next.x - cam.x) < 0.5 && Math.abs(next.y - cam.y) < 0.5 && Math.abs(next.z - cam.z) < 1e-3) return
    editor.setCamera(next, { animation: { duration: 450 } })
  } catch (err) {
    console.warn('lesson: could not move the page', err)
  }
}
