import { audioOut } from './audio'
import { speechMs } from './timing'

/** The bits of the Web Speech API the narrator uses (so tests can fake them). */
export interface VoiceLike {
  name: string
  lang: string
  localService?: boolean
  default?: boolean
}

export interface UtteranceLike {
  text: string
  lang: string
  rate: number
  volume: number
  voice: unknown
  onstart: ((e: unknown) => void) | null
  onend: ((e: unknown) => void) | null
  onerror: ((e: { error?: string }) => void) | null
}

export interface SynthLike {
  speaking: boolean
  pending: boolean
  speak(u: UtteranceLike): void
  cancel(): void
  getVoices(): VoiceLike[]
}

export interface SpeechEnv {
  /** undefined = this browser can't speak */
  synth?: SynthLike
  makeUtterance?: (text: string) => UtteranceLike
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

/** If speech hasn't started this long after asking for it, the browser is not going to say it. */
export const START_TIMEOUT_MS = 3000

// Novelty and low-quality voices that iOS and macOS list under English.
const AVOID =
  /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|pipe organ|fred|junior|kathy|ralph|eddy|flo\b|grandma|grandpa|reed|rocko|sandy|shelley|eloquence/i
const PREFERRED = [/samantha/i, /google us english/i, /ava/i, /allison/i, /daniel/i, /karen/i, /google uk english female/i, /zira/i, /aria/i]

/** Rank a voice for reading a lesson out in English. Below zero = don't use it. */
export function voiceScore(v: VoiceLike): number {
  const lang = v.lang.replace('_', '-').toLowerCase()
  if (!lang.startsWith('en')) return -1
  if (AVOID.test(v.name)) return -1
  let score = lang === 'en-us' ? 30 : lang === 'en-gb' ? 24 : 18
  const liked = PREFERRED.findIndex((re) => re.test(v.name))
  if (liked >= 0) score += 40 - liked * 3
  if (/enhanced|premium|natural|neural/i.test(v.name)) score += 25
  if (v.localService) score += 6 // works offline and doesn't cut out on long sentences
  if (v.default) score += 4
  return score
}

/** The best English voice on offer, or null to leave the choice to the browser. */
export function pickVoice<V extends VoiceLike>(voices: V[]): V | null {
  let best: V | null = null
  let bestScore = 0
  for (const v of voices) {
    const s = voiceScore(v)
    if (s > bestScore) {
      best = v
      bestScore = s
    }
  }
  return best
}

export interface SpeakOptions {
  /** say nothing, but take as long as saying it would */
  muted?: boolean
  /**
   * true = playback was started by a tap, so if the browser stays silent there is nothing more to
   * try: carry on without sound. false = it may only be waiting for a tap: report `onBlocked`.
   */
  trusted?: boolean
  onEnd: () => void
  /** Speech was asked for but never started and no tap is behind it. The narration is dropped. */
  onBlocked?: () => void
}

/**
 * Says one piece of narration at a time and tells you when it is over. Whatever the browser does
 * (no speech API, speech blocked until a tap, an error, an utterance that never reports its end),
 * `onEnd` or `onBlocked` is called exactly once, unless `stop()` came first.
 */
export class Narrator {
  /** speech was tried after a tap and stayed silent: every later step runs on a timer */
  silent = false
  private env: SpeechEnv
  private token = 0
  private timers: unknown[] = []
  /** kept so the utterance isn't garbage-collected before its `end` event (a WebKit/Chrome bug) */
  protected current: UtteranceLike | null = null

  constructor(env: SpeechEnv) {
    this.env = env
  }

  get canSpeak(): boolean {
    return !!this.env.synth && !!this.env.makeUtterance && !this.silent
  }

  /**
   * Call inside a tap handler. iOS Safari only lets a page speak after speech was started from a
   * user gesture; a silent utterance now lets the narration start later, when the lesson arrives.
   */
  prime() {
    const { synth, makeUtterance } = this.env
    if (!synth || !makeUtterance) return
    try {
      const u = makeUtterance(' ')
      u.volume = 0
      u.rate = 2
      synth.speak(u)
    } catch {
      // nothing to unlock
    }
  }

  speak(text: string, opts: SpeakOptions) {
    this.stop()
    const token = this.token
    const live = () => token === this.token
    const estimate = speechMs(text)
    let done = false
    const finish = () => {
      if (!live() || done) return
      done = true
      this.clearTimers()
      this.current = null
      opts.onEnd()
    }
    /** carry on without sound for what is left of the narration */
    const quietly = (ms: number) => {
      this.clearTimers()
      this.after(Math.max(0, ms), finish)
    }

    const { synth, makeUtterance } = this.env
    if (opts.muted || !text.trim() || !synth || !makeUtterance || this.silent) return quietly(estimate)

    let started = false
    const blocked = () => {
      if (!live() || done || started) return
      try {
        synth.cancel()
      } catch {
        // ignore
      }
      if (opts.trusted || !opts.onBlocked) {
        this.silent = true
        return quietly(estimate - START_TIMEOUT_MS)
      }
      done = true
      this.clearTimers()
      this.current = null
      opts.onBlocked()
    }
    try {
      const u = makeUtterance(text)
      const voice = pickVoice(synth.getVoices())
      if (voice) u.voice = voice
      u.lang = voice?.lang ?? 'en-US'
      u.rate = 0.96
      u.volume = 1
      u.onstart = () => {
        if (!live() || done) return
        started = true
        // some browsers never report the end of an utterance: don't wait for ever
        quietly(estimate * 2 + 4000)
      }
      u.onend = finish
      u.onerror = (e) => {
        if (!live() || done) return
        if (!started && e?.error === 'not-allowed') return blocked()
        if (started) return finish() // cut off part-way: move on
        quietly(estimate)
      }
      this.current = u
      synth.speak(u)
      this.after(START_TIMEOUT_MS, blocked)
    } catch {
      quietly(estimate)
    }
  }

  /** Stop talking now. The pending `onEnd` is never called. */
  stop() {
    this.token++
    this.clearTimers()
    this.current = null
    const synth = this.env.synth
    if (!synth) return
    try {
      if (synth.speaking || synth.pending) synth.cancel()
    } catch {
      // ignore
    }
  }

  private after(ms: number, fn: () => void) {
    this.timers.push(this.env.setTimer(fn, ms))
  }

  private clearTimers() {
    for (const t of this.timers) this.env.clearTimer(t)
    this.timers = []
  }
}

function browserEnv(): SpeechEnv {
  const w = typeof window === 'undefined' ? undefined : window
  const ok = !!w && 'speechSynthesis' in w && typeof w.SpeechSynthesisUtterance === 'function'
  return {
    synth: ok ? (w.speechSynthesis as unknown as SynthLike) : undefined,
    makeUtterance: ok ? (text) => new w.SpeechSynthesisUtterance(text) as unknown as UtteranceLike : undefined,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
}

let shared: Narrator | null = null

/** The page's one narrator (there is one speech queue per page). */
export function narrator(): Narrator {
  if (!shared) {
    shared = new Narrator(browserEnv())
    try {
      // Chrome loads its voice list late; asking early means it is there by the first step
      window.speechSynthesis?.getVoices()
    } catch {
      // ignore
    }
  }
  return shared
}

/** Call from the tap that asks for a lesson, so the narration may start when the lesson arrives. */
export function primeSpeech() {
  // the recorded voice plays through one audio element, which iOS also only unlocks inside a tap
  audioOut()?.unlock()
  narrator().prime()
}
