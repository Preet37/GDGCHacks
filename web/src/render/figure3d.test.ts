import { describe, expect, it, vi } from 'vitest'
import type { Action, FigureSpec } from '../contract'
import example from '../../../contract/examples/surface3d.json'
import {
  cleanSpec,
  displayRange,
  heightColor,
  renderSurface3d,
  sampleSurface,
  surface3dShape,
  surfaceIndices,
  toSurfaceExpr,
  trySampleSurface,
} from './figure3d'

const spec = (expr: string, extra: Partial<FigureSpec> = {}): FigureSpec => ({
  kind: 'surface3d',
  expressions: [expr],
  x_range: [-2, 2],
  y_range: [-2, 2],
  ...extra,
})

describe('toSurfaceExpr', () => {
  it('drops a left-hand side and fixes **', () => {
    expect(toSurfaceExpr('z = x^2 + y^2')).toBe('x^2 + y^2')
    expect(toSurfaceExpr('f(x, y) = x**2 - y')).toBe('x^2 - y')
    expect(toSurfaceExpr('sin(x) * cos(y)')).toBe('sin(x) * cos(y)')
  })
})

describe('sampleSurface', () => {
  it('samples an (n+1) x (n+1) grid, x along columns and y along rows', () => {
    const g = sampleSurface(spec('x + 10*y', { x_range: [0, 4], y_range: [0, 2] }), 4)
    expect(g.z.length).toBe(25)
    expect(g.finiteCount).toBe(25)
    expect(g.z[0]).toBe(0) // (0, 0)
    expect(g.z[4]).toBe(4) // (4, 0)
    expect(g.z[5]).toBe(5) // (0, 0.5)
    expect(g.z[24]).toBe(24) // (4, 2)
    expect(g.z_range).toEqual([0, 24])
    expect(surfaceIndices(g).length).toBe(4 * 4 * 6)
  })

  it('reads the contract example', () => {
    const g = sampleSurface(example.actions[0].figure as FigureSpec)
    expect(g.n).toBe(60)
    expect(g.z_range[0]).toBeCloseTo(0, 5)
    expect(g.z_range[1]).toBeCloseTo(8, 5)
    expect(g.z[30 * 61 + 30]).toBeCloseTo(0, 5) // centre of the bowl
  })

  it('accepts implicit multiplication and uses x_range when y_range is missing', () => {
    const g = sampleSurface({ kind: 'surface3d', expressions: ['2x y'], x_range: [0, 1] }, 2)
    expect(g.y_range).toEqual([0, 1])
    expect(g.z[8]).toBe(2)
  })

  it('skips cells around a division by zero instead of failing', () => {
    const g = sampleSurface(spec('1 / (x^2 + y^2)'), 4) // the centre vertex is 1/0
    expect(Number.isNaN(g.z[12])).toBe(true)
    expect(g.finiteCount).toBe(24)
    expect(surfaceIndices(g).length).toBe((16 - 4) * 6) // the 4 cells touching the pole are dropped
    expect(g.z.every((v) => Number.isNaN(v) || (v >= g.z_range[0] && v <= g.z_range[1]))).toBe(true)
  })

  it('treats complex results as missing', () => {
    const g = sampleSurface(spec('sqrt(x)', { x_range: [-1, 1] }), 2)
    expect(Number.isNaN(g.z[0])).toBe(true)
    expect(g.z[2]).toBe(1)
  })

  it('cuts off a pole so the rest of the surface keeps its shape', () => {
    const g = sampleSurface(spec('1 / (x^2 + y^2)'), 61) // odd n: no sample exactly on the pole, just huge ones near it
    expect(g.finiteCount).toBe(62 * 62)
    expect(g.z_range[1]).toBeLessThan(20)
  })

  it('gives a flat surface a non-empty height range', () => {
    const g = sampleSurface(spec('3'), 4)
    expect(g.z_range[0]).toBeLessThan(3)
    expect(g.z_range[1]).toBeGreaterThan(3)
  })

  it('throws on specs that cannot be drawn', () => {
    expect(() => sampleSurface(spec('x^2 +* y'))).toThrow()
    expect(() => sampleSurface(spec(''))).toThrow()
    expect(() => sampleSurface(spec('0/0'))).toThrow('no finite values')
    expect(() => sampleSurface(spec('q + w'))).toThrow('no finite values') // unknown symbols
    expect(() => sampleSurface(spec('x', { x_range: [2, 2] }))).toThrow('bad x_range')
    expect(() => sampleSurface({ kind: 'surface3d', expressions: [] } as unknown as FigureSpec)).toThrow()
  })
})

describe('trySampleSurface', () => {
  it('returns null instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(trySampleSurface(spec('sin(('))).toBeNull()
    expect(trySampleSurface({} as FigureSpec)).toBeNull()
    expect(trySampleSurface(spec('x*y'))).not.toBeNull()
    warn.mockRestore()
  })
})

describe('displayRange', () => {
  it('ignores non-finite values', () => {
    expect(displayRange([NaN, 1, Infinity, 3, -Infinity])).toEqual([1, 3])
    expect(displayRange([NaN, Infinity])).toBeNull()
  })
})

describe('heightColor', () => {
  it('clamps and stays within 0..1', () => {
    expect(heightColor(-5)).toEqual(heightColor(0))
    expect(heightColor(7)).toEqual(heightColor(1))
    expect(heightColor(NaN)).toEqual(heightColor(0))
    for (const c of heightColor(0.37)) expect(c >= 0 && c <= 1).toBe(true)
  })
})

describe('surface3dShape', () => {
  const action = example.actions[0] as Action
  const rect = { x: 100, y: 50, w: 360, h: 260 }

  it('is tagged as AI feedback for its line and stores only the spec', () => {
    const s = surface3dShape(action, rect)!
    expect(s.type).toBe('surface3d')
    expect(s.meta).toEqual({ ai: true, line_id: 'L2', kind: 'figure' })
    expect(s.x).toBe(100)
    expect(s.y).toBe(50)
    expect(s.props.spec).toEqual(action.figure)
    expect(Object.keys(s.props).sort()).toEqual(['h', 'spec', 'w'])
    expect(JSON.parse(JSON.stringify(s.props))).toEqual(s.props) // plain JSON: survives a snapshot
  })

  it('ignores other actions', () => {
    expect(surface3dShape({ type: 'note', text: 'hi' }, rect)).toBeNull()
    expect(surface3dShape({ type: 'figure', figure: { kind: 'plot2d', expressions: ['x'], x_range: [0, 1] } }, rect)).toBeNull()
  })

  it('cleanSpec leaves no undefined keys', () => {
    const c = cleanSpec({ kind: 'surface3d', expressions: ['x'], x_range: [0, 1], y_range: undefined, title: undefined })
    expect(Object.keys(c).sort()).toEqual(['expressions', 'kind', 'x_range'])
  })
})

describe('renderSurface3d', () => {
  const fakeEditor = () => {
    const created: unknown[] = []
    const editor = { run: (fn: () => void) => fn(), createShapes: (s: unknown[]) => created.push(...s) }
    return { editor: editor as never, created }
  }

  it('creates one shape, even for a broken expression (the card says it could not draw)', async () => {
    const { editor, created } = fakeEditor()
    await renderSurface3d(editor, example.actions[0] as Action, { x: 0, y: 0, w: 360, h: 260 })
    await renderSurface3d(editor, { type: 'figure', figure: spec('x +* y') }, { x: 0, y: 0, w: 360, h: 260 })
    expect(created.length).toBe(2)
  })

  it('never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = { run: () => { throw new Error('boom') } } as never
    await expect(renderSurface3d(editor, example.actions[0] as Action, { x: 0, y: 0, w: 1, h: 1 })).resolves.toBeUndefined()
    warn.mockRestore()
  })
})
