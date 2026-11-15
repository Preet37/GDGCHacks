import { useEffect, useState } from 'react'
import type { Tutor } from './sync/tutor'
import './tutor.css'

/** Pulsing dot while a request is in flight, quiet toast on errors. */
export function TutorOverlay({ tutor }: { tutor: Tutor }) {
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /** a failure that trying again won't fix: stays up until a check works again */
  const [down, setDown] = useState<string | null>(null)

  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined
    const off = tutor.on((e) => {
      if (e.type === 'busy') setBusy(e.busy)
      if (e.type === 'reply') setDown(null)
      if (e.type === 'error' && e.sticky) setDown(e.message)
      else if (e.type === 'error') {
        setToast(e.message)
        clearTimeout(hide)
        hide = setTimeout(() => setToast(null), 7000)
      }
    })
    return () => {
      off()
      clearTimeout(hide)
    }
  }, [tutor])

  return (
    <>
      {busy && (
        <div className="tutor-dot" aria-label="Tutor is thinking">
          <span className="tutor-dot-pulse" />
          Looking at your work…
        </div>
      )}
      {down && (
        <div className="tutor-down" role="alert">
          {down}
        </div>
      )}
      {toast && !down && (
        <div className="tutor-toast" role="status">
          {toast}
        </div>
      )}
    </>
  )
}
