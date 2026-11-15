import { describe, expect, it } from 'vitest'
import type { Action, CheckResponse, CircuitFigure } from '../contract'
import figureExample from '../../../contract/examples/circuit_figure.json'
import hiddenExample from '../../../contract/examples/circuit_hidden.json'
import {
  arrowFor,
  CIRCUIT_CARD_TYPE,
  circuitShapes,
  formatSI,
  labelPlacements,
  labelTexts,
  parseValue,
  showValue,
  stepValue,
  summary,
  toNetlistValue,
  typedValue,
  XRAY_KIND,
  type CardProps,
} from './circuit'

const figAction = (ex: unknown) => (ex as unknown as CheckResponse).actions.find((a) => a.type === 'figure') as Action
const revealed = figAction(figureExample)
const hidden = figAction(hiddenExample)
const circuit = revealed.figure!.circuit as CircuitFigure
const bounds = { x: 100, y: 50, w: 900, h: 620 } // the sketch the example's boxes were measured on

describe('values', () => {
  it('reads what the read step writes', () => {
    expect(parseValue('1k')).toBe(1000)
    expect(parseValue('4.7k')).toBeCloseTo(4700)
    expect(parseValue('9V')).toBe(9)
    expect(parseValue('2 mA')).toBeCloseTo(0.002)
    expect(parseValue('1kΩ')).toBe(1000)
    expect(parseValue('9*mA')).toBeCloseTo(0.009)
    expect(parseValue('lots')).toBeNaN()
  })

  it('formats with SI prefixes', () => {
    expect(formatSI(0.0018, 'A')).toBe('1.8 mA')
    expect(formatSI(7.2, 'V')).toBe('7.2 V')
    expect(formatSI(2000, 'Ω')).toBe('2 kΩ')
    expect(formatSI(0.003, 'A')).toBe('3 mA')
    expect(formatSI(0, 'V')).toBe('0 V')
    expect(showValue({ kind: 'resistor', value: '4.7k' })).toBe('4.7 kΩ')
  })

  it('steps in 1-2-5 both ways and across decades', () => {
    expect(stepValue('2k', 1)).toBe('5k')
    expect(stepValue('2k', -1)).toBe('1k')
    expect(stepValue('5k', 1)).toBe('10k')
    expect(stepValue('1k', -1)).toBe('500')
    expect(stepValue('4.7k', 1)).toBe('5k')
    expect(stepValue('4.7k', -1)).toBe('2k')
    expect(stepValue('9', 1)).toBe('10')
  })

  it('reads a typed value back as a netlist value', () => {
    expect(typedValue('4k')).toBe('4k')
    expect(typedValue('4 kΩ')).toBe('4k')
    expect(typedValue('4000')).toBe('4k')
    expect(typedValue('banana')).toBeNull()
    expect(toNetlistValue(0.5)).toBe('500m')
  })
})

describe('x-ray labels', () => {
  const sol = circuit.solution!

  it('label text: node voltages (no ground) and currents with an arrow', () => {
    const t = labelTexts(circuit, sol)
    expect(t['node:n1']).toBe('9 V')
    expect(t['node:n2']).toBe('6 V')
    expect(t['node:0']).toBeUndefined()
    expect(t['el:R1']).toBe('3 mA →') // n1 (left) -> n2 (right) along a wide symbol
    expect(t['el:R2']).toBe('3 mA ↓') // n2 (top) -> ground (bottom) along a tall symbol
    expect(t['el:V1']).toBe('3 mA ↑') // through a battery current flows from - (ground, below) up to +
  })

  it('arrow flips with the sign of the current', () => {
    const r1 = circuit.elements.find((e) => e.id === 'R1')!
    expect(arrowFor(r1, circuit.nodes, 0.003)).toBe('→')
    expect(arrowFor(r1, circuit.nodes, -0.003)).toBe('←')
    expect(arrowFor({ ...r1, a: 'nowhere' }, circuit.nodes, 1)).toBeNull()
  })

  it('places node labels on their wire point and element labels just past the symbol', () => {
    const labels = labelPlacements(circuit, sol, bounds, 18)
    const n1 = labels.find((l) => l.target === 'node:n1')!
    const at = circuit.nodes!.find((n) => n.id === 'n1')!.at
    expect(Math.abs(n1.x - (bounds.x + (at[1] / 1000) * bounds.w))).toBeLessThan(20)
    expect(Math.abs(n1.y - (bounds.y + (at[0] / 1000) * bounds.h))).toBeLessThan(40)
    const page = (id: string) => {
      const [y0, x0, y1, x1] = circuit.elements.find((e) => e.id === id)!.box!
      return { x0: bounds.x + (x0 / 1000) * bounds.w, x1: bounds.x + (x1 / 1000) * bounds.w, y0: bounds.y + (y0 / 1000) * bounds.h, y1: bounds.y + (y1 / 1000) * bounds.h }
    }
    // each element label goes on the side facing the middle of the circuit, away from what the student wrote outside
    const r1 = labels.find((l) => l.target === 'el:R1')! // R1 is on top: label below it
    expect(r1.y).toBeGreaterThan(page('R1').y1)
    const r2 = labels.find((l) => l.target === 'el:R2')! // R2 is on the right: label to its left, not over "R2 = 2kΩ"
    expect(r2.x).toBeLessThan(page('R2').x0)
    const v1 = labels.find((l) => l.target === 'el:V1')! // V1 is on the left: label to its right
    expect(v1.x).toBeGreaterThan(page('V1').x1)
  })

  it('summary is the loop current', () => {
    expect(summary(circuit.elements, circuit.solution)).toBe('I = 3 mA')
    expect(summary(circuit.elements, undefined)).toBe('I = ?')
  })
})

describe('circuitShapes', () => {
  it('revealed: a card plus a blue label per node (minus ground) and per element, all tutor shapes on the circuit line', () => {
    const shapes = circuitShapes(revealed, bounds)
    const card = shapes.find((s) => s.type === CIRCUIT_CARD_TYPE)!
    const labels = shapes.filter((s) => s.meta?.kind === XRAY_KIND)
    expect(labels).toHaveLength(2 + 3)
    expect(labels.every((l) => l.meta?.card === card.id && l.meta?.ai === true && l.meta?.line_id === 'L1')).toBe(true)
    const props = card.props as CardProps
    expect(props.reveal).toBe(true)
    expect(props.elements.map((e) => e.value)).toEqual(['9', '1k', '2k'])
    expect(props.drawn).toEqual(props.elements)
    expect(props.solution?.currents.R1).toBeCloseTo(0.003)
    expect(card.meta?.ai).toBe(true)
  })

  it('hidden: the card with no numbers and no labels at all', () => {
    const shapes = circuitShapes(hidden, bounds)
    expect(shapes.map((s) => s.type)).toEqual([CIRCUIT_CARD_TYPE])
    const props = shapes[0].props as CardProps
    expect(props.reveal).toBe(false)
    expect(props.solution).toBeNull()
  })

  it('not a circuit figure, or an empty one: nothing', () => {
    expect(circuitShapes({ type: 'note', text: 'x' }, bounds)).toEqual([])
    expect(circuitShapes({ type: 'figure', figure: { kind: 'circuit', expressions: [], x_range: [0, 1] } }, bounds)).toEqual([])
  })

  it('props are plain JSON (tldraw stores them)', () => {
    for (const s of circuitShapes(revealed, bounds)) expect(JSON.parse(JSON.stringify(s.props))).toEqual(s.props)
  })
})
