// Speech-to-text for "hold Help and ask". Uses the browser's built-in recognizer
// (webkitSpeechRecognition on Safari/Chrome). Missing support just means Help without a question.

export interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

type RecognitionCtor = new () => Recognition

function ctor(): RecognitionCtor | null {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechSupported(): boolean {
  return ctor() !== null
}

/** A fresh recognizer set up for running speech, or null where the browser has none. */
export function newRecognition(): Recognition | null {
  const Ctor = ctor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
  rec.interimResults = true
  rec.continuous = true
  return rec
}

export interface Listening {
  /** Stop listening and get what was said ('' if nothing or on error). */
  stop(): Promise<string>
}

/** What has been heard so far: the finished phrases, then the one still being worked out. */
export function transcript(finals: string[], interim: string): string {
  return [...finals.filter(Boolean), interim].join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Start listening. `onHeard` gets the running transcript every time the recognizer changes its
 * mind (interim results included), for showing it live while the student is still talking.
 */
export function startListening(onHeard?: (text: string) => void): Listening | null {
  const Ctor = ctor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
  rec.interimResults = true
  rec.continuous = true
  const finals: string[] = []
  let interim = ''
  let ended = false
  let onEnded: (() => void) | null = null

  rec.onresult = (e) => {
    interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finals[i] = r[0].transcript
      else interim += r[0].transcript
    }
    onHeard?.(transcript(finals, interim))
  }
  rec.onerror = () => {}
  rec.onend = () => {
    ended = true
    onEnded?.()
  }
  try {
    rec.start()
  } catch {
    return null
  }

  return {
    stop: () =>
      new Promise<string>((resolve) => {
        const done = () => resolve(transcript(finals, interim))
        if (ended) return done()
        onEnded = done
        rec.stop()
        // some browsers never fire `end` after stop(); don't hang the Help request
        setTimeout(() => {
          if (!ended) {
            ended = true
            rec.abort()
            done()
          }
        }, 1500)
      }),
  }
}

export interface HoldHandlers {
  onTap: () => void
  onHoldStart: () => void
  onHoldEnd: () => void
}

/** Tells a tap from a press-and-hold on one button. */
export class HoldGesture {
  private timer: ReturnType<typeof setTimeout> | null = null
  private holding = false
  private down = false
  private h: HoldHandlers
  private holdMs: number

  constructor(h: HoldHandlers, holdMs = 350) {
    this.h = h
    this.holdMs = holdMs
  }

  pointerDown() {
    this.down = true
    this.holding = false
    this.timer = setTimeout(() => {
      this.holding = true
      this.h.onHoldStart()
    }, this.holdMs)
  }

  /** Pointer up, cancel or leave. */
  pointerUp() {
    if (!this.down) return
    this.down = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.holding) this.h.onHoldEnd()
    else this.h.onTap()
    this.holding = false
  }
}
