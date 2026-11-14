import type { Editor, TLShapeId } from 'tldraw'
import type { CheckResponse } from '../contract'
import { isAiShape, shapesForAction } from './actions'
import type { PageRect } from './geometry'

/** Line ids whose old feedback must go: anything re-addressed by an action, plus clear_line_ids. */
export function lineIdsToReplace(response: Pick<CheckResponse, 'actions' | 'clear_line_ids'>): Set<string> {
  const ids = new Set(response.clear_line_ids)
  for (const action of response.actions) if (action.line_id) ids.add(action.line_id)
  return ids
}

export function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/\$/g, '')))
}

/** Draw a CheckResponse onto the page. `bounds` = page-space area of the image that was sent. */
export function applyResponse(editor: Editor, response: CheckResponse, bounds: PageRect) {
  const replace = lineIdsToReplace(response)
  const stale = editor
    .getCurrentPageShapes()
    .filter((s) => isAiShape(s) && typeof s.meta.line_id === 'string' && replace.has(s.meta.line_id))
    .map((s) => s.id as TLShapeId)

  const shapes = response.actions.flatMap((a) => shapesForAction(a, bounds))

  editor.run(
    () => {
      if (stale.length) editor.deleteShapes(stale)
      if (shapes.length) editor.createShapes(shapes)
    },
    { history: 'ignore', ignoreShapeLock: true },
  )

  for (const action of response.actions) if (action.type === 'speak' && action.text) speak(action.text)
}
