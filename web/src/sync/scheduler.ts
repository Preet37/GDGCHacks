export interface SchedulerOptions {
  delayMs: number
  /** Fingerprint of what would be sent; a send is skipped if it matches the last one sent. */
  key: () => string
  send: () => Promise<void>
  /** A pause ended but nothing had changed since the last send, so nothing was sent. */
  onSkip?: () => void
  /** A request (auto or exclusive) just finished and nothing is in flight. */
  onIdle?: () => void
}

/** A check that failed (network, server) is sent again by itself this many times, waiting longer each time. */
export const MAX_RETRIES = 2

/**
 * Sends after a pause in changes. Skips if nothing changed since the last send,
 * never overlaps requests, and if changes arrived mid-flight, schedules one more send after.
 * A failed send is retried a couple of times without waiting for another change.
 */
export class PauseScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private changedDuringFlight = false
  private lastKey: string | null = null
  private failures = 0
  private opts: SchedulerOptions

  constructor(opts: SchedulerOptions) {
    this.opts = opts
  }

  get busy() {
    return this.inFlight
  }

  /** Call on every change to the student's work. */
  poke() {
    this.failures = 0
    this.arm()
  }

  private arm() {
    if (this.inFlight) {
      this.changedDuringFlight = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.fire(), this.opts.delayMs)
  }

  /** Run `fn` exclusively (e.g. a Help request). Waits out nothing: returns false if busy. */
  async exclusive(fn: () => Promise<void>): Promise<boolean> {
    if (this.inFlight) return false
    // a pause that was being waited out starts again afterwards: Help must not swallow the
    // automatic check of what was just written
    const waiting = this.timer !== null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      await this.run(fn)
    } finally {
      if (waiting && !this.timer && !this.inFlight) this.arm()
    }
    return true
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async fire() {
    this.timer = null
    const key = this.opts.key()
    if (key === this.lastKey) {
      this.opts.onSkip?.()
      return
    }
    this.lastKey = key
    try {
      await this.run(this.opts.send)
      this.failures = 0
    } catch {
      // allow retrying the same page after a failure, and do: the student may be sitting there
      // waiting for the check, not writing anything that would trigger another one
      this.lastKey = null
      if (this.failures < MAX_RETRIES && !this.timer && !this.inFlight) {
        this.failures++
        this.timer = setTimeout(() => void this.fire(), this.opts.delayMs * 2 ** this.failures)
      }
    }
  }

  private async run(fn: () => Promise<void>) {
    this.inFlight = true
    try {
      await fn()
    } finally {
      this.inFlight = false
      if (this.changedDuringFlight) {
        this.changedDuringFlight = false
        this.poke()
      }
      this.opts.onIdle?.()
    }
  }
}

/** Small, fast string hash (FNV-1a) for fingerprinting shape records. */
export function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length
}
