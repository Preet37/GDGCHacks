import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseBoxShapeUtil, DefaultColorStyle, HTMLContainer, T, useEditor, type RecordProps, type TLShape } from 'tldraw'
import type { Model3dFigure } from '../contract'
import { hasLooks, LOAD_COLORS, LOAD_WORDS, loadsUsed, model3dScale, partGroups, thinStroke, TL_COLORS, type ModelMark } from '../render/model3d/geometry'
import type { ModelView } from '../render/model3d/scene'
import { buildModel3d } from '../sync/api'
import { claimLive, isFresh } from './fresh3d'

/**
 * Engineering (Part 2): a 3D model of a structure (a bridge, a truss, a crane) the student can turn and tap.
 * Drag the view to turn it, tap a part (or step with ‹ ›) to see its job and the force it carries. Parts are
 * coloured by that force. In Draw mode the pen draws on the model: each stroke is stuck onto the parts in 3D
 * (stored in `marks`), so it turns with the model. Only the model is stored; the scene is rebuilt on mount, so it survives save/load.
 */

export const MODEL3D_TYPE = 'model3d'
export const MODEL3D_TITLE_H = 32
export const MODEL3D_PANEL_H = 118
/** Movement (CSS px) under which a press counts as a tap, not a turn. */
const TAP_SLOP = 6

interface Model3dProps {
  w: number
  h: number
  title: string
  model: Model3dFigure
  /** the student's strokes on the model (absent on cards saved before Draw mode) */
  marks?: ModelMark[]
}

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    model3d: Model3dProps
  }
}

export type Model3dShape = TLShape<typeof MODEL3D_TYPE>

/** Cards whose model is being built right now (one request per card, however often it re-renders). */
const building = new Set<string>()

const btn: React.CSSProperties = {
  minWidth: 34,
  height: 34,
  borderRadius: 8,
  border: '1px solid #d6dbe4',
  background: '#fff',
  color: '#1f2a44',
  fontSize: 18,
  fontWeight: 600,
  cursor: 'pointer',
  pointerEvents: 'all',
}

function Model3dCard({ shape }: { shape: Model3dShape }) {
  const editor = useEditor()
  const { model, title, w, h } = shape.props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ModelView | null>(null)
  const [glFailed, setGlFailed] = useState(false)
  const [touched, setTouched] = useState(false)
  // a card restored with a saved page waits for a tap before it starts WebGL (see fresh3d.ts)
  const [live, setLive] = useState(() => isFresh(shape.id))
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'turn' | 'draw'>('turn')
  // real materials when the model has them; older models (force colours only) start in Forces
  const [look, setLook] = useState<'real' | 'forces'>(() => (hasLooks(model) ? 'real' : 'forces'))
  const modeRef = useRef(mode)
  modeRef.current = mode
  /** the stroke being drawn, in CSS pixels inside the view (a flat preview until it is stuck onto the model) */
  const [stroke, setStroke] = useState<[number, number][] | null>(null)
  const marks = shape.props.marks ?? []
  const marksRef = useRef(marks)
  marksRef.current = marks
  const marksKey = JSON.stringify(marks)
  const modelKey = JSON.stringify(model)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => partGroups(model), [modelKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const legend = useMemo(() => loadsUsed(model), [modelKey])

  const viewW = Math.max(1, Math.round(w) - 2)
  // the card's own UI grows with the card, so it stays readable on a card made while zoomed out
  const k = model3dScale(w, h)
  const titleH = Math.round(MODEL3D_TITLE_H * k)
  const panelH = Math.round(MODEL3D_PANEL_H * k)
  const viewH = Math.max(1, Math.round(h) - titleH - panelH - 2)
  /** the card's button, at the card's scale */
  const kbtn: React.CSSProperties = { ...btn, minWidth: 34 * k, height: 34 * k, borderRadius: 8 * k, fontSize: 18 * k }

  useEffect(() => {
    const host = hostRef.current
    if (!host || !model.parts.length || !live) return
    let cancelled = false
    let view: ModelView | null = null
    setGlFailed(false)
    // keep the number of WebGL views small: the oldest live 3D card goes back to "Tap to show"
    const unclaim = claimLive(shape.id, () => setLive(false))
    import('../render/model3d/scene')
      .then(({ createModelView }) => {
        if (cancelled) return
        view = createModelView(host, model, host.clientWidth || 1, host.clientHeight || 1)
        viewRef.current = view
        setReady((n) => n + 1)
      })
      .catch((err) => {
        console.warn('model3d: WebGL view failed', err)
        if (!cancelled) setGlFailed(true)
      })
    return () => {
      cancelled = true
      view?.dispose()
      viewRef.current = null
      unclaim()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, live])

  useEffect(() => {
    viewRef.current?.resize(viewW, viewH)
  }, [viewW, viewH])

  useEffect(() => {
    viewRef.current?.select(selected)
  }, [selected])

  // A reply only names the model (`subject`): build it once on the server and store it in the card.
  const unbuilt = !model.parts.length && !!model.subject
  const [buildError, setBuildError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!unbuilt || building.has(shape.id)) return
    building.add(shape.id)
    setBuildError(null)
    void buildModel3d({ subject: model.subject!, focus: model.focus })
      .then((out) => {
        if (out.ok && out.model?.parts.length) {
          const props: Partial<Model3dProps> = { model: out.model }
          if (out.title) props.title = out.title
          editor.run(() => editor.updateShape({ id: shape.id, type: MODEL3D_TYPE, props }), { ignoreShapeLock: true, history: 'ignore' })
        } else setBuildError(out.detail ?? "couldn't build the model")
      })
      .finally(() => building.delete(shape.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unbuilt, attempt])

  const [ready, setReady] = useState(0) // bumped when the view exists, so the marks are drawn into it
  useEffect(() => {
    viewRef.current?.setLook(look)
  }, [look, ready])
  // a model built after the card appeared: show it as it really looks once its parts arrive
  const hadParts = useRef(model.parts.length > 0)
  useEffect(() => {
    if (!hadParts.current && model.parts.length) {
      hadParts.current = true
      setLook(hasLooks(model) ? 'real' : 'forces')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey])
  useEffect(() => {
    viewRef.current?.setMarks(marksRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksKey, ready])

  const saveMarks = (next: ModelMark[]) =>
    editor.run(() => editor.updateShape({ id: shape.id, type: MODEL3D_TYPE, props: { marks: next } }), { ignoreShapeLock: true })

  // Drag to turn, tap to pick. Native listeners so tldraw neither inks nor pans (same as the 3D surface).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let active: number | null = null
    let lastX = 0
    let lastY = 0
    let moved = 0
    let drawing: [number, number][] | null = null
    /** screen pixels inside the view -> its CSS pixels (the page may be zoomed) */
    const local = (e: PointerEvent): [number, number] => {
      const r = host.getBoundingClientRect()
      const k = r.width ? host.clientWidth / r.width : 1
      return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]
    }
    const claim = (e: Event) => {
      editor.markEventAsHandled(e)
      e.stopPropagation()
    }
    // The card's own buttons sit inside the view: let their events reach React (their handlers claim them)
    const onButton = (e: Event) => e.target instanceof Element && e.target.closest('button') !== null
    const down = (e: PointerEvent) => {
      if (onButton(e)) return
      claim(e)
      if (active !== null || (e.pointerType === 'mouse' && e.button !== 0)) return
      active = e.pointerId
      lastX = e.clientX
      lastY = e.clientY
      moved = 0
      try {
        host.setPointerCapture(e.pointerId)
      } catch {
        // pointer already gone
      }
      if (modeRef.current === 'draw') {
        drawing = [local(e)]
        setStroke(drawing)
      }
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== active) return
      claim(e)
      if (drawing) {
        drawing = [...drawing, local(e)]
        setStroke(drawing)
        return
      }
      const zoom = editor.getZoomLevel() || 1
      moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY)
      if (moved > TAP_SLOP) {
        viewRef.current?.rotateBy((e.clientX - lastX) / zoom, (e.clientY - lastY) / zoom)
        setTouched(true)
      }
      lastX = e.clientX
      lastY = e.clientY
    }
    const end = (e: PointerEvent) => {
      if (e.pointerId !== active) {
        if (!onButton(e)) claim(e)
        return
      }
      claim(e)
      active = null
      try {
        host.releasePointerCapture(e.pointerId)
      } catch {
        // already released
      }
      if (drawing) {
        const pts = thinStroke(drawing)
        drawing = null
        setStroke(null)
        const view = viewRef.current
        if (view && e.type === 'pointerup' && pts.length) {
          // project() takes screen pixels inside the view, like pick()
          const r = host.getBoundingClientRect()
          const k = host.clientWidth ? r.width / host.clientWidth : 1
          const stuck = view.project(pts.map(([x, y]) => [x * k, y * k]))
          const name = editor.getStyleForNextShape(DefaultColorStyle)
          if (stuck.length) saveMarks([...marksRef.current, { color: TL_COLORS[name] ?? '#1d1d1d', pts: stuck }])
        }
        return
      }
      if (moved <= TAP_SLOP && e.type === 'pointerup' && viewRef.current) {
        // screen pixels inside the view; pick() divides by the canvas's on-screen size, so the zoom doesn't matter
        const r = host.getBoundingClientRect()
        setSelected(viewRef.current.pick(e.clientX - r.left, e.clientY - r.top))
        setTouched(true)
      }
    }
    const touch = (e: TouchEvent) => {
      if (onButton(e)) return
      claim(e)
      if (e.cancelable) e.preventDefault()
    }
    const wheel = (e: WheelEvent) => {
      claim(e)
      e.preventDefault()
      viewRef.current?.zoomBy(Math.exp(-e.deltaY * 0.002))
    }
    const swallow = (e: Event) => {
      if (!onButton(e)) claim(e)
    }
    host.addEventListener('pointerdown', down)
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerup', end)
    host.addEventListener('pointercancel', end)
    host.addEventListener('touchstart', touch, { passive: false })
    host.addEventListener('touchmove', touch, { passive: false })
    host.addEventListener('touchend', touch, { passive: false })
    host.addEventListener('wheel', wheel, { passive: false })
    host.addEventListener('click', swallow)
    host.addEventListener('dblclick', swallow)
    host.addEventListener('contextmenu', swallow)
    return () => {
      host.removeEventListener('pointerdown', down)
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerup', end)
      host.removeEventListener('pointercancel', end)
      host.removeEventListener('touchstart', touch)
      host.removeEventListener('touchmove', touch)
      host.removeEventListener('touchend', touch)
      host.removeEventListener('wheel', wheel)
      host.removeEventListener('click', swallow)
      host.removeEventListener('dblclick', swallow)
      host.removeEventListener('contextmenu', swallow)
    }
  }, [editor])

  /** Buttons on the card: handled here, never by tldraw (no ink, no selecting the card). */
  const press = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      editor.markEventAsHandled(e)
      e.stopPropagation()
    },
    onPointerUp: (e: React.PointerEvent) => {
      editor.markEventAsHandled(e)
      e.stopPropagation()
      fn()
    },
  })

  const index = selected === null ? -1 : groups.findIndex((g) => g.name === selected)
  const step = (by: number) => {
    const n = groups.length
    if (!n) return
    setSelected(groups[(((index < 0 ? (by > 0 ? -1 : 0) : index) + by) % n + n) % n].name)
  }
  const group = index >= 0 ? groups[index] : null

  return (
    <HTMLContainer>
      <div
        data-model3d={glFailed ? 'error' : 'ok'}
        style={{
          width: '100%',
          height: '100%',
          background: '#fff',
          border: '1px solid #dfe3ea',
          borderRadius: 12,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'system-ui, sans-serif',
          color: '#1f2a44',
          boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ height: titleH, flex: 'none', display: 'flex', alignItems: 'center', padding: `0 ${12 * k}px`, fontSize: 16 * k, fontWeight: 650, gap: 8 * k }}>
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title || '3D model'}</span>
          {look === 'forces' && legend.map((l) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 * k, fontSize: 12 * k, fontWeight: 500, color: '#4b5568' }}>
              <span style={{ width: 10 * k, height: 10 * k, borderRadius: 3 * k, background: LOAD_COLORS[l] }} />
              {l}
            </span>
          ))}
          <div style={{ display: 'flex', border: `${k}px solid #d6dbe4`, borderRadius: 8 * k, overflow: 'hidden', pointerEvents: 'all' }}>
            {(['real', 'forces'] as const).map((l) => (
              <button
                key={l}
                aria-pressed={look === l}
                aria-label={l === 'real' ? 'Show real materials' : 'Colour by force'}
                style={{ ...kbtn, minWidth: 0, height: 26 * k, border: 'none', borderRadius: 0, fontSize: 12 * k, padding: `0 ${9 * k}px`, background: look === l ? '#1f2a44' : '#fff', color: look === l ? '#fff' : '#1f2a44' }}
                {...press(() => setLook(l))}
              >
                {l === 'real' ? 'Real' : 'Forces'}
              </button>
            ))}
          </div>
        </div>
        {glFailed ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 * k, color: '#777' }}>Couldn't draw this</div>
        ) : (
          <div
            ref={hostRef}
            data-model3d-view
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              pointerEvents: 'all',
              touchAction: 'none',
              cursor: mode === 'draw' ? 'crosshair' : 'grab',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
          >
            {!live && !unbuilt && (
              <button
                // like the card's other buttons: tldraw captures the pointer on a press it isn't told about, so a click never arrives
                {...press(() => setLive(true))}
                style={{ position: 'absolute', inset: 0, zIndex: 4, border: 0, background: 'rgba(255,255,255,0.6)', color: '#2563eb', fontSize: 16 * k, fontWeight: 600, touchAction: 'manipulation' }}
              >
                Tap to show the 3D model
              </button>
            )}
            {unbuilt && (
              <div
                data-model3d-building={buildError ? 'error' : 'busy'}
                style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 * k, color: '#4b5568', fontSize: 15 * k, zIndex: 3, textAlign: 'center' }}
              >
                {buildError ? (
                  <>
                    <span>Couldn't build the model: {buildError}</span>
                    <button style={{ ...kbtn, fontSize: 14 * k, padding: `0 ${14 * k}px` }} {...press(() => setAttempt((n) => n + 1))}>
                      Try again
                    </button>
                  </>
                ) : (
                  <>
                    <span className="tutor-dot-pulse" />
                    <span>Building the 3D model of {model.subject}…</span>
                    <span style={{ fontSize: 12 * k, color: '#8a8f99' }}>about 15 to 20 seconds</span>
                  </>
                )}
              </div>
            )}
            {stroke && stroke.length > 1 && (
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
                <polyline
                  points={stroke.map((p) => p.join(',')).join(' ')}
                  fill="none"
                  stroke={TL_COLORS[editor.getStyleForNextShape(DefaultColorStyle)] ?? '#1d1d1d'}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <div style={{ position: 'absolute', left: 8 * k, top: 8 * k, display: 'flex', gap: 6 * k, zIndex: 2 }}>
              <div style={{ display: 'flex', border: `${k}px solid #d6dbe4`, borderRadius: 8 * k, overflow: 'hidden', pointerEvents: 'all' }}>
                {(['turn', 'draw'] as const).map((m) => (
                  <button
                    key={m}
                    aria-pressed={mode === m}
                    aria-label={m === 'turn' ? 'Turn the model' : 'Draw on the model'}
                    style={{ ...kbtn, border: 'none', borderRadius: 0, fontSize: 13 * k, padding: `0 ${10 * k}px`, background: mode === m ? '#2563eb' : '#fff', color: mode === m ? '#fff' : '#1f2a44' }}
                    {...press(() => {
                      setMode(m)
                      setTouched(true)
                    })}
                  >
                    {m === 'turn' ? '↻ Turn' : '✎ Draw'}
                  </button>
                ))}
              </div>
              {marks.length > 0 && (
                <>
                  <button style={{ ...kbtn, fontSize: 13 * k, padding: `0 ${8 * k}px` }} aria-label="Undo last mark" {...press(() => saveMarks(marksRef.current.slice(0, -1)))}>
                    ↶ Undo
                  </button>
                  <button style={{ ...kbtn, fontSize: 13 * k, padding: `0 ${8 * k}px` }} aria-label="Clear marks" {...press(() => saveMarks([]))}>
                    Clear
                  </button>
                </>
              )}
            </div>
            <div style={{ position: 'absolute', right: 8 * k, top: 8 * k, display: 'flex', flexDirection: 'column', gap: 6 * k, zIndex: 2 }}>
              <button style={kbtn} aria-label="Zoom in" {...press(() => viewRef.current?.zoomBy(1.25))}>
                +
              </button>
              <button style={kbtn} aria-label="Zoom out" {...press(() => viewRef.current?.zoomBy(0.8))}>
                −
              </button>
            </div>
            {!touched && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: 10 * k,
                  transform: 'translateX(-50%)',
                  padding: `${6 * k}px ${14 * k}px`,
                  borderRadius: 999,
                  background: 'rgba(20, 24, 33, 0.82)',
                  color: '#fff',
                  fontSize: 14 * k,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                ↻ Drag to turn · tap a part · ✎ Draw to mark it up
              </div>
            )}
          </div>
        )}
        <div
          data-model3d-panel
          style={{ height: panelH, flex: 'none', borderTop: '1px solid #eef0f4', padding: `${10 * k}px ${12 * k}px`, boxSizing: 'border-box', display: 'flex', gap: 10 * k }}
        >
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {group ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 * k, marginBottom: 4 * k }}>
                  <span data-model3d-part style={{ fontSize: 16 * k, fontWeight: 650 }}>
                    {group.name}
                  </span>
                  <span
                    style={{ fontSize: 12 * k, fontWeight: 600, color: '#fff', background: LOAD_COLORS[group.load], borderRadius: 999, padding: `${2 * k}px ${8 * k}px` }}
                  >
                    {LOAD_WORDS[group.load]}
                  </span>
                </div>
                <div style={{ fontSize: 14 * k, lineHeight: 1.35, color: '#374151' }}>{group.explain ?? ''}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14 * k, fontWeight: 600, marginBottom: 4 * k }}>{model.summary ?? 'Tap a part to see its job'}</div>
                <div style={{ fontSize: 13 * k, color: '#6b7280' }}>
                  Tap a part, or step through all {groups.length} with ‹ ›. Green arrows are the outside forces.
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 * k, justifyContent: 'center' }}>
            <div style={{ display: 'flex', gap: 6 * k }}>
              <button style={kbtn} aria-label="Previous part" {...press(() => step(-1))}>
                ‹
              </button>
              <button style={kbtn} aria-label="Next part" {...press(() => step(1))}>
                ›
              </button>
            </div>
            {group && (
              <button style={{ ...kbtn, fontSize: 13 * k }} {...press(() => setSelected(null))}>
                Show all
              </button>
            )}
          </div>
        </div>
      </div>
    </HTMLContainer>
  )
}

export class Model3dShapeUtil extends BaseBoxShapeUtil<Model3dShape> {
  static override type = MODEL3D_TYPE
  static override props: RecordProps<Model3dShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    model: T.jsonValue as never,
    marks: T.jsonValue.optional() as never,
  }

  override getDefaultProps(): Model3dShape['props'] {
    return { w: 560, h: 460, title: '', model: { parts: [] }, marks: [] }
  }

  override canEdit() {
    return false
  }

  override isAspectRatioLocked() {
    return false
  }

  override component(shape: Model3dShape) {
    return <Model3dCard shape={shape} />
  }

  override getIndicatorPath(shape: Model3dShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}
