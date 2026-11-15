import { useEffect, useState } from 'react'
import type { Tutor } from './sync/tutor'
import './tutor.css'

/** Pulsing dot while a request is in flight, quiet toast on errors. */
export function TutorOverlay({ tutor }: { tutor: Tutor }) {
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /** a failure that trying again won't fix: stays up until a check works again */
  const [down, setDown] = useState<string | null>(null)

  /** part of the app could not be loaded (the site was updated while this page was open): offer a reload */
  const [stale, setStale] = useState<string | null>(null)
  useEffect(() => {
    const onNotice = (e: Event) => {
      const d = (e as CustomEvent<{ message?: string; reload?: boolean }>).detail
      if (d?.message) setStale(d.message)
    }
    // Vite fires this when a lazily loaded part of the app is missing on the server
    const onPreload = (e: Event) => {
      e.preventDefault()
      setStale('The app was updated. Reload the page to keep going.')
    }
    window.addEventListener('tutor-notice', onNotice)
    window.addEventListener('vite:preloadError', onPreload)
    return () => {
      window.removeEventListener('tutor-notice', onNotice)
      window.removeEventListener('vite:preloadError', onPreload)
    }
  }, [])

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
      {stale && (
        <button className="tutor-reload" onClick={() => location.reload()}>
          {stale} <b>Reload</b>
        </button>
      )}
      {down && !stale && (
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
