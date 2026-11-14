import { describe, expect, it } from 'vitest'
import { exportScale } from './exportImage'

describe('exportScale', () => {
  it('shrinks so the longest side is 1280', () => {
    expect(exportScale({ x: 0, y: 0, w: 2560, h: 800 }) * 2560).toBe(1280)
    expect(exportScale({ x: 0, y: 0, w: 600, h: 3840 }) * 3840).toBe(1280)
  })

  it('never upscales small pages', () => {
    expect(exportScale({ x: 0, y: 0, w: 400, h: 300 })).toBe(1)
  })
})
