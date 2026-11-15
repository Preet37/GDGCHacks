import { describe, expect, it } from 'vitest'
import { glQuality, glQualityFor } from './gl'

describe('glQualityFor', () => {
  it('keeps antialiasing and up to 2x on a desktop', () => {
    expect(glQualityFor({ coarse: false, touchPoints: 0, dpr: 1 })).toEqual({ antialias: true, pixelRatio: 1 })
    expect(glQualityFor({ coarse: false, touchPoints: 0, dpr: 2 })).toEqual({ antialias: true, pixelRatio: 2 })
    expect(glQualityFor({ coarse: false, touchPoints: 0, dpr: 3 })).toEqual({ antialias: true, pixelRatio: 2 })
  })

  it('goes light on a touch device: no antialiasing, at most 1.5x', () => {
    expect(glQualityFor({ coarse: true, touchPoints: 5, dpr: 2 })).toEqual({ antialias: false, pixelRatio: 1.5 })
    expect(glQualityFor({ coarse: true, touchPoints: 5, dpr: 1 })).toEqual({ antialias: false, pixelRatio: 1 })
  })

  it('counts either sign of touch (an iPad with a trackpad reports a fine pointer but has touch points)', () => {
    expect(glQualityFor({ coarse: false, touchPoints: 5, dpr: 2 })).toEqual({ antialias: false, pixelRatio: 1.5 })
    expect(glQualityFor({ coarse: true, touchPoints: 0, dpr: 2 })).toEqual({ antialias: false, pixelRatio: 1.5 })
  })

  it('treats a missing pixel ratio as 1', () => {
    expect(glQualityFor({ coarse: false, touchPoints: 0, dpr: 0 }).pixelRatio).toBe(1)
    expect(glQualityFor({ coarse: true, touchPoints: 1, dpr: NaN }).pixelRatio).toBe(1)
  })

  it('glQuality() works without a DOM', () => {
    expect(glQuality()).toEqual({ antialias: true, pixelRatio: 1 })
  })
})
