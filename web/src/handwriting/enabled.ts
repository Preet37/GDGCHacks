/** The "Write in my handwriting" switch: off by default, remembered on this device. */
export const HANDWRITING_KEY = 'tutor.handwriting'
export const HANDWRITING_EVENT = 'tutor:handwriting'

let cached: boolean | null = null

/** Is "Write in my handwriting" switched on? Off by default; remembered on this device. */
export function handwritingEnabled(): boolean {
  if (cached === null) {
    try {
      cached = typeof localStorage !== 'undefined' && localStorage.getItem(HANDWRITING_KEY) === '1'
    } catch {
      cached = false
    }
  }
  return cached
}

export function setHandwritingEnabled(on: boolean) {
  cached = on
  try {
    if (on) localStorage.setItem(HANDWRITING_KEY, '1')
    else localStorage.removeItem(HANDWRITING_KEY)
  } catch {
    // private window: the choice lasts for this session
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HANDWRITING_EVENT))
}
