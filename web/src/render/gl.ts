/** What the device looks like to the WebGL views. Passed in, so the choice can be tested without a DOM. */
export interface GlDevice {
  /** `matchMedia('(pointer: coarse)')` matches: the main pointer is a finger */
  coarse: boolean
  /** `navigator.maxTouchPoints` */
  touchPoints: number
  /** `window.devicePixelRatio` */
  dpr: number
}

export interface GlQuality {
  antialias: boolean
  pixelRatio: number
}

/**
 * How heavy a WebGL view may be. A touch device (the iPad) gets no antialiasing and at most 1.5 device
 * pixels per CSS pixel: an antialiased canvas at 2x costs several times the GPU memory, and iPad Safari
 * kills a tab that uses too much. A desktop keeps antialiasing and up to 2x.
 */
export function glQualityFor(device: GlDevice): GlQuality {
  const dpr = device.dpr > 0 ? device.dpr : 1
  const touch = device.coarse || device.touchPoints > 0
  return touch ? { antialias: false, pixelRatio: Math.min(1.5, dpr) } : { antialias: true, pixelRatio: Math.min(2, dpr) }
}

/** glQualityFor() for the device this page runs on. */
export function glQuality(): GlQuality {
  if (typeof window === 'undefined') return glQualityFor({ coarse: false, touchPoints: 0, dpr: 1 })
  let coarse = false
  try {
    coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  } catch {
    // no matchMedia: decide from the touch points alone
  }
  const touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0
  return glQualityFor({ coarse, touchPoints, dpr: window.devicePixelRatio || 1 })
}
