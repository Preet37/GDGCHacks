// Hands-free: the page keeps listening and the tutor steps in when the student says they need it
// ("I'm stuck", "help me here", "teach me"). No button to tap or hold. The reply is read out.
//
// The microphone is closed whenever the tutor itself is making sound (it would hear itself, and on
// iOS an open recognizer and audio playback fight over the audio session), and reopened after.

import type { CheckResponse } from './contract'
import { mathToSpeech } from './render/text'
import type { Recognition } from './voice'

export type Intent = 'help' | 'teach'

// what the recognizer writes for "I'm": I'm, I’m, Im, I am
const IM = "i(?:['’]| a)?m"
const TEACH = new RegExp(
  `\\b(teach me|walk me through|explain (this|that|it)|can you explain|show me how|i (don['’]?t|do not) (understand|get)|i have no idea)\\b`,
  'i',
)
const HELP = new RegExp(
  `\\b(help me|i need (some |a little )?help|can (you|i get some) help|${IM} (so |really |totally |kind of |a bit )?(stuck|lost|confused)|give me a hint|(can|could) i (get|have) a hint|what did i do wrong|where did i go wrong|is (this|that) (right|correct)|what(['’]s| is| do i do| should i do) next|how do i|hey tutor)\\b`,
  'i',
)

/** How much of what came before the key phrase is kept as part of the question. */
const LEAD_IN = 80

/**
 * Does `text` (running speech) ask for the tutor? `said` is the part to send as the question:
 * from a little before the key phrase to the end, so chatter from earlier is left out.
 */
export function intentOf(text: string): { intent: Intent; said: string } | null {
  const teach = TEACH.exec(text)
  const help = HELP.exec(text)
  const m = teach ?? help
  if (!m) return null
  let from = Math.max(0, m.index - LEAD_IN)
  // start at a word, not in the middle of one
  if (from > 0) from = text.indexOf(' ', from) + 1 || from
  return { intent: teach ? 'teach' : 'help', said: text.slice(from).replace(/\s+/g, ' ').trim() }
}

/** What to read out for a reply: its `speak` text if it has one, else its notes and questions. */
export function spokenText(reply: Pick<CheckResponse, 'actions'>): string {
  const speak = reply.actions.find((a) => a.type === 'speak' && a.text?.trim())
  if (speak?.text) return mathToSpeech(speak.text)
  const parts = reply.actions.filter((a) => (a.type === 'note' || a.type === 'ask') && a.text?.trim()).map((a) => (a.text ?? '').trim())
  return mathToSpeech([...new Set(parts)].map((p) => (/[.?!]$/.test(p) ? p : p + '.')).join(' '))
}

export type Phase = 'off' | 'listening' | 'thinking' | 'speaking'

export interface HandsFreeState {
  on: boolean
  phase: Phase
  /** the request being answered, as it was heard ('' when there is none) */
  heard: string
  /** why listening stopped by itself, to show once */
  error: string | null
}

export interface HandsFreeDeps {
  /** a recognizer ready to start, or null if the browser has none */
  make: () => Recognition | null
  /** nothing the tutor plays is making sound right now */
  quiet: () => boolean
  /** the student asked: do it. Resolves when the tutor has answered (the reply is on the page). */
  onIntent: (intent: Intent, said: string) => Promise<void>
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  now?: () => number
}

/** How often the microphone is opened or closed to match what the tutor is doing. */
export const TICK_MS = 400
/** A key phrase that the recognizer hasn't marked as finished counts once it has stood this long. */
export const SETTLE_MS = 1200
/** After answering, this long before another request is taken (the tail of the same sentence). */
export const COOLDOWN_MS = 1500
/** This many sessions in a row that end at once: the browser is not letting us listen. */
export const MAX_DUDS = 6

export class HandsFree {
  private deps: Required<HandsFreeDeps>
  private listeners = new Set<() => void>()
  private snap: HandsFreeState = { on: false, phase: 'off', heard: '', error: null }
  private rec: Recognition | null = null
  private ticker: unknown = null
  private settle: unknown = null
  private openedAt = 0
  private gotResult = false
  private duds = 0
  private busy = false
  private held = false
  private restAt = 0
  /** told apart from an older session's late events */
  private session = 0

  constructor(deps: HandsFreeDeps) {
    this.deps = {
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      ...deps,
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  get snapshot(): HandsFreeState {
    return this.snap
  }

  /** Call inside a tap: the browser asks for the microphone the first time. false = can't listen here. */
  start(): boolean {
    if (this.snap.on) return true
    this.duds = 0
    this.set({ on: true, error: null, heard: '' })
    this.sync()
    if (!this.rec) {
      this.stop("This browser can't listen. Hold Help to ask instead")
      return false
    }
    this.loop()
    return true
  }

  stop(error: string | null = null) {
    this.deps.clearTimer(this.ticker)
    this.ticker = null
    this.close()
    this.busy = false
    this.set({ on: false, phase: 'off', heard: '', error })
  }

  /** Something else needs the microphone (hold-to-talk): step aside until it is released. */
  hold(held: boolean) {
    this.held = held
    if (this.snap.on) this.sync()
  }

  dispose() {
    this.stop()
    this.listeners.clear()
  }

  private loop() {
    this.ticker = this.deps.setTimer(() => {
      if (!this.snap.on) return
      this.sync()
      if (this.snap.on) this.loop()
    }, TICK_MS)
  }

  /** Open or close the microphone to match what is going on, and say which phase this is. */
  private sync() {
    if (!this.snap.on) return
    const quiet = this.deps.quiet()
    const want = !this.held && !this.busy && quiet && this.deps.now() >= this.restAt
    if (want && !this.rec) this.open()
    else if (!want && this.rec) this.close()
    if (!this.snap.on) return
    const phase: Phase = this.busy ? 'thinking' : !quiet ? 'speaking' : 'listening'
    if (phase !== this.snap.phase) this.set({ phase, ...(phase === 'listening' ? { heard: '' } : {}) })
  }

  private open() {
    const rec = this.deps.make()
    if (!rec) return
    const session = ++this.session
    const mine = () => session === this.session
    const finals: string[] = []
    this.gotResult = false
    this.openedAt = this.deps.now()
    rec.onresult = (e) => {
      if (!mine()) return
      this.gotResult = true
      let interim = ''
      let finished = false
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          finals[i] = r[0].transcript
          finished = true
        } else interim += r[0].transcript
      }
      const text = [...finals.filter(Boolean), interim].join(' ').replace(/\s+/g, ' ').trim()
      this.deps.clearTimer(this.settle)
      const hit = intentOf(text)
      if (!hit) return
      // a finished phrase goes now; one still being worked out goes once it stops changing
      if (finished && !interim) this.fire(hit.intent, hit.said)
      else this.settle = this.deps.setTimer(() => mine() && this.fire(hit.intent, hit.said), SETTLE_MS)
    }
    rec.onerror = (e) => {
      if (!mine()) return
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.stop('The microphone is blocked for this page')
    }
    rec.onend = () => {
      if (!mine()) return
      this.rec = null
      this.deps.clearTimer(this.settle)
      // a session that ends straight away with nothing heard, again and again: stop trying
      if (!this.gotResult && this.deps.now() - this.openedAt < 1000) {
        if (++this.duds >= MAX_DUDS) this.stop('Listening stopped. Tap Listen to turn it back on')
      } else this.duds = 0
    }
    try {
      rec.start()
      this.rec = rec
    } catch {
      this.rec = null
    }
  }

  private close() {
    this.deps.clearTimer(this.settle)
    this.settle = null
    const rec = this.rec
    this.rec = null
    this.session++
    if (!rec) return
    try {
      rec.abort()
    } catch {
      // already closed
    }
  }

  private fire(intent: Intent, said: string) {
    if (this.busy || !this.snap.on) return
    this.busy = true
    this.close()
    this.set({ phase: 'thinking', heard: said })
    const done = () => {
      this.busy = false
      this.restAt = this.deps.now() + COOLDOWN_MS
      if (this.snap.on) this.sync()
    }
    this.deps.onIntent(intent, said).then(done, done)
  }

  private set(part: Partial<HandsFreeState>) {
    this.snap = { ...this.snap, ...part }
    for (const fn of this.listeners) fn()
  }
}
