import { describe, expect, it } from 'vitest'
import type { CheckResponse } from '../contract'
import example from '../../../contract/examples/wrong_derivative.json'
import { isPrinted, readingRects, readingShapes } from './reading'

const lines = (example as unknown as CheckResponse).lines
const bounds = { x: 0, y: 0, w: 1000, h: 1000 }

describe('readingShapes', () => {
  it('puts gray text just under each line', () => {
    const shapes = readingShapes(lines, bounds)
    expect(shapes).toHaveLength(2)
    expect(shapes[0]).toMatchObject({ x: 80, y: 182, meta: { ai: true, kind: 'reading' } })
    expect(JSON.stringify(shapes[1].props)).toContain("f'(x) = 6x + 1")
  })

  it('is sized to the writing, and readable at the current zoom', () => {
    const scale = (zoom: number, frame: number) => {
      const [s] = readingShapes(lines, { x: 0, y: 0, w: frame, h: frame }, { zoom, view: { x: 0, y: 0, w: 1024 / zoom, h: 768 / zoom } })
      return (s.props as { scale: number }).scale
    }
    expect(scale(1, 1000) * 18).toBeCloseTo(60 * 0.22) // 22% of the 60-unit line
    expect(scale(0.1, 1000) * 18 * 0.1).toBeCloseTo(11) // never under 11 px on screen
    expect(scale(0.3, 1000 / 0.3) * 0.3).toBeCloseTo(scale(1, 1000)) // same on screen at any zoom
  })

  it('skips printed worksheet lines', () => {
    const printed = { ...lines[0], source: 'printed' as const }
    expect(isPrinted(printed)).toBe(true)
    expect(isPrinted(lines[0])).toBe(false)
    expect(readingShapes([printed, lines[1]], bounds)).toHaveLength(1)
  })

  it('says where the labels are, so notes can keep clear of them', () => {
    const rects = readingRects(lines, bounds)
    expect(rects).toHaveLength(2)
    expect(rects[0]).toMatchObject({ x: 80, y: 182 })
    const font = 60 * 0.22
    expect(rects[0].h).toBeCloseTo(font * 1.35)
    // about as wide as its text
    expect(rects[1].w).toBeGreaterThan(font * 5)
    expect(rects[1].w).toBeLessThan(font * 14)
    expect(readingRects([{ ...lines[0], source: 'printed' as const }], bounds)).toEqual([])
  })
})
