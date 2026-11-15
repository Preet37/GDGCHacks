import { wavDurationMs, type AudioPort } from './audio'
import type { Narrator } from './speech'
import { speechMs } from './timing'

/** How a step is being narrated: the recorded voice, the browser's own voice, or not at all (timed). */
export type VoiceMode = 'audio' | 'speech' | 'silent'

export interface Clip {
  url: string
  /** from the file's header; undefined if it couldn't be read */
  durationMs?: number
}

export type ClipState = { state: 'loading' } | ({ state: 'ready' } & Clip) | { state: 'failed' }

export interface ClipEnv {
  makeUrl: (blob: Blob) => string
  revokeUrl: (url: string) => void
}

const browserClipEnv: ClipEnv = {
  makeUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
}

/**
 * The recorded narration of one lesson: one clip per step, kept for as long as the lesson is. A clip
 * that can't be had is 'failed', never thrown.
 *
 * `ahead` = how many steps past the one being played are asked for in advance. The voice model allows
 * only so many clips a day, so a lesson asks for the next couple, not all of them: a lesson that is
 * closed half-way never pays for its second half. Left out, every step is asked for at once.
 */
export class ClipSet {
  private states: ClipState[]
  private settled: (Promise<Clip | null> | undefined)[]
  private texts: string[]
  private load: (text: string) => Promise<Blob>
  private ahead: number
  private env: ClipEnv
  private disposed = false

  constructor(texts: string[], load: (text: string) => Promise<Blob>, env: ClipEnv = browserClipEnv, ahead = Infinity) {
    this.env = env
    this.texts = texts
    this.load = load
    this.ahead = ahead
    this.states = texts.map(() => ({ state: 'loading' }))
    this.settled = texts.map(() => undefined)
    this.reach(0)
  }

  /** Ask for `step`'s clip and the few after it, if they haven't been asked for yet. */
  private reach(step: number) {
    for (let i = Math.max(0, step); i <= step + this.ahead && i < this.texts.length; i++) {
      if (!this.settled[i]) this.settled[i] = this.fetchOne(i)
    }
  }

  private async fetchOne(i: number): Promise<Clip | null> {
    try {
      const text = this.texts[i]
      if (!text.trim()) throw new Error('nothing to say')
      const blob = await this.load(text)
      let durationMs: number | undefined
      try {
        durationMs = wavDurationMs(await blob.arrayBuffer())
      } catch {
        // not a WAV we can measure: the player asks the audio element instead
      }
      if (this.disposed) return null
      const clip: Clip = { url: this.env.makeUrl(blob), durationMs }
      this.states[i] = { state: 'ready', ...clip }
      return clip
    } catch {
      this.states[i] = { state: 'failed' }
      return null
    }
  }

  get(step: number): ClipState {
    if (!this.disposed) this.reach(step)
    return this.states[step] ?? { state: 'failed' }
  }

  /** The step's clip once its request is over: the clip, or null if there is none. */
  wait(step: number): Promise<Clip | null> {
    if (!this.disposed) this.reach(step)
    return this.settled[step] ?? Promise.resolve(null)
  }

  dispose() {
    this.disposed = true
    this.states.forEach((s, i) => {
      if (s.state === 'ready') this.env.revokeUrl(s.url)
      this.states[i] = { state: 'failed' }
    })
  }
}

export interface NarrateOptions {
  /** make no sound, but take as long as the narration would */
  muted?: boolean
  /** playback was started by a tap, so if the browser stays silent there is nothing more to wait for */
  trusted?: boolean
  /** the narration is starting now: how, and how long it will last (real for a recording, estimated otherwise) */
  onStart: (info: { mode: VoiceMode; durationMs: number }) => void
  /** the recording or the spoken narration is over. Never called in 'silent' mode: the caller times that itself */
  onEnd: () => void
  /** sound needs a tap first and none is behind this. The narration is dropped */
  onBlocked?: () => void
}

/** What the player asks of a voice. */
export interface StepVoice {
  unlock(): void
  begin(step: number, text: string, opts: NarrateOptions): void
  /** hold / carry on a recording in place (no effect in the other modes) */
  pause(): void
  resume(): void
  /** stop; nothing more is reported for the narration that was running */
  stop(): void
  setMuted(muted: boolean): void
  /** how far into the recording playback is, or null when no recording is playing */
  positionMs(): number | null
}

export interface VoiceDeps {
  /** the browser's own speech, used when there is no recording */
  narrator: Narrator
  audio?: AudioPort | null
  clips?: ClipSet | null
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** how long to wait for the first recording, and for a later one that isn't there yet */
  firstWaitMs?: number
  waitMs?: number
}

export const FIRST_WAIT_MS = 12_000
export const LATER_WAIT_MS = 2500

/**
 * Narrates a lesson's steps: the recording from the server when there is one, the browser's speech
 * when there isn't (the request failed, or is too slow), and silence on a timer when that can't
 * be had either. Whatever happens, `onStart` is followed by an end (or `onBlocked` is reported).
 */
export class LessonVoice implements StepVoice {
  private d: VoiceDeps
  private token = 0
  private mode: VoiceMode | null = null
  private muted = false
  private waitTimer: unknown = null
  /** a recording has played: later ones are only waited for briefly */
  private played = false
  /** the audio element refused to play even after a tap: don't try it again */
  private audioDead = false

  constructor(deps: VoiceDeps) {
    this.d = deps
  }

  unlock() {
    this.d.audio?.unlock()
  }

  begin(step: number, text: string, opts: NarrateOptions) {
    this.stop()
    const token = this.token
    const live = () => token === this.token
    this.muted = !!opts.muted
    const estimate = speechMs(text)
    const { narrator, audio, clips } = this.d

    const fallback = () => {
      if (!live()) return
      if (this.muted || !text.trim() || !narrator.canSpeak) {
        this.mode = 'silent'
        opts.onStart({ mode: 'silent', durationMs: estimate })
        return
      }
      this.mode = 'speech'
      opts.onStart({ mode: 'speech', durationMs: estimate })
      if (!live()) return
      narrator.speak(text, {
        trusted: opts.trusted,
        onEnd: () => live() && opts.onEnd(),
        onBlocked: opts.onBlocked && (() => live() && opts.onBlocked?.()),
      })
    }

    if (!audio || !clips || this.audioDead || !text.trim()) return fallback()

    const playClip = (clip: Clip) => {
      if (!live()) return
      let started = false
      audio.setMuted(this.muted)
      this.mode = 'audio'
      audio.play(clip.url, {
        onStart: (ms) => {
          if (!live() || started) return
          started = true
          this.played = true
          opts.onStart({ mode: 'audio', durationMs: clip.durationMs ?? ms ?? estimate })
        },
        onEnd: () => {
          if (!live()) return
          if (!started) opts.onStart({ mode: 'audio', durationMs: clip.durationMs ?? estimate })
          opts.onEnd()
        },
        onError: (blocked) => {
          if (!live()) return
          if (started) return opts.onEnd() // cut off part-way: move on
          this.mode = null
          if (blocked && !opts.trusted && opts.onBlocked) return opts.onBlocked()
          if (blocked) this.audioDead = true
          fallback()
        },
      })
    }

    const clip = clips.get(step)
    if (clip.state === 'ready') return playClip(clip)
    if (clip.state === 'failed') return fallback()
    const setTimer = this.d.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    const timer = setTimer(
      () => {
        if (!live() || this.waitTimer !== timer) return
        this.waitTimer = null
        fallback()
      },
      this.played ? (this.d.waitMs ?? LATER_WAIT_MS) : (this.d.firstWaitMs ?? FIRST_WAIT_MS),
    )
    this.waitTimer = timer
    void clips.wait(step).then((c) => {
      if (!live() || this.waitTimer !== timer) return
      this.clearWait()
      if (c) playClip(c)
      else fallback()
    })
  }

  pause() {
    if (this.mode === 'audio') this.d.audio?.pause()
  }

  resume() {
    if (this.mode === 'audio') this.d.audio?.resume()
  }

  stop() {
    this.token++
    this.clearWait()
    if (this.mode === 'audio') this.d.audio?.stop()
    if (this.mode === 'speech') this.d.narrator.stop()
    this.mode = null
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.d.audio?.setMuted(muted)
  }

  positionMs(): number | null {
    return this.mode === 'audio' && this.d.audio ? this.d.audio.positionMs() : null
  }

  private clearWait() {
    if (this.waitTimer === null) return
    const clear = this.d.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
    clear(this.waitTimer)
    this.waitTimer = null
  }
}
