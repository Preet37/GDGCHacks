import { describe, expect, it } from 'vitest'
import { assignStrokes, type CharBox } from './assign'
import { writeLine } from './testHand'
import type { Rect, Stroke } from './types'

const line = (x0: number, y0: number, x1: number, y1: number, n = 12): Stroke =>
  Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: y0 + ((y1 - y0) * i) / (n - 1) }))
const box = (char: string, x: number, y: number, w: number, h: number): CharBox => ({ char, rect: { x, y, w, h } })
const sloppy = (r: Rect, by: number): Rect => ({ x: r.x - r.w * by, y: r.y + r.h * by, w: r.w * (1 + by), h: r.h * (1 - by) })

describe('assignStrokes', () => {
  it('gives every stroke to the character whose box holds it', () => {
    const w = writeLine('f(x) = 3x^2 + 12x', 100, 300, 40)
    const got = assignStrokes(w.strokes, w.boxes)
    expect(got.map((g) => g.char).join('')).toBe('f(x)=3x2+12x')
    // multi-stroke characters keep all their strokes
    expect(got.find((g) => g.char === '=')!.strokes).toHaveLength(2)
    expect(got.find((g) => g.char === 'x')!.strokes).toHaveLength(2)
    expect(got.find((g) => g.char === 'f')!.strokes).toHaveLength(2)
    // no stroke is used twice
    const used = got.flatMap((g) => g.ids)
    expect(new Set(used).size).toBe(used.length)
  })

  it('copes with boxes that are a little off, as boxes read from a picture are', () => {
    const w = writeLine('y = 2x + 7', 100, 300, 40)
    const boxes = w.boxes.map((b, i) => ({ char: b.char, rect: sloppy(b.rect, i % 2 ? 0.08 : -0.06) }))
    expect(assignStrokes(w.strokes, boxes).map((g) => g.char).join('')).toBe('y=2x+7')
  })

  it('measures a character by its ink, not by the box it was given', () => {
    const stroke = line(100, 100, 100, 160)
    const [got] = assignStrokes([stroke], [box('1', 90, 95, 25, 70)])
    expect(got.rect).toEqual({ x: 100, y: 100, w: 0, h: 60 })
  })

  it('drops a stroke that runs through several characters, and the characters it runs through', () => {
    const a = line(100, 100, 100, 160) // a "1"
    const b = line(200, 100, 200, 160) // another "1"
    const join = line(105, 150, 240, 150) // a long bar under both and beyond
    const c = line(400, 100, 400, 160) // a third, untouched
    const got = assignStrokes([a, b, join, c], [box('1', 90, 95, 30, 70), box('1', 190, 95, 30, 70), box('1', 390, 95, 30, 70)])
    expect(got).toHaveLength(1)
    expect(got[0].ids).toEqual([3])
  })

  it('drops a character whose strokes do not fill its box (a stroke is missing)', () => {
    const half = line(100, 100, 130, 110) // only the top bar of something 60 tall
    expect(assignStrokes([half], [box('5', 98, 98, 36, 62)])).toEqual([])
  })

  it('sorts out overlapping boxes: an x tucked inside its brackets', () => {
    const open = line(100, 100, 92, 180, 20)
    const x1 = line(104, 120, 128, 160)
    const x2 = line(128, 120, 104, 160)
    const close = line(132, 100, 140, 180, 20)
    const got = assignStrokes([open, x1, x2, close], [box('(', 88, 98, 20, 84), box('x', 100, 116, 32, 48), box(')', 126, 98, 18, 84)])
    expect(got.map((g) => `${g.char}${g.ids.join(',')}`)).toEqual(['(0', 'x1,2', ')3'])
  })

  it('finds the equals and minus signs the reader left out', () => {
    const w = writeLine('x = 4 - 6', 100, 300, 40)
    const boxes = w.boxes.filter((b) => b.char !== '=' && b.char !== '-')
    const got = assignStrokes(w.strokes, boxes)
    expect(got.map((g) => g.char).join('')).toBe('x=4-6')
    expect(got.find((g) => g.char === '=')!.strokes).toHaveLength(2)
  })

  it('does not take an underline or a far-away dash for a minus sign', () => {
    const w = writeLine('12', 100, 300, 40)
    const underline = line(95, 315, 190, 315) // under the digits
    const stray = line(900, 280, 930, 280) // nowhere near
    const got = assignStrokes([...w.strokes, underline, stray], w.boxes)
    expect(got.map((g) => g.char).join('')).toBe('12')
  })

  it('returns nothing when there are no boxes', () => {
    expect(assignStrokes([line(0, 0, 10, 10)], [])).toEqual([])
  })
})
