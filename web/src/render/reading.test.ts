import { describe, expect, it } from 'vitest'
import type { CheckResponse } from '../contract'
import example from '../../../contract/examples/wrong_derivative.json'
import { isPrinted, readingShapes } from './reading'

const lines = (example as unknown as CheckResponse).lines
const bounds = { x: 0, y: 0, w: 1000, h: 1000 }

describe('readingShapes', () => {
  it('puts gray text just under each line', () => {
    const shapes = readingShapes(lines, bounds)
    expect(shapes).toHaveLength(2)
    expect(shapes[0]).toMatchObject({ x: 80, y: 182, meta: { ai: true, kind: 'reading' } })
    expect(JSON.stringify(shapes[1].props)).toContain("f'(x) = 6x + 1")
  })

  it('skips printed worksheet lines (marker or source field)', () => {
    const printed = { ...lines[0], latex: '\\text{[printed]} Find f\'(x)' }
    expect(isPrinted(printed)).toBe(true)
    expect(isPrinted({ ...lines[0], source: 'printed' } as typeof lines[0])).toBe(true)
    expect(readingShapes([printed, lines[1]], bounds)).toHaveLength(1)
  })
})
