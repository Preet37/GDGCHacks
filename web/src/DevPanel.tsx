import type { Editor } from 'tldraw'
import type { CheckResponse } from './contract'
import { isAiShape } from './render/actions'
import { applyResponse } from './render/apply'
import { studentBounds } from './page'

const examples = import.meta.glob<CheckResponse>('../../contract/examples/*.json', { eager: true, import: 'default' })

/** Open the app with ?dev to draw the contract's fake replies over whatever is on the page. */
export function DevPanel({ editor }: { editor: Editor }) {
  const draw = (reply: CheckResponse) => {
    const bounds = studentBounds(editor) ?? editor.getViewportPageBounds()
    applyResponse(editor, reply, bounds)
  }
  const clear = () =>
    editor.run(() => editor.deleteShapes(editor.getCurrentPageShapes().filter(isAiShape)), {
      history: 'ignore',
      ignoreShapeLock: true,
    })

  return (
    <div style={{ position: 'absolute', top: 60, left: 8, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {Object.entries(examples).map(([path, reply]) => (
        <button key={path} onClick={() => draw(reply)}>
          {path.split('/').pop()}
        </button>
      ))}
      <button onClick={clear}>clear AI marks</button>
    </div>
  )
}
