import { useMemo, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import type { PageRect } from './render/geometry'
import type { Tutor } from './sync/tutor'
import { HoldGesture, startListening, type Listening } from './voice'
import { importPdf } from './worksheet'

/**
 * Big floating Help. Tap: hint for the selection (lasso/box select), or for what is on screen if nothing is selected.
 * Hold: also listen, and send what the student said as `question` when they let go.
 */
export function HelpButton({ editor, tutor }: { editor: Editor; tutor: Tutor }) {
  const [reading, setReading] = useState(tutor.showReading)
  const [listening, setListening] = useState(false)
  const mic = useRef<Listening | null>(null)
  const area = useRef<PageRect | undefined>(undefined)

  const gesture = useMemo(() => {
    const send = (question?: string) => {
      editor.selectNone()
      void tutor.help(area.current, question || undefined)
    }
    return new HoldGesture({
      onTap: () => send(),
      onHoldStart: () => {
        mic.current = startListening()
        setListening(mic.current !== null)
      },
      onHoldEnd: async () => {
        setListening(false)
        const m = mic.current
        mic.current = null
        send(m ? await m.stop() : undefined)
      },
    })
  }, [editor, tutor])

  const down = () => {
    const sel = editor.getSelectionPageBounds()
    area.current = sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : undefined
    gesture.pointerDown()
  }
  const up = () => gesture.pointerUp()

  const fileInput = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const onPdf = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try {
      await importPdf(editor, file)
    } catch (err) {
      console.error('PDF import failed', err)
      alert("Couldn't open that PDF")
    } finally {
      setImporting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const toggleReading = () => {
    tutor.setShowReading(!reading)
    setReading(!reading)
  }

  return (
    <div className="tutor-controls">
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => void onPdf(e.target.files?.[0])}
      />
      <button className="tutor-chip" disabled={importing} onClick={() => fileInput.current?.click()}>
        {importing ? 'Importing…' : 'Import PDF'}
      </button>
      <button className={'tutor-chip' + (reading ? ' on' : '')} onClick={toggleReading}>
        Show what AI read
      </button>
      <button
        className={'tutor-help' + (listening ? ' listening' : '')}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Help (hold to ask out loud)"
      >
        {listening ? 'Listening…' : 'Help'}
      </button>
    </div>
  )
}
