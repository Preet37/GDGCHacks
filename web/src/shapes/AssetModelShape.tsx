import { useEffect, useRef, useState, type ComponentType } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, useValue, type RecordProps, type TLShape } from 'tldraw'
import { assetById, assetParams, type AssetEntry, type AssetSlider } from '../assets3d/catalog'
import type { AssetStageProps, Orbit } from '../assets3d/AssetStage'
import { isFresh } from './fresh3d'

/**
 * A hand-built, animated 3D model from the asset library (../assets3d): a bridge, a Formula One car, a wind
 * turbine... Drag the view to turn it, pinch or use + / − to zoom, move a slider to change the model.
 * Only the asset's id and the slider values are stored; the scene is rebuilt on mount.
 */

export const ASSET3D_TYPE = 'asset3d' as const
export const ASSET3D_TITLE_H = 32
/** At most this many asset cards run WebGL at once; the oldest goes back to "Tap to show" (iPad memory). */
const MAX_LIVE = 2

interface Asset3dProps {
  w: number
  h: number
  /** id in the catalogue (../assets3d/catalog.ts) */
  asset: string
  title: string
  /** slider values, by the model's parameter name */
  params: Record<string, number>
}

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    asset3d: Asset3dProps
  }
}

export type Asset3dShape = TLShape<typeof ASSET3D_TYPE>

/** Cards that are running WebGL now, oldest first, each with the way to put it back to sleep. */
const liveCards = new Map<string, () => void>()

const cardStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: '#fff',
  border: '1px solid #e2e2e2',
  borderRadius: 10,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'system-ui, sans-serif',
  color: '#000',
}

const zoomBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.25)',
  background: 'rgba(20, 24, 33, 0.72)',
  color: '#fff',
  fontSize: 20,
  fontWeight: 600,
  lineHeight: 1,
  cursor: 'pointer',
  pointerEvents: 'all',
  padding: 0,
}

const overlay: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  fontWeight: 600,
  pointerEvents: 'none',
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function decimals(step: number) {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

function show(sl: AssetSlider, v: number) {
  const text = v.toFixed(decimals(sl.step))
  return sl.unit ? `${text}${sl.unit === '°' ? '' : ' '}${sl.unit}` : text
}

/** A slider drawn by the card itself (a native range input is unreliable inside the zoomed page on iPad). */
function Slider({
  sl,
  value,
  onChange,
  onCommit,
}: {
  sl: AssetSlider
  value: number
  onChange: (v: number) => void
  onCommit: () => void
}) {
  const editor = useEditor()
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)
  const claim = (e: React.SyntheticEvent) => {
    editor.markEventAsHandled(e)
    e.stopPropagation()
  }
  const valueAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || !r.width) return value
    const frac = clamp((clientX - r.left) / r.width, 0, 1)
    const steps = Math.round((frac * (sl.max - sl.min)) / sl.step)
    return clamp(Number((sl.min + steps * sl.step).toFixed(decimals(sl.step))), sl.min, sl.max)
  }
  const frac = clamp((value - sl.min) / (sl.max - sl.min), 0, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 36 }} data-slider={sl.key}>
      <span style={{ width: 132, flex: 'none', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {sl.label}
      </span>
      <div
        ref={trackRef}
        role="slider"
        aria-label={sl.label}
        aria-valuemin={sl.min}
        aria-valuemax={sl.max}
        aria-valuenow={value}
        style={{ flex: 1, height: 36, position: 'relative', cursor: 'pointer', touchAction: 'none', pointerEvents: 'all' }}
        onPointerDown={(e) => {
          claim(e)
          if (dragging.current !== null) return
          dragging.current = e.pointerId
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // pointer already gone
          }
          onChange(valueAt(e.clientX))
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== dragging.current) return
          claim(e)
          onChange(valueAt(e.clientX))
        }}
        onPointerUp={(e) => {
          claim(e)
          if (e.pointerId !== dragging.current) return
          dragging.current = null
          onCommit()
        }}
        onPointerCancel={(e) => {
          claim(e)
          if (e.pointerId !== dragging.current) return
          dragging.current = null
          onCommit()
        }}
        onTouchStart={claim}
        onTouchMove={claim}
        onTouchEnd={claim}
        onClick={claim}
        onDoubleClick={claim}
      >
        <div style={{ position: 'absolute', left: 0, right: 0, top: 15, height: 6, borderRadius: 3, background: '#dfe3ea' }} />
        <div style={{ position: 'absolute', left: 0, width: `${frac * 100}%`, top: 15, height: 6, borderRadius: 3, background: '#2563eb' }} />
        <div
          style={{
            position: 'absolute',
            left: `calc(${frac * 100}% - 11px)`,
            top: 7,
            width: 22,
            height: 22,
            borderRadius: 11,
            background: '#fff',
            border: '2px solid #2563eb',
            boxSizing: 'border-box',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          }}
        />
      </div>
      <span style={{ width: 84, flex: 'none', fontSize: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {show(sl, value)}
      </span>
    </div>
  )
}

function Asset3dCard({ shape }: { shape: Asset3dShape }) {
  const editor = useEditor()
  const entry: AssetEntry | null = assetById(shape.props.asset)
  const hostRef = useRef<HTMLDivElement>(null)
  const orbit = useRef<Orbit>({ az: 0.5, pol: 1.2, dist: 10 })
  const baseDist = useRef(10)
  const [Stage, setStage] = useState<ComponentType<AssetStageProps> | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [touched, setTouched] = useState(false)
  const [running, setRunning] = useState(true)
  // a card restored with a saved page waits for a tap before it starts WebGL (see fresh3d.ts)
  const [live, setLive] = useState(() => isFresh(shape.id))
  const liveRef = useRef(live)
  liveRef.current = live
  const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])
  const hintScale = Math.min(2.5, Math.max(1, 0.8 / zoom))

  // Slider values: live here while a slider moves, stored in the shape when it is let go.
  const storedKey = JSON.stringify(shape.props.params)
  const [vals, setVals] = useState<Record<string, number>>(() => (entry ? assetParams(entry, shape.props.params) : {}))
  const valsRef = useRef(vals)
  valsRef.current = vals
  useEffect(() => {
    if (entry) setVals(assetParams(entry, shape.props.params))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey, entry])
  const commit = () => {
    try {
      editor.run(() => editor.updateShape({ id: shape.id, type: ASSET3D_TYPE, props: { params: valsRef.current } }), {
        history: 'ignore',
        ignoreShapeLock: true,
      })
    } catch (err) {
      console.warn('asset3d: could not store the slider values', err)
    }
  }

  // The 3D code (three.js + react-three-fiber) is loaded only when a card is actually shown.
  useEffect(() => {
    if (!live || !entry) return
    let cancelled = false
    setFailed(false)
    setReady(false)
    import('../assets3d/AssetStage')
      .then((m) => {
        if (cancelled) return
        const start = m.startOrbit(entry)
        orbit.current = start
        baseDist.current = start.dist
        setStage(() => m.default)
      })
      .catch((err) => {
        console.warn('asset3d: 3D view failed to load', err)
        if (!cancelled) setFailed(true)
      })
    // keep the number of WebGL views small: the oldest live card goes back to sleep
    liveCards.delete(shape.id)
    liveCards.set(shape.id, () => setLive(false))
    while (liveCards.size > MAX_LIVE) {
      const [oldest, sleep] = liveCards.entries().next().value as [string, () => void]
      liveCards.delete(oldest)
      sleep()
    }
    return () => {
      cancelled = true
      liveCards.delete(shape.id)
    }
  }, [live, entry, shape.id])

  // Stop the frame loop while the card is off screen.
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) setRunning(en.isIntersecting)
    })
    io.observe(host)
    return () => io.disconnect()
  }, [])

  // Drag to turn, pinch to zoom. Native listeners on the view itself: they run before tldraw's (which sit
  // on the canvas and the document), mark the event as handled so tldraw neither inks nor pans, and capture
  // the pointer so the drag keeps working when the finger leaves the card.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch = 0
    const claim = (e: Event) => {
      editor.markEventAsHandled(e)
      e.stopPropagation()
    }
    // the + / − buttons sit inside the view: let their events reach React (their handlers claim them)
    const onButton = (e: Event) => e.target instanceof Element && e.target.closest('button') !== null
    const spread = () => {
      const [a, b] = [...pointers.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const down = (e: PointerEvent) => {
      if (onButton(e)) return
      claim(e)
      if (!liveRef.current) {
        setLive(true) // the tap that wakes a restored card
        return
      }
      if (pointers.size >= 2 || (e.pointerType === 'mouse' && e.button !== 0)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) pinch = spread()
      try {
        host.setPointerCapture(e.pointerId)
      } catch {
        // pointer already gone
      }
      setTouched(true)
    }
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      claim(e)
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      const o = orbit.current
      if (pointers.size === 2) {
        const now = spread()
        if (pinch > 0 && now > 0) o.dist = clamp((o.dist * pinch) / now, baseDist.current * 0.35, baseDist.current * 2.5)
        pinch = now
        return
      }
      const z = editor.getZoomLevel() || 1
      o.az -= (dx / z) * 0.01
      o.pol = clamp(o.pol - (dy / z) * 0.01, 0.12, 1.55)
    }
    const end = (e: PointerEvent) => {
      if (onButton(e)) return
      claim(e)
      if (!pointers.delete(e.pointerId)) return
      pinch = 0
      try {
        host.releasePointerCapture(e.pointerId)
      } catch {
        // already released
      }
    }
    // Touch events also bubble to tldraw (pinch tracking, scroll prevention): keep them here.
    const touch = (e: TouchEvent) => {
      if (onButton(e)) return
      claim(e)
      if (e.cancelable) e.preventDefault()
    }
    const swallow = (e: Event) => {
      if (onButton(e)) return
      claim(e)
    }
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
  const zoomBy = (k: number) => {
    const o = orbit.current
    o.dist = clamp(o.dist / k, baseDist.current * 0.35, baseDist.current * 2.5)
    setTouched(true)
  }

  const broken = !entry || failed
  const state = broken ? 'error' : !live ? 'asleep' : ready ? 'ok' : 'loading'

  return (
    <HTMLContainer>
      <div style={cardStyle} data-asset3d={state} data-asset={shape.props.asset}>
        <div
          style={{
            height: ASSET3D_TITLE_H,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 600,
            padding: '0 10px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {shape.props.title || entry?.title || '3D model'}
        </div>
        <div
          ref={hostRef}
          data-asset3d-view=""
          style={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(#5a6b8c, #2b364e)',
            pointerEvents: 'all',
            touchAction: 'none',
            cursor: broken ? 'default' : 'grab',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        >
          {entry && live && !failed && Stage && (
            <Stage
              entry={entry}
              params={vals}
              running={running}
              orbit={orbit}
              onReady={() => setReady(true)}
              onError={(err) => {
                console.warn('asset3d: the model failed', err)
                setFailed(true)
              }}
              onLost={() => {
                // the browser took the WebGL context (memory): drop the view, a tap brings it back
                setStage(null)
                setLive(false)
              }}
            />
          )}
          {broken && <div style={{ ...overlay, color: '#c9d1e0', fontWeight: 400, fontSize: 14 }}>Couldn't draw this</div>}
          {!broken && !live && <div style={{ ...overlay, color: '#8fb4ff' }}>Tap to show the 3D model</div>}
          {!broken && live && !ready && <div style={{ ...overlay, color: '#c9d1e0', fontWeight: 400 }}>Loading the model…</div>}
          {!broken && live && ready && (
            <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button style={zoomBtn} aria-label="Zoom in" {...press(() => zoomBy(1.25))}>
                +
              </button>
              <button style={zoomBtn} aria-label="Zoom out" {...press(() => zoomBy(0.8))}>
                −
              </button>
            </div>
          )}
          {!broken && live && ready && !touched && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                bottom: 10,
                // the card shrinks with the page; the hint is kept readable when zoomed out
                transform: `translateX(-50%) scale(${hintScale})`,
                transformOrigin: 'center bottom',
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.9)',
                color: '#141821',
                fontSize: 15,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              ↻ Drag to turn
            </div>
          )}
        </div>
        {entry && (
          <>
            <div style={{ flex: 'none', padding: '6px 14px 2px' }}>
              {entry.sliders.map((sl) => (
                <Slider
                  key={sl.key}
                  sl={sl}
                  value={vals[sl.key] ?? sl.def}
                  onChange={(v) => setVals((old) => (old[sl.key] === v ? old : { ...old, [sl.key]: v }))}
                  onCommit={commit}
                />
              ))}
            </div>
            <div style={{ flex: 'none', padding: '4px 14px 10px', fontSize: 13.5, lineHeight: 1.35, color: '#333' }}>{entry.caption}</div>
          </>
        )}
      </div>
    </HTMLContainer>
  )
}

export class Asset3dShapeUtil extends BaseBoxShapeUtil<Asset3dShape> {
  static override type = ASSET3D_TYPE
  static override props: RecordProps<Asset3dShape> = {
    w: T.number,
    h: T.number,
    asset: T.string,
    title: T.string,
    params: T.dict(T.string, T.number),
  }

  override getDefaultProps(): Asset3dShape['props'] {
    return { w: 560, h: 540, asset: '', title: '', params: {} }
  }

  override canEdit() {
    return false
  }

  override canResize() {
    return false
  }

  override component(shape: Asset3dShape) {
    return <Asset3dCard shape={shape} />
  }

  override getIndicatorPath(shape: Asset3dShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}
