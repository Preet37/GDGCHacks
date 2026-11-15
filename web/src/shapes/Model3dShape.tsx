import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, type RecordProps, type TLShape } from 'tldraw'
import type { Model3dFigure } from '../contract'
import { LOAD_COLORS, LOAD_WORDS, loadsUsed, partGroups } from '../render/model3d/geometry'
import type { ModelView } from '../render/model3d/scene'

/**
 * Engineering (Part 2): a 3D model of a structure (a bridge, a truss, a crane) the student can turn and tap.
 * Drag the view to turn it, tap a part (or step with ‹ ›) to see its job and the force it carries. Parts are
 * coloured by that force. Only the model is stored; the scene is rebuilt on mount, so it survives save/load.
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
}

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    model3d: Model3dProps
  }
}

export type Model3dShape = TLShape<typeof MODEL3D_TYPE>

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
  const [selected, setSelected] = useState<string | null>(null)
  const modelKey = JSON.stringify(model)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => partGroups(model), [modelKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const legend = useMemo(() => loadsUsed(model), [modelKey])

  const viewW = Math.max(1, Math.round(w) - 2)
  const viewH = Math.max(1, Math.round(h) - MODEL3D_TITLE_H - MODEL3D_PANEL_H - 2)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let view: ModelView | null = null
    setGlFailed(false)
    import('../render/model3d/scene')
      .then(({ createModelView }) => {
        if (cancelled) return
        view = createModelView(host, model, host.clientWidth || 1, host.clientHeight || 1)
        viewRef.current = view
      })
      .catch((err) => {
        console.warn('model3d: WebGL view failed', err)
        if (!cancelled) setGlFailed(true)
      })
    return () => {
      cancelled = true
      view?.dispose()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey])

  useEffect(() => {
    viewRef.current?.resize(viewW, viewH)
  }, [viewW, viewH])

  useEffect(() => {
    viewRef.current?.select(selected)
  }, [selected])

  // Drag to turn, tap to pick. Native listeners so tldraw neither inks nor pans (same as the 3D surface).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let active: number | null = null
    let lastX = 0
    let lastY = 0
    let moved = 0
    const claim = (e: Event) => {
      editor.markEventAsHandled(e)
      e.stopPropagation()
    }
    const down = (e: PointerEvent) => {
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
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== active) return
      claim(e)
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
      claim(e)
      if (e.pointerId !== active) return
      active = null
      try {
        host.releasePointerCapture(e.pointerId)
      } catch {
        // already released
      }
      if (moved <= TAP_SLOP && e.type === 'pointerup' && viewRef.current) {
        // screen pixels inside the view; pick() divides by the canvas's on-screen size, so the zoom doesn't matter
        const r = host.getBoundingClientRect()
        setSelected(viewRef.current.pick(e.clientX - r.left, e.clientY - r.top))
        setTouched(true)
      }
    }
    const touch = (e: TouchEvent) => {
      claim(e)
      if (e.cancelable) e.preventDefault()
    }
    const wheel = (e: WheelEvent) => {
      claim(e)
      e.preventDefault()
      viewRef.current?.zoomBy(Math.exp(-e.deltaY * 0.002))
    }
    const swallow = (e: Event) => claim(e)
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
        <div style={{ height: MODEL3D_TITLE_H, flex: 'none', display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 16, fontWeight: 650, gap: 8 }}>
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title || '3D model'}</span>
          {legend.map((l) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, color: '#4b5568' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: LOAD_COLORS[l] }} />
              {l}
            </span>
          ))}
        </div>
        {glFailed ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#777' }}>Couldn't draw this</div>
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
              cursor: 'grab',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
          >
            <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 2 }}>
              <button style={btn} aria-label="Zoom in" {...press(() => viewRef.current?.zoomBy(1.25))}>
                +
              </button>
              <button style={btn} aria-label="Zoom out" {...press(() => viewRef.current?.zoomBy(0.8))}>
                −
              </button>
            </div>
            {!touched && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: 10,
                  transform: 'translateX(-50%)',
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: 'rgba(20, 24, 33, 0.82)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                ↻ Drag to turn · tap a part
              </div>
            )}
          </div>
        )}
        <div
          data-model3d-panel
          style={{ height: MODEL3D_PANEL_H, flex: 'none', borderTop: '1px solid #eef0f4', padding: '10px 12px', boxSizing: 'border-box', display: 'flex', gap: 10 }}
        >
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {group ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span data-model3d-part style={{ fontSize: 16, fontWeight: 650 }}>
                    {group.name}
                  </span>
                  <span
                    style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: LOAD_COLORS[group.load], borderRadius: 999, padding: '2px 8px' }}
                  >
                    {LOAD_WORDS[group.load]}
                  </span>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.35, color: '#374151' }}>{group.explain ?? ''}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{model.summary ?? 'Tap a part to see its job'}</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  Tap a part, or step through all {groups.length} with ‹ ›. Green arrows are the outside forces.
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btn} aria-label="Previous part" {...press(() => step(-1))}>
                ‹
              </button>
              <button style={btn} aria-label="Next part" {...press(() => step(1))}>
                ›
              </button>
            </div>
            {group && (
              <button style={{ ...btn, fontSize: 13 }} {...press(() => setSelected(null))}>
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
  }

  override getDefaultProps(): Model3dShape['props'] {
    return { w: 560, h: 460, title: '', model: { parts: [] } }
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
