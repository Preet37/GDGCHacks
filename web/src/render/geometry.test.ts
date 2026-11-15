import { describe, expect, it } from 'vitest'
import { beside, boxToPage, expand, feedbackSizes, inlineAt, overlapRatio, pageToBox, placeBeside, TEXT_LINE_HEIGHT, textHeight } from './geometry'

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

/** A 1024 x 768 screen looking at the page at `zoom`. */
const screen = (zoom: number) => ({ zoom, view: { x: 0, y: 0, w: 1024 / zoom, h: 768 / zoom } })

describe('feedbackSizes', () => {
  it('scales notes, gaps, strokes and figures with the line height', () => {
    const s = feedbackSizes(150, screen(0.4))
    expect(s.noteFont).toBe(60) // 40% of the handwriting
    expect(s.inlineFont).toBeCloseTo(112.5) // 75%
    expect(s.noteWidth).toBe(720)
    expect(s.gap).toBeCloseTo(37.5)
    expect(s.pad).toBeCloseTo(18.75)
    expect(s.stroke).toBe(6)
    expect(s.figureH).toBe(640) // a third of the screen's shorter side: more than 3.5 line heights here
    expect(s.figureW / s.figureH).toBeCloseTo(360 / 260)
  })

  it('keeps note text between 35% and 45% of ordinary handwriting', () => {
    for (const h of [50, 80, 100]) {
      const ratio = feedbackSizes(h).noteFont / h
      expect(ratio).toBeGreaterThanOrEqual(0.35)
      expect(ratio).toBeLessThanOrEqual(0.45)
    }
  })

  it('same writing on screen at zoom 1 and zoom 0.3 gives the same on-screen sizes', () => {
    // 80 screen px of handwriting, whatever the zoom
    for (const screenH of [6, 30, 80, 200, 900]) {
      const a = feedbackSizes(screenH / 1, screen(1))
      const b = feedbackSizes(screenH / 0.3, screen(0.3))
      for (const key of Object.keys(a) as (keyof typeof a)[]) expect(b[key] * 0.3).toBeCloseTo(a[key] * 1, 6)
    }
  })

  it('zoomed out with big writing: nothing is held to a page-unit cap', () => {
    // 60 screen px tall writing at zoom 0.1 = 600 page units
    const s = feedbackSizes(600, screen(0.1))
    expect(s.noteFont).toBe(240) // 24 px on screen (was capped at 64 page units = 6 px)
    expect(s.inlineFont).toBe(450)
    expect(s.figureH * 0.1).toBeGreaterThanOrEqual(768 / 3) // a third of the screen
  })

  it('limits are screen sizes: at least 14 px text, at most a fraction of the viewport', () => {
    for (const zoom of [0.1, 0.3, 1, 3]) {
      const tiny = feedbackSizes(1, screen(zoom))
      expect(tiny.noteFont * zoom).toBeCloseTo(14)
      expect(tiny.inlineFont * zoom).toBeCloseTo(14)
      expect(tiny.readingFont * zoom).toBeCloseTo(11)
      expect(tiny.stroke * zoom).toBeCloseTo(2)
      expect(tiny.figureH * zoom).toBeCloseTo(768 / 3)
      const huge = feedbackSizes(1e6, screen(zoom))
      expect(huge.noteFont * zoom).toBeCloseTo(768 * 0.055)
      expect(huge.inlineFont * zoom).toBeCloseTo(768 * 0.14)
      expect(huge.figureH * zoom).toBeCloseTo(768 * 0.6)
      expect(huge.figureW * zoom).toBeLessThanOrEqual(1024 * 0.9)
      expect(huge.lessonW * zoom).toBeCloseTo(512) // half the viewport
    }
  })

  it('falls back to a default line height for a missing or broken box', () => {
    expect(feedbackSizes(0)).toEqual(feedbackSizes(60))
    expect(feedbackSizes(NaN)).toEqual(feedbackSizes(60))
  })
})

describe('textHeight', () => {
  const line = { x: 0, y: 0, w: 900, h: 400 } // "∫ 4x dx =" : the integral sign makes the box tall
  const ink = [
    { x: 0, y: 0, w: 60, h: 400 }, // ∫
    { x: 120, y: 140, w: 70, h: 120 }, // 4
    { x: 220, y: 170, w: 60, h: 80 }, // x
    { x: 230, y: 170, w: 60, h: 80 },
    { x: 330, y: 120, w: 80, h: 130 }, // d
    { x: 430, y: 170, w: 60, h: 80 }, // x
    { x: 440, y: 170, w: 60, h: 80 },
    { x: 700, y: 200, w: 100, h: 6 }, // =
    { x: 700, y: 230, w: 100, h: 6 },
  ]

  it('is the box height when the strokes are not known', () => {
    expect(textHeight(line)).toBe(400)
    expect(textHeight(line, [])).toBe(400)
  })

  it('follows the typical stroke, not a tall symbol', () => {
    const h = textHeight(line, ink)
    expect(h).toBeGreaterThan(100)
    expect(h).toBeLessThan(200)
  })

  it('never exceeds the box, and ignores strokes of other lines', () => {
    expect(textHeight({ x: 0, y: 0, w: 900, h: 100 }, ink.map((s) => ({ ...s, y: s.y + 1000 })))).toBe(100)
    expect(textHeight({ x: 100, y: 100, w: 420, h: 100 }, ink)).toBeLessThanOrEqual(100)
  })
})

describe('inlineAt', () => {
  it('starts just right of the rect, on the lower-middle of the box', () => {
    const at = inlineAt({ x: 100, y: 200, w: 300, h: 150 }, 100, 20)
    expect(at.x).toBe(420)
    const centre = at.y + (100 * TEXT_LINE_HEIGHT) / 2
    expect(centre).toBeGreaterThan(275) // below the middle
    expect(centre).toBeLessThan(200 + 150 * 0.7)
  })

  it('on a tall line it lines up with the "=" and starts after it with a gap', () => {
    const box = { x: 0, y: 0, w: 780, h: 400 } // read box stops a little short of the "="
    const ink = [
      { x: 0, y: 0, w: 60, h: 400 }, // ∫
      { x: 120, y: 140, w: 70, h: 120 },
      { x: 220, y: 170, w: 60, h: 80 },
      { x: 700, y: 200, w: 100, h: 6 }, // =
      { x: 700, y: 230, w: 100, h: 6 },
    ]
    const at = inlineAt(box, 100, 30, ink)
    expect(at.x).toBe(830) // after the ink, not the box
    expect(at.y + (100 * TEXT_LINE_HEIGHT) / 2).toBeCloseTo(218) // the middle of the "="
  })
})

describe('placeBeside', () => {
  const anchor = { x: 400, y: 300, w: 200, h: 60 }
  const size = [{ w: 300, h: 100 }]
  const view = { x: 0, y: 0, w: 1024, h: 768 }

  it('uses the requested side when it is free', () => {
    expect(placeBeside(anchor, size, 'right', 10, { zoom: 1, view })).toEqual({ x: 610, y: 300, w: 300, h: 100 })
    expect(placeBeside(anchor, size, 'below', 10, { zoom: 1, view })).toEqual({ x: 400, y: 370, w: 300, h: 100 })
  })

  it('moves to another side when ink is in the way', () => {
    const ink = [{ x: 650, y: 310, w: 100, h: 40 }]
    expect(placeBeside(anchor, size, 'right', 10, { zoom: 1, view, ink })).toEqual({ x: 400, y: 370, w: 300, h: 100 })
    // the next line is right below: an ask does not sit where the student writes next
    const next = [{ x: 400, y: 380, w: 180, h: 60 }]
    expect(placeBeside(anchor, size, 'below', 10, { zoom: 1, view, ink: next })).toEqual({ x: 610, y: 300, w: 300, h: 100 })
  })

  it('keeps clear of other tutor shapes too', () => {
    const taken = [{ x: 610, y: 300, w: 300, h: 60 }]
    expect(placeBeside(anchor, size, 'right', 10, { zoom: 1, view, taken }).y).toBe(370)
  })

  it('goes above when right and below are both taken', () => {
    const ink = [
      { x: 650, y: 310, w: 100, h: 40 },
      { x: 400, y: 380, w: 300, h: 60 },
    ]
    expect(placeBeside(anchor, size, 'right', 10, { zoom: 1, view, ink })).toEqual({ x: 400, y: 190, w: 300, h: 100 })
  })

  it('does not run off the screen: other side, then narrower', () => {
    const edge = { x: 800, y: 300, w: 200, h: 60 }
    expect(placeBeside(edge, size, 'right', 10, { zoom: 1, view }).x).toBe(800 - 0) // below: starts under the anchor
    expect(placeBeside(edge, size, 'right', 10, { zoom: 1, view }).y).toBe(370)
    // nothing fits at full width, a narrower wrap does
    const sizes = [
      { w: 600, h: 60 },
      { w: 200, h: 180 },
    ]
    expect(placeBeside(edge, sizes, 'right', 10, { zoom: 1, view })).toEqual({ x: 800, y: 370, w: 200, h: 180 })
  })

  it('takes the least crowded spot when nothing is free, and is deterministic', () => {
    const ink = [
      { x: 610, y: 300, w: 400, h: 100 }, // right: fully covered
      { x: 400, y: 370, w: 20, h: 20 }, // below: a dot
      { x: 400, y: 100, w: 400, h: 190 }, // above: covered
    ]
    const a = placeBeside(anchor, size, 'right', 10, { zoom: 1, view, ink })
    expect(a).toEqual({ x: 400, y: 370, w: 300, h: 100 })
    expect(placeBeside(anchor, size, 'right', 10, { zoom: 1, view, ink })).toEqual(a)
  })

  it('ignores the viewport when the anchor is not on screen', () => {
    const far = { x: 5000, y: 5000, w: 200, h: 60 }
    expect(placeBeside(far, size, 'right', 10, { zoom: 1, view })).toEqual({ x: 5210, y: 5000, w: 300, h: 100 })
  })
})

describe('overlapRatio', () => {
  it('is the shared part of the smaller rect', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }
    expect(overlapRatio(a, a)).toBe(1)
    expect(overlapRatio(a, { x: 50, y: 0, w: 100, h: 100 })).toBe(0.5)
    expect(overlapRatio(a, { x: 10, y: 10, w: 20, h: 20 })).toBe(1)
    expect(overlapRatio(a, { x: 200, y: 0, w: 100, h: 100 })).toBe(0)
  })
})
