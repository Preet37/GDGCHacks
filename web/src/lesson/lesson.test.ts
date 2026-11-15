import { describe, expect, it, vi } from 'vitest'
import type { Lesson } from '../contract'
import example from '../../../contract/examples/lesson.json'
import {
  areaPolygon,
  areaUnder,
  buildScene,
  compileExpr,
  fmt,
  lerpView,
  markAt,
  markMoves,
  matchMarks,
  niceTicks,
  scenesFor,
  secantThrough,
  slopeAt,
  tangentAt,
} from './geometry'
import { LessonPlayer } from './player'
import { cleanLesson } from './render'
import { Narrator, pickVoice, START_TIMEOUT_MS, type SpeechEnv, type SynthLike, type UtteranceLike } from './speech'
import { easeInOut, motionAt, planStep, speechMs, splitCaption, STEP_GAP_MS } from './timing'

const lesson = (example.actions[0] as unknown as { lesson: Lesson }).lesson
const sq = compileExpr('x^2')!

describe('mark geometry', () => {
  it('compiles expressions and survives bad ones', () => {
    expect(sq(3)).toBe(9)
    expect(compileExpr('2x + 1')!(2)).toBe(5)
    expect(compileExpr('x^^')).toBeNull()
    expect(compileExpr('sqrt(x)')!(-1)).toBeNaN() // complex result: not a point on the plot
    expect(compileExpr('nope(x)')!(1)).toBeNaN()
  })

  it('finds the tangent slope numerically', () => {
    expect(slopeAt(sq, 1)).toBeCloseTo(2, 5)
    expect(slopeAt(sq, -2)).toBeCloseTo(-4, 5)
    expect(slopeAt(compileExpr('sin(x)')!, 0)).toBeCloseTo(1, 5)
    const t = tangentAt(sq, 2)!
    expect(t.y).toBe(4)
    expect(t.slope).toBeCloseTo(4, 5)
    expect(tangentAt(compileExpr('log(x)')!, -1)).toBeNull()
    // next to the edge of the domain the slope is taken from the side that exists
    expect(slopeAt(compileExpr('sqrt(x)')!, 0)).toBeGreaterThan(10)
  })

  it('draws the secant through two points and lets it settle into the tangent', () => {
    const s = secantThrough(sq, 1, 2.5)!
    expect([s.y, s.y2]).toEqual([1, 6.25])
    expect(s.slope).toBeCloseTo(3.5, 10)
    expect(secantThrough(sq, 1, 1.02)!.slope).toBeCloseTo(2.02, 6)
    expect(secantThrough(sq, 1, 1)!.slope).toBeCloseTo(2, 5) // no division by zero
    expect(secantThrough(compileExpr('1/x')!, 0, 1)).toBeNull()
  })

  it('builds the area polygon down to the axis', () => {
    const pts = areaPolygon(sq, 0, 2, 4)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[pts.length - 1]).toEqual([2, 0])
    expect(pts.slice(1, -1)).toEqual([
      [0, 0],
      [0.5, 0.25],
      [1, 1],
      [1.5, 2.25],
      [2, 4],
    ])
    expect(areaUnder(sq, 0, 2, 400)).toBeCloseTo(8 / 3, 3)
    expect(areaUnder(sq, 2, 0, 400)).toBeCloseTo(-8 / 3, 3)
    expect(areaPolygon(sq, 1, 1)).toHaveLength(3) // nothing to shade yet
    // undefined stretches are left out, not drawn as spikes
    expect(areaPolygon(compileExpr('sqrt(x)')!, -1, 1, 4).every(([, y]) => Number.isFinite(y))).toBe(true)
  })

  it('moves marks between their start and end', () => {
    const m = { type: 'secant', x: 1, x2: 2.5, to_x2: 1.02 } as const
    expect(markAt(m, 0)).toEqual({ x: 1, x2: 2.5 })
    expect(markAt(m, 1)).toEqual({ x: 1, x2: 1.02 })
    expect(markAt(m, 0.5).x2).toBeCloseTo(1.76)
    expect(markAt({ type: 'point', x: -2, to_x: 2 }, 0.25).x).toBe(-1)
    expect(markMoves(m)).toBe(true)
    expect(markMoves({ type: 'tangent', x: 1 })).toBe(false)
    expect(markMoves({ type: 'tangent', x: 1, to_x: 1 })).toBe(false)
  })

  it('carries marks over from the step before', () => {
    const a = [{ type: 'secant', x: 1, x2: 2 } as const, { type: 'point', x: 0 } as const]
    const b = [{ type: 'point', x: 1 } as const, { type: 'secant', x: 1, x2: 2, to_x2: 1 } as const, { type: 'point', x: 3 } as const]
    expect(matchMarks(a, b)).toEqual([1, 0, -1])
    expect(matchMarks(a, [{ type: 'secant', expr: 1, x: 1, x2: 2 }])).toEqual([-1])
  })

  it('picks round ticks and short numbers', () => {
    expect(niceTicks(-3, 3, 8)).toEqual([-3, -2, -1, 0, 1, 2, 3])
    expect(niceTicks(-1, 9, 6)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(0, 0.5, 5)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5])
    expect(niceTicks(1, 1)).toEqual([])
    expect(fmt(2)).toBe('2')
    expect(fmt(3.5)).toBe('3.5')
    expect(fmt(-0.0001)).toBe('0')
    expect(fmt(2.0199)).toBe('2.02')
    expect(fmt(10)).toBe('10')
  })
})

describe('scenes', () => {
  it('works out a y range when none is given, and skips bad expressions', () => {
    const s = buildScene({ kind: 'plot2d', expressions: ['x^2', 'x^^', 'sin(x)'], x_range: [-2, 2] })
    expect(s.curves.map((c) => !!c.fn)).toEqual([true, false, true])
    expect(s.view.y0).toBeLessThan(-0.9)
    expect(s.view.y1).toBeGreaterThan(4)
    const none = buildScene({ kind: 'plot2d', expressions: ['x^^'], x_range: [3, 3] })
    expect(none.view).toEqual({ x0: -5, x1: 5, y0: -5, y1: 5 })
  })

  it('keeps the last picture through steps that have none', () => {
    const scenes = scenesFor({
      title: 't',
      steps: [{ say: 'a' }, { say: 'b', visual: { kind: 'plot2d', expressions: ['x'], x_range: [0, 1] } }, { say: 'c' }],
    })
    expect(scenes[0]).toBeNull()
    expect(scenes[2]).toBe(scenes[1])
    expect(scenesFor(lesson)).toHaveLength(5)
  })

  it('tweens the axes between two views', () => {
    const a = { x0: -3, x1: 3, y0: -1, y1: 9 }
    const b = { x0: -3, x1: 3, y0: -6, y1: 9 }
    expect(lerpView(a, b, 0)).toEqual(a)
    expect(lerpView(a, b, 1)).toEqual(b)
    expect(lerpView(a, b, 0.5).y0).toBe(-3.5)
  })
})

describe('timing', () => {
  it('eases from 0 to 1 and clamps outside', () => {
    expect(easeInOut(-1)).toBe(0)
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBe(0.5)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(2)).toBe(1)
    expect(easeInOut(0.25)).toBeLessThan(0.25)
    expect(easeInOut(0.75)).toBeGreaterThan(0.75)
  })

  it('estimates narration length from the words', () => {
    expect(speechMs('')).toBe(1400)
    const short = speechMs('Here is the curve.')
    const long = speechMs(lesson.steps[3].say)
    expect(short).toBeGreaterThan(1500)
    expect(long).toBeGreaterThan(short * 3)
    expect(long).toBeLessThan(20000)
    expect(speechMs('one two three four', 2)).toBeLessThan(speechMs('one two three four'))
  })

  it('plans a step: motion fits inside the narration, and a step is never shorter than its animation', () => {
    const still = planStep(lesson.steps[0], { reveals: true })
    expect(still.moveMs).toBe(0)
    expect(still.minMs).toBeGreaterThanOrEqual(1500)

    const moving = planStep(lesson.steps[2])
    expect(moving.moveMs).toBeGreaterThanOrEqual(2200)
    expect(moving.moveStart + moving.moveMs).toBeLessThan(moving.speechMs)
    expect(moving.minMs).toBeGreaterThan(moving.moveStart + moving.moveMs)
    expect(motionAt(moving, 0)).toBe(0)
    expect(motionAt(moving, moving.moveStart)).toBe(0)
    expect(motionAt(moving, moving.moveStart + moving.moveMs / 2)).toBeCloseTo(0.5)
    expect(motionAt(moving, moving.minMs)).toBe(1)

    // a one-word narration still leaves room for the motion
    const terse = planStep({ say: 'Watch.', visual: lesson.steps[2].visual })
    expect(terse.minMs).toBeGreaterThan(terse.speechMs)
  })

  it('splits captions into words and math', () => {
    expect(splitCaption('The curve $y = x^2$')).toEqual([
      { math: false, text: 'The curve ' },
      { math: true, text: 'y = x^2' },
    ])
    expect(splitCaption('costs $5')).toEqual([{ math: false, text: 'costs $5' }])
    expect(splitCaption('$a$ and $b$').filter((p) => p.math)).toHaveLength(2)
    expect(splitCaption('')).toEqual([])
  })
})

/** A fake clock and a fake speechSynthesis. */
function fakeEnv(mode: 'none' | 'works' | 'never-starts' | 'throws' | 'not-allowed') {
  let now = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const spoken: UtteranceLike[] = []
  const synth: SynthLike = {
    speaking: false,
    pending: false,
    getVoices: () => [],
    cancel: vi.fn(),
    speak(u) {
      if (mode === 'throws') throw new Error('boom')
      spoken.push(u)
      if (mode === 'works') u.onstart?.({})
      if (mode === 'not-allowed') u.onerror?.({ error: 'not-allowed' })
    },
  }
  const env: SpeechEnv = {
    synth: mode === 'none' ? undefined : synth,
    makeUtterance:
      mode === 'none' ? undefined : (text) => ({ text, lang: '', rate: 1, volume: 1, voice: null, onstart: null, onend: null, onerror: null }),
    setTimer: (fn, ms) => {
      timers.set(++seq, { at: now + ms, fn })
      return seq
    },
    clearTimer: (h) => void timers.delete(h as number),
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, t] of [...timers]) {
      if (t.at <= now && timers.delete(id)) t.fn()
    }
  }
  return { env, synth, spoken, advance }
}

describe('narration', () => {
  const text = 'Pick two points on the curve and join them.'

  it('advances on a timer when the browser has no speech', () => {
    const f = fakeEnv('none')
    const n = new Narrator(f.env)
    const onEnd = vi.fn()
    n.speak(text, { onEnd })
    f.advance(speechMs(text) - 1)
    expect(onEnd).not.toHaveBeenCalled()
    f.advance(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('keeps the same timing when muted, without speaking', () => {
    const f = fakeEnv('works')
    const onEnd = vi.fn()
    new Narrator(f.env).speak(text, { muted: true, onEnd })
    expect(f.spoken).toHaveLength(0)
    f.advance(speechMs(text))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('ends when the utterance ends, once', () => {
    const f = fakeEnv('works')
    const onEnd = vi.fn()
    new Narrator(f.env).speak(text, { onEnd })
    expect(f.spoken[0].text).toBe(text)
    f.advance(900)
    f.spoken[0].onend?.({})
    f.spoken[0].onend?.({})
    f.advance(60_000)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('does not wait for ever for an end event that never comes', () => {
    const f = fakeEnv('works')
    const onEnd = vi.fn()
    new Narrator(f.env).speak(text, { onEnd })
    f.advance(speechMs(text) * 2 + 4000)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('reports speech that needs a tap, and carries on in silence if a tap was already behind it', () => {
    const f = fakeEnv('never-starts')
    const n = new Narrator(f.env)
    const onEnd = vi.fn()
    const onBlocked = vi.fn()
    n.speak(text, { onEnd, onBlocked })
    f.advance(START_TIMEOUT_MS)
    expect(onBlocked).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    expect(n.silent).toBe(false) // a tap may still unlock it

    n.speak(text, { trusted: true, onEnd, onBlocked })
    f.advance(START_TIMEOUT_MS)
    expect(onBlocked).toHaveBeenCalledTimes(1)
    expect(n.silent).toBe(true)
    f.advance(speechMs(text))
    expect(onEnd).toHaveBeenCalledTimes(1)
    // from now on: timers only
    n.speak(text, { trusted: true, onEnd })
    expect(f.spoken).toHaveLength(2)
  })

  it('treats "not-allowed" as blocked straight away, and a throwing speak() as silence', () => {
    const a = fakeEnv('not-allowed')
    const onBlocked = vi.fn()
    new Narrator(a.env).speak(text, { onEnd: vi.fn(), onBlocked })
    expect(onBlocked).toHaveBeenCalledTimes(1)

    const b = fakeEnv('throws')
    const onEnd = vi.fn()
    new Narrator(b.env).speak(text, { onEnd })
    b.advance(speechMs(text))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('stop() silences the pending end', () => {
    const f = fakeEnv('works')
    const n = new Narrator(f.env)
    const onEnd = vi.fn()
    n.speak(text, { onEnd })
    f.synth.speaking = true
    n.stop()
    expect(f.synth.cancel).toHaveBeenCalled()
    f.spoken[0].onend?.({})
    f.advance(60_000)
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('picks a plain English voice, or leaves it to the browser', () => {
    const voices = [
      { name: 'Zarvox', lang: 'en-US', localService: true },
      { name: 'Thomas', lang: 'fr-FR', localService: true, default: true },
      { name: 'Daniel', lang: 'en-GB', localService: true },
      { name: 'Samantha', lang: 'en-US', localService: true },
      { name: 'Fred', lang: 'en-US', localService: true },
    ]
    expect(pickVoice(voices)?.name).toBe('Samantha')
    expect(pickVoice(voices.slice(0, 3))?.name).toBe('Daniel')
    expect(pickVoice(voices.slice(0, 2))).toBeNull()
    expect(pickVoice([{ name: 'Whoever', lang: 'en_AU' }])?.name).toBe('Whoever')
    expect(pickVoice([])).toBeNull()
  })
})

describe('player', () => {
  /** Run the player and the narrator's timers together, a frame at a time. */
  function run(p: LessonPlayer, f: ReturnType<typeof fakeEnv>, ms: number) {
    for (let t = 0; t < ms; t += 50) {
      f.advance(50)
      p.tick(50)
    }
  }

  it('plays every step in turn, each for at least its narration and its animation, then stops', () => {
    const f = fakeEnv('none')
    const p = new LessonPlayer(lesson, new Narrator(f.env))
    expect(p.snapshot).toMatchObject({ step: 0, playing: false, started: false })
    p.play(true)
    const seen: number[] = []
    let total = 0
    for (let i = 0; i < 5; i++) {
      expect(p.snapshot.step).toBe(i)
      const plan = p.plans[i]
      const least = Math.max(plan.speechMs, plan.minMs)
      run(p, f, least - 100)
      expect(p.snapshot.step).toBe(i) // not early
      run(p, f, STEP_GAP_MS + 300)
      seen.push(p.snapshot.step)
      total += least
    }
    expect(seen).toEqual([1, 2, 3, 4, 4])
    expect(p.snapshot).toMatchObject({ playing: false, ended: true })
    expect(p.motion).toBe(1)
    expect(total).toBeGreaterThan(20_000)
    p.play(true) // play after the end starts over
    expect(p.snapshot).toMatchObject({ step: 0, playing: true, ended: false })
  })

  it('moves the marks only while playing, and pause stops the voice', () => {
    const f = fakeEnv('works')
    const p = new LessonPlayer(lesson, new Narrator(f.env))
    p.goto(2)
    expect(p.snapshot).toMatchObject({ step: 2, playing: false })
    run(p, f, 5000)
    expect(p.motion).toBe(0)
    p.play(true)
    expect(f.spoken.at(-1)?.text).toBe(lesson.steps[2].say)
    run(p, f, p.plan.moveStart + p.plan.moveMs / 2)
    expect(p.motion).toBeGreaterThan(0.3)
    expect(p.motion).toBeLessThan(0.7)
    f.synth.speaking = true
    p.pause()
    expect(f.synth.cancel).toHaveBeenCalled()
    const at = p.motion
    run(p, f, 3000)
    expect(p.motion).toBe(at)
    // the step does not end until the voice has: the utterance never ended here
    p.play(true)
    run(p, f, p.plan.minMs + 1000)
    expect(p.snapshot.step).toBe(2)
    f.spoken.at(-1)?.onend?.({})
    run(p, f, STEP_GAP_MS + 100)
    expect(p.snapshot.step).toBe(3)
  })

  it('waits for a tap when the browser will not speak yet, then plays', () => {
    const f = fakeEnv('never-starts')
    const p = new LessonPlayer(lesson, new Narrator(f.env))
    p.play(false) // started by the lesson arriving, not by a tap
    run(p, f, START_TIMEOUT_MS + 100)
    expect(p.snapshot).toMatchObject({ step: 0, playing: false, needsTap: true })
    expect(p.elapsed).toBe(0)
    p.play(true)
    expect(p.snapshot).toMatchObject({ playing: true, needsTap: false })
    run(p, f, START_TIMEOUT_MS + p.plans[0].speechMs + p.plans[0].minMs)
    expect(p.snapshot.step).toBe(1) // silent, but it plays
  })

  it('mute keeps the timing', () => {
    const f = fakeEnv('works')
    const p = new LessonPlayer(lesson, new Narrator(f.env))
    p.play(true)
    run(p, f, 2000)
    p.setMuted(true)
    expect(p.snapshot.muted).toBe(true)
    run(p, f, p.plans[0].speechMs - 2000 - 200)
    expect(p.snapshot.step).toBe(0)
    run(p, f, STEP_GAP_MS + 400)
    expect(p.snapshot.step).toBe(1)
    expect(f.spoken).toHaveLength(1) // the next step is not spoken
  })

  it('starting one lesson pauses the other', () => {
    const f = fakeEnv('works')
    const n = new Narrator(f.env)
    const a = new LessonPlayer(lesson, n)
    const b = new LessonPlayer(lesson, n)
    a.play(true)
    b.play(true)
    expect(a.snapshot.playing).toBe(false)
    expect(b.snapshot.playing).toBe(true)
    b.dispose()
    expect(b.snapshot.playing).toBe(false)
  })

  it('previous restarts the step first, then goes back', () => {
    const f = fakeEnv('none')
    const p = new LessonPlayer(lesson, new Narrator(f.env))
    p.goto(2)
    p.play(true)
    run(p, f, 2000)
    p.prev()
    expect(p.snapshot.step).toBe(2)
    expect(p.elapsed).toBe(0)
    p.prev()
    expect(p.snapshot.step).toBe(1)
    expect(p.prevStep).toBe(2)
    p.next()
    p.next()
    p.next()
    p.next()
    expect(p.snapshot.step).toBe(4)
  })
})

describe('cleaning a lesson', () => {
  it('keeps only what the player understands', () => {
    const dirty = {
      title: 'T',
      extra: 1,
      steps: [
        null,
        { say: 'hello', write: '  ', junk: true, visual: { kind: 'plot2d', expressions: ['x', 3], x_range: ['-1', 2], x_log: 'yes', marks: [{ type: 'tangent', x: 1, to_x: 'far' }, { type: 'wiggle' }, null] } },
        {},
      ],
    } as unknown as Lesson
    expect(cleanLesson(dirty)).toEqual({
      title: 'T',
      steps: [{ say: 'hello', visual: { kind: 'plot2d', expressions: ['x', '3'], x_range: [-1, 2], marks: [{ type: 'tangent', x: 1 }] } }],
    })
    expect(cleanLesson({ title: 'x', steps: [] })).toBeNull()
    expect(cleanLesson(undefined)).toBeNull()
    expect(cleanLesson(lesson)).toEqual(lesson)
  })
})
