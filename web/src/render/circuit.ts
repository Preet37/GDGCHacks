import { createShapeId, toRichText, type Editor, type TLShapeId, type TLShapePartial } from 'tldraw'
import type { Action, CircuitElement, CircuitFigure, CircuitSolution } from '../contract'
import { aiMeta, cardRect } from './actions'
import { boxToPage, DEFAULT_CONTEXT, type PageRect, type RenderContext } from './geometry'

/**
 * Engineering (Part 2): a `figure` with kind "circuit" becomes
 * - x-ray labels ON the student's own drawing: the voltage at each node (nodes[].at) and the current through each
 *   element (beside its box), with an arrow for the direction;
 * - a what-if card beside the circuit (CircuitCardShape) where a value can be changed and re-solved for free.
 * Everything here is generic: it draws whatever netlist and solution the server sent.
 */

/** Must match CircuitCardShapeUtil.type (web/src/shapes/CircuitCardShape.tsx, registered in App.tsx). */
export const CIRCUIT_CARD_TYPE = 'circuitcard'
export const XRAY_KIND = 'xray'
export const CARD_W = 300

const SI: Record<string, number> = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, '': 1, m: 1e-3, u: 1e-6, µ: 1e-6, μ: 1e-6, n: 1e-9, p: 1e-12 }

/** "4.7k", "9V", "2 mA", "1kΩ", "9*mA" -> number, like circuits.parse_value on the server. NaN if unreadable. */
export function parseValue(raw: string): number {
  const m = String(raw)
    .replace(/\*/g, ' ')
    .trim()
    .match(/^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([TGMkKmuµμnp]?)\s*(?:Ω|ohms?|V|A|v|a|W|w)?$/)
  if (!m) return NaN
  return Number(m[1]) * SI[m[2]]
}

const PREFIXES: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']]

/** 0.0018, "A" -> "1.8 mA"; 7.2, "V" -> "7.2 V"; 2000, "Ω" -> "2 kΩ". Three significant figures at most. */
export function formatSI(x: number, unit: string): string {
  if (!Number.isFinite(x)) return '?'
  if (x === 0) return `0 ${unit}`
  const a = Math.abs(x)
  const [scale, p] = PREFIXES.find(([s]) => a >= s * 0.9995) ?? PREFIXES[PREFIXES.length - 1]
  const v = x / scale
  const s = Number(v.toPrecision(3)).toString()
  return `${s} ${p}${unit}`
}

export function unitOf(kind: CircuitElement['kind']): string {
  return kind === 'resistor' ? 'Ω' : kind === 'vsource' ? 'V' : 'A'
}

/** The value as the card shows it: "2 kΩ", "9 V". Falls back to the raw text if it can't be read. */
export function showValue(el: Pick<CircuitElement, 'kind' | 'value'>): string {
  const v = parseValue(el.value)
  return Number.isFinite(v) ? formatSI(v, unitOf(el.kind)) : el.value
}

/** Next value in the 1-2-5 series (up = +1, down = -1), as a netlist value string ("5k", "500", "0.5"). */
export function stepValue(raw: string, dir: 1 | -1): string {
  const v = parseValue(raw)
  if (!Number.isFinite(v) || v === 0) return raw
  const sign = Math.sign(v)
  const a = Math.abs(v)
  const decade = Math.pow(10, Math.floor(Math.log10(a) + 1e-9))
  const series = [1, 2, 5, 10]
  const m = a / decade
  let next: number
  if (dir > 0) next = decade * (series.find((s) => s > m + 1e-9) ?? 10)
  else {
    const below = [...series].reverse().find((s) => s < m - 1e-9)
    next = below !== undefined ? decade * below : (decade / 10) * 5
  }
  return toNetlistValue(sign * next)
}

/** 4000 -> "4k", 0.5 -> "500m", 9 -> "9": the shortest form the server's parser reads back exactly. */
export function toNetlistValue(x: number): string {
  if (x === 0) return '0'
  const a = Math.abs(x)
  for (const [scale, p] of PREFIXES) {
    if (a >= scale * 0.9995) {
      const v = Number((x / scale).toPrecision(6))
      return `${v}${p === 'µ' ? 'u' : p}`
    }
  }
  return String(x)
}

/** Read a typed value back as a netlist value: "4k", "4 kΩ", "4000" -> "4k". Null if it can't be read. */
export function typedValue(text: string): string | null {
  const v = parseValue(text)
  return Number.isFinite(v) ? toNetlistValue(v) : null
}

export interface XrayLabel {
  target: string // "node:n1" or "el:R1"
  x: number // page space, top-left of the label
  y: number
  text: string
}

const ARROWS = { right: '→', left: '←', down: '↓', up: '↑' } as const

/**
 * Which way current flows through an element on the drawing: from node a's wire point towards node b's, along
 * whichever axis those two points differ most on, flipped when the current is negative. (Not the symbol's shape:
 * a battery's plates are drawn wide but current crosses them.) null if either node point isn't known.
 */
export function arrowFor(el: CircuitElement, nodes: CircuitFigure['nodes'], current: number): string | null {
  const at = (id: string) => nodes?.find((n) => n.id === id)?.at
  const a = at(el.a)
  const b = at(el.b)
  if (!a || !b) return null
  const flow = current < 0 ? -1 : 1
  const dy = (b[0] - a[0]) * flow
  const dx = (b[1] - a[1]) * flow
  if (dx === 0 && dy === 0) return null
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ARROWS.right : ARROWS.left
  return dy >= 0 ? ARROWS.down : ARROWS.up
}

/** Text of each x-ray label for a solution. Nodes: voltage; elements: current with its arrow. Ground is left out. */
export function labelTexts(circuit: Pick<CircuitFigure, 'elements' | 'nodes'>, sol: CircuitSolution): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of circuit.nodes ?? []) {
    const v = sol.node_voltages?.[n.id]
    if (n.id !== '0' && typeof v === 'number') out[`node:${n.id}`] = formatSI(v, 'V')
  }
  for (const el of circuit.elements) {
    const i = sol.currents?.[el.id]
    if (typeof i !== 'number') continue
    const arrow = arrowFor(el, circuit.nodes, i)
    out[`el:${el.id}`] = `${formatSI(Math.abs(i), 'A')}${arrow ? ` ${arrow}` : ''}`
  }
  return out
}

/**
 * Where each x-ray label goes on the page. Node labels sit just above their wire point. Element labels sit just
 * past the element's symbol on the side that faces the middle of the circuit: that is usually empty paper, while
 * the outside is where students write "R2 = 2kΩ". `bounds` = page rect of the sent image.
 */
export function labelPlacements(circuit: CircuitFigure, sol: CircuitSolution, bounds: PageRect, fontPx: number): XrayLabel[] {
  const texts = labelTexts(circuit, sol)
  const out: XrayLabel[] = []
  for (const n of circuit.nodes ?? []) {
    const text = texts[`node:${n.id}`]
    if (!text) continue
    const p = boxToPage([n.at[0], n.at[1], n.at[0], n.at[1]], bounds)
    out.push({ target: `node:${n.id}`, x: p.x + fontPx * 0.3, y: p.y - fontPx * 1.5, text })
  }
  const rects = circuit.elements.filter((e) => e.box).map((e) => boxToPage(e.box!, bounds))
  const cx = rects.reduce((a, r) => a + r.x + r.w / 2, 0) / Math.max(1, rects.length)
  const cy = rects.reduce((a, r) => a + r.y + r.h / 2, 0) / Math.max(1, rects.length)
  const textW = (t: string) => t.length * fontPx * 0.55
  for (const el of circuit.elements) {
    const text = texts[`el:${el.id}`]
    if (!text || !el.box) continue
    const r = boxToPage(el.box, bounds)
    const dx = (cx - (r.x + r.w / 2)) / Math.max(r.w, 1)
    const dy = (cy - (r.y + r.h / 2)) / Math.max(r.h, 1)
    const gap = fontPx * 0.4
    let x: number
    let y: number
    if (Math.abs(dx) > Math.abs(dy)) {
      x = dx > 0 ? r.x + r.w + gap : r.x - gap - textW(text) // right of it, or left of it
      y = r.y + r.h / 2 - fontPx * 0.6
    } else {
      x = r.x + r.w / 2 - textW(text) / 2
      y = dy > 0 ? r.y + r.h + gap * 0.5 : r.y - gap - fontPx * 1.2 // below it, or above it
    }
    out.push({ target: `el:${el.id}`, x, y, text })
  }
  return out
}

/** One line under the card's table: the loop current, i.e. the current through the first source (else first element). */
export function summary(elements: CircuitElement[], sol: CircuitSolution | undefined): string {
  if (!sol) return 'I = ?'
  const src = elements.find((e) => e.kind !== 'resistor') ?? elements[0]
  const i = src ? sol.currents?.[src.id] : undefined
  return typeof i === 'number' ? `I = ${formatSI(Math.abs(i), 'A')}` : 'I = ?'
}

/** The card's stored state: the netlist as drawn and as edited, and the last good solution. */
export interface CardProps {
  w: number
  h: number
  lineId: string
  reveal: boolean
  drawn: CircuitElement[] // values as read from the drawing (Reset goes back to these)
  elements: CircuitElement[] // values as edited on the card
  nodes: { id: string; at: [number, number] }[]
  solution: CircuitSolution | null
  detail: string // last re-solve problem, '' if fine
}

export function cardHeight(n: number): number {
  return 74 + 40 * n + 54
}

/** Plain JSON copy (tldraw props must be JSON; no undefined keys). */
function clean<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

/** The card shape + the x-ray label shapes for a circuit figure action. Labels only when the numbers are revealed. */
export function circuitShapes(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): TLShapePartial[] {
  const fig = action.type === 'figure' && action.figure?.kind === 'circuit' ? action.figure.circuit : undefined
  if (!fig || !Array.isArray(fig.elements) || !fig.elements.length) return []
  const elements = clean(fig.elements)
  const h = cardHeight(elements.length)
  const rect = cardRect(action, bounds, ctx, CARD_W, h)
  const cardId = createShapeId()
  const props: CardProps = {
    w: CARD_W,
    h,
    lineId: action.line_id ?? '',
    reveal: Boolean(fig.reveal),
    drawn: elements,
    elements: clean(elements),
    nodes: clean(fig.nodes ?? []),
    solution: fig.solution ? clean(fig.solution) : null,
    detail: '',
  }
  const shapes: TLShapePartial[] = [
    { id: cardId, type: CIRCUIT_CARD_TYPE, x: rect.x, y: rect.y, meta: aiMeta('figure', action.line_id), props } as TLShapePartial,
  ]
  if (props.reveal && props.solution) {
    const font = 18
    for (const l of labelPlacements(fig, props.solution, bounds, font)) {
      shapes.push({
        id: createShapeId(),
        type: 'text',
        x: l.x,
        y: l.y,
        meta: { ...aiMeta(XRAY_KIND, action.line_id), card: cardId, target: l.target },
        props: { richText: toRichText(l.text), font: 'sans', size: 's', color: 'blue', textAlign: 'start', autoSize: true, scale: 0.8 },
      })
    }
  }
  return shapes
}

/** Draw a circuit figure. Never throws: a figure that can't be drawn is skipped. Returns how many shapes were made. */
export function renderCircuit(editor: Editor, action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): number {
  try {
    const shapes = circuitShapes(action, bounds, ctx)
    if (shapes.length) editor.run(() => editor.createShapes(shapes), { history: 'ignore', ignoreShapeLock: true })
    return shapes.length
  } catch (err) {
    console.warn('circuit figure skipped', action.figure, err)
    return 0
  }
}

/** After a re-solve on the card: rewrite the text of that card's x-ray labels (ids of labels with no text left are returned). */
export function updateLabels(editor: Editor, cardId: TLShapeId, circuit: Pick<CircuitFigure, 'elements' | 'nodes'>, sol: CircuitSolution) {
  const texts = labelTexts(circuit, sol)
  const labels = editor.getCurrentPageShapes().filter((s) => s.meta?.card === cardId && s.meta?.kind === XRAY_KIND)
  editor.run(
    () => {
      for (const s of labels) {
        const text = texts[String(s.meta.target)]
        if (text) editor.updateShape({ id: s.id, type: 'text', props: { richText: toRichText(text) } })
      }
    },
    { history: 'ignore', ignoreShapeLock: true },
  )
}
