import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useEditor, useValue } from 'tldraw'
import type { FigureSpec, Lesson, LessonVisual } from '../contract'
import { trySampleSurface } from '../render/figure3d/sample'
import type { SurfaceView } from '../render/figure3d/scene'
import { takeAutoplay } from './autoplay'
import { drawFrame } from './draw'
import { scenesFor, type Scene } from './geometry'
import { Caption, MathLine } from './mathText'
import { LessonPlayer } from './player'
import { CARD_H, CARD_W, VISUAL_H, VISUAL_W } from './size'
import { narrator } from './speech'
import './lesson.css'

/** Does step i bring a curve that wasn't on screen in the step before? (It is drawn on, which takes a moment.) */
function revealsAt(scenes: (Scene | null)[], i: number): boolean {
  const now = scenes[i]
  if (!now) return false
  const before = new Set((i > 0 ? scenes[i - 1]?.curves : undefined)?.map((c) => c.src) ?? [])
  return now.curves.some((c) => c.fn && !before.has(c.src))
}

const ICONS = {
  play: 'M8 5.2v13.6a.9.9 0 0 0 1.37.77l11-6.8a.9.9 0 0 0 0-1.54l-11-6.8A.9.9 0 0 0 8 5.2z',
  pause: 'M7 5h3.4v14H7zM13.6 5H17v14h-3.4z',
  prev: 'M6 5h2.4v14H6zM19 5.9v12.2a.8.8 0 0 1-1.24.67L9 12.67a.8.8 0 0 1 0-1.34l8.76-6.1A.8.8 0 0 1 19 5.9z',
  next: 'M15.6 5H18v14h-2.4zM5 5.9v12.2a.8.8 0 0 0 1.24.67L15 12.67a.8.8 0 0 0 0-1.34l-8.76-6.1A.8.8 0 0 0 5 5.9z',
  replay: 'M12 5a7 7 0 1 1-6.6 4.67l1.9.66A5 5 0 1 0 12 7v3L7.5 6.25 12 2.5V5z',
  sound: 'M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5H4zm11.2-2.3-1.2 1.6a4 4 0 0 1 0 6.4l1.2 1.6a6 6 0 0 0 0-9.6zm2.4-3.2-1.2 1.6a8 8 0 0 1 0 12.8l1.2 1.6a10 10 0 0 0 0-16z',
  muted: 'M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5H4zm10.1-.6-1.4 1.4 1.7 1.7-1.7 1.7 1.4 1.4 1.7-1.7 1.7 1.7 1.4-1.4-1.7-1.7 1.7-1.7-1.4-1.4-1.7 1.7-1.7-1.7z',
}

function Icon({ name, size = 28 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  )
}

/** A 3D surface for a surface3d visual: the notebook's own 3D view, turning slowly while the lesson plays. */
function Surface({ visual, spin }: { visual: LessonVisual; spin: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<SurfaceView | null>(null)
  const key = JSON.stringify([visual.expressions, visual.x_range, visual.y_range])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grid = useMemo(() => {
    const spec: FigureSpec = { kind: 'surface3d', expressions: visual.expressions, x_range: visual.x_range }
    if (visual.y_range) spec.y_range = visual.y_range
    return trySampleSurface(spec)
  }, [key])

  useEffect(() => {
    const el = host.current
    if (!el || !grid) return
    let cancelled = false
    let made: SurfaceView | null = null
    import('../render/figure3d/scene')
      .then(({ createSurfaceView }) => {
        if (cancelled) return
        made = createSurfaceView(el, grid, VISUAL_W, VISUAL_H)
        view.current = made
      })
      .catch((err) => console.warn('lesson: 3D view failed', err))
    return () => {
      cancelled = true
      made?.dispose()
      view.current = null
    }
  }, [grid])

  useEffect(() => {
    if (!spin) return
    let raf = 0
    let last = performance.now()
    const turn = (now: number) => {
      raf = requestAnimationFrame(turn)
      view.current?.rotateBy(-(now - last) * 0.012, 0)
      last = now
    }
    raf = requestAnimationFrame(turn)
    return () => cancelAnimationFrame(raf)
  }, [spin])

  return (
    <div ref={host} className="lesson-surface">
      {!grid && <span className="lesson-note">Couldn't draw this surface</span>}
    </div>
  )
}

export default function LessonCard({ shapeId, lesson, w, h }: { shapeId: string; lesson: Lesson; w: number; h: number }) {
  const editor = useEditor()
  const lessonKey = JSON.stringify(lesson)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { player, scenes } = useMemo(() => {
    const scenes = scenesFor(lesson)
    return { scenes, player: new LessonPlayer(lesson, narrator(), { reveals: (i) => revealsAt(scenes, i) }) }
  }, [lessonKey])
  const snap = useSyncExternalStore(player.subscribe, () => player.snapshot)

  // A card the tutor has just placed starts by itself; one restored from a saved page waits for Play.
  const auto = useRef(false)
  useEffect(() => {
    if (takeAutoplay(shapeId)) auto.current = true
    if (auto.current) player.play(false)
    return () => player.dispose() // stops the voice when the card is deleted
  }, [player, shapeId])

  const scale = Math.max(0.05, Math.min(w / CARD_W, h / CARD_H))
  const zoom = useValue('lesson zoom', () => Math.ceil(editor.getZoomLevel() * 2) / 2, [editor])
  const ratio = Math.min(3, Math.max(1, (window.devicePixelRatio || 1) * scale * zoom))

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const dirty = useRef(true)
  // any render (step, size, play state) is worth one fresh frame
  useEffect(() => {
    dirty.current = true
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.width = Math.round(VISUAL_W * ratio)
    canvas.height = Math.round(VISUAL_H * ratio)
    dirty.current = true
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(250, now - last)
      last = now
      player.tick(dt)
      if (!player.animating && !dirty.current) return
      dirty.current = false
      const s = player.snapshot
      const scene = scenes[s.step] ?? null
      const prev = player.prevStep >= 0 ? (scenes[player.prevStep] ?? null) : null
      // a step without its own picture keeps the last one as it ended
      const own = !!lesson.steps[s.step]?.visual
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      try {
        drawFrame(ctx, VISUAL_W, VISUAL_H, { scene, prev, since: player.sinceChange, motion: own ? player.motion : 1 })
      } catch (err) {
        console.warn('lesson: frame skipped', err)
      }
      dotRef.current?.style.setProperty('--p', String(player.progress))
    }
    raf = requestAnimationFrame(frame)
    // the plot's numbers use the math font, which arrives a moment after the first frame
    const redraw = () => (dirty.current = true)
    document.fonts?.addEventListener?.('loadingdone', redraw)
    return () => {
      cancelAnimationFrame(raf)
      document.fonts?.removeEventListener?.('loadingdone', redraw)
    }
  }, [player, scenes, lesson, ratio])

  // Taps on the controls. Native listeners on the card: they run before tldraw's (so a tap neither
  // inks nor drags the card), and they act on touchend / mouse-up, which iOS counts as a user
  // gesture, so the voice is allowed to start.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let touchAt = -1e9
    const target = (e: Event) => (e.target as Element | null)?.closest?.('[data-act]') as HTMLElement | null
    const claim = (e: Event) => {
      editor.markEventAsHandled(e)
      e.stopPropagation()
    }
    const act = (e: Event) => {
      const el = target(e)
      if (!el) return
      const name = el.dataset.act
      if (name === 'toggle') player.toggle(true)
      else if (name === 'prev') player.prev(true)
      else if (name === 'next') player.next(true)
      else if (name === 'replay') player.replay(true)
      else if (name === 'mute') player.setMuted(!player.snapshot.muted)
      else if (name === 'goto') player.goto(Number(el.dataset.step), true)
    }
    const on = (e: Event) => {
      if (!target(e)) return
      claim(e)
      // one tap = one action: a finger or pencil acts on touchend, a mouse on click (as does the keyboard)
      if (e.type === 'touchend') {
        e.preventDefault() // no synthetic click afterwards
        touchAt = performance.now()
        act(e)
      } else if (e.type === 'click' && performance.now() - touchAt > 700) act(e)
    }
    const types = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'click', 'dblclick', 'contextmenu']
    for (const t of types) root.addEventListener(t, on, { passive: false })
    return () => {
      for (const t of types) root.removeEventListener(t, on)
    }
  }, [editor, player])

  const steps = lesson.steps
  const step = steps[snap.step]
  const scene = scenes[snap.step] ?? null
  // the line of math stays up (greyed) through steps that don't write a new one
  let writeFrom = snap.step
  while (writeFrom > 0 && !steps[writeFrom]?.write) writeFrom--
  const write = steps[writeFrom]?.write
  const showStart = !snap.started || snap.needsTap

  return (
    <div className="lesson-frame" style={{ width: w, height: h }}>
      <div
        ref={rootRef}
        className="lesson-card"
        data-lesson={snap.playing ? 'playing' : snap.ended ? 'ended' : 'paused'}
        data-step={snap.step}
        style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})` }}
      >
        <div className="lesson-head">
          <div className="lesson-title">{lesson.title}</div>
          <div className="lesson-count">
            {snap.step + 1} of {steps.length}
          </div>
        </div>

        <div className={'lesson-visual' + (scene ? '' : ' empty')}>
          <canvas ref={canvasRef} className="lesson-canvas" style={{ width: VISUAL_W, height: VISUAL_H }} />
          {scene?.kind === 'surface3d' && <Surface visual={scene.visual} spin={snap.playing} />}
          {showStart && (
            <button className="lesson-start" data-act="toggle" aria-label="Play lesson">
              <span className="lesson-start-disc">
                <Icon name="play" size={52} />
              </span>
              <span className="lesson-start-label">{snap.needsTap ? 'Tap to play with sound' : 'Play lesson'}</span>
            </button>
          )}
        </div>

        <div className="lesson-write">
          {write && <MathLine key={writeFrom} tex={write} className={'lesson-math' + (writeFrom === snap.step ? ' fresh' : ' kept')} />}
        </div>
        <div className="lesson-caption" key={snap.step}>
          {step?.caption ? <Caption text={step.caption} /> : null}
        </div>

        <div className="lesson-controls">
          <button className="lesson-btn" data-act="prev" aria-label="Previous step">
            <Icon name="prev" />
          </button>
          <button className="lesson-btn lesson-play" data-act="toggle" aria-label={snap.playing ? 'Pause' : 'Play'}>
            <Icon name={snap.playing ? 'pause' : snap.ended ? 'replay' : 'play'} size={34} />
          </button>
          <button className="lesson-btn" data-act="next" aria-label="Next step" disabled={snap.step >= steps.length - 1}>
            <Icon name="next" />
          </button>
          <div className="lesson-dots">
            {steps.map((_, i) => (
              <button
                key={i}
                className={'lesson-dot' + (i === snap.step ? ' now' : i < snap.step ? ' done' : '')}
                data-act="goto"
                data-step={i}
                aria-label={`Step ${i + 1}`}
                aria-current={i === snap.step ? 'step' : undefined}
              >
                <span ref={i === snap.step ? dotRef : undefined} />
              </button>
            ))}
          </div>
          <button className="lesson-btn" data-act="replay" aria-label="Play again from the start">
            <Icon name="replay" />
          </button>
          <button className={'lesson-btn' + (snap.muted ? ' off' : '')} data-act="mute" aria-label={snap.muted ? 'Turn the voice on' : 'Turn the voice off'} aria-pressed={snap.muted}>
            <Icon name={snap.muted ? 'muted' : 'sound'} />
          </button>
        </div>
      </div>
    </div>
  )
}
