import { describe, expect, it, vi } from 'vitest'
import type { Action, Model3dFigure, ModelPart } from '../contract'
import example from '../../../contract/examples/model3d_bridge.json'
import { drawModel3d, MODEL3D_MIN_H, MODEL3D_MIN_W, MODEL3D_TYPE } from './figure'
import { loadsUsed, memberAxis, memberRadius, modelBounds, partGroups, partPoints, thinStroke, TL_COLORS } from './model3d/geometry'

const figureAction = example.actions.find((a) => a.type === 'figure') as unknown as Action
const bridge = figureAction.figure!.model3d as Model3dFigure

describe('model3d geometry', () => {
  it('bounds cover every part, centred on the model', () => {
    const b = modelBounds(bridge)
    expect(b.min[0]).toBeCloseTo(-105) // left anchorage: centre -100, 10 long
    expect(b.max[0]).toBeCloseTo(105)
    expect(b.max[2]).toBeCloseTo(38) // tower tops: deck 8 + 30
    expect(b.center[0]).toBeCloseTo(0)
    expect(b.radius).toBeGreaterThan(100)
  })

  it('corners of each shape', () => {
    const box: ModelPart = { id: 'b', name: 'B', shape: 'box', at: [0, 0, 5], size: [4, 2, 2], load: 'none' }
    expect(partPoints(box)).toEqual([[-2, -1, 4], [2, 1, 6]])
    const cyl: ModelPart = { id: 'c', name: 'C', shape: 'cylinder', at: [0, 0, 10], size: [1, 1, 20], load: 'compression' }
    expect(partPoints(cyl)).toEqual([[-1, -1, 0], [1, 1, 20]])
    const sph: ModelPart = { id: 's', name: 'S', shape: 'sphere', at: [1, 1, 1], size: [1, 1, 1], load: 'none' }
    expect(partPoints(sph)).toEqual([[0, 0, 0], [2, 2, 2]])
    expect(partPoints({ id: 'm', name: 'M', shape: 'member', load: 'none' })).toEqual([])
    const wheel: ModelPart = { id: 'w', name: 'W', shape: 'cylinder', axis: 'y', at: [0, 1, 0.3], size: [0.3, 0.3, 0.4], load: 'none' }
    expect(partPoints(wheel)).toEqual([[-0.3, 0.8, 0], [0.3, 1.2, 0.6]]) // lying on its side: length along y
    const curve: ModelPart = { id: 'c', name: 'C', shape: 'member', points: [[0, 0, 5], [1, 0, 1], [2, 0, 5]], load: 'tension' }
    expect(partPoints(curve)).toHaveLength(3)
  })

  it('a member runs from start to end', () => {
    const { mid, length, dir } = memberAxis([0, 0, 0], [3, 0, 4])
    expect(mid).toEqual([1.5, 0, 2])
    expect(length).toBe(5)
    expect(dir).toEqual([0.6, 0, 0.8])
  })

  it('member thickness is kept visible but never fat', () => {
    const m = (r: number): ModelPart => ({ id: 'm', name: 'M', shape: 'member', start: [0, 0, 0], end: [1, 0, 0], size: [r, 0, 0], load: 'tension' })
    expect(memberRadius(m(0), 100)).toBeCloseTo(0.5) // too thin: raised to see it
    expect(memberRadius(m(1), 100)).toBe(1)
    expect(memberRadius(m(50), 100)).toBeCloseTo(3) // too fat: capped
  })

  it('segments with one name are one part; legend lists loads used', () => {
    const groups = partGroups(bridge)
    const hangers = groups.find((g) => g.name === 'Hanger')!
    expect(hangers.ids).toHaveLength(22)
    expect(hangers.load).toBe('tension')
    expect(groups.filter((g) => g.name === 'Main cable')).toHaveLength(1)
    expect(loadsUsed(bridge)).toEqual(['tension', 'compression', 'bending'])
  })
})

describe('drawModel3d', () => {
  const fakeEditor = () => {
    const created: { type: string; props: { w: number; h: number; title: string; model: Model3dFigure }; meta: { ai: boolean } }[] = []
    const editor = { run: (fn: () => void) => fn(), createShapes: (s: never[]) => created.push(...s) }
    return { editor: editor as never, created }
  }

  it('puts a model card on the page with the model stored as JSON', () => {
    const { editor, created } = fakeEditor()
    expect(drawModel3d(editor, figureAction, { x: 10, y: 20, w: 300, h: 200 })).toBe(true)
    expect(created).toHaveLength(1)
    const s = created[0]
    expect(s.type).toBe(MODEL3D_TYPE)
    expect(s.meta.ai).toBe(true)
    expect(s.props.w).toBe(MODEL3D_MIN_W)
    expect(s.props.h).toBe(MODEL3D_MIN_H)
    expect(s.props.title).toBe('Suspension bridge')
    expect(s.props.model.parts).toHaveLength(bridge.parts.length)
    expect(s.props.model).not.toBe(bridge) // a copy, not the reply's object
  })

  it('no model or a broken editor: nothing drawn, no throw', () => {
    const { editor, created } = fakeEditor()
    const empty = { ...figureAction, figure: { ...figureAction.figure!, model3d: { parts: [] } } } as Action
    expect(drawModel3d(editor, empty, { x: 0, y: 0, w: 1, h: 1 })).toBe(false)
    expect(created).toHaveLength(0)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boom = { run: () => { throw new Error('boom') } } as never
    expect(drawModel3d(boom, figureAction, { x: 0, y: 0, w: 1, h: 1 })).toBe(false)
    warn.mockRestore()
  })
})

describe('marks drawn on the model', () => {
  it('a pen stroke is thinned before it is stuck onto the model, keeping both ends', () => {
    const pts: [number, number][] = Array.from({ length: 50 }, (_, i) => [i * 0.5, 0])
    const thin = thinStroke(pts)
    expect(thin[0]).toEqual([0, 0])
    expect(thin[thin.length - 1]).toEqual([24.5, 0])
    expect(thin.length).toBeLessThan(12)
    expect(thinStroke([[5, 5]])).toEqual([[5, 5]]) // a tap is a dot
  })

  it('every tldraw colour has a hex', () => {
    for (const c of ['black', 'blue', 'red', 'green', 'violet', 'orange']) expect(TL_COLORS[c]).toMatch(/^#[0-9a-f]{6}$/)
  })
})
