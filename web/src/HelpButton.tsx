import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Editor } from 'tldraw'
import type { PageRect } from './render/geometry'
import { primeSpeech } from './lesson/speech'
import type { HintChain } from './sync/hintChain'
import { HandwritingToggle } from './handwriting'
import { statusLine } from './sync/status'
import type { Tutor } from './sync/tutor'
import { HoldGesture, newRecognition, startListening, type Listening } from './voice'
import { HandsFree, spokenText } from './handsfree'
import { setSpeaker } from './render/apply'
import { hush, sayAloud, tutorIsLoud } from './sayAloud'
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

/** What "Solve" asks for. Worded as a spoken request, which is what the server takes as permission to solve. */
const SOLVE_REQUEST = 'Solve this for me step by step and show every step'

/**
 * "Solve": writes the whole worked solution, every step, under the selection (or the last thing the
 * student wrote or circled). Help nudges and Teach me explains; this one just does it.
 */
function SolveButton({ editor, tutor }: { editor: Editor; tutor: Tutor }) {
  const [solving, setSolving] = useState(false)
  const area = useRef<PageRect | undefined>(undefined)
  const down = () => {
    const sel = editor.getSelectionPageBounds()
    area.current = sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : undefined
  }
  const solve = async () => {
    if (solving) return
    primeSpeech()
    setSolving(true)
    editor.selectNone()
    try {
      await tutor.help(area.current, SOLVE_REQUEST)
    } finally {
      setSolving(false)
    }
  }
  return (
    <button
      className={'tutor-solve' + (solving ? ' preparing' : '')}
      onPointerDown={down}
      onClick={() => void solve()}
      aria-busy={solving}
      aria-label={solving ? 'Solving' : 'Solve: write out every step of this problem'}
    >
      {solving ? (
        <>
          <svg className="tutor-teach-spin" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
          </svg>
          <span>Solving…</span>
        </>
      ) : (
        <span>
          Solve
          <br />
          it
        </span>
      )}
    </button>
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

  // hands-free: keeps listening; "I'm stuck" / "help me here" asks for help, "teach me" for a lesson
  const hands = useMemo(
    () =>
      new HandsFree({
        make: newRecognition,
        quiet: () => !tutorIsLoud(),
        onIntent: async (intent, said) => {
          editor.selectNone()
          if (intent === 'teach') await tutor.explain()
          else await tutor.help(undefined, said)
        },
      }),
    [editor, tutor],
  )
  useEffect(() => () => hands.dispose(), [hands])
  const free = useSyncExternalStore(hands.subscribe, () => hands.snapshot)
  useEffect(() => {
    if (!free.on) return
    // while hands-free is on, every hint is read out in the tutor's own voice
    setSpeaker(() => {})
    const off = tutor.on((e) => {
      if (e.type !== 'reply' || e.mode !== 'help') return
      const text = spokenText(e.reply)
      if (text) void sayAloud(text)
    })
    return () => {
      off()
      setSpeaker(null)
      hush()
    }
  }, [free.on, tutor])
  const toggleHands = () => {
    if (free.on) return hands.stop()
    // the microphone first, then sound: both may only start inside a tap
    hands.start()
    primeSpeech()
  }

  const gesture = useMemo(() => {
    const send = (question?: string) => {
      editor.selectNone()
      return tutor.help(area.current, question || undefined)
    }
    return new HoldGesture({
      onTap: () => void send(),
      onHoldStart: () => {
        const turn = ++asked.current
        hands.hold(true)
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
        hands.hold(false)
        // the question stays on screen until the tutor has answered it
        if (asked.current === turn) setHeard(question ? { text: question, sent: true } : null)
        try {
          await send(question)
        } finally {
          if (asked.current === turn) setHeard(null)
        }
      },
    })
  }, [editor, tutor, hands])

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
    {heard ? <Subtitle heard={heard} /> : free.heard ? <Subtitle heard={{ text: free.heard, sent: true }} /> : null}
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
      <HandwritingToggle editor={editor} />
      <button
        className={'tutor-chip tutor-listen' + (free.on ? ' on ' + free.phase : '')}
        onClick={toggleHands}
        aria-pressed={free.on}
        aria-label={free.on ? 'Listening for "I\'m stuck" or "teach me". Tap to stop' : 'Listen: say "I\'m stuck" or "teach me" and the tutor answers out loud'}
      >
        <span className="tutor-listen-dot" aria-hidden="true" />
        {!free.on ? 'Listen' : free.phase === 'thinking' ? 'Thinking…' : free.phase === 'speaking' ? 'Speaking…' : 'Listening'}
      </button>
      {free.error && (
        <div className="tutor-status" role="status">
          {free.error}
        </div>
      )}
      {reading && (
        <div className="tutor-status" role="status">
          {status ? statusLine(status) : 'no check yet'}
        </div>
      )}
      <NextHint chain={tutor.hints} />
      <SolveButton editor={editor} tutor={tutor} />
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
