import { describe, expect, it } from 'vitest'
import type { Action, CheckResponse } from '../contract'
import wrongDerivative from '../../../contract/examples/wrong_derivative.json'
import { shapesForAction } from './actions'
import { revealBounds, staleShapeIds, type OldShape } from './apply'

const frame = { x: 0, y: 0, w: 1000, h: 1000 }
const wrong = wrongDerivative as unknown as CheckResponse
const linesOf = (r: CheckResponse) => new Map(r.lines.map((l) => [l.line_id, { x: l.box[1], y: l.box[0], w: l.box[3] - l.box[1], h: l.box[2] - l.box[0] }]))

/** What a reply leaves on the page, as the next reply will find it. */
function drawn(reply: CheckResponse): OldShape[] {
  const ctx = { zoom: 1, lines: linesOf(reply) }
  return reply.actions.flatMap((a) => shapesForAction(a, frame, ctx)).map((s, i) => ({ id: `shape:${i}`, meta: s.meta as Record<string, unknown> }))
}

/** The same reply with every line id changed, as when a line is read again from another window. */
function renamed(reply: CheckResponse, to: string): CheckResponse {
  const swap = (id: string) => (id === 'L2' ? to : id)
  return {
    ...reply,
    lines: reply.lines.map((l) => ({ ...l, line_id: swap(l.line_id) })),
    actions: reply.actions.map((a) => ({ ...a, line_id: a.line_id && swap(a.line_id) })),
  }
}

describe('staleShapeIds', () => {
  const old = drawn(wrong) // a circle and a note for L2

  it('new feedback for the same line id replaces the old', () => {
    expect(staleShapeIds(old, wrong, frame, { zoom: 1, lines: linesOf(wrong) })).toEqual(['shape:0', 'shape:1'])
  })

  it('new feedback for the same writing under another id replaces the old too', () => {
    const again = renamed(wrong, 'L9')
    expect(staleShapeIds(old, again, frame, { zoom: 1, lines: linesOf(again) })).toEqual(['shape:0', 'shape:1'])
  })

  it('also when the new action has no line id at all, or a slightly different box', () => {
    const note: Action = { type: 'note', box: [205, 90, 262, 410], text: 'Look again' }
    expect(staleShapeIds(old, { actions: [note], clear_line_ids: [] }, frame)).toEqual(['shape:0', 'shape:1'])
  })

  it('feedback for another line is left alone', () => {
    const other: Action = { type: 'note', line_id: 'L5', box: [300, 80, 360, 400], text: 'Nice' }
    expect(staleShapeIds(old, { actions: [other], clear_line_ids: [] }, frame)).toEqual([])
    // the line above (L1, y 120..180) does not count as the same writing either
    const above: Action = { type: 'underline', line_id: 'L1', box: [120, 80, 180, 420] }
    expect(staleShapeIds(old, { actions: [above], clear_line_ids: [] }, frame)).toEqual([])
  })

  it('figures and lesson cards are never removed by place', () => {
    const anchor = { ax: 80, ay: 200, aw: 320, ah: 60 }
    const cards: OldShape[] = [
      { id: 'fig', meta: { ai: true, line_id: 'L7', kind: 'figure', ...anchor } },
      { id: 'lesson', meta: { ai: true, line_id: 'L7', kind: 'lesson', ...anchor } },
      { id: 'reading', meta: { ai: true, line_id: null, kind: 'reading' } },
    ]
    expect(staleShapeIds(cards, wrong, frame, { zoom: 1, lines: linesOf(wrong) })).toEqual([])
  })

  it('old marks without a recorded anchor: circles and underlines go by their own bounds', () => {
    const legacy: OldShape[] = [
      { id: 'c', meta: { ai: true, line_id: 'L9', kind: 'circle' }, rect: { x: 292, y: 192, w: 116, h: 76 } },
      { id: 'n', meta: { ai: true, line_id: 'L9', kind: 'note' }, rect: { x: 415, y: 200, w: 200, h: 80 } },
    ]
    expect(staleShapeIds(legacy, wrong, frame, { zoom: 1, lines: linesOf(wrong) })).toEqual(['c'])
  })

  it('a leader line goes with its note: by line id, and by place when the id has changed', () => {
    const anchor = { ax: 300, ay: 200, aw: 100, ah: 60 }
    const page: OldShape[] = [
      { id: 'n', meta: { ai: true, kind: 'note', line_id: 'L2', ...anchor } },
      { id: 'l', meta: { ai: true, kind: 'leader', line_id: 'L2', ...anchor } },
    ]
    expect(staleShapeIds(page, wrong, frame, { zoom: 1, lines: linesOf(wrong) })).toEqual(['n', 'l'])
    const again = renamed(wrong, 'L9')
    expect(staleShapeIds(page, again, frame, { zoom: 1, lines: linesOf(again) })).toEqual(['n', 'l'])
  })

  it('clear_line_ids removes everything of that line, lesson included', () => {
    const shapes: OldShape[] = [
      { id: 'n', meta: { ai: true, line_id: 'L3', kind: 'note' } },
      { id: 'l', meta: { ai: true, line_id: 'L3', kind: 'lesson' } },
      { id: 'student', meta: {} },
    ]
    expect(staleShapeIds(shapes, { actions: [], clear_line_ids: ['L3'] }, frame)).toEqual(['n', 'l'])
  })

  it('a lesson card survives a hint for its line; a new lesson replaces only the old lesson', () => {
    const shapes: OldShape[] = [
      { id: 'n', meta: { ai: true, line_id: 'L3', kind: 'note' } },
      { id: 'l', meta: { ai: true, line_id: 'L3', kind: 'lesson' } },
    ]
    const hint: Action = { type: 'note', line_id: 'L3', text: 'Try again' }
    expect(staleShapeIds(shapes, { actions: [hint], clear_line_ids: [] }, frame)).toEqual(['n'])
    const lesson: Action = { type: 'lesson', line_id: 'L3', lesson: { title: 't', steps: [] } }
    expect(staleShapeIds(shapes, { actions: [lesson], clear_line_ids: [] }, frame)).toEqual(['l'])
  })

  it('a lesson never removes the inline answer or marks already on its line', () => {
    const shapes: OldShape[] = [
      { id: 'answer', meta: { ai: true, line_id: 'L2', kind: 'note' } },
      { id: 'ring', meta: { ai: true, line_id: 'L2', kind: 'circle' } },
    ]
    const lesson: Action = { type: 'lesson', line_id: 'L2', box: [480, 60, 590, 470], lesson: { title: 't', steps: [] } }
    expect(staleShapeIds(shapes, { actions: [lesson], clear_line_ids: [] }, frame)).toEqual([])
  })
})

describe('revealBounds', () => {
  const view = { x: 0, y: 0, w: 1000, h: 800 }
  const line = { x: 100, y: 300, w: 300, h: 40 }

  it('nothing to do when what was placed is in view', () => {
    expect(revealBounds([{ x: 420, y: 300, w: 200, h: 100 }], [line], view)).toBeNull()
    expect(revealBounds([{ x: 900, y: 300, w: 120, h: 100 }], [line], view)).toBeNull() // a sliver over the edge
  })

  it('a graph in the margin, off screen: it and the line it is about', () => {
    expect(revealBounds([{ x: -400, y: 300, w: 380, h: 280 }], [line], view)).toEqual({ x: -400, y: 300, w: 800, h: 280 })
  })

  it('leaves the camera alone when the student is looking somewhere else', () => {
    expect(revealBounds([{ x: 5000, y: 5300, w: 380, h: 280 }], [{ x: 5000, y: 5000, w: 300, h: 40 }], view)).toBeNull()
  })
})

describe('new feedback replaces only old feedback of its own kind', () => {
  const on = (kind: string, id: string): OldShape => ({ id, meta: { ai: true, kind, line_id: 'L3' } })
  const page = [on('solution', 'sol:0'), on('solution', 'sol:1'), on('note', 'note:0'), on('figure', 'fig:0')]
  const reply = (...actions: Partial<Action>[]) => ({ actions: actions.map((a) => ({ line_id: 'L3', ...a }) as Action), clear_line_ids: [] })

  it('a graph asked for after a worked solution keeps the solution and the notes', () => {
    const fig = { type: 'figure' as const, figure: { kind: 'plot2d' as const, expressions: ['x*sin(x)'], x_range: [-10, 10] as [number, number] } }
    expect(staleShapeIds(page, reply(fig), frame)).toEqual(['fig:0'])
  })
  it('a new hint replaces the old hint, not the solution or the graph', () => {
    expect(staleShapeIds(page, reply({ type: 'note', text: 'another hint' }), frame)).toEqual(['note:0'])
  })
  it('a new solution replaces the old one only', () => {
    expect(staleShapeIds(page, reply({ type: 'solution', steps: ['x = 1'] }), frame)).toEqual(['sol:0', 'sol:1'])
  })
  it('a cleared line still loses everything on it', () => {
    expect(staleShapeIds(page, { actions: [], clear_line_ids: ['L3'] }, frame)).toEqual(['sol:0', 'sol:1', 'note:0', 'fig:0'])
  })
})
