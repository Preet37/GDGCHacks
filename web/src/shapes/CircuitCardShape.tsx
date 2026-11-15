import { useEffect, useRef, useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, type RecordProps, type TLShape, type TLShapeId } from 'tldraw'
import type { CircuitElement, CircuitSolution } from '../contract'
import {
  CIRCUIT_CARD_TYPE,
  showValue,
  stepValue,
  summary,
  typedValue,
  updateLabels,
  formatSI,
  unitOf,
  type CardProps,
} from '../render/circuit'
import { solveCircuit } from '../sync/api'

/**
 * The what-if card beside a drawn circuit (Part 2). One row per element with its value: tap the value to type a new
 * one, or step it with - / + (1-2-5). Every edit re-solves on the server (POST /api/circuit/solve, no Gemini, debounced
 * 250 ms) and updates the card and the x-ray labels on the drawing. Reset goes back to the values as drawn.
 * Until the student's answer is checked (reveal = false) the card shows the parts but "?" for every result.
 * It is a tutor shape (meta.ai), so editing it never sends a check; its props are saved with the page.
 */

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    circuitcard: CardProps
  }
}

export type CircuitCardShape = TLShape<typeof CIRCUIT_CARD_TYPE>

export const DEBOUNCE_MS = 250

const card: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: '#fff',
  border: '1px solid #c9d6f5',
  borderRadius: 10,
  boxSizing: 'border-box',
  padding: '10px 12px',
  fontFamily: 'system-ui, sans-serif',
  color: '#1f2a44',
  fontSize: 15,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  boxShadow: '0 2px 10px rgba(37, 99, 235, 0.10)',
}
const btn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid #c9d6f5',
  background: '#f3f6ff',
  color: '#2563eb',
  fontSize: 18,
  lineHeight: '28px',
  padding: 0,
  touchAction: 'manipulation',
}

/** The row's result: current through the element (with the voltage across it) once revealed. */
function rowResult(el: CircuitElement, sol: CircuitSolution | null, reveal: boolean): string {
  if (!reveal || !sol) return '?'
  const i = sol.currents?.[el.id]
  return typeof i === 'number' ? formatSI(Math.abs(i), 'A') : '?'
}

function CircuitCard({ shape }: { shape: CircuitCardShape }) {
  const editor = useEditor()
  const p = shape.props
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    abort.current?.abort()
  }, [])

  // Taps on the card are the card's: tldraw must neither ink nor drag the shape for them.
  const claim = (e: React.SyntheticEvent) => {
    editor.markEventAsHandled(e)
    e.stopPropagation()
  }

  const save = (patch: Partial<CardProps>) =>
    editor.run(() => editor.updateShape({ id: shape.id, type: CIRCUIT_CARD_TYPE, props: patch }), {
      history: 'ignore',
      ignoreShapeLock: true,
    })

  /** Store the edited values now, re-solve after a pause. Hidden cards never ask for numbers. */
  const setElements = (elements: CircuitElement[]) => {
    save({ elements })
    if (!p.reveal) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      abort.current?.abort()
      const ctl = new AbortController()
      abort.current = ctl
      setBusy(true)
      try {
        const out = await solveCircuit(elements, ctl.signal)
        if (ctl.signal.aborted) return
        if (out.ok) {
          const solution: CircuitSolution = {
            node_voltages: out.node_voltages,
            currents: out.currents,
            ...(out.element_voltages ? { element_voltages: out.element_voltages } : {}),
            ...(out.power ? { power: out.power } : {}),
          }
          save({ solution, detail: '' })
          updateLabels(editor, shape.id as TLShapeId, { elements, nodes: p.nodes }, solution)
        } else {
          save({ detail: out.detail || "this circuit can't be solved" }) // keep the last good numbers
        }
      } catch {
        // aborted by a newer edit
      } finally {
        if (abort.current === ctl) setBusy(false)
      }
    }, DEBOUNCE_MS)
  }

  const change = (id: string, value: string) =>
    setElements(p.elements.map((e) => (e.id === id ? { ...e, value } : e)))

  const commitDraft = (id: string) => {
    const v = typedValue(draft)
    setEditing(null)
    if (v) change(id, v)
  }

  const changed = p.elements.some((e, i) => e.value !== p.drawn[i]?.value)

  return (
    <HTMLContainer style={{ pointerEvents: 'all' }}>
      <div style={card} data-circuit-card={shape.id} onPointerDown={claim} onPointerUp={claim} onClick={claim}>
        <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>What if…?</span>
          <span style={{ fontSize: 12, color: '#7a869f', fontWeight: 400 }}>{busy ? 'solving…' : 'tap a value to change it'}</span>
        </div>
        {p.elements.map((el) => (
          <div key={el.id} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34 }} data-row={el.id}>
            <span style={{ width: 34, fontWeight: 600 }}>{el.id}</span>
            {editing === el.id ? (
              <input
                autoFocus
                aria-label={`${el.id} value`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitDraft(el.id)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commitDraft(el.id)
                  if (e.key === 'Escape') setEditing(null)
                }}
                placeholder={unitOf(el.kind)}
                style={{ width: 92, height: 28, fontSize: 15, padding: '0 6px', border: '1px solid #2563eb', borderRadius: 6 }}
              />
            ) : (
              <button
                data-value={el.id}
                onClick={() => {
                  setDraft(el.value)
                  setEditing(el.id)
                }}
                style={{ ...btn, width: 92, fontSize: 15, color: '#1f2a44', background: '#fff' }}
              >
                {showValue(el)}
              </button>
            )}
            <button aria-label={`${el.id} down`} data-step={`${el.id}:-`} style={btn} onClick={() => change(el.id, stepValue(el.value, -1))}>
              −
            </button>
            <button aria-label={`${el.id} up`} data-step={`${el.id}:+`} style={btn} onClick={() => change(el.id, stepValue(el.value, 1))}>
              +
            </button>
            <span style={{ marginLeft: 'auto', color: '#2563eb', fontVariantNumeric: 'tabular-nums' }} data-result={el.id}>
              {rowResult(el, p.solution, p.reveal)}
            </span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
          <span data-summary style={{ fontWeight: 600, color: '#2563eb' }}>
            {p.reveal ? summary(p.elements, p.solution ?? undefined) : 'Write your answer to unlock'}
          </span>
          <button
            data-reset
            disabled={!changed}
            onClick={() => setElements(p.drawn.map((e) => ({ ...e })))}
            style={{ ...btn, width: 64, fontSize: 14, opacity: changed ? 1 : 0.4 }}
          >
            Reset
          </button>
        </div>
        {p.detail ? (
          <div data-detail style={{ color: '#8a8f99', fontSize: 12 }}>
            {p.detail}
          </div>
        ) : null}
      </div>
    </HTMLContainer>
  )
}

export class CircuitCardShapeUtil extends BaseBoxShapeUtil<CircuitCardShape> {
  static override type = CIRCUIT_CARD_TYPE
  static override props: RecordProps<CircuitCardShape> = {
    w: T.number,
    h: T.number,
    lineId: T.string,
    reveal: T.boolean,
    drawn: T.jsonValue as never,
    elements: T.jsonValue as never,
    nodes: T.jsonValue as never,
    solution: T.jsonValue as never,
    detail: T.string,
  }

  override getDefaultProps(): CircuitCardShape['props'] {
    return { w: 300, h: 200, lineId: '', reveal: false, drawn: [], elements: [], nodes: [], solution: null, detail: '' }
  }

  override canEdit() {
    return false
  }

  override canResize() {
    return false
  }

  override component(shape: CircuitCardShape) {
    return <CircuitCard shape={shape} />
  }

  override getIndicatorPath(shape: CircuitCardShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}
