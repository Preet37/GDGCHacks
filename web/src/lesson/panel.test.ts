import { describe, expect, it, vi } from 'vitest'
import type { Lesson } from '../contract'
import example from '../../../contract/examples/lesson.json'
import { silentWav, wavDurationMs, type AudioCallbacks, type AudioPort } from './audio'
import { buildScene, lerpView, logLabel, logTicks, markAt, sampleXs, xAtFrac, xFrac, type View } from './geometry'
import { cameraFor, canvasInsets, dockLayout, focusRect, markerSize, markerSpot } from './layout'
import { LessonPlayer } from './player'
import { cleanLesson } from './render'
import { Narrator, type SpeechEnv, type SynthLike, type UtteranceLike } from './speech'
import { planStep, speechMs, STEP_GAP_MS, sweepPlan, wordsSpoken } from './timing'
import { ClipSet, LessonVoice, type NarrateOptions } from './voice'

const lesson = example.actions[0].lesson as Lesson

/** A clock, a speech synthesiser and an audio element, all fake and all on the same time. */
function rig(opts: { speech?: boolean; blockAudio?: boolean } = {}) {
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
      spoken.push(u)
      u.onstart?.({})
    },
  }
  const env: SpeechEnv = {
    synth: opts.speech === false ? undefined : synth,
    makeUtterance:
      opts.speech === false ? undefined : (text) => ({ text, lang: '', rate: 1, volume: 1, voice: null, onstart: null, onend: null, onerror: null }),
    setTimer: (fn, ms) => {
      timers.set(++seq, { at: now + ms, fn })
      return seq
    },
    clearTimer: (h) => void timers.delete(h as number),
  }

  /** The audio element: plays a "clip" whose url is its length in ms. */
  const audio = {
    blocked: !!opts.blockAudio,
    unlocked: 0,
    url: null as string | null,
    cb: null as AudioCallbacks | null,
    pos: 0,
    paused: false,
    muted: false,
    plays: [] as string[],
    unlock() {
      this.unlocked++
      this.blocked = false
    },
    play(url: string, cb: AudioCallbacks) {
      if (this.blocked) return cb.onError(true)
      this.plays.push(url)
      this.url = url
      this.cb = cb
      this.pos = 0
      this.paused = false
      cb.onStart(Number(url))
    },
    pause() {
      this.paused = true
    },
    resume() {
      this.paused = false
    },
    stop() {
      this.url = null
      this.cb = null
    },
    setMuted(m: boolean) {
      this.muted = m
    },
    positionMs() {
      return this.pos
    },
  }
  const port: AudioPort = audio

  const advance = (ms: number) => {
    now += ms
    for (const [id, t] of [...timers]) if (t.at <= now && timers.delete(id)) t.fn()
    if (audio.url && !audio.paused) {
      const length = Number(audio.url)
      audio.pos = Math.min(length, audio.pos + ms)
      if (audio.pos >= length) {
        const cb = audio.cb
        audio.url = null
        audio.cb = null
        cb?.onEnd()
      }
    }
  }
  const narrator = new Narrator(env)
  return { env, synth, spoken, audio, port, narrator, advance }
}

/** Clips whose "blob" carries its own length; `fetches` lets a test settle each request by hand. */
function fakeClips(texts: string[], lengthMs = 4000) {
  const fetches: { text: string; ok: () => void; fail: () => void }[] = []
  const clips = new ClipSet(
    texts,
    (text) =>
      new Promise<Blob>((resolve, reject) => {
        fetches.push({ text, ok: () => resolve({ arrayBuffer: async () => new ArrayBuffer(0), lengthMs } as unknown as Blob), fail: () => reject(new Error('503')) })
      }),
    { makeUrl: (b) => String((b as unknown as { lengthMs: number }).lengthMs), revokeUrl: vi.fn() },
  )
  return { clips, fetches }
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('the recorded voice', () => {
  const says = lesson.steps.map((s) => s.say)

  it('asks for every step at once and keeps what comes back', async () => {
    const { clips, fetches } = fakeClips(says)
    expect(fetches.map((f) => f.text)).toEqual(says)
    expect(clips.get(0)).toEqual({ state: 'loading' })
    fetches[2].ok()
    fetches[1].fail()
    await flush()
    expect(clips.get(2)).toMatchObject({ state: 'ready', url: '4000' })
    expect(clips.get(1)).toEqual({ state: 'failed' })
    expect(await clips.wait(1)).toBeNull()
    expect(clips.get(0)).toEqual({ state: 'loading' })
    // a step with nothing to say is never asked for
    expect(fakeClips(['', 'hi']).fetches.map((f) => f.text)).toEqual(['hi'])
  })

  it('reads the length of a WAV from its header', () => {
    expect(wavDurationMs(silentWav(500, 8000).buffer as ArrayBuffer)).toBeCloseTo(500)
    // a streamed file that never filled in its data size: what follows the header is the sound
    const open = silentWav(250, 8000)
    new DataView(open.buffer).setUint32(40, 0xffffffff, true)
    expect(wavDurationMs(open.buffer as ArrayBuffer)).toBeCloseTo(250)
    expect(wavDurationMs(new ArrayBuffer(10))).toBeUndefined()
    expect(wavDurationMs(new TextEncoder().encode('{"error":"tts_failed"}'.padEnd(60)).buffer as ArrayBuffer)).toBeUndefined()
  })

  function starts() {
    const log: string[] = []
    const opts: NarrateOptions = {
      onStart: (i) => log.push(`start:${i.mode}:${Math.round(i.durationMs)}`),
      onEnd: () => log.push('end'),
      onBlocked: () => log.push('blocked'),
    }
    return { log, opts }
  }

  it('plays the recording when it is ready, and waits for one that is on its way', async () => {
    const r = rig()
    const { clips, fetches } = fakeClips(says, 5200)
    const voice = new LessonVoice({ narrator: r.narrator, audio: r.port, clips, setTimer: r.env.setTimer, clearTimer: r.env.clearTimer })
    const { log, opts } = starts()
    voice.begin(0, says[0], opts)
    expect(log).toEqual([]) // nothing yet: the caller shows that the voice is loading
    r.advance(2000)
    fetches[0].ok()
    await flush()
    expect(log).toEqual(['start:audio:5200'])
    expect(r.spoken).toHaveLength(0)
    r.advance(5200)
    expect(log).toEqual(['start:audio:5200', 'end'])
  })

  it('falls back to the browser voice when the request fails, and to silence when there is none', async () => {
    const r = rig()
    const { clips, fetches } = fakeClips(says)
    const voice = new LessonVoice({ narrator: r.narrator, audio: r.port, clips, setTimer: r.env.setTimer, clearTimer: r.env.clearTimer })
    const a = starts()
    voice.begin(0, says[0], a.opts)
    fetches[0].fail()
    await flush()
    expect(a.log).toEqual([`start:speech:${speechMs(says[0])}`])
    expect(r.spoken[0].text).toBe(says[0])
    expect(r.audio.plays).toHaveLength(0)
    r.spoken[0].onend?.({})
    expect(a.log.at(-1)).toBe('end')

    const mute = rig({ speech: false })
    const none = fakeClips(says)
    none.fetches.forEach((f) => f.fail())
    await flush()
    const b = starts()
    new LessonVoice({ narrator: mute.narrator, audio: mute.port, clips: none.clips }).begin(1, says[1], b.opts)
    expect(b.log).toEqual([`start:silent:${speechMs(says[1])}`]) // the player times it; no end is reported
  })

  it('waits long for the first recording, only briefly for a later one, then falls back', async () => {
    const r = rig()
    const { clips, fetches } = fakeClips(says)
    const voice = new LessonVoice({ narrator: r.narrator, audio: r.port, clips, setTimer: r.env.setTimer, clearTimer: r.env.clearTimer, firstWaitMs: 10_000, waitMs: 2000 })
    fetches[0].ok()
    await flush()
    const a = starts()
    voice.begin(0, says[0], a.opts)
    expect(a.log).toEqual(['start:audio:4000'])
    const b = starts()
    voice.begin(1, says[1], b.opts) // step 2 is not there yet
    r.advance(1900)
    expect(b.log).toEqual([])
    r.advance(100)
    expect(b.log).toEqual([`start:speech:${speechMs(says[1])}`])
    // the recording turning up afterwards changes nothing
    fetches[1].ok()
    await flush()
    expect(r.audio.plays).toEqual(['4000'])

    const slow = rig()
    const late = fakeClips(says)
    const first = starts()
    new LessonVoice({ narrator: slow.narrator, audio: slow.port, clips: late.clips, setTimer: slow.env.setTimer, clearTimer: slow.env.clearTimer, firstWaitMs: 10_000, waitMs: 2000 }).begin(0, says[0], first.opts)
    slow.advance(9000)
    expect(first.log).toEqual([])
    slow.advance(1000)
    expect(first.log[0]).toMatch(/^start:speech/)
  })

  it('asks for a tap when sound is blocked, and uses the recording once there has been one', async () => {
    const r = rig({ blockAudio: true })
    const { clips, fetches } = fakeClips(says)
    fetches.forEach((f) => f.ok())
    await flush()
    const voice = new LessonVoice({ narrator: r.narrator, audio: r.port, clips })
    const a = starts()
    voice.begin(0, says[0], a.opts)
    expect(a.log).toEqual(['blocked'])
    expect(r.spoken).toHaveLength(0)
    voice.unlock() // the tap
    const b = starts()
    voice.begin(0, says[0], { ...b.opts, trusted: true })
    expect(b.log).toEqual(['start:audio:4000'])
  })

  it('stop() silences whatever was pending', async () => {
    const r = rig()
    const { clips, fetches } = fakeClips(says)
    const voice = new LessonVoice({ narrator: r.narrator, audio: r.port, clips, setTimer: r.env.setTimer, clearTimer: r.env.clearTimer })
    const a = starts()
    voice.begin(0, says[0], a.opts)
    voice.stop()
    fetches[0].ok()
    await flush()
    r.advance(60_000)
    expect(a.log).toEqual([])
    expect(r.audio.plays).toHaveLength(0)
  })
})

describe('the player with a recorded voice', () => {
  const says = lesson.steps.map((s) => s.say)

  async function setup(lengthMs = 9000, opts: Parameters<typeof rig>[0] = {}) {
    const r = rig(opts)
    const c = fakeClips(says, lengthMs)
    const voice = new LessonVoice({ narrator: r.narrator, audio: r.port, clips: c.clips, setTimer: r.env.setTimer, clearTimer: r.env.clearTimer, firstWaitMs: 10_000, waitMs: 2000 })
    const p = new LessonPlayer(lesson, voice)
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 50) {
        r.advance(50)
        p.tick(50)
      }
    }
    return { r, c, p, run }
  }

  it('shows that the voice is loading, and starts the step when it arrives', async () => {
    const { c, p, run } = await setup()
    p.play(false)
    expect(p.snapshot).toMatchObject({ playing: true, loading: true, voice: null })
    run(1500)
    expect(p.elapsed).toBe(0) // the step has not begun: nothing has been said
    expect(p.narration).toBe(0)
    c.fetches[0].ok()
    await flush()
    expect(p.snapshot).toMatchObject({ playing: true, loading: false, voice: 'audio' })
    run(1000)
    expect(p.elapsed).toBe(1000)
  })

  it('makes each step as long as its recording, with the motion spanning it', async () => {
    const { c, p, run } = await setup(15_000)
    c.fetches.forEach((f) => f.ok())
    await flush()
    p.goto(3) // the sliding tangent
    const guessed = p.plan.moveMs
    p.play(true)
    expect(p.plan.speechMs).toBe(15_000)
    expect(p.plan.moveMs).toBeGreaterThan(guessed)
    expect(p.plan.moveStart + p.plan.moveMs).toBeLessThan(15_000)
    run(7500)
    expect(p.narration).toBeCloseTo(0.5, 1)
    expect(p.motion).toBeGreaterThan(0.2)
    expect(p.motion).toBeLessThan(0.8)
    run(7400)
    expect(p.snapshot.step).toBe(3)
    run(200 + STEP_GAP_MS + 100)
    expect(p.snapshot.step).toBe(4)
    expect(p.snapshot.voice).toBe('audio')
  })

  it('pause holds the recording where it is and play carries on from there', async () => {
    const { r, c, p, run } = await setup(8000)
    c.fetches.forEach((f) => f.ok())
    await flush()
    p.play(true)
    run(3000)
    p.pause()
    expect(r.audio.paused).toBe(true)
    run(5000)
    expect(p.elapsed).toBe(3000)
    expect(r.audio.pos).toBe(3000)
    p.play(true)
    expect(r.audio.paused).toBe(false)
    expect(r.audio.plays).toHaveLength(1) // not started again
    expect(p.elapsed).toBe(3000)
    run(4900)
    expect(p.snapshot.step).toBe(0)
    run(200 + STEP_GAP_MS + 100)
    expect(p.snapshot.step).toBe(1)
  })

  it('mute silences the recording without changing the timing', async () => {
    const { r, c, p, run } = await setup(8000)
    c.fetches.forEach((f) => f.ok())
    await flush()
    p.play(true)
    run(2000)
    p.setMuted(true)
    expect(r.audio.muted).toBe(true)
    expect(p.snapshot.voice).toBe('audio')
    run(5900)
    expect(p.snapshot.step).toBe(0)
    run(200 + STEP_GAP_MS + 100)
    expect(p.snapshot.step).toBe(1)
    expect(r.audio.plays).toHaveLength(2) // the next step plays too, still muted
    expect(r.audio.muted).toBe(true)
    p.setMuted(false)
    expect(r.audio.muted).toBe(false)
  })

  it('a step whose recording is late is spoken by the browser instead', async () => {
    const { r, c, p, run } = await setup(3000)
    c.fetches[0].ok()
    await flush()
    p.play(true)
    run(Math.max(3000, p.plans[0].minMs) + STEP_GAP_MS + 100)
    expect(p.snapshot).toMatchObject({ step: 1, loading: true })
    run(2000)
    expect(p.snapshot).toMatchObject({ step: 1, loading: false, voice: 'speech' })
    expect(r.spoken.at(-1)?.text).toBe(says[1])
  })

  it('without any voice at all it plays through in silence, and pause holds its place', async () => {
    const { c, p, run } = await setup(3000, { speech: false })
    c.fetches.forEach((f) => f.fail())
    await flush()
    p.play(true)
    expect(p.snapshot).toMatchObject({ playing: true, loading: false, voice: 'silent' })
    run(1000)
    p.pause()
    run(4000)
    p.play(true)
    expect(p.elapsed).toBe(1000)
    run(Math.max(speechMs(says[0]), p.plans[0].minMs) - 1000 + STEP_GAP_MS + 100)
    expect(p.snapshot.step).toBe(1)
  })

  it('waits for a tap when sound is blocked, then plays the recording', async () => {
    const { r, c, p } = await setup(3000, { blockAudio: true })
    c.fetches.forEach((f) => f.ok())
    await flush()
    p.play(false)
    expect(p.snapshot).toMatchObject({ playing: false, needsTap: true })
    p.play(true)
    expect(r.audio.unlocked).toBe(1)
    expect(p.snapshot).toMatchObject({ playing: true, needsTap: false, voice: 'audio' })
  })

  it('a recording that never moves does not hold the lesson up', async () => {
    const { r, c, p, run } = await setup(4000)
    c.fetches.forEach((f) => f.ok())
    await flush()
    p.play(true)
    run(1000)
    r.audio.paused = true // stalled, not paused by the player
    run(3500)
    expect(p.snapshot.voice).toBe('silent')
    run(4000 + p.plans[0].minMs)
    expect(p.snapshot.step).toBeGreaterThanOrEqual(1)
  })
})

describe('subtitles', () => {
  it('gives every word a share of the time, more to long words and to pauses', () => {
    const s = sweepPlan('Pick two points, then join them. Now look.')
    expect(s.words).toEqual(['Pick', 'two', 'points,', 'then', 'join', 'them.', 'Now', 'look.'])
    expect(s.ends.at(-1)).toBe(1)
    for (let i = 1; i < s.ends.length; i++) expect(s.ends[i]).toBeGreaterThan(s.ends[i - 1])
    const share = (i: number) => s.ends[i] - (s.ends[i - 1] ?? 0)
    expect(share(2)).toBeGreaterThan(share(1)) // "points," > "two"
    expect(share(5)).toBeGreaterThan(share(4)) // "them." > "join"
    expect(sweepPlan('   ')).toEqual({ words: [], ends: [] })
  })

  it('sweeps from no words to all of them', () => {
    const s = sweepPlan('one two three four')
    expect(wordsSpoken(s, 0)).toBe(0)
    expect(wordsSpoken(s, 0.01)).toBe(1) // the first word lights up as it starts
    expect(wordsSpoken(s, 0.5)).toBeGreaterThanOrEqual(2)
    expect(wordsSpoken(s, 0.5)).toBeLessThanOrEqual(3)
    expect(wordsSpoken(s, 0.999)).toBe(4)
    expect(wordsSpoken(s, 1)).toBe(4)
    expect(wordsSpoken(s, 7)).toBe(4)
    let last = 0
    for (let t = 0; t <= 1; t += 0.01) {
      const n = wordsSpoken(s, t)
      expect(n).toBeGreaterThanOrEqual(last)
      last = n
    }
  })

  it('plans a step around the real length of its recording', () => {
    const step = lesson.steps[3]
    expect(planStep(step, { speechMs: 15_000 }).speechMs).toBe(15_000)
    expect(planStep(step, { speechMs: 15_000 }).moveMs).toBeGreaterThan(planStep(step, { speechMs: 6000 }).moveMs)
    expect(planStep(step, {}).speechMs).toBe(speechMs(step.say))
  })
})

describe('log x axis', () => {
  const view: View = { x0: 0.1, x1: 1000, y0: -60, y1: 20, xlog: true }

  it('maps equal ratios to equal distances, and back', () => {
    expect(xFrac(view, 0.1)).toBeCloseTo(0)
    expect(xFrac(view, 1)).toBeCloseTo(0.25)
    expect(xFrac(view, 10)).toBeCloseTo(0.5)
    expect(xFrac(view, 1000)).toBeCloseTo(1)
    expect(xAtFrac(view, 0.75)).toBeCloseTo(100)
    expect(xAtFrac(view, xFrac(view, 37))).toBeCloseTo(37)
    expect(xFrac(view, 0)).toBeNaN()
    expect(xFrac(view, -5)).toBeNaN()
    // a linear view is untouched
    const lin: View = { x0: -2, x1: 2, y0: 0, y1: 1 }
    expect(xFrac(lin, 0)).toBe(0.5)
    expect(xAtFrac(lin, 0.25)).toBe(-1)
  })

  it('puts ticks on the decades, with 2..9 between them', () => {
    const t = logTicks(0.1, 1000)
    expect(t.major).toEqual([0.1, 1, 10, 100, 1000])
    expect(t.labels).toEqual(t.major)
    expect(t.minor).toContain(0.2)
    expect(t.minor).toContain(50)
    expect(t.minor).toHaveLength(8 * 4)
    // less than two decades in view: 2 and 5 get numbers too, so the axis can still be read
    expect(logTicks(2, 60).major).toEqual([10])
    expect(logTicks(2, 60).labels).toEqual([2, 5, 10, 20, 50])
    expect(logTicks(0, 10).major).toEqual([])
    expect(logTicks(5, 1).major).toEqual([])
    expect([0.01, 0.1, 1, 10, 1000, 10000, 1e6, 0.001, 20].map(logLabel)).toEqual(['0.01', '0.1', '1', '10', '1000', '10⁴', '10⁶', '10⁻³', '20'])
  })

  it('samples and moves marks evenly across the screen', () => {
    expect(sampleXs(1, 100, 2, true)).toEqual([1, 10, 100].map((v) => expect.closeTo(v)))
    expect(sampleXs(0, 4, 2)).toEqual([0, 2, 4])
    expect(markAt({ type: 'point', x: 1, to_x: 100 }, 0.5, true).x).toBeCloseTo(10)
    expect(markAt({ type: 'point', x: 1, to_x: 100 }, 0.5).x).toBeCloseTo(50.5)
  })

  it('builds a log scene from x_log, and a linear one when the range cannot be log', () => {
    const s = buildScene({ kind: 'plot2d', expressions: ['20*log10(1/sqrt(1+x^2))'], x_range: [0.1, 100], x_log: true })
    expect(s.view.xlog).toBe(true)
    expect(s.view.y1).toBeGreaterThan(-0.1) // 0 dB at low frequency is in view
    expect(s.view.y0).toBeLessThan(-39) // and about -40 dB at 100
    expect(buildScene({ kind: 'plot2d', expressions: ['x'], x_range: [0, 100], x_log: true }).view).toMatchObject({ xlog: true, x0: 0.1, x1: 100 })
    expect(buildScene({ kind: 'plot2d', expressions: ['x'], x_range: [-5, -1], x_log: true }).view.xlog).toBeUndefined()
    expect(buildScene({ kind: 'plot2d', expressions: ['x'], x_range: [1, 10] }).view.xlog).toBeUndefined()
    expect(cleanLesson({ title: 't', steps: [{ say: 's', visual: { kind: 'plot2d', expressions: ['x'], x_range: [1, 10], x_log: true } }] })?.steps[0].visual?.x_log).toBe(true)
  })

  it('tweens between two log views by ratio, and snaps between log and linear', () => {
    const a: View = { x0: 1, x1: 100, y0: 0, y1: 1, xlog: true }
    const b: View = { x0: 100, x1: 10000, y0: 0, y1: 3, xlog: true }
    expect(lerpView(a, b, 0.5)).toMatchObject({ x0: expect.closeTo(10), x1: expect.closeTo(1000), y1: 2, xlog: true })
    const lin: View = { x0: -1, x1: 1, y0: 0, y1: 1 }
    expect(lerpView(lin, b, 0.3)).toBe(b)
  })
})

describe('docking the panel', () => {
  it('is a bottom sheet on an upright screen and a right-hand panel on a wide one', () => {
    const portrait = dockLayout(820, 1180)
    expect(portrait.side).toBe('bottom')
    expect(portrait.size / 1180).toBeCloseTo(0.45, 2)
    expect(portrait.canvas).toEqual({ w: 820, h: 1180 - portrait.size })
    const landscape = dockLayout(1180, 820)
    expect(landscape.side).toBe('right')
    expect(landscape.size / 1180).toBeCloseTo(0.42, 2)
    expect(landscape.canvas).toEqual({ w: 1180 - landscape.size, h: 820 })
    // a phone, either way up, gets the sheet; the notebook always keeps some room
    expect(dockLayout(390, 844).side).toBe('bottom')
    expect(dockLayout(700, 390).side).toBe('bottom')
    for (const [w, h] of [[390, 844], [700, 390], [1366, 1024], [2560, 1440], [320, 480]]) {
      const l = dockLayout(w, h)
      expect(l.canvas.w).toBeGreaterThanOrEqual(Math.min(w, 320))
      expect(l.canvas.h).toBeGreaterThanOrEqual(Math.min(h, 180))
    }
  })

  const pad = canvasInsets('bottom')
  const screen = dockLayout(820, 1180).canvas

  /** where a page rect lands on screen under a camera */
  const onScreen = (r: { x: number; y: number; w: number; h: number }, c: { x: number; y: number; z: number }) => ({
    left: (r.x + c.x) * c.z,
    top: (r.y + c.y) * c.z,
    right: (r.x + r.w + c.x) * c.z,
    bottom: (r.y + r.h + c.y) * c.z,
  })

  it('leaves the page alone when the problem is already in the clear', () => {
    const cam = { x: 0, y: 0, z: 1 }
    expect(cameraFor({ x: 100, y: 100, w: 300, h: 120 }, cam, screen, pad)).toEqual(cam)
  })

  it('slides the page so a problem that would be under the sheet stays visible', () => {
    const focus = { x: 120, y: 900, w: 400, h: 140 } // was near the bottom of the full screen
    const cam = cameraFor(focus, { x: 0, y: 0, z: 1 }, screen, pad)
    expect(cam.z).toBe(1)
    expect(cam.x).toBe(0)
    const s = onScreen(focus, cam)
    expect(s.top).toBeGreaterThanOrEqual(pad.top)
    expect(s.bottom).toBeLessThanOrEqual(screen.h - pad.bottom + 1e-6)
  })

  it('zooms out, but not to nothing, when the problem does not fit', () => {
    const wide = { x: 0, y: 0, w: 1400, h: 200 }
    const cam = cameraFor(wide, { x: 0, y: 0, z: 1 }, screen, pad)
    expect(cam.z).toBeLessThan(1)
    expect(cam.z).toBeGreaterThanOrEqual(0.5)
    const s = onScreen(wide, cam)
    expect(s.left).toBeGreaterThanOrEqual(pad.left - 1e-6)
    expect(s.right).toBeLessThanOrEqual(screen.w - pad.right + 1e-6)
    // far too big: half the zoom at most, showing where it starts
    const huge = cameraFor({ x: 50, y: 60, w: 9000, h: 9000 }, { x: 0, y: 0, z: 1 }, screen, pad)
    expect(huge.z).toBe(0.5)
    const t = onScreen({ x: 50, y: 60, w: 1, h: 1 }, huge)
    expect(t.left).toBeCloseTo(pad.left)
    expect(t.top).toBeCloseTo(pad.top)
  })

  it('focuses on the marker and the writing beside it, not the whole page', () => {
    const marker = { x: 500, y: 300, w: 34, h: 34 }
    const line = { x: 180, y: 290, w: 300, h: 60 }
    const elsewhere = { x: 100, y: 2000, w: 400, h: 80 }
    const f = focusRect(marker, [line, elsewhere], 260)
    expect(f).toEqual({ x: 240, y: 290, w: 294, h: 60 }) // the line (as far as the reach goes) plus the marker
    expect(focusRect(marker, [], 260)).toEqual(marker)
  })

  it('puts the marker in the corner of the free spot nearest the writing', () => {
    const line = { x: 100, y: 500, w: 300, h: 60 }
    // free spot to the right of the line: level with it, hard against it
    expect(markerSpot({ x: 420, y: 480, w: 400, h: 320 }, [line], 34)).toEqual({ x: 420, y: 500, w: 34, h: 34 })
    // free spot above the line: its bottom-left, just over the line's start
    expect(markerSpot({ x: 100, y: 150, w: 400, h: 320 }, [line], 34)).toEqual({ x: 100, y: 436, w: 34, h: 34 })
    // below: its top-left
    expect(markerSpot({ x: 100, y: 580, w: 400, h: 320 }, [line], 34)).toEqual({ x: 100, y: 580, w: 34, h: 34 })
    // the nearest writing counts, and with none the spot's top-left is used
    expect(markerSpot({ x: 420, y: 480, w: 400, h: 320 }, [{ x: 0, y: 3000, w: 50, h: 50 }, line], 34).y).toBe(500)
    expect(markerSpot({ x: 420, y: 480, w: 400, h: 320 }, [], 34)).toEqual({ x: 420, y: 480, w: 34, h: 34 })
  })

  it('keeps the marker small on screen at any zoom', () => {
    expect(markerSize(1)).toBe(34)
    expect(markerSize(2) * 2).toBeCloseTo(34)
    expect(markerSize(0.5) * 0.5).toBeCloseTo(32)
    expect(markerSize(0.1)).toBe(64)
    expect(markerSize(NaN)).toBe(34)
  })
})
