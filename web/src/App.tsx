import { useEffect, useState } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { DevPanel } from './DevPanel'
import { Tutor } from './sync/tutor'
import { TutorOverlay } from './TutorOverlay'

const DEV = new URLSearchParams(location.search).has('dev')

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [tutor, setTutor] = useState<Tutor | null>(null)

  useEffect(() => {
    if (!editor) return
    const t = new Tutor(editor)
    setTutor(t)
    if (DEV) Object.assign(window, { tutor: t })
    return () => t.dispose()
  }, [editor])

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        persistenceKey="tutor-notebook"
        onMount={(e) => {
          setEditor(e)
          if (DEV) Object.assign(window, { editor: e })
        }}
      />
      {tutor && <TutorOverlay tutor={tutor} />}
      {DEV && editor && <DevPanel editor={editor} />}
    </div>
  )
}
