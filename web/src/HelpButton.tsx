import { useState } from 'react'
import type { Editor } from 'tldraw'
import type { Tutor } from './sync/tutor'

/** Big floating Help: sends mode "help" for the selected area (lasso/box select), or the whole page. */
export function HelpButton({ editor, tutor }: { editor: Editor; tutor: Tutor }) {
  const [reading, setReading] = useState(tutor.showReading)

  const help = () => {
    const sel = editor.getSelectionPageBounds()
    const area = sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : undefined
    editor.selectNone()
    void tutor.help(area)
  }

  const toggleReading = () => {
    tutor.setShowReading(!reading)
    setReading(!reading)
  }

  return (
    <div className="tutor-controls">
      <button className={'tutor-chip' + (reading ? ' on' : '')} onClick={toggleReading}>
        Show what AI read
      </button>
      <button className="tutor-help" onClick={help}>
        Help
      </button>
    </div>
  )
}
