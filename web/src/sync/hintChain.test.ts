import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckResponse } from '../contract'
import { HintChain, mistakeProblems, raisedProblem, sameTarget, STUCK_MS, stuckMsFromUrl, type HelpAttempt, type HelpTarget } from './hintChain'

const VIEW = { x: 0, y: 0, w: 1000, h: 700 }
const WIN = { x: 0, y: 0, w: 1000, h: 700 }
const SEL = { x: 100, y: 100, w: 300, h: 80 }

describe('HintChain', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** A fake tutor: each request raises P1 by one level (up to 3) unless told otherwise. */
  function setup(opts: { stuckMs?: number } = {}) {
    const calls: HelpTarget[] = []
    let level = 0
    let next: (() => HelpAttempt) | null = null
    let hold: ((v: HelpAttempt) => void) | null = null
    let manual = false
    const request = vi.fn((t: HelpTarget) => {
      calls.push(t)
      const answer = (): HelpAttempt => {
        if (next) {
          const n = next
          next = null
          return n()
        }
        level = Math.min(3, level + 1)
        return { window: t.window ?? WIN, raised: { problemId: 'P1', level } }
      }
      if (!manual) return Promise.resolve(answer())
      return new Promise<HelpAttempt>((r) => (hold = (v) => r(v ?? answer())))
    })
    const chain = new HintChain({ stuckMs: opts.stuckMs ?? 18000, request })
    return {
      chain,
      calls,
      request,
      /** make the next request return this instead */
      nextReply: (fn: () => HelpAttempt) => (next = fn),
      /** requests stay in flight until finish() */
      holdRequests: () => (manual = true),
      finish: async () => {
        hold?.(undefined as unknown as HelpAttempt)
        hold = null
        await vi.advanceTimersByTimeAsync(0)
      },
      tap: (area?: typeof SEL, question?: string, view = VIEW) => chain.tap(area, question, view),
    }
  }

  it('one tap gives hint 1 and starts the countdown', async () => {
    const { chain, request, tap } = setup()
    expect(await tap()).toBe('ok')
    expect(request).toHaveBeenCalledTimes(1)
    expect(chain.snapshot).toMatchObject({ phase: 'counting', level: 1, totalMs: 18000 })
    expect(chain.snapshot.deadline - Date.now()).toBe(18000)
  })

  it('no ink for the stuck time: the next hints come by themselves, and it stops after the worked step', async () => {
    const { chain, request, tap } = setup()
    await tap()
    await vi.advanceTimersByTimeAsync(17999)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(request).toHaveBeenCalledTimes(2)
    expect(chain.snapshot).toMatchObject({ phase: 'counting', level: 2 })
    await vi.advanceTimersByTimeAsync(18000)
    expect(request).toHaveBeenCalledTimes(3)
    expect(chain.snapshot).toMatchObject({ phase: 'idle', level: 0 })
    await vi.advanceTimersByTimeAsync(60000)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('follow-ups target the window and selection the chain started with, and only the first carries the question', async () => {
    const { calls, tap, nextReply } = setup()
    const first = { x: 80, y: 70, w: 400, h: 200 }
    nextReply(() => ({ window: first, raised: { problemId: 'P7', level: 1 } }))
    await tap(SEL, 'why is this wrong?')
    await vi.advanceTimersByTimeAsync(18000)
    await vi.advanceTimersByTimeAsync(18000)
    expect(calls).toEqual([
      { area: SEL, question: 'why is this wrong?' },
      { area: SEL, window: first, problemId: 'P7' },
      { area: SEL, window: first, problemId: 'P1' },
    ])
    expect(calls[1].question).toBeUndefined()
  })

  it('ink cancels the countdown', async () => {
    const { chain, request, tap } = setup()
    await tap()
    await vi.advanceTimersByTimeAsync(10000)
    chain.ink()
    expect(chain.snapshot.phase).toBe('watching')
    await vi.advanceTimersByTimeAsync(60000)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('a wrong next line on the same problem brings the next hint once nothing is in flight', async () => {
    const { chain, request, tap } = setup()
    await tap()
    chain.ink()
    chain.checked({ dirty: false, mistakes: ['P1'] })
    expect(request).toHaveBeenCalledTimes(1) // the auto check is still in flight
    chain.idle()
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledTimes(2)
    expect(chain.snapshot).toMatchObject({ phase: 'counting', level: 2 })
  })

  it('a clean next line ends the chain', async () => {
    const { chain, request, tap } = setup()
    await tap()
    chain.ink()
    chain.checked({ dirty: false, mistakes: [] })
    chain.idle()
    await vi.advanceTimersByTimeAsync(60000)
    expect(chain.snapshot.phase).toBe('idle')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('a mistake on another problem does not bring a hint for this one', async () => {
    const { chain, request, tap } = setup()
    await tap()
    chain.ink()
    chain.checked({ dirty: false, mistakes: ['P2'] })
    chain.idle()
    await vi.advanceTimersByTimeAsync(60000)
    expect(request).toHaveBeenCalledTimes(1)
    expect(chain.snapshot.phase).toBe('idle')
  })

  it('a check that is already out of date (more ink came in) is ignored; the next one decides', async () => {
    const { chain, request, tap } = setup()
    await tap()
    chain.ink()
    chain.checked({ dirty: true, mistakes: ['P1'] })
    chain.idle()
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledTimes(1)
    expect(chain.snapshot.phase).toBe('watching')
    chain.checked({ dirty: false, mistakes: ['P1'] })
    chain.idle()
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('ink that left nothing to check (e.g. drawn then erased) starts the countdown again', async () => {
    const { chain, request, tap } = setup()
    await tap()
    chain.ink()
    chain.checked(null)
    expect(chain.snapshot.phase).toBe('counting')
    await vi.advanceTimersByTimeAsync(18000)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('a check result while counting (no ink since the hint) changes nothing', async () => {
    const { chain, tap } = setup()
    await tap()
    chain.checked({ dirty: false, mistakes: [] })
    expect(chain.snapshot.phase).toBe('counting')
  })

  it('level 3 ends the chain', async () => {
    const { chain, tap, nextReply } = setup()
    nextReply(() => ({ window: WIN, raised: { problemId: 'P1', level: 3 } }))
    await tap()
    expect(chain.snapshot.phase).toBe('idle')
  })

  it('a reply that raises no level ends the chain', async () => {
    const { chain, request, tap, nextReply } = setup()
    await tap()
    nextReply(() => ({ window: WIN, raised: null }))
    await vi.advanceTimersByTimeAsync(18000)
    expect(request).toHaveBeenCalledTimes(2)
    expect(chain.snapshot.phase).toBe('idle')
    await vi.advanceTimersByTimeAsync(60000)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('a failed request ends the chain', async () => {
    const { chain, tap, nextReply } = setup()
    nextReply(() => null)
    expect(await tap()).toBe('failed')
    expect(chain.snapshot.phase).toBe('idle')
  })

  it('a second tap gives the next hint now and restarts the countdown', async () => {
    const { chain, calls, tap } = setup()
    await tap()
    await vi.advanceTimersByTimeAsync(10000)
    await tap()
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ window: WIN, problemId: 'P1' })
    expect(chain.snapshot).toMatchObject({ phase: 'counting', level: 2 })
    expect(chain.snapshot.deadline - Date.now()).toBe(18000)
    await vi.advanceTimersByTimeAsync(17999)
    expect(calls).toHaveLength(2) // the old timer is gone
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(3)
  })

  it('help on a different area starts a new chain and drops the old one', async () => {
    const { chain, calls, tap, nextReply } = setup()
    await tap(SEL)
    await tap(SEL) // level 2 on P1
    const other = { x: 100, y: 2000, w: 300, h: 80 }
    const otherWin = { x: 60, y: 1900, w: 500, h: 300 }
    nextReply(() => ({ window: otherWin, raised: { problemId: 'P2', level: 1 } }))
    await tap(other)
    expect(calls[2]).toEqual({ area: other, question: undefined })
    expect(chain.snapshot).toMatchObject({ phase: 'counting', level: 1 })
    nextReply(() => ({ window: otherWin, raised: { problemId: 'P2', level: 2 } }))
    await vi.advanceTimersByTimeAsync(18000)
    expect(calls).toHaveLength(4) // one follow-up, for the new chain only
    expect(calls[3]).toEqual({ area: other, window: otherWin, problemId: 'P2' })
  })

  it('no selection, but the view moved away: a new chain', async () => {
    const { calls, tap } = setup()
    await tap()
    await tap(undefined, undefined, { x: 0, y: 5000, w: 1000, h: 700 })
    expect(calls[1]).toEqual({ area: undefined, question: undefined })
  })

  it('tapping the countdown cancels the chain', async () => {
    const { chain, request, tap } = setup()
    await tap()
    chain.cancel()
    expect(chain.snapshot.phase).toBe('idle')
    await vi.advanceTimersByTimeAsync(60000)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('cancelled while its request is in flight: the reply does not restart it', async () => {
    const { chain, request, tap, holdRequests, finish } = setup()
    await tap()
    holdRequests()
    await vi.advanceTimersByTimeAsync(18000)
    expect(chain.snapshot.phase).toBe('asking')
    chain.cancel()
    await finish()
    expect(chain.snapshot.phase).toBe('idle')
    await vi.advanceTimersByTimeAsync(60000)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('never asks while its own request is in flight', async () => {
    const { chain, request, tap, holdRequests, finish } = setup()
    holdRequests()
    const first = tap()
    expect(await tap()).toBe('busy')
    chain.idle()
    expect(request).toHaveBeenCalledTimes(1)
    await finish()
    expect(await first).toBe('ok')
    expect(chain.snapshot).toMatchObject({ phase: 'counting', level: 1 })
  })

  it('a follow-up that meets another request in flight waits for it, then goes out once', async () => {
    const { chain, request, tap, nextReply } = setup()
    await tap()
    nextReply(() => 'busy')
    await vi.advanceTimersByTimeAsync(18000)
    expect(request).toHaveBeenCalledTimes(2) // refused: nothing was sent
    expect(chain.snapshot).toMatchObject({ phase: 'counting', level: 1 })
    await vi.advanceTimersByTimeAsync(60000)
    expect(request).toHaveBeenCalledTimes(2) // no retry loop
    chain.idle()
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledTimes(3)
    expect(chain.snapshot).toMatchObject({ phase: 'counting', level: 2 })
  })

  it('a tap refused as busy leaves the running chain and its countdown alone', async () => {
    const { chain, request, tap, nextReply } = setup()
    await tap()
    await vi.advanceTimersByTimeAsync(10000)
    nextReply(() => 'busy')
    expect(await tap()).toBe('busy')
    expect(chain.snapshot).toMatchObject({ phase: 'counting', level: 1 })
    await vi.advanceTimersByTimeAsync(8000)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('ink while the hint request is in flight: wait for its check instead of counting', async () => {
    const { chain, tap, holdRequests, finish } = setup()
    holdRequests()
    const first = tap()
    chain.ink()
    await finish()
    await first
    expect(chain.snapshot).toMatchObject({ phase: 'watching', level: 1 })
  })

  it('tells subscribers about every change', async () => {
    const { chain, tap } = setup()
    const seen: string[] = []
    chain.subscribe(() => seen.push(chain.snapshot.phase))
    await tap()
    chain.cancel()
    expect(seen).toEqual(['asking', 'counting', 'idle'])
  })
})

describe('helpers', () => {
  it('stuck time: 18 s unless ?stuck= says otherwise', () => {
    expect(STUCK_MS).toBe(18000)
    expect(stuckMsFromUrl('')).toBe(18000)
    expect(stuckMsFromUrl('?mock&stuck=2')).toBe(2000)
    expect(stuckMsFromUrl('?stuck=abc')).toBe(18000)
  })

  it('raisedProblem finds the problem whose hint level went up', () => {
    const p = (problem_id: string, hint_level: 0 | 1 | 2 | 3) => ({ problem_id, hint_level })
    expect(raisedProblem([p('P1', 1), p('P2', 0)], [p('P1', 1), p('P2', 1)])).toEqual({ problemId: 'P2', level: 1 })
    expect(raisedProblem([p('P1', 1)], [p('P1', 1)])).toBeNull()
    expect(raisedProblem([], [p('P3', 1)])).toEqual({ problemId: 'P3', level: 1 })
    expect(raisedProblem([], [p('P3', 0)])).toBeNull()
    expect(raisedProblem([p('P1', 1), p('P2', 1)], [p('P1', 2), p('P2', 2)], 'P2')).toEqual({ problemId: 'P2', level: 2 })
  })

  it('mistakeProblems: red actions, by the problem of their line', () => {
    const line = (line_id: string, problem_id: string) =>
      ({ line_id, problem_id, latex: '', plain: '', box: [0, 0, 1, 1], relation: 'other', confidence: 'high' }) as CheckResponse['lines'][number]
    const reply: CheckResponse = {
      lines: [line('L1', 'P1'), line('L2', 'P1'), line('L3', 'P2')],
      actions: [
        { type: 'circle', line_id: 'L2', color: 'red' },
        { type: 'note', line_id: 'L2', color: 'red', text: '?' },
        { type: 'note', line_id: 'L3', color: 'blue', text: 'hint' },
        { type: 'speak', text: 'hi' },
      ],
      clear_line_ids: [],
      state: { page_id: 'p', lines: [line('L1', 'P1'), line('L2', 'P1'), line('L3', 'P2')], problems: [], flagged_line_ids: [] },
    }
    expect(mistakeProblems(reply)).toEqual(['P1'])
  })

  it('sameTarget', () => {
    const view = { x: 0, y: 0, w: 1000, h: 700 }
    const chain = { area: SEL, window: { x: 60, y: 60, w: 400, h: 200 } }
    expect(sameTarget(chain, SEL, view)).toBe(true)
    expect(sameTarget(chain, { x: 100, y: 900, w: 300, h: 80 }, view)).toBe(false)
    expect(sameTarget(chain, undefined, view)).toBe(true) // still on screen
    expect(sameTarget(chain, undefined, { x: 0, y: 3000, w: 1000, h: 700 })).toBe(false)
    expect(sameTarget({ window: view }, SEL, view)).toBe(false) // a selection is more specific than "what is on screen"
  })
})
