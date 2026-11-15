import type { CheckResponse, ProblemState } from '../contract'
import type { PageRect } from '../render/geometry'
import { coverage } from '../page'

/** How long the student can sit without writing before the next hint comes by itself. */
export const STUCK_MS = 18_000
/** The last hint level (the worked step); a chain stops there. */
export const MAX_HINT_LEVEL = 3

/** `?stuck=3` shortens the wait to 3 seconds (for testing). */
export function stuckMsFromUrl(search: string): number {
  const s = Number(new URLSearchParams(search).get('stuck'))
  return s > 0 ? s * 1000 : STUCK_MS
}

/** What one help request is aimed at. `window`/`problemId` are only set on a chain's follow-ups. */
export interface HelpTarget {
  /** the student's selection, in page coordinates (missing = no selection) */
  area?: PageRect
  /** the part of the page the chain's first request sent, in page coordinates */
  window?: PageRect
  problemId?: string
  question?: string
}

/** What a help request did: the window it sent, and the problem whose hint level went up (if any). */
export interface HelpResult {
  window: PageRect
  raised: { problemId: string; level: number } | null
}

/** 'busy' = another request was in flight, nothing was sent. null = it failed or there was nothing to send. */
export type HelpAttempt = HelpResult | 'busy' | null

/** What an auto check found. `dirty` = the student wrote more while it ran, so it is already out of date. */
export interface CheckResult {
  dirty: boolean
  /** problems that got a red mark in this check */
  mistakes: string[]
}

export type ChainPhase =
  | 'idle' // no chain
  | 'asking' // a help request of ours is in flight
  | 'counting' // waiting to see if the student writes; the next hint comes at `deadline`
  | 'watching' // the student is writing; waiting for the auto check of what they wrote

export interface ChainSnapshot {
  phase: ChainPhase
  /** hint level reached so far (0 = none yet) */
  level: number
  /** counting: when the next hint is sent (same clock as `now`) */
  deadline: number
  totalMs: number
}

export interface ChainDeps {
  stuckMs: number
  /** Send one help request through the scheduler's exclusive path. Must not throw. */
  request: (target: HelpTarget) => Promise<HelpAttempt>
  /**
   * Fetch the next hint ahead of time without showing it: nothing on the page or in the saved
   * state may change. Resolves to whatever `show` needs, or null if it could not be fetched.
   */
  prefetch?: (target: HelpTarget) => Promise<unknown>
  /**
   * Show a prefetched hint now. null = it is out of date (the page changed since it was asked
   * for); 'busy' = another request is in flight. Either way a normal request is made instead.
   */
  show?: (held: unknown) => HelpAttempt
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => number
}

interface Chain {
  area?: PageRect
  window: PageRect
  problemId: string
  level: number
}

/** The problem whose hint level went up between two states (`prefer` wins if several did). */
export function raisedProblem(before: ProblemState[], after: ProblemState[], prefer?: string): HelpResult['raised'] {
  const was = new Map(before.map((p) => [p.problem_id, p.hint_level as number]))
  const up = after.filter((p) => p.hint_level > (was.get(p.problem_id) ?? 0))
  const p = up.find((u) => u.problem_id === prefer) ?? up[0]
  return p ? { problemId: p.problem_id, level: p.hint_level } : null
}

/** Problems with a mistake marked in this reply: a red action on one of their lines. */
export function mistakeProblems(reply: CheckResponse): string[] {
  const problemOf = new Map([...reply.lines, ...reply.state.lines].map((l) => [l.line_id, l.problem_id]))
  const out = new Set<string>()
  for (const a of reply.actions) {
    const p = a.color === 'red' && a.line_id ? problemOf.get(a.line_id) : undefined
    if (p) out.add(p)
  }
  return [...out]
}

/** Is a new tap on Help (selection `area`, or none, seen through `view`) about the same thing as the chain? */
export function sameTarget(chain: { area?: PageRect; window: PageRect }, area: PageRect | undefined, view: PageRect): boolean {
  if (area) return !!chain.area && (coverage(area, chain.area) > 0.5 || coverage(chain.area, area) > 0.5)
  // no selection: the same if what the chain is about is still on screen
  return coverage(chain.window, view) > 0.3 || coverage(view, chain.window) > 0.5
}

/**
 * One tap on Help starts a chain of hints for one problem:
 * - no writing for `stuckMs`: the next hint. It is fetched in the background as soon as the
 *   countdown starts and held back, so it appears the moment the countdown ends (or Help is
 *   tapped again). A held hint is thrown away if the student writes: it was made for a page
 *   that no longer exists;
 * - writing: wait for its auto check. A clean check ends the chain. A mistake gets its red mark
 *   from that check, and the countdown starts again: the next hint only comes if the student
 *   stays stuck on it (asking at once would replace the red mark before it could be read);
 * - the worked step (level 3), a reply that raises no level, or a failed request ends it.
 */
export class HintChain {
  private chain: Chain | null = null
  private phase: ChainPhase = 'idle'
  private asking = false
  private inkWhileAsking = false
  /** a follow-up is owed as soon as no other request is in flight */
  private due = false
  /** bumped whenever the chain is dropped, so a reply that arrives later is not taken for it */
  private epoch = 0
  private timer: unknown = null
  private deadline = 0
  /** the next hint, being fetched or already here, not yet shown */
  private pre: { held: Promise<unknown> } | null = null
  private listeners = new Set<() => void>()
  private snap: ChainSnapshot
  private d: Required<ChainDeps>

  constructor(deps: ChainDeps) {
    this.d = {
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      prefetch: () => Promise.resolve(null),
      show: () => null,
      ...deps,
    }
    this.snap = this.makeSnapshot()
  }

  /** Stable between changes (safe for useSyncExternalStore). */
  get snapshot(): ChainSnapshot {
    return this.snap
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /**
   * The student tapped Help. During a chain on the same thing: the next hint now.
   * Anywhere else: a new chain, the old one is dropped.
   */
  tap(area: PageRect | undefined, question: string | undefined, view: PageRect): Promise<'ok' | 'busy' | 'failed'> {
    const c = this.chain
    if (c && sameTarget(c, area, view)) return this.ask({ area: c.area, window: c.window, problemId: c.problemId, question }, true)
    return this.ask({ area, question }, false)
  }

  /** The student changed something on the page (never called for the tutor's own drawing). */
  ink() {
    if (this.asking) {
      this.inkWhileAsking = true
      return
    }
    if (!this.chain) return
    this.stopTimer()
    this.due = false
    this.pre = null // made for the page as it was
    this.set('watching')
  }

  /** An auto check finished. null = nothing was checked (nothing new to read, or it failed). */
  checked(result: CheckResult | null) {
    if (this.phase !== 'watching' || !this.chain) return
    if (!result) return this.count() // they stopped without giving us anything to check: count again
    if (result.dirty) return // more writing came in; its own check follows
    // a mistake: the check has just marked it in red. Give them time with that before the next hint.
    if (result.mistakes.includes(this.chain.problemId)) this.count()
    else this.end() // their next step is fine: they're moving
  }

  /** No request is in flight any more: send the follow-up if one is owed. */
  idle() {
    if (!this.due || this.asking || !this.chain) return
    void this.followUp()
  }

  /** Stop the chain (the student tapped the countdown, or the page was replaced). */
  cancel() {
    this.end()
  }

  dispose() {
    this.stopTimer()
    this.listeners.clear()
  }

  private followUp() {
    const c = this.chain
    if (!c) return Promise.resolve('failed' as const)
    // no question: only the request the student made carries what they asked
    return this.ask({ area: c.area, window: c.window, problemId: c.problemId }, true)
  }

  private async ask(target: HelpTarget, continuing: boolean): Promise<'ok' | 'busy' | 'failed'> {
    if (this.asking) return 'busy'
    const before = { phase: this.phase, due: this.due, left: this.deadline - this.d.now() }
    this.asking = true
    this.inkWhileAsking = false
    this.due = false
    this.stopTimer()
    // the hint fetched ahead of time answers this, unless the student asked something out loud just now
    const pre = continuing && !target.question ? this.pre : null
    this.pre = null
    const epoch = this.epoch
    this.set('asking')
    let res: HelpAttempt = null
    try {
      let shown = false
      if (pre) {
        const held = await pre.held.catch(() => null)
        if (epoch === this.epoch && this.inkWhileAsking) {
          // they started writing while it was on its way: it is out of date, and their check comes first
          this.asking = false
          this.set('watching')
          return 'ok'
        }
        if (epoch === this.epoch && held != null) {
          res = this.d.show(held)
          shown = res !== null && res !== 'busy'
        }
      }
      if (!shown && epoch === this.epoch) res = await this.d.request(target)
    } catch {
      res = null
    } finally {
      this.asking = false
    }
    if (epoch !== this.epoch) return res === 'busy' ? 'busy' : res ? 'ok' : 'failed' // cancelled meanwhile
    if (res === 'busy') {
      // nothing was sent: put things back; a follow-up that could not go out goes when the other request is done
      if (!this.chain) this.set('idle')
      else if (this.inkWhileAsking) this.set('watching')
      else if (before.phase === 'watching') {
        this.due = before.due
        this.set('watching')
      } else if (before.left > 0) this.count(before.left)
      else {
        this.due = true
        this.set('counting')
      }
      return 'busy'
    }
    if (!res || !res.raised) {
      this.end() // failed, or the tutor had nothing to add
      return res ? 'ok' : 'failed'
    }
    const old = continuing ? this.chain : null
    this.chain = {
      area: target.area,
      window: old?.window ?? res.window,
      problemId: res.raised.problemId,
      level: res.raised.level,
    }
    if (res.raised.level >= MAX_HINT_LEVEL) this.end()
    else if (this.inkWhileAsking) this.set('watching')
    else this.count()
    return 'ok'
  }

  /** Start the countdown to the next hint, and fetch that hint now so it is ready when the countdown ends. */
  private count(ms = this.d.stuckMs) {
    this.startTimer(ms)
    const c = this.chain
    if (this.pre || !c) return
    try {
      const held = this.d.prefetch({ area: c.area, window: c.window, problemId: c.problemId })
      held.catch(() => {}) // a failed prefetch is simply not used
      this.pre = { held }
    } catch {
      // no prefetch: the hint is asked for when the countdown ends
    }
  }

  private startTimer(ms = this.d.stuckMs) {
    this.stopTimer()
    this.deadline = this.d.now() + ms
    this.timer = this.d.setTimer(() => {
      this.timer = null
      void this.followUp()
    }, ms)
    this.set('counting')
  }

  private stopTimer() {
    if (this.timer !== null) this.d.clearTimer(this.timer)
    this.timer = null
  }

  private end() {
    this.stopTimer()
    this.epoch++
    this.pre = null
    this.chain = null
    this.due = false
    this.set('idle')
  }

  private set(phase: ChainPhase) {
    this.phase = phase
    this.snap = this.makeSnapshot()
    for (const fn of this.listeners) fn()
  }

  private makeSnapshot(): ChainSnapshot {
    return { phase: this.phase, level: this.chain?.level ?? 0, deadline: this.deadline, totalMs: this.d.stuckMs }
  }
}
