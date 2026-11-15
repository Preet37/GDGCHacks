import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, type RecordProps, type TLShape } from 'tldraw'
import type { FigureSpec } from '../contract'
import { trySampleSurface } from '../render/figure3d/sample'
import type { SurfaceView } from '../render/figure3d/scene'

export const SURFACE3D_TYPE = 'surface3d'
/** Height of the title strip. It is not interactive, so it's where you grab the card to move it. */
export const SURFACE3D_TITLE_H = 30

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    surface3d: { w: number; h: number; spec: FigureSpec }
  }
}

export type Surface3dShape = TLShape<typeof SURFACE3D_TYPE>

const range = T.arrayOf(T.number).refine((r): [number, number] => {
  if (r.length !== 2) throw new Error('expected [min, max]')
  return [r[0], r[1]]
})

const cardStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: '#fff',
  border: '1px solid #e2e2e2',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'system-ui, sans-serif',
  color: '#000',
}

function Surface3dCard({ shape }: { shape: Surface3dShape }) {
  const editor = useEditor()
  const { spec, w, h } = shape.props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<SurfaceView | null>(null)
  const [glFailed, setGlFailed] = useState(false)
  const [touched, setTouched] = useState(false)

  // Only the spec is stored; the grid is recomputed whenever it changes (and on page load).
  const specKey = JSON.stringify(spec)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grid = useMemo(() => trySampleSurface(spec), [specKey])

  const viewW = Math.max(1, Math.round(w) - 2)
  const viewH = Math.max(1, Math.round(h) - SURFACE3D_TITLE_H - 2)

  // One WebGL renderer per shape, created on mount and freed on unmount.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !grid) return
    let cancelled = false
    let view: SurfaceView | null = null
    setGlFailed(false)
    // three.js is loaded only when a surface is actually shown
    import('../render/figure3d/scene')
      .then(({ createSurfaceView }) => {
        if (cancelled) return
        view = createSurfaceView(host, grid, host.clientWidth || 1, host.clientHeight || 1)
        viewRef.current = view
      })
      .catch((err) => {
        console.warn('surface3d: WebGL view failed', err)
        if (!cancelled) setGlFailed(true)
      })
    return () => {
      cancelled = true
      view?.dispose()
      viewRef.current = null
    }
  }, [grid])

  useEffect(() => {
    viewRef.current?.resize(viewW, viewH)
  }, [viewW, viewH])

  // Drag to orbit. Native listeners on the figure itself: they run before tldraw's (which sit on
  // the canvas and the document), mark the event as handled so tldraw neither inks nor pans, and
  // capture the pointer so the drag keeps working when the finger leaves the card.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let active: number | null = null
    let lastX = 0
    let lastY = 0
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
      try {
        host.setPointerCapture(e.pointerId)
      } catch {
        // pointer already gone
      }
      setTouched(true)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== active) return
      claim(e)
      const zoom = editor.getZoomLevel() || 1
      viewRef.current?.rotateBy((e.clientX - lastX) / zoom, (e.clientY - lastY) / zoom)
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
    }
    // Touch events also bubble to tldraw (pinch tracking, scroll prevention): keep them here.
    const touch = (e: TouchEvent) => {
      claim(e)
      if (e.cancelable) e.preventDefault()
    }
    const swallow = (e: Event) => claim(e)
    host.addEventListener('pointerdown', down)
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerup', end)
    host.addEventListener('pointercancel', end)
    host.addEventListener('touchstart', touch, { passive: false })
    host.addEventListener('touchmove', touch, { passive: false })
    host.addEventListener('touchend', touch, { passive: false })
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
      host.removeEventListener('click', swallow)
      host.removeEventListener('dblclick', swallow)
      host.removeEventListener('contextmenu', swallow)
    }
  }, [editor])

  const broken = !grid || glFailed

  return (
    <HTMLContainer>
      <div style={cardStyle} data-surface3d={broken ? 'error' : 'ok'}>
        <div
          style={{
            height: SURFACE3D_TITLE_H,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            padding: '0 8px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {spec.title ?? ''}
        </div>
        {broken ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#777' }}>
            Couldn't draw this
          </div>
        ) : (
          <div
            ref={hostRef}
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
            {!touched && (
              <div style={{ position: 'absolute', right: 8, bottom: 6, fontSize: 11, color: '#999', pointerEvents: 'none' }}>
                drag to rotate
              </div>
            )}
          </div>
        )}
      </div>
    </HTMLContainer>
  )
}

export class Surface3dShapeUtil extends BaseBoxShapeUtil<Surface3dShape> {
  static override type = SURFACE3D_TYPE
  static override props: RecordProps<Surface3dShape> = {
    w: T.number,
    h: T.number,
    spec: T.object({
      kind: T.literalEnum('plot2d', 'surface3d'),
      expressions: T.arrayOf(T.string),
      x_range: range,
      y_range: range.optional(),
      title: T.string.optional(),
    }),
  }

  override getDefaultProps(): Surface3dShape['props'] {
    return { w: 360, h: 300, spec: { kind: 'surface3d', expressions: ['0'], x_range: [-1, 1], y_range: [-1, 1] } }
  }

  override canEdit() {
    return false
  }

  override isAspectRatioLocked() {
    return false
  }

  override component(shape: Surface3dShape) {
    return <Surface3dCard shape={shape} />
  }

  override getIndicatorPath(shape: Surface3dShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}
