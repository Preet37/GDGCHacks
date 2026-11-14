import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HoldGesture, speechSupported, startListening } from './voice'

describe('HoldGesture', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = () => {
    const h = { onTap: vi.fn(), onHoldStart: vi.fn(), onHoldEnd: vi.fn() }
    return { h, g: new HoldGesture(h, 350) }
  }

  it('a quick press is a tap', () => {
    const { h, g } = make()
    g.pointerDown()
    vi.advanceTimersByTime(100)
    g.pointerUp()
    expect(h.onTap).toHaveBeenCalledTimes(1)
    expect(h.onHoldStart).not.toHaveBeenCalled()
  })

  it('a long press starts and ends a hold, no tap', () => {
    const { h, g } = make()
    g.pointerDown()
    vi.advanceTimersByTime(400)
    expect(h.onHoldStart).toHaveBeenCalledTimes(1)
    g.pointerUp()
    expect(h.onHoldEnd).toHaveBeenCalledTimes(1)
    expect(h.onTap).not.toHaveBeenCalled()
  })

  it('ignores a stray up (e.g. pointerleave after up)', () => {
    const { h, g } = make()
    g.pointerDown()
    g.pointerUp()
    g.pointerUp()
    expect(h.onTap).toHaveBeenCalledTimes(1)
  })
})

describe('speech recognition', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).webkitSpeechRecognition
  })

  it('reports unsupported and returns null without a recognizer', () => {
    expect(speechSupported()).toBe(false)
    expect(startListening()).toBeNull()
  })

  it('collects final + interim transcript on stop', async () => {
    class FakeRec {
      static last: FakeRec
      onresult: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      onerror = null
      lang = ''
      interimResults = false
      continuous = false
      constructor() {
        FakeRec.last = this
      }
      start() {}
      abort() {}
      stop() {
        setTimeout(() => this.onend?.(), 0)
      }
    }
    Object.assign(globalThis, { webkitSpeechRecognition: FakeRec })
    const l = startListening()!
    const res = (t: string, isFinal: boolean) => Object.assign([{ transcript: t }], { isFinal })
    FakeRec.last.onresult!({ resultIndex: 0, results: [res('why is this', true), res(' wrong', false)] })
    expect(await l.stop()).toBe('why is this wrong')
  })
})
