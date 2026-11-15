import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Editor } from 'tldraw'
import type { PageRect } from './render/geometry'
import { primeSpeech } from './lesson/speech'
import type { HintChain } from './sync/hintChain'
import { statusLine } from './sync/status'
import type { Tutor } from './sync/tutor'
import { HoldGesture, startListening, type Listening } from './voice'
import { importPdf } from './worksheet'

const RING = 2 * Math.PI * 9

/**
 * Shown while a hint chain is running: when the next hint comes, or that the tutor is waiting for the
 * student's next line. Tapping it stops the chain.
 */
function NextHint({ chain }: { chain: HintChain }) {
  const snap = useSyncExternalStore(chain.subscribe, () => chain.snapshot)
  const counting = snap.phase === 'counting'
  const [, tick] = useState(0)
  useEffect(() => {
    if (!counting) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [counting, snap.deadline])

  if (snap.phase === 'idle' || (snap.phase === 'asking' && snap.level === 0)) return null
  const left = Math.max(0, snap.deadline - Date.now())
  const label = snap.phase === 'watching' ? "I'll look when you pause" : counting && left > 0 ? `Next hint in ${Math.ceil(left / 1000)} s` : 'Next hint…'
  return (
    <button className="tutor-next" onClick={() => chain.cancel()} aria-label={`${label}. Tap to stop hints`}>
      <svg className="tutor-next-ring" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="track" cx="12" cy="12" r="9" />
        {counting && (
          <circle
            key={snap.deadline}
            className="fill"
            cx="12"
            cy="12"
            r="9"
            strokeDasharray={RING}
            style={{ animationDuration: `${snap.totalMs}ms`, animationDelay: `${left - snap.totalMs}ms` }}
          />
        )}
      </svg>
      <span className="tutor-next-label">{label}</span>
      <span className="tutor-next-x" aria-hidden="true">
        ×
      </span>
    </button>
  )
}

/**
 * "Teach me": asks for a short narrated, animated lesson about the selection (or what is on screen).
 * Help's quieter sibling: same shape, paper-white. After the last hint it wears a small "Still stuck?"
 * tag for a while, since that is when being taught beats another nudge.
 */
function TeachButton({ editor, tutor }: { editor: Editor; tutor: Tutor }) {
  const [preparing, setPreparing] = useState(false)
  const [offered, setOffered] = useState(false)
  const area = useRef<PageRect | undefined>(undefined)

  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined
    const off = tutor.on((e) => {
      if (e.type !== 'offer-lesson') return
      setOffered(true)
      clearTimeout(hide)
      hide = setTimeout(() => setOffered(false), 30_000)
    })
    return () => {
      off()
      clearTimeout(hide)
    }
  }, [tutor])

  const down = () => {
    // read the selection before the tap can clear it
    const sel = editor.getSelectionPageBounds()
    area.current = sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : undefined
  }
  const teach = async () => {
    if (preparing) return
    // iOS only lets a page speak if speech began inside a tap. The lesson arrives seconds from now,
    // so the voice is unlocked here, while this tap is still being handled.
    primeSpeech()
    setOffered(false)
    setPreparing(true)
    editor.selectNone()
    try {
      await tutor.explain(area.current)
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="tutor-teach-wrap">
      {offered && !preparing && <span className="tutor-teach-tag">Still stuck?</span>}
      <button
        className={'tutor-teach' + (preparing ? ' preparing' : '')}
        onPointerDown={down}
        onClick={() => void teach()}
        aria-busy={preparing}
        aria-label={preparing ? 'Preparing a lesson' : 'Teach me: play a short lesson about this'}
      >
        {preparing ? (
          <>
            <svg className="tutor-teach-spin" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
            </svg>
            <span>Preparing a lesson…</span>
          </>
        ) : (
          <span>
            Teach
            <br />
            me
          </span>
        )}
      </button>
    </div>
  )
}

/**
 * What the student is saying while they hold Help, as a subtitle along the bottom of the screen:
 * the recognizer's running guess while they talk, then the question as it was sent, until the answer is there.
 */
function Subtitle({ heard }: { heard: { text: string; sent: boolean } }) {
  return (
    <div className={'tutor-subtitle' + (heard.sent ? ' sent' : '')} role="status" aria-live="polite">
      <span className="tutor-subtitle-mic" aria-hidden="true" />
      <span className="tutor-subtitle-text">
        <span>{heard.text || 'Listening… ask your question'}</span>
      </span>
    </div>
  )
}

/**
 * Big floating Help. Tap: hint for the selection (lasso/box select), or for what is on screen if nothing is selected.
 * Hold: also listen, and send what the student said as `question` when they let go.
 * One tap is enough: more hints follow while the student stays stuck (see sync/hintChain.ts); tapping again
 * brings the next one right away.
 */
export function HelpButton({ editor, tutor }: { editor: Editor; tutor: Tutor }) {
  const [reading, setReading] = useState(tutor.showReading)
  const [listening, setListening] = useState(false)
  /** what speech recognition has heard: live while holding, then the question that was sent, until its reply arrives */
  const [heard, setHeard] = useState<{ text: string; sent: boolean } | null>(null)
  const [status, setStatus] = useState(tutor.status)
  const mic = useRef<Listening | null>(null)
  const area = useRef<PageRect | undefined>(undefined)
  /** which hold the subtitle belongs to: an older question's reply must not clear a newer one */
  const asked = useRef(0)

  useEffect(() => {
    const off = tutor.on((e) => {
      if (e.type === 'status') setStatus(e.status)
    })
    return () => void off()
  }, [tutor])

  const gesture = useMemo(() => {
    const send = (question?: string) => {
      editor.selectNone()
      return tutor.help(area.current, question || undefined)
    }
    return new HoldGesture({
      onTap: () => void send(),
      onHoldStart: () => {
        const turn = ++asked.current
        mic.current = startListening((text) => {
          if (asked.current === turn) setHeard({ text, sent: false })
        })
        setListening(mic.current !== null)
        setHeard(mic.current ? { text: '', sent: false } : null)
      },
      onHoldEnd: async () => {
        const turn = asked.current
        setListening(false)
        const m = mic.current
        mic.current = null
        const question = m ? await m.stop() : undefined
        // the question stays on screen until the tutor has answered it
        if (asked.current === turn) setHeard(question ? { text: question, sent: true } : null)
        try {
          await send(question)
        } finally {
          if (asked.current === turn) setHeard(null)
        }
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
    <>
    {heard && <Subtitle heard={heard} />}
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
      {reading && (
        <div className="tutor-status" role="status">
          {status ? statusLine(status) : 'no check yet'}
        </div>
      )}
      <NextHint chain={tutor.hints} />
      <TeachButton editor={editor} tutor={tutor} />
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
    </>
  )
}
