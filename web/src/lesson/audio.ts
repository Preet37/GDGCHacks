/** What the voice needs from the page's one audio output (so tests can fake it). */
export interface AudioPort {
  /**
   * Call inside a tap handler. iOS only lets audio start from a user gesture; playing a moment of
   * silence on the element now lets the same element play the narration when it arrives later.
   */
  unlock(): void
  /** Play `url` from its start. Exactly one of the callbacks' endings is reported, unless stop() comes first. */
  play(url: string, cb: AudioCallbacks): void
  /** Hold the sound where it is. */
  pause(): void
  /** Carry on from where pause() left it. */
  resume(): void
  /** Stop for good; the callbacks of the current play are never called. */
  stop(): void
  /** Silence without stopping, so timing is unchanged. */
  setMuted(muted: boolean): void
  /** How far into the current clip playback is, in ms. */
  positionMs(): number
}

export interface AudioCallbacks {
  /** sound is coming out; `durationMs` is the clip's length if the browser knows it */
  onStart: (durationMs?: number) => void
  onEnd: () => void
  /** it could not be played. `blocked` = the browser wants a tap first */
  onError: (blocked: boolean) => void
}

/** A WAV file's length in ms from its header, or undefined if `buf` is not a WAV this understands. */
export function wavDurationMs(buf: ArrayBuffer): number | undefined {
  const v = new DataView(buf)
  const tag = (at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))
  if (v.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return undefined
  let byteRate = 0
  for (let at = 12; at + 8 <= v.byteLength; ) {
    const id = tag(at)
    const size = v.getUint32(at + 4, true)
    if (id === 'fmt ' && at + 20 <= v.byteLength) byteRate = v.getUint32(at + 16, true)
    if (id === 'data') {
      if (!byteRate) return undefined
      // a streamed file may leave the size as 0 or all ones: what follows the header is the sound
      const rest = v.byteLength - (at + 8)
      const bytes = size === 0 || size > rest ? rest : size
      return (bytes / byteRate) * 1000
    }
    at += 8 + size + (size % 2)
  }
  return undefined
}

/** A WAV of silence (8-bit mono), as bytes. */
export function silentWav(ms = 60, rate = 8000): Uint8Array {
  const n = Math.max(1, Math.round((rate * ms) / 1000))
  const bytes = new Uint8Array(44 + n).fill(128)
  const v = new DataView(bytes.buffer)
  const put = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  put(0, 'RIFF')
  v.setUint32(4, 36 + n, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate, true) // bytes per second
  v.setUint16(32, 1, true)
  v.setUint16(34, 8, true)
  put(36, 'data')
  v.setUint32(40, n, true)
  return bytes
}

/** The page's one <audio> element. One element, reused, because iOS unlocks sound per element. */
class ElementAudio implements AudioPort {
  private el: HTMLAudioElement | null = null
  private token = 0
  private busy = false
  private unlocked = false
  private muted = false
  private silence: string | null = null

  private element(): HTMLAudioElement {
    if (!this.el) {
      this.el = new Audio()
      this.el.preload = 'auto'
      this.el.setAttribute('playsinline', '')
    }
    return this.el
  }

  unlock() {
    // already allowed, or in use right now (which also means allowed): leave it alone
    if (this.unlocked || this.busy) return
    try {
      const el = this.element()
      if (!this.silence) this.silence = URL.createObjectURL(new Blob([silentWav() as BlobPart], { type: 'audio/wav' }))
      const token = this.token
      el.muted = false
      el.src = this.silence
      el.play()
        ?.then(() => {
          this.unlocked = true
          if (token === this.token && !this.busy) el.pause()
        })
        .catch(() => {})
    } catch {
      // no audio here: the voice falls back
    }
  }

  play(url: string, cb: AudioCallbacks) {
    const token = ++this.token
    const live = () => token === this.token
    let started = false
    let over = false
    const fail = (blocked: boolean) => {
      if (!live() || over) return
      over = true
      this.busy = false
      cb.onError(blocked)
    }
    let el: HTMLAudioElement
    try {
      el = this.element()
    } catch {
      return fail(false)
    }
    this.busy = true
    el.onplaying = () => {
      if (!live() || started) return
      started = true
      this.unlocked = true
      cb.onStart(Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : undefined)
    }
    el.onended = () => {
      if (!live() || over) return
      over = true
      this.busy = false
      cb.onEnd()
    }
    el.onerror = () => fail(false)
    try {
      el.muted = this.muted
      el.src = url
      el.play()?.catch((err: { name?: string } | undefined) => {
        // AbortError = pause() or a new src came before it got going: not a failure
        if (err?.name !== 'AbortError') fail(err?.name === 'NotAllowedError')
      })
    } catch {
      fail(false)
    }
  }

  pause() {
    try {
      this.el?.pause()
    } catch {
      // ignore
    }
  }

  resume() {
    try {
      this.el?.play()?.catch(() => {})
    } catch {
      // ignore
    }
  }

  stop() {
    this.token++
    this.busy = false
    const el = this.el
    if (!el) return
    el.onplaying = el.onended = el.onerror = null
    try {
      el.pause()
    } catch {
      // ignore
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.el) this.el.muted = muted
  }

  positionMs() {
    return this.el ? this.el.currentTime * 1000 : 0
  }
}

let shared: AudioPort | null = null

/** The page's audio output, or null where there is none (tests, very old browsers). */
export function audioOut(): AudioPort | null {
  if (typeof window === 'undefined' || typeof Audio !== 'function') return null
  if (!shared) shared = new ElementAudio()
  return shared
}
