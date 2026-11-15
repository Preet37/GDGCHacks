import { b64Vecs, type Editor } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { emptyBank } from './bank'
import { bankFrom } from './testHand'
import { placeAfter, strokesOnPage, studentPen, writeInHand, writeLinesInHand } from './write'
import { layoutText } from './layout'

interface FakeShape {
  id: string
  type: string
  x: number
  y: number
  meta: Record<string, unknown>
  props: Record<string, unknown>
  bounds?: { x: number; y: number; w: number; h: number }
}

/** Just enough of an editor: a list of shapes that can be added to. */
function fakeEditor(shapes: FakeShape[] = []) {
  const editor = {
    shapes,
    getCurrentPageShapes: () => shapes,
    getCurrentPageShapesSorted: () => shapes,
    getShapePageBounds: (s: FakeShape) => s.bounds,
    getShape: (id: string) => shapes.find((s) => s.id === id),
    run: (fn: () => void) => fn(),
    createShapes: (list: FakeShape[]) => void shapes.push(...list),
    createShape: (s: FakeShape) => void shapes.push(s),
    deleteShapes: (ids: string[]) => void ids.forEach((id) => shapes.splice(shapes.findIndex((s) => s.id === id), 1)),
  }
  return editor as unknown as Editor & { shapes: FakeShape[] }
}

const ink = (id: string, x: number, y: number, w: number, h: number, props: Record<string, unknown> = {}): FakeShape => ({
  id,
  type: 'draw',
  x,
  y,
  meta: {},
  props: { color: 'blue', size: 's', dash: 'draw', isPen: true, scale: 1, isComplete: true, ...props },
  bounds: { x, y, w, h },
})

const bank = bankFrom(['f(x) = 3x^2 + 12x - 7', 'y = 2x + 1'])
const at = { x: 500, baseline: 300, xHeight: 40, line_id: 'L2', anchor: { x: 100, y: 240, w: 380, h: 70 } }

describe('writeInHand', () => {
  it('draws nothing and says so when the hand is not known yet', () => {
    const editor = fakeEditor()
    expect(writeInHand(editor, '12x', at, { bank: emptyBank(), animate: false })).toBeNull()
    expect(editor.shapes).toHaveLength(0)
  })

  it('refuses text it cannot write on one line', () => {
    const editor = fakeEditor()
    expect(writeInHand(editor, 'x = 1\nx = 2', at, { bank, animate: false })).toBeNull()
    expect(writeInHand(editor, '  ', at, { bank, animate: false })).toBeNull()
    expect(writeInHand(editor, '12x', { ...at, xHeight: 0 }, { bank, animate: false })).toBeNull()
    expect(editor.shapes).toHaveLength(0)
  })

  it('writes pen strokes tagged as tutor feedback for the line, in the student\'s pen', () => {
    const editor = fakeEditor([ink('shape:old', 100, 250, 30, 50, { color: 'red', size: 'l' }), ink('shape:new', 300, 250, 30, 50, { color: 'blue', size: 's' })])
    const r = writeInHand(editor, '12x', at, { bank, animate: false, seed: 1 })!
    expect(r.mode).toBe('hand')
    const made = editor.shapes.filter((s) => s.meta.ai === true)
    expect(made).toHaveLength(4) // 1, 2, and the two strokes of x
    expect(made.map((s) => s.id)).toEqual(r.ids)
    for (const s of made) {
      expect(s.type).toBe('draw')
      expect(s.meta).toMatchObject({ ai: true, line_id: 'L2', kind: 'hand', ax: 100, ay: 240, aw: 380, ah: 70 })
      expect(s.props).toMatchObject({ color: 'blue', size: 's', dash: 'draw', isPen: true, isComplete: true, fill: 'none' })
    }
  })

  it('puts the writing where it was asked for: on the baseline, at the size given', () => {
    const editor = fakeEditor()
    const r = writeInHand(editor, '12x', at, { bank, animate: false, seed: 1, jitter: 0 })!
    expect(r.rect.x).toBeCloseTo(500, 0)
    expect(Math.abs(r.rect.y + r.rect.h - 300)).toBeLessThan(1.5) // feet on the baseline
    expect(Math.abs(r.rect.h - 40 * 1.5)).toBeLessThan(2.5) // digits are 1.5 x-heights in this hand
    // the stored points really are there
    const first = editor.shapes[0]
    const pts = b64Vecs.decodePoints((first.props.segments as { path: string }[])[0].path)
    expect(pts.length).toBeGreaterThan(5)
    const ys = pts.map((p) => first.y + p.y)
    expect(Math.abs(Math.max(...ys) - 300)).toBeLessThan(1.5)
    expect(Math.abs(Math.min(...ys) - 240)).toBeLessThan(1.5)
  })

  it('shrinks a line that would be too wide, but not below readable', () => {
    const l = layoutText('3x^2 + 12x - 7', bank, { seed: 1, jitter: 0 })!
    const full = l.width * 40
    expect(strokesOnPage(l, { ...at, maxWidth: full / 1.25 }).unit).toBeCloseTo(32, 5)
    expect(strokesOnPage(l, { ...at, maxWidth: full / 10 }).unit).toBeCloseTo(24, 5)
    expect(strokesOnPage(l, { ...at, maxWidth: full * 2 }).unit).toBe(40)
  })

  it('writes a worked solution line under line, or not at all', () => {
    const editor = fakeEditor()
    const r = writeLinesInHand(editor, ['2x + 1 = 7', '2x = 6', 'x = 3'], { ...at, line_id: 'L9' }, { bank, animate: false, seed: 2, jitter: 0 })!
    expect(editor.shapes.length).toBe(r.ids.length)
    expect(editor.shapes.every((s) => s.meta.line_id === 'L9' && s.meta.kind === 'hand')).toBe(true)
    expect(r.rect.h).toBeGreaterThan(40 * 5) // three lines tall
    const none = fakeEditor()
    expect(writeLinesInHand(none, ['2x = 6', 'x = 🙂'], at, { bank, animate: false })).toBeNull()
    expect(none.shapes).toHaveLength(0)
  })
})

describe('placeAfter', () => {
  it('carries on after the last stroke of the line, on its baseline, at its size', () => {
    // "g'(x) =": tall strokes standing on y = 300, then the two bars of the equals sign
    const editor = fakeEditor([
      ink('a', 100, 240, 30, 60),
      ink('b', 140, 235, 12, 80),
      ink('c', 160, 260, 30, 40),
      ink('d', 195, 240, 12, 60),
      ink('e', 230, 268, 30, 3),
      ink('f', 230, 282, 30, 3),
      ink('other', 100, 500, 40, 60), // another line
    ])
    const p = placeAfter(editor, { x: 100, y: 235, w: 160, h: 80 }, bank)
    expect(p.baseline).toBeCloseTo(300, 0)
    expect(p.xHeight).toBeCloseTo(40, 0)
    expect(p.x).toBeGreaterThan(260)
    expect(p.x).toBeLessThan(260 + 40)
  })

  it('takes the pen from the newest stroke near the line', () => {
    const editor = fakeEditor([ink('a', 100, 240, 30, 60, { color: 'green' }), ink('b', 100, 600, 30, 60, { color: 'violet' })])
    expect(studentPen(editor, { x: 90, y: 230, w: 100, h: 80 }).color).toBe('green')
    expect(studentPen(editor).color).toBe('violet')
    expect(studentPen(fakeEditor()).color).toBe('black')
  })
})
