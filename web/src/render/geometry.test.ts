import { describe, expect, it } from 'vitest'
import { beside, boxToPage, expand, pageToBox } from './geometry'

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
