import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashString, PauseScheduler } from './scheduler'

describe('PauseScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    let key = 'a'
    let resolveSend: (() => void) | null = null
    const send = vi.fn(() => new Promise<void>((r) => (resolveSend = r)))
    const s = new PauseScheduler({ delayMs: 2000, key: () => key, send })
    return {
      s,
      send,
      setKey: (k: string) => (key = k),
      finish: async () => {
        resolveSend?.()
        await vi.advanceTimersByTimeAsync(0)
      },
    }
  }

  it('sends exactly once after a pause in many changes', async () => {
    const { s, send } = setup()
    for (let i = 0; i < 10; i++) {
      s.poke()
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('skips if nothing changed since the last send', async () => {
    const { s, send, finish } = setup()
    s.poke()
    await vi.advanceTimersByTimeAsync(2000)
    await finish()
    s.poke()
    await vi.advanceTimersByTimeAsync(2000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('never overlaps, and sends once more after if changes came in mid-flight', async () => {
    const { s, send, setKey, finish } = setup()
    s.poke()
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.busy).toBe(true)
    setKey('b')
    s.poke()
    s.poke()
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledTimes(1)
    await finish()
    await vi.advanceTimersByTimeAsync(2000)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('retries the same page after a failure', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined)
    const s = new PauseScheduler({ delayMs: 100, key: () => 'same', send })
    s.poke()
    await vi.advanceTimersByTimeAsync(100)
    s.poke()
    await vi.advanceTimersByTimeAsync(100)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('exclusive refuses while a request is in flight', async () => {
    const { s, finish } = setup()
    s.poke()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await s.exclusive(async () => {})).toBe(false)
    await finish()
    expect(await s.exclusive(async () => {})).toBe(true)
  })
})

describe('PauseScheduler hooks', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('onIdle runs after every request, when exclusive is free again; onSkip when a pause had nothing new', async () => {
    const onIdle = vi.fn()
    const onSkip = vi.fn()
    const s: PauseScheduler = new PauseScheduler({
      delayMs: 100,
      key: () => 'same',
      send: async () => {},
      onSkip,
      onIdle: () => {
        onIdle()
        expect(s.busy).toBe(false)
      },
    })
    s.poke()
    await vi.advanceTimersByTimeAsync(100)
    expect(onIdle).toHaveBeenCalledTimes(1)
    expect(onSkip).not.toHaveBeenCalled()
    s.poke()
    await vi.advanceTimersByTimeAsync(100)
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
    await s.exclusive(async () => {})
    expect(onIdle).toHaveBeenCalledTimes(2)
  })

  it('a request started from onIdle goes through exclusive without overlapping', async () => {
    let inFlight = 0
    let max = 0
    const job = async () => {
      max = Math.max(max, ++inFlight)
      await new Promise((r) => setTimeout(r, 50))
      inFlight--
    }
    let owed = true
    const results: boolean[] = []
    const s: PauseScheduler = new PauseScheduler({
      delayMs: 100,
      key: () => String(Math.random()),
      send: job,
      onIdle: () => {
        if (!owed) return
        owed = false
        void s.exclusive(job).then((ok) => results.push(ok))
      },
    })
    s.poke()
    await vi.advanceTimersByTimeAsync(120)
    expect(await s.exclusive(job)).toBe(false) // the auto check is in flight
    await vi.advanceTimersByTimeAsync(500)
    expect(results).toEqual([true])
    expect(max).toBe(1)
  })
})

describe('hashString', () => {
  it('is stable and sensitive to changes', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})
