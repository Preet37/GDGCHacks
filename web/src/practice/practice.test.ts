import { describe, expect, it } from 'vitest'
import type { Action, Practice } from '../contract'
import { lessonSpeed } from '../lesson/timing'
import { autoWindow } from '../page'
import { staleShapeIds } from '../render/apply'
import { type PageRect, type RenderContext } from '../render/geometry'
import { isStudentStroke } from '../handwriting/harvest'
import { givenLines, openPractices, solvedPractices } from './given'
import { latexToPlain, shapeUse } from './kind'
import { practiceLayout, practiceShapes, ROOM_EM } from './layout'
import { statusesOf } from './write'

const practice: Practice = { prompt: 'Your turn: find the derivative.', problem: 'g(x) = x^3', plain: 'g(x) = x^3', ask: "g'(x) =" }
const overlaps = (a: PageRect, b: PageRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** two handwritten lines: letters 40 tall, at x 100 */
const ink: PageRect[] = [0, 1, 2, 3, 4].flatMap((i) => [
  { x: 100 + i * 45, y: 100, w: 30, h: 40 },
  { x: 100 + i * 45, y: 180, w: 30, h: 40 },
])
const work: PageRect = { x: 100, y: 100, w: 210, h: 120 }
const ctx = (extra: Partial<RenderContext> = {}): RenderContext => ({ zoom: 1, view: { x: 0, y: 0, w: 820, h: 1180 }, ink, taken: [], ...extra })

describe('practiceLayout', () => {
  it('goes straight under the work, lined up with it, at the size of the handwriting', () => {
    const l = practiceLayout(practice, work, ctx())
    expect(l.rect.x).toBe(100)
    expect(l.rect.y).toBeGreaterThan(220)
    expect(l.rect.y).toBeLessThan(220 + 80)
    // letters about as tall as the student's (40): the font's capitals are ~0.75 em
    expect(l.font).toBeGreaterThanOrEqual(40)
    expect(l.font).toBeLessThanOrEqual(80)
    expect(l.labelFont).toBeLessThan(l.font)
    // label, then the problem, then the ask line
    expect(l.label.y).toBe(l.rect.y)
    expect(l.problem.y).toBeGreaterThanOrEqual(l.label.y + l.label.h)
    expect(l.ask!.y).toBeGreaterThanOrEqual(l.problem.y + l.problem.h)
    expect(l.problem.text).toBe('g(x) = x³')
  })

  it('leaves room to write: right of the ask line and below it', () => {
    const l = practiceLayout(practice, work, ctx())
    expect(l.rect.x + l.rect.w).toBeGreaterThanOrEqual(l.ask!.x + l.ask!.w + ROOM_EM * l.font - 1e-6)
    expect(l.rect.y + l.rect.h).toBeGreaterThanOrEqual(l.ask!.y + l.ask!.h + l.font * 2)
    const noAsk = practiceLayout({ ...practice, ask: undefined }, work, ctx())
    expect(noAsk.ask).toBeUndefined()
    expect(noAsk.rect.y + noAsk.rect.h).toBeGreaterThanOrEqual(noAsk.problem.y + noAsk.problem.h + noAsk.font * 3)
  })

  it('never lands on ink, feedback or printed text: it slides below them', () => {
    const more: PageRect = { x: 90, y: 250, w: 300, h: 50 } // another line of ink right under the work
    const note: PageRect = { x: 100, y: 320, w: 200, h: 60 } // a tutor note
    const printed: PageRect = { x: 0, y: 400, w: 600, h: 30 }
    const c = ctx({ ink: [...ink, more], taken: [note], printed: [printed] })
    const l = practiceLayout(practice, work, c)
    for (const o of [...ink, more, note, printed]) expect(overlaps(l.rect, o)).toBe(false)
    expect(l.rect.y).toBeGreaterThan(430)
    expect(c.taken).toContain(l.rect) // claimed
  })

  it('is written smaller when it would not fit across the screen', () => {
    const long = { ...practice, problem: 'h(x) = 3x^5 - 2x^4 + 7x^3 - x^2 + 9x - 12 + \\sin(x) + \\cos(x)' }
    const l = practiceLayout(long, work, ctx())
    expect(l.rect.w).toBeLessThanOrEqual(820 * 0.9 + 1)
  })

  it('makes label, problem and ask shapes that carry the practice', () => {
    const l = practiceLayout(practice, work, ctx())
    const shapes = practiceShapes(practice, l, 'pr_1')
    expect(shapes.map((s) => s.meta!.role)).toEqual(['label', 'problem', 'ask'])
    for (const s of shapes) {
      expect(s.meta).toMatchObject({ ai: true, kind: 'practice', practice_id: 'pr_1', solved: false })
      expect(JSON.parse(s.meta!.practice as string)).toEqual(practice)
      expect((s.props as { color: string }).color).toBe('violet')
    }
    expect(shapes[1].meta).toMatchObject({ latex: 'g(x) = x^3', plain: 'g(x) = x^3' })
    expect(shapes[2].meta).toMatchObject({ latex: "g'(x) =", plain: "g'(x) =" })
  })
})

const ai = (kind: string, extra: Record<string, unknown> = {}) => ({ type: 'text', meta: { ai: true, line_id: null, kind, ...extra } })
const label = ai('practice', { role: 'label', practice_id: 'p1' })
const problem = ai('practice', { role: 'problem', practice_id: 'p1', latex: 'g(x) = x^3', plain: 'g(x) = x^3' })
const ask = ai('practice', { role: 'ask', practice_id: 'p1', latex: "g'(x) =", plain: "g'(x) =" })

describe('shapeUse: what each kind of shape is to a check', () => {
  it('student ink and worksheets are sent and are the student\'s', () => {
    expect(shapeUse({ meta: {} })).toEqual({ exported: true, working: true, student: true, replaceable: false })
    expect(shapeUse({ meta: { worksheet: true } }).exported).toBe(true)
  })
  it('a practice problem and its ask line are sent and part of the working, but not the student\'s and never replaced', () => {
    for (const s of [problem, ask]) expect(shapeUse(s)).toEqual({ exported: true, working: true, student: false, replaceable: false })
  })
  it('the "Your turn" label is not sent', () => {
    expect(shapeUse(label)).toEqual({ exported: false, working: false, student: false, replaceable: false })
  })
  it('every other tutor shape is left out of the image and is replaceable', () => {
    for (const kind of ['note', 'ask', 'circle', 'underline', 'figure', 'lesson', 'solution', 'reading', 'hand', 'leader']) {
      expect(shapeUse(ai(kind))).toEqual({ exported: false, working: false, student: false, replaceable: true })
    }
  })
  it('practice text is never harvested as handwriting', () => {
    expect(isStudentStroke({ ...problem, type: 'draw', props: {} } as never)).toBe(false)
    expect(isStudentStroke(problem as never)).toBe(false)
  })
  it('feedback for the same writing never removes a practice problem', () => {
    const at = { ax: 100, ay: 100, aw: 200, ah: 50 }
    const old = [
      { id: 'note', meta: { ai: true, kind: 'note', line_id: 'L1', ...at } },
      { id: 'problem', meta: { ...problem.meta, line_id: 'L1', ...at } },
      { id: 'ask', meta: { ...ask.meta, ...at } },
      { id: 'label', meta: { ...label.meta, ...at } },
    ]
    const reply = { actions: [{ type: 'note', line_id: 'L1', box: [100, 100, 150, 300], text: 'x' } as Action], clear_line_ids: ['L1'] }
    expect(staleShapeIds(old, reply, { x: 0, y: 0, w: 1000, h: 1000 })).toEqual(['note'])
  })
  it('a practice problem pulls the window for a check over itself, like the line above would', () => {
    const view = { x: 0, y: 0, w: 820, h: 1180 }
    const problemRect = { x: 100, y: 300, w: 260, h: 60 }
    const answer = [{ x: 330, y: 385, w: 30, h: 40 }, { x: 370, y: 385, w: 30, h: 40 }]
    const win = autoWindow(answer, [...answer, problemRect, { x: 100, y: 380, w: 200, h: 60 }], [], view)!
    expect(win.y).toBeLessThanOrEqual(300)
  })
})

describe('givenLines', () => {
  const win = { x: 50, y: 200, w: 500, h: 400 }
  const placed = [
    { meta: ask.meta, rect: { x: 100, y: 380, w: 200, h: 60 } },
    { meta: problem.meta, rect: { x: 100, y: 300, w: 250, h: 60 } },
    { meta: label.meta, rect: { x: 100, y: 260, w: 300, h: 30 } },
  ]
  it('one line per practice line in the window, top to bottom, boxes over the sent image', () => {
    expect(givenLines(placed, win)).toEqual([
      { box: [250, 100, 400, 600], latex: 'g(x) = x^3', plain: 'g(x) = x^3' },
      { box: [450, 100, 600, 500], latex: "g'(x) =", plain: "g'(x) =" },
    ])
  })
  it('leaves out lines outside the window, and the label always', () => {
    expect(givenLines(placed, { x: 50, y: 370, w: 500, h: 400 }).map((g) => g.latex)).toEqual(["g'(x) ="])
    expect(givenLines(placed, { x: 600, y: 0, w: 100, h: 100 })).toEqual([])
  })
})

describe('solved', () => {
  const win = { x: 0, y: 0, w: 1000, h: 1000 }
  const p1 = { id: 'p1', rect: { x: 100, y: 300, w: 250, h: 60 } }
  const p2 = { id: 'p2', rect: { x: 100, y: 700, w: 250, h: 60 } }
  const green = (box?: [number, number, number, number]): Action => ({ type: 'note', color: 'green', text: 'Correct!', box })

  it('a green note under a practice problem solves it', () => {
    expect(solvedPractices([green([380, 100, 440, 300])], [p1], win)).toEqual(['p1'])
    expect(solvedPractices([green()], [p1], win)).toEqual(['p1'])
  })
  it('red marks, hints and notes above the problem do not', () => {
    expect(solvedPractices([{ type: 'note', color: 'red', text: 'check the power', box: [380, 100, 440, 300] }, { type: 'circle', box: [380, 100, 440, 300] }], [p1], win)).toEqual([])
    expect(solvedPractices([green([100, 100, 160, 300])], [p1], win)).toEqual([])
    expect(solvedPractices([green([380, 100, 440, 300])], [], win)).toEqual([])
  })
  it('with two practice problems in view, the note goes to the one it is under', () => {
    expect(solvedPractices([green([790, 100, 850, 300])], [p1, p2], win)).toEqual(['p2'])
    expect(solvedPractices([green([400, 100, 450, 300])], [p1, p2], win)).toEqual(['p1'])
    expect(solvedPractices([green()], [p1, p2], win)).toEqual([])
  })
  it('a solved practice is not open, and the status follows the shapes on the page', () => {
    const placed = (solved: boolean, id = 'p1') => ({ meta: { ...problem.meta, practice_id: id, practice: 'K', solved }, rect: p1.rect })
    expect(openPractices([placed(false)], win)).toEqual([p1])
    expect(openPractices([placed(true)], win)).toEqual([])
    expect(statusesOf([]).get('K')).toBeUndefined()
    expect(statusesOf([placed(false)]).get('K')).toBe('open')
    expect(statusesOf([placed(true)]).get('K')).toBe('solved')
    expect(statusesOf([placed(true), placed(false, 'p2')]).get('K')).toBe('open')
  })
})

describe('helpers', () => {
  it('latexToPlain: calculator syntax where that is simple', () => {
    expect(latexToPlain("g'(x) =")).toBe("g'(x) =")
    expect(latexToPlain('\\frac{dy}{dx} =')).toBe('(dy)/(dx) =')
    expect(latexToPlain('f(x) = 3x^{2} \\cdot \\sin(x)')).toBe('f(x) = 3*x^2 * sin(x)')
    expect(latexToPlain('\\int x^{n+1} \\, dx =')).toBe('int x^(n+1) dx =')
  })
  it('lessonSpeed reads the debug parameter', () => {
    expect(lessonSpeed('')).toBe(1)
    expect(lessonSpeed('?lessonSpeed=8')).toBe(8)
    expect(lessonSpeed('?lessonSpeed=0')).toBe(1)
    expect(lessonSpeed('?lessonSpeed=999')).toBe(60)
  })
})
