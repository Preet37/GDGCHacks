import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimLive, isFresh, liveIds, markFresh, MAX_LIVE } from './fresh3d'

const held: (() => void)[] = []
const claim = (id: string, release: () => void = () => {}) => {
  const un = claimLive(id, release)
  held.push(un)
  return un
}

afterEach(() => {
  for (const un of held.splice(0)) un()
  expect(liveIds()).toEqual([])
})

describe('fresh3d', () => {
  it('knows which cards were made in this session', () => {
    expect(isFresh('shape:a')).toBe(false)
    markFresh('shape:a')
    expect(isFresh('shape:a')).toBe(true)
  })

  it('lets two views run and releases the oldest when a third starts', () => {
    expect(MAX_LIVE).toBe(2)
    const a = vi.fn()
    const b = vi.fn()
    const c = vi.fn()
    claim('a', a)
    claim('b', b)
    expect(liveIds()).toEqual(['a', 'b'])
    expect(a).not.toHaveBeenCalled()
    claim('c', c)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
    expect(c).not.toHaveBeenCalled()
    expect(liveIds()).toEqual(['b', 'c'])
  })

  it('a released card that is tapped comes back and puts the next oldest to sleep', () => {
    const a = vi.fn()
    const b = vi.fn()
    const c = vi.fn()
    const unA = claim('a', a)
    claim('b', b)
    claim('c', c) // a is released
    unA() // a's view is disposed after the release: must not disturb anything
    expect(liveIds()).toEqual(['b', 'c'])
    claim('a', a) // tapped
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(liveIds()).toEqual(['c', 'a'])
  })

  it('giving a place back makes room without releasing anyone', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unA = claim('a', a)
    claim('b', b)
    unA()
    claim('c')
    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
    expect(liveIds()).toEqual(['b', 'c'])
  })

  it('claiming again moves a card to the newest place, and an old unclaim does not remove the new claim', () => {
    const a1 = vi.fn()
    const a2 = vi.fn()
    const b = vi.fn()
    const un1 = claim('a', a1)
    claim('b', b)
    claim('a', a2)
    expect(liveIds()).toEqual(['b', 'a'])
    un1() // the first claim's cleanup, run late
    expect(liveIds()).toEqual(['b', 'a'])
    claim('c')
    expect(b).toHaveBeenCalledTimes(1)
    expect(a1).not.toHaveBeenCalled()
    expect(a2).not.toHaveBeenCalled()
  })
})
