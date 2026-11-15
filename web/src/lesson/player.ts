import type { Lesson } from '../contract'
import type { Narrator } from './speech'
import { motionAt, planStep, STEP_GAP_MS, stepProgress, type StepPlan } from './timing'

export interface PlayerSnapshot {
  step: number
  playing: boolean
  /** the last step has finished */
  ended: boolean
  muted: boolean
  /** play has been pressed (or auto-started) at least once */
  started: boolean
  /** the browser wouldn't speak without a tap: paused, waiting for one */
  needsTap: boolean
}

/** The lesson that is playing now. Starting another pauses it: there is one voice. */
let active: LessonPlayer | null = null

/**
 * Plays a lesson step by step. Time only moves through `tick(dt)` (called once per animation frame),
 * so the same code runs under a fake clock in tests. A step ends when its narration is over and its
 * animation has had its minimum time; then the next one starts by itself.
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
  private narrator: Narrator
  private narrationDone = false
  private doneAt = -1
  private trusted = false
  /** muted part-way through a step: the narration counts as over at this `elapsed` */
  private silentUntil = -1
  private listeners = new Set<() => void>()

  constructor(lesson: Lesson, narrator: Narrator, opts: { muted?: boolean; reveals?: (step: number) => boolean } = {}) {
    this.lesson = lesson
    this.narrator = narrator
    this.plans = lesson.steps.map((s, i) => planStep(s, { reveals: opts.reveals?.(i) ?? i === 0 }))
    this.snap = { step: 0, playing: false, ended: false, muted: !!opts.muted, started: false, needsTap: false }
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

  /** Something on screen is still changing, so frames are worth drawing. */
  get animating(): boolean {
    return this.snap.playing || this.sinceChange < 3000
  }

  /** `fromTap` = called inside a tap handler (the browser lets speech start then). */
  play(fromTap: boolean) {
    if (!this.lesson.steps.length) return
    if (fromTap) this.trusted = true
    if (this.snap.ended) return this.enter(0, true)
    if (this.snap.playing) return
    if (active && active !== this) active.pause()
    active = this
    if (!this.narrationDone) this.elapsed = 0 // the narration starts over, and the motion with it
    if (!this.snap.started) this.sinceChange = 0 // first play: the picture draws itself on
    this.set({ playing: true, started: true, needsTap: false })
    if (!this.narrationDone) this.narrate()
  }

  pause() {
    if (!this.snap.playing) return
    this.narrator.stop()
    if (active === this) active = null
    this.set({ playing: false })
  }

  toggle(fromTap: boolean) {
    if (this.snap.playing) this.pause()
    else this.play(fromTap)
  }

  next(fromTap = false) {
    if (fromTap) this.trusted = true
    if (this.snap.step < this.lesson.steps.length - 1) this.enter(this.snap.step + 1, this.snap.playing)
  }

  prev(fromTap = false) {
    if (fromTap) this.trusted = true
    // like a music player: back goes to the start of this step first, then to the one before
    const restart = this.elapsed > 1500 || this.snap.ended || this.snap.step === 0
    this.enter(restart ? this.snap.step : this.snap.step - 1, this.snap.playing)
  }

  goto(step: number, fromTap = false) {
    if (fromTap) this.trusted = true
    if (step < 0 || step >= this.lesson.steps.length) return
    this.enter(step, this.snap.playing)
  }

  replay(fromTap: boolean) {
    if (fromTap) this.trusted = true
    if (!this.lesson.steps.length) return
    this.enter(0, true)
  }

  setMuted(muted: boolean) {
    if (muted === this.snap.muted) return
    this.set({ muted })
    // the current step keeps its timing: finish it on a timer if it was being spoken, or the other way round
    if (this.snap.playing && !this.narrationDone) {
      if (muted) this.narrate(Math.max(300, this.plan.speechMs - this.elapsed))
      else if (this.elapsed < 1200) this.narrate()
    }
  }

  /** Advance time by `dt` ms. */
  tick(dt: number) {
    this.sinceChange += dt
    if (!this.snap.playing) return
    this.elapsed += dt
    if (this.silentUntil >= 0 && this.elapsed >= this.silentUntil) {
      this.silentUntil = -1
      this.narrationDone = true
    }
    if (!this.narrationDone) return
    if (this.doneAt < 0) this.doneAt = Math.max(this.elapsed, this.plan.minMs)
    if (this.elapsed < this.doneAt + STEP_GAP_MS) return
    if (this.snap.step < this.lesson.steps.length - 1) this.enter(this.snap.step + 1, true)
    else {
      if (active === this) active = null
      this.set({ playing: false, ended: true })
    }
  }

  dispose() {
    if (this.snap.playing) this.narrator.stop()
    if (active === this) active = null
    this.snap = { ...this.snap, playing: false }
  }

  private enter(step: number, playing: boolean) {
    if (playing) {
      if (active && active !== this) active.pause()
      active = this
    } else this.narrator.stop()
    if (step !== this.snap.step) {
      this.prevStep = this.snap.step
      this.sinceChange = 0
    }
    this.elapsed = 0
    this.narrationDone = false
    this.doneAt = -1
    this.silentUntil = -1
    this.set({ step, playing, ended: false, needsTap: false, started: this.snap.started || playing })
    if (playing) this.narrate()
  }

  /** Speak the current step (or, with `ms`, just wait that long in silence). */
  private narrate(ms?: number) {
    const step = this.snap.step
    const mine = () => this.snap.step === step && this.snap.playing
    this.narrationDone = false
    this.doneAt = -1
    if (ms !== undefined) {
      this.narrator.stop()
      this.silentUntil = this.elapsed + ms
      return
    }
    this.silentUntil = -1
    this.narrator.speak(this.lesson.steps[step].say ?? '', {
      muted: this.snap.muted,
      trusted: this.trusted,
      onEnd: () => {
        if (mine()) this.narrationDone = true
      },
      onBlocked: () => {
        if (!mine()) return
        // nothing was heard: go back to the start of the step and wait for a tap
        if (active === this) active = null
        this.elapsed = 0
        this.set({ playing: false, needsTap: true })
      },
    })
  }

  private set(patch: Partial<PlayerSnapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const fn of this.listeners) fn()
  }
}
