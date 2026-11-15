import { describe, expect, it } from 'vitest'
import type { Action, CheckResponse, FbdFigure } from '../contract'
import example from '../../../contract/examples/fbd.json'
import { arrowEnd, fbdSvg, fbdToDataUrl, missingForces } from './fbd'

const fig = (example as unknown as CheckResponse).actions.find((a: Action) => a.type === 'figure')!.figure!
const fbd = fig.fbd as FbdFigure

describe('free-body diagram', () => {
  it('finds the force the student left out (friction)', () => {
    expect(missingForces(fbd).map((f) => f.label)).toEqual(['f'])
  })

  it('a force drawn under another label but the same direction is not missing', () => {
    const drawnAsF = { ...fbd, forces: [...fbd.forces, { id: 'F9', label: 'Ff', angle_deg: 35, on: 'B' }] }
    expect(missingForces(drawnAsF)).toEqual([])
  })

  it('arrows point the way their angle says (SVG y grows downwards)', () => {
    const [x, y] = arrowEnd(100, 100, 90, 10) // up
    expect(x).toBeCloseTo(100)
    expect(y).toBeCloseTo(90)
    const [x2, y2] = arrowEnd(100, 100, 0, 10) // right
    expect(x2).toBeCloseTo(110)
    expect(y2).toBeCloseTo(100)
  })

  it('draws the drawn forces solid, the missing one dashed with a "?", the ramp angle and the title', () => {
    const svg = fbdSvg(fbd, 'Block on a 30° ramp')
    expect(svg).toContain('>mg<')
    expect(svg).toContain('>N<')
    expect(svg).toContain('>f?<')
    expect((svg.match(/stroke-dasharray="7 5"/g) ?? []).length).toBe(1)
    expect(svg).toContain('30°')
    expect(svg).toContain('Block on a 30° ramp')
    expect(fbdToDataUrl(fbd).startsWith('data:image/svg+xml')).toBe(true)
  })

  it('no surface, no expected: just the body and its arrows, nothing dashed', () => {
    const svg = fbdSvg({ bodies: [{ id: 'P', shape: 'point' }], forces: [{ id: 'T', label: 'T', angle_deg: 90, on: 'P' }] })
    expect(svg).toContain('<circle')
    expect(svg).not.toContain('stroke-dasharray="7 5"')
  })

  it('escapes labels', () => {
    expect(fbdSvg({ bodies: [{ id: 'B', shape: 'box' }], forces: [{ id: 'x', label: '<b>', angle_deg: 0, on: 'B' }] })).toContain('&lt;b&gt;')
  })
})
