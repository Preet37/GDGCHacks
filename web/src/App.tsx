import { useEffect, useState } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { DevPanel } from './DevPanel'
import { HelpButton } from './HelpButton'
import { LessonDock, useLessonDock } from './lesson/LessonDock'
import { LessonShapeUtil } from './shapes/LessonShape'
import { MathShapeUtil } from './shapes/MathShape'
import { Surface3dShapeUtil } from './shapes/Surface3dShape'
import { CircuitCardShapeUtil } from './shapes/CircuitCardShape'
import { Model3dShapeUtil } from './shapes/Model3dShape'
import { Asset3dShapeUtil } from './shapes/AssetModelShape'
import { pageIdFromUrl, restorePage, startAutosave } from './persist/saver'
import { Tutor } from './sync/tutor'
import { TutorOverlay } from './TutorOverlay'

const shapeUtils = [Surface3dShapeUtil, LessonShapeUtil, MathShapeUtil, CircuitCardShapeUtil, Model3dShapeUtil, Asset3dShapeUtil]
const DEV = new URLSearchParams(location.search).has('dev')

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [tutor, setTutor] = useState<Tutor | null>(null)

  useEffect(() => {
    if (!editor) return
    const t = new Tutor(editor, pageIdFromUrl())
    setTutor(t)
    if (DEV) Object.assign(window, { tutor: t })
    let stopSave = () => {}
    let disposed = false
    restorePage(editor, t)
      .catch((err) => {
        console.warn('load failed', err)
        t.notify("Couldn't load the saved page")
      })
      .finally(() => {
        if (!disposed) stopSave = startAutosave(editor, t, (m) => t.notify(m))
      })
    return () => {
      disposed = true
      stopSave()
      t.dispose()
    }
  }, [editor])

  // An open lesson takes its own part of the screen (below the notebook, or to its right), so it
  // never covers the work; the notebook, its toolbar and the Help buttons all fit in what is left.
  const lessonDock = useLessonDock()

  return (
    <div className="app-shell" data-dock={lessonDock.layout?.side}>
      <div className="app-canvas">
        <Tldraw
          persistenceKey="tutor-notebook"
          shapeUtils={shapeUtils}
          // required on https production hosts (tutor-1098c.web.app); dev and plain http work without it
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
          onMount={(e) => {
            setEditor(e)
            if (DEV) Object.assign(window, { editor: e })
          }}
        />
        {tutor && <TutorOverlay tutor={tutor} />}
        {editor && tutor && <HelpButton editor={editor} tutor={tutor} />}
        {DEV && editor && <DevPanel editor={editor} />}
      </div>
      <LessonDock {...lessonDock} />
    </div>
  )
}
