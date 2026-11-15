import { describe, expect, it } from 'vitest'
import { beside, boxToPage, expand, feedbackSizes, inlineAt, pageToBox, TEXT_LINE_HEIGHT } from './geometry'

const bounds = { x: 100, y: 50, w: 2000, h: 1000 }

describe('boxToPage', () => {
  it('maps the full box to the full bounds', () => {
    expect(boxToPage([0, 0, 1000, 1000], bounds)).toEqual(bounds)
  })

  it('uses [ymin, xmin, ymax, xmax] order', () => {
    // ymin=200, xmin=300, ymax=260, xmax=400
    expect(boxToPage([200, 300, 260, 400], bounds)).toEqual({ x: 100 + 600, y: 50 + 200, w: 200, h: 60 })
  })

  it('scales width and height independently for non-square images', () => {
    const r = boxToPage([0, 0, 500, 500], { x: 0, y: 0, w: 1280, h: 640 })
    expect(r).toEqual({ x: 0, y: 0, w: 640, h: 320 })
  })
})

describe('pageToBox', () => {
  it('round-trips with boxToPage', () => {
    const box: [number, number, number, number] = [120, 80, 180, 420]
    expect(pageToBox(boxToPage(box, bounds), bounds)).toEqual(box)
  })

  it('clamps to 0-1000', () => {
    expect(pageToBox({ x: 0, y: 0, w: 99999, h: 99999 }, bounds)).toEqual([0, 0, 1000, 1000])
  })
})

describe('helpers', () => {
  it('expand pads on every side', () => {
    expect(expand({ x: 10, y: 10, w: 20, h: 20 }, 5)).toEqual({ x: 5, y: 5, w: 30, h: 30 })
  })

  it('beside places right or below', () => {
    const r = { x: 10, y: 20, w: 100, h: 30 }
    expect(beside(r, 'right', 8)).toEqual({ x: 118, y: 20 })
    expect(beside(r, 'below', 8)).toEqual({ x: 10, y: 58 })
  })
})

describe('feedbackSizes', () => {
  it('scales notes, gaps, strokes and figures with the line height', () => {
    const s = feedbackSizes(150)
    expect(s.noteFont).toBe(60) // 40% of the handwriting
    expect(s.inlineFont).toBeCloseTo(112.5) // 75%
    expect(s.noteWidth).toBe(720)
    expect(s.gap).toBeCloseTo(37.5)
    expect(s.stroke).toBe(6)
    expect(s.figureH).toBe(525) // 3.5 line heights
    expect(s.figureW / s.figureH).toBeCloseTo(360 / 260)
  })

  it('keeps note text between 35% and 45% of ordinary handwriting', () => {
    for (const h of [50, 80, 120, 150]) {
      const ratio = feedbackSizes(h).noteFont / h
      expect(ratio).toBeGreaterThanOrEqual(0.35)
      expect(ratio).toBeLessThanOrEqual(0.45)
    }
  })

  it('clamps tiny and huge lines', () => {
    const tiny = feedbackSizes(10)
    expect(tiny).toMatchObject({ noteFont: 18, inlineFont: 18, gap: 12, pad: 8, stroke: 2, figureW: 360, figureH: 260 })
    const huge = feedbackSizes(2000)
    expect(huge).toMatchObject({ noteFont: 64, inlineFont: 160, gap: 48, pad: 24, stroke: 7, figureH: 720 })
  })

  it('falls back to a default line height for a missing or broken box', () => {
    expect(feedbackSizes(0)).toEqual(feedbackSizes(60))
    expect(feedbackSizes(NaN)).toEqual(feedbackSizes(60))
  })
})

describe('inlineAt', () => {
  it('starts just right of the rect and centres one text line on it', () => {
    const at = inlineAt({ x: 100, y: 200, w: 300, h: 150 }, 100, 20)
    expect(at.x).toBe(420)
    expect(at.y + (100 * TEXT_LINE_HEIGHT) / 2).toBe(275)
  })
})
