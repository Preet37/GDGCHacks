import { useState } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { DevPanel } from './DevPanel'

const DEV = new URLSearchParams(location.search).has('dev')

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        persistenceKey="tutor-notebook"
        onMount={(e) => {
          setEditor(e)
          if (DEV) Object.assign(window, { editor: e })
        }}
      />
      {DEV && editor && <DevPanel editor={editor} />}
    </div>
  )
}
