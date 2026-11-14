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

describe('hashString', () => {
  it('is stable and sensitive to changes', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})
