import { useEffect, useState } from 'react'
import type { Tutor } from './sync/tutor'
import './tutor.css'

/** Pulsing dot while a request is in flight, quiet toast on errors. */
export function TutorOverlay({ tutor }: { tutor: Tutor }) {
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined
    const off = tutor.on((e) => {
      if (e.type === 'busy') setBusy(e.busy)
      if (e.type === 'error') {
        setToast(e.message)
        clearTimeout(hide)
        hide = setTimeout(() => setToast(null), 4000)
      }
    })
    return () => {
      off()
      clearTimeout(hide)
    }
  }, [tutor])

  return (
    <>
      {busy && <div className="tutor-dot" aria-label="Tutor is thinking" />}
      {toast && <div className="tutor-toast">{toast}</div>}
    </>
  )
}
