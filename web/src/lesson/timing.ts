import type { LessonStep } from '../contract'
import { markMoves } from './geometry'

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

export function easeInOut(t: number): number {
  const c = clamp01(t)
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2
}

export function easeOut(t: number): number {
  return 1 - (1 - clamp01(t)) ** 3
}

/** Progress 0..1 of something that starts at `start` ms and lasts `dur` ms. */
export function span(t: number, start: number, dur: number): number {
  return dur <= 0 ? (t >= start ? 1 : 0) : clamp01((t - start) / dur)
}

/** How long a new curve takes to draw on, and the gap between two that appear together. */
export const REVEAL_MS = 1100
export const REVEAL_STAGGER_MS = 350
/** Axes tween and marks carried over from the last step settle in this long. */
export const TWEEN_MS = 700
export const FADE_MS = 400
/** Pause between the end of one step and the start of the next. */
export const STEP_GAP_MS = 550

const MS_PER_WORD = 370

/** About how long it takes to say `text` out loud (also how long a silent step stays up). */
export function speechMs(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const pauses = (text.match(/[.!?:;]/g) ?? []).length * 280 + (text.match(/,/g) ?? []).length * 140
  return Math.max(1400, Math.round((500 + words * MS_PER_WORD + pauses) / Math.max(0.5, rate)))
}

export interface StepPlan {
  /** estimated length of the narration */
  speechMs: number
  /** when the marks start to move, and for how long (0 = nothing moves) */
  moveStart: number
  moveMs: number
  /** the step never ends before this, however short the narration */
  minMs: number
}

/**
 * Timing of one step. Motion waits for the picture to settle, then runs for most of the narration,
 * finishing a little before the talking does. A step without motion still stays long enough to read.
 */
export function planStep(step: LessonStep, opts: { reveals?: boolean; rate?: number } = {}): StepPlan {
  const speech = speechMs(step.say ?? '', opts.rate)
  const moves = (step.visual?.marks ?? []).some(markMoves)
  const moveStart = opts.reveals ? REVEAL_MS + 300 : 900
  const moveMs = moves ? Math.min(9000, Math.max(2200, speech - moveStart - 900)) : 0
  const settle = opts.reveals ? REVEAL_MS + 900 : 1500
  const minMs = moves ? moveStart + moveMs + 700 : settle
  return { speechMs: speech, moveStart, moveMs, minMs }
}

/** Eased 0..1 position of the step's moving marks after `elapsed` ms of play. */
export function motionAt(plan: StepPlan, elapsed: number): number {
  if (!plan.moveMs) return elapsed > 0 ? 1 : 0
  return easeInOut(span(elapsed, plan.moveStart, plan.moveMs))
}

/** Fraction of the step that has played, for the progress dot. */
export function stepProgress(plan: StepPlan, elapsed: number): number {
  return clamp01(elapsed / Math.max(plan.minMs, plan.speechMs))
}

/** Caption text split into plain and `$math$` runs. An unpaired `$` stays as text. */
export function splitCaption(text: string): { math: boolean; text: string }[] {
  const out: { math: boolean; text: string }[] = []
  const re = /\$([^$]+)\$/g
  let at = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ math: false, text: text.slice(at, m.index) })
    out.push({ math: true, text: m[1] })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ math: false, text: text.slice(at) })
  return out
}
