export interface SchedulerOptions {
  delayMs: number
  /** Fingerprint of what would be sent; a send is skipped if it matches the last one sent. */
  key: () => string
  send: () => Promise<void>
}

/**
 * Sends after a pause in changes. Skips if nothing changed since the last send,
 * never overlaps requests, and if changes arrived mid-flight, schedules one more send after.
 */
export class PauseScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private changedDuringFlight = false
  private lastKey: string | null = null
  private opts: SchedulerOptions

  constructor(opts: SchedulerOptions) {
    this.opts = opts
  }

  get busy() {
    return this.inFlight
  }

  /** Call on every change to the student's work. */
  poke() {
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
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.run(fn)
    return true
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async fire() {
    this.timer = null
    const key = this.opts.key()
    if (key === this.lastKey) return
    this.lastKey = key
    await this.run(this.opts.send).catch(() => {
      // allow retrying the same page after a failure
      this.lastKey = null
    })
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
