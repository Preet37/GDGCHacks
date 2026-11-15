import type { Lesson } from '../contract'
import { Narrator } from './speech'
import { clamp01, motionAt, planStep, STEP_GAP_MS, stepProgress, type StepPlan } from './timing'
import { LessonVoice, type StepVoice, type VoiceMode } from './voice'

export interface PlayerSnapshot {
  step: number
  playing: boolean
  /** the last step has finished */
  ended: boolean
  muted: boolean
  /** play has been pressed (or auto-started) at least once */
  started: boolean
  /** the browser wouldn't make a sound without a tap: paused, waiting for one */
  needsTap: boolean
  /** playing, but still waiting for this step's recorded voice to arrive */
  loading: boolean
  /** how the current step is being narrated (null until its narration starts) */
  voice: VoiceMode | null
}

/** The lesson that is playing now. Starting another pauses it: there is one voice. */
let active: LessonPlayer | null = null

/** A recording that reports no progress for this long is not playing: the step carries on without it. */
const STALL_MS = 3000

/**
 * Plays a lesson step by step. Time only moves through `tick(dt)` (called once per animation frame),
 * so the same code runs under a fake clock in tests. A step lasts as long as its narration (the real
 * length of the recording when there is one) and never less than its animation; then the next one
 * starts by itself. Pausing holds a recording where it is; the browser's own speech can't be held,
 * so that starts the step's narration again.
 */
export class LessonPlayer {
  readonly lesson: Lesson
  readonly plans: StepPlan[]
  /** ms of play in the current step */
  elapsed = 0
  /** ms since the step last changed, running or not (drives transitions between pictures) */
  sinceChange = 1e9
  /** the step shown before this one, for transitions (-1 = none) */
  prevStep = -1
  private snap: PlayerSnapshot
  private voice: StepVoice
  private reveals: (step: number) => boolean
  /** the current step's narration: not begun, waiting for the recording, being said, over */
  private phase: 'idle' | 'waiting' | 'speaking' | 'done' = 'idle'
  /** how long the current step's narration is (ms), once it has started */
  private narrMs = 0
  private narrId = 0
  private doneAt = -1
  private trusted = false
  private lastPos = -1
  private stalled = 0
  private listeners = new Set<() => void>()

  constructor(lesson: Lesson, voice: StepVoice | Narrator, opts: { muted?: boolean; reveals?: (step: number) => boolean } = {}) {
    this.lesson = lesson
    this.voice = voice instanceof Narrator ? new LessonVoice({ narrator: voice }) : voice
    this.reveals = opts.reveals ?? ((i) => i === 0)
    this.plans = lesson.steps.map((s, i) => planStep(s, { reveals: this.reveals(i) }))
    this.snap = { step: 0, playing: false, ended: false, muted: !!opts.muted, started: false, needsTap: false, loading: false, voice: null }
  }

  get snapshot(): PlayerSnapshot {
    return this.snap
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  get plan(): StepPlan {
    return this.plans[this.snap.step]
  }

  /** 0..1 eased position of the current step's moving marks. */
  get motion(): number {
    if (this.snap.ended) return 1
    return motionAt(this.plan, this.elapsed)
  }

  /** 0..1 of the current step played. */
  get progress(): number {
    if (this.snap.ended) return 1
    return stepProgress(this.plan, this.elapsed)
  }

  /** 0..1 of the current step's narration said (drives the subtitles). */
  get narration(): number {
    if (this.snap.ended || this.phase === 'done') return 1
    if (this.phase !== 'speaking' || this.narrMs <= 0) return 0
    return clamp01(this.elapsed / this.narrMs)
  }

  /** Something on screen is still changing, so frames are worth drawing. */
  get animating(): boolean {
    return this.snap.playing || this.sinceChange < 3000
  }

  /** `fromTap` = called inside a tap handler (the browser lets sound start then). */
  play(fromTap: boolean) {
    if (!this.lesson.steps.length) return
    if (fromTap) this.tapped()
    if (this.snap.ended) return this.enter(0, true)
    if (this.snap.playing) return
    if (active && active !== this) active.pause()
    active = this
    if (!this.snap.started) this.sinceChange = 0 // first play: the picture draws itself on
    this.set({ playing: true, started: true, needsTap: false })
    if (this.phase === 'idle') {
      this.elapsed = 0 // the narration starts (over), and the motion with it
      this.narrate()
    } else if (this.phase === 'speaking') this.voice.resume()
  }

  pause() {
    if (!this.snap.playing) return
    if (this.phase === 'speaking' && this.snap.voice === 'audio') this.voice.pause()
    else if (this.phase === 'speaking' && this.snap.voice === 'silent') {
      // nothing is sounding: time simply stops
    } else if (this.phase !== 'done') {
      // waiting for the voice, or the browser's speech (which can't be held): begin again on play
      this.narrId++
      this.voice.stop()
      this.phase = 'idle'
    }
    if (active === this) active = null
    this.set({ playing: false, loading: false })
  }

  toggle(fromTap: boolean) {
    if (this.snap.playing) this.pause()
    else this.play(fromTap)
  }

  next(fromTap = false) {
    if (fromTap) this.tapped()
    if (this.snap.step < this.lesson.steps.length - 1) this.enter(this.snap.step + 1, this.snap.playing)
  }

  prev(fromTap = false) {
    if (fromTap) this.tapped()
    // like a music player: back goes to the start of this step first, then to the one before
    const restart = this.elapsed > 1500 || this.snap.ended || this.snap.step === 0
    this.enter(restart ? this.snap.step : this.snap.step - 1, this.snap.playing)
  }

  goto(step: number, fromTap = false) {
    if (fromTap) this.tapped()
    if (step < 0 || step >= this.lesson.steps.length) return
    this.enter(step, this.snap.playing)
  }

  replay(fromTap: boolean) {
    if (fromTap) this.tapped()
    if (!this.lesson.steps.length) return
    this.enter(0, true)
  }

  setMuted(muted: boolean) {
    if (muted === this.snap.muted) return
    this.voice.setMuted(muted) // a recording goes on playing, unheard: its timing is untouched
    const mode = this.snap.voice
    this.set({ muted })
    if (!this.snap.playing || this.phase !== 'speaking') return
    if (muted && mode === 'speech') {
      // the browser's speech can only be cut: see the step out on a timer instead
      this.voice.stop()
      this.narrMs = Math.max(this.elapsed + 300, this.narrMs)
      this.set({ voice: 'silent' })
    } else if (!muted && mode === 'silent' && this.elapsed < 1200) {
      // barely begun in silence: say it after all
      this.elapsed = 0
      this.narrate()
    }
  }

  /** Advance time by `dt` ms. */
  tick(dt: number) {
    this.sinceChange += dt
    if (!this.snap.playing || this.phase === 'idle' || this.phase === 'waiting') return
    this.elapsed += dt
    if (this.phase === 'speaking') {
      const mode = this.snap.voice
      if (mode === 'audio') this.followRecording(dt)
      // silence is timed here; a recording whose end was never reported is not waited for for ever
      if (mode === 'silent' ? this.elapsed >= this.narrMs : mode === 'audio' && this.elapsed > this.narrMs + 1500) this.endNarration()
      if (this.phase === 'speaking') return
    }
    if (this.doneAt < 0) this.doneAt = Math.max(this.elapsed, this.plan.minMs)
    if (this.elapsed < this.doneAt + STEP_GAP_MS) return
    if (this.snap.step < this.lesson.steps.length - 1) this.enter(this.snap.step + 1, true)
    else {
      if (active === this) active = null
      this.phase = 'idle'
      this.set({ playing: false, ended: true })
    }
  }

  dispose() {
    this.narrId++
    this.voice.stop()
    this.phase = 'idle'
    if (active === this) active = null
    this.snap = { ...this.snap, playing: false, loading: false }
  }

  private tapped() {
    this.trusted = true
    this.voice.unlock()
  }

  /** Keep `elapsed` on the recording's own clock, so pictures and subtitles stay with the sound. */
  private followRecording(dt: number) {
    const pos = this.voice.positionMs()
    if (pos === null) return
    if (pos !== this.lastPos) {
      this.lastPos = pos
      this.stalled = 0
      if (Math.abs(pos - this.elapsed) > 250) this.elapsed = pos
      return
    }
    this.stalled += dt
    this.elapsed = Math.min(this.elapsed, pos + 250) // the sound is not moving: nor does the step
    if (this.stalled > STALL_MS) {
      // it is never going to play: finish the step in silence
      this.voice.stop()
      this.set({ voice: 'silent' })
    }
  }

  private endNarration() {
    this.phase = 'done'
    this.doneAt = -1
  }

  private enter(step: number, playing: boolean) {
    if (playing) {
      if (active && active !== this) active.pause()
      active = this
    }
    this.narrId++
    this.voice.stop()
    if (step !== this.snap.step) {
      this.prevStep = this.snap.step
      this.sinceChange = 0
    }
    this.elapsed = 0
    this.phase = 'idle'
    this.doneAt = -1
    this.set({ step, playing, ended: false, needsTap: false, loading: false, voice: null, started: this.snap.started || playing })
    if (playing) this.narrate()
  }

  /** Start the current step's narration. Time stands still until the voice says it has started. */
  private narrate() {
    const step = this.snap.step
    const id = ++this.narrId
    const mine = () => id === this.narrId
    this.phase = 'waiting'
    this.doneAt = -1
    this.lastPos = -1
    this.stalled = 0
    this.voice.begin(step, this.lesson.steps[step].say ?? '', {
      muted: this.snap.muted,
      trusted: this.trusted,
      onStart: ({ mode, durationMs }) => {
        if (!mine()) return
        this.phase = 'speaking'
        this.narrMs = durationMs
        // the animation spans the narration as it really is, not as it was guessed
        if (mode === 'audio') this.plans[step] = planStep(this.lesson.steps[step], { reveals: this.reveals(step), speechMs: durationMs })
        this.elapsed = 0
        this.set({ loading: false, voice: mode })
      },
      onEnd: () => {
        if (mine() && this.phase === 'speaking') this.endNarration()
      },
      onBlocked: () => {
        if (!mine()) return
        // nothing was heard: go back to the start of the step and wait for a tap
        this.narrId++
        this.voice.stop()
        if (active === this) active = null
        this.elapsed = 0
        this.phase = 'idle'
        this.set({ playing: false, needsTap: true, loading: false, voice: null })
      },
    })
    if (mine() && this.phase === 'waiting') this.set({ loading: true, voice: null })
  }

  private set(patch: Partial<PlayerSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const fn of this.listeners) fn()
  }
}
