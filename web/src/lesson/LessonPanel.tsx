import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FigureSpec, LessonVisual } from '../contract'
import { practiceKey, practiceStatus, startPractice } from '../practice/write'
import { trySampleSurface } from '../render/figure3d/sample'
import type { SurfaceView } from '../render/figure3d/scene'
import { audioOut } from './audio'
import { dock, type DockState } from './dock'
import { drawFrame } from './draw'
import { scenesFor, type Scene } from './geometry'
import { Caption, MathLine } from './mathText'
import { LessonPlayer } from './player'
import { narrator } from './speech'
import { lessonSpeed, sweepPlan, wordsSpoken } from './timing'
import { LessonVoice } from './voice'

/** Does step i bring a curve that wasn't on screen in the step before? (It is drawn on, which takes a moment.) */
function revealsAt(scenes: (Scene | null)[], i: number): boolean {
  const now = scenes[i]
  if (!now) return false
  const before = new Set((i > 0 ? scenes[i - 1]?.curves : undefined)?.map((c) => c.src) ?? [])
  return now.curves.some((c) => c.fn && !before.has(c.src))
}

/** Debug: `?lessonSpeed=8` plays lessons that many times faster, without the voice. */
const SPEED = typeof location === 'undefined' ? 1 : lessonSpeed(location.search)

const ICONS = {
  play: 'M8 5.2v13.6a.9.9 0 0 0 1.37.77l11-6.8a.9.9 0 0 0 0-1.54l-11-6.8A.9.9 0 0 0 8 5.2z',
  pause: 'M7 5h3.4v14H7zM13.6 5H17v14h-3.4z',
  prev: 'M6 5h2.4v14H6zM19 5.9v12.2a.8.8 0 0 1-1.24.67L9 12.67a.8.8 0 0 1 0-1.34l8.76-6.1A.8.8 0 0 1 19 5.9z',
  next: 'M15.6 5H18v14h-2.4zM5 5.9v12.2a.8.8 0 0 0 1.24.67L15 12.67a.8.8 0 0 0 0-1.34l-8.76-6.1A.8.8 0 0 0 5 5.9z',
  replay: 'M12 5a7 7 0 1 1-6.6 4.67l1.9.66A5 5 0 1 0 12 7v3L7.5 6.25 12 2.5V5z',
  sound: 'M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5H4zm11.2-2.3-1.2 1.6a4 4 0 0 1 0 6.4l1.2 1.6a6 6 0 0 0 0-9.6zm2.4-3.2-1.2 1.6a8 8 0 0 1 0 12.8l1.2 1.6a10 10 0 0 0 0-16z',
  muted: 'M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5H4zm10.1-.6-1.4 1.4 1.7 1.7-1.7 1.7 1.4 1.4 1.7-1.7 1.7 1.7 1.4-1.4-1.7-1.7 1.7-1.7-1.4-1.4-1.7 1.7-1.7-1.7z',
  collapse: 'M5.3 8.3a1 1 0 0 1 1.4 0L12 13.6l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4z',
  close: 'M6.3 6.3a1 1 0 0 1 1.4 0L12 10.6l4.3-4.3a1 1 0 1 1 1.4 1.4L13.4 12l4.3 4.3a1 1 0 0 1-1.4 1.4L12 13.4l-4.3 4.3a1 1 0 0 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4z',
}

function Icon({ name, size = 26 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  )
}

/** A 3D surface for a surface3d visual: the notebook's own 3D view, turning slowly while the lesson plays. */
function Surface({ visual, spin, w, h }: { visual: LessonVisual; spin: boolean; w: number; h: number }) {
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
    if (!el || !grid || w < 40 || h < 40) return
    let cancelled = false
    let made: SurfaceView | null = null
    import('../render/figure3d/scene')
      .then(({ createSurfaceView }) => {
        if (cancelled) return
        made = createSurfaceView(el, grid, w, h)
        view.current = made
      })
      .catch((err) => console.warn('lesson: 3D view failed', err))
    return () => {
      cancelled = true
      made?.dispose()
      view.current = null
    }
  }, [grid, w, h])

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

/**
 * The lesson player, inside the docked panel: the animated picture, the line of math and caption,
 * the narration as subtitles that fill in as it is spoken, and the transport.
 */
export default function LessonPanel({ state }: { state: DockState }) {
  const { lesson, clips, collapsed, playRequest, fromTap } = state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { player, scenes, sweeps } = useMemo(() => {
    const scenes = scenesFor(lesson)
    const voice = new LessonVoice({ narrator: narrator(), audio: audioOut(), clips })
    return {
      scenes,
      sweeps: lesson.steps.map((s) => sweepPlan(s.say ?? '')),
      player: new LessonPlayer(lesson, voice, { reveals: (i) => revealsAt(scenes, i), muted: SPEED > 1 }),
    }
  }, [state.key])
  const snap = useSyncExternalStore(player.subscribe, () => player.snapshot)

  useEffect(() => () => player.dispose(), [player]) // closing the panel stops the voice
  // a lesson that has just arrived (or was reopened from its marker or the pill) plays by itself
  useEffect(() => {
    if (!collapsed) player.play(fromTap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, playRequest])
  useEffect(() => {
    if (collapsed) player.pause()
  }, [player, collapsed])

  // "Your turn": when the lesson ends, its practice problem is written on the page and the panel folds away
  const practice = lesson.practice
  const turn = useSyncExternalStore(practiceStatus.subscribe, () => (practice ? practiceStatus.get(practiceKey(practice)) : undefined))
  useEffect(() => {
    if (snap.ended) startPractice(practice, { lesson })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.ended])

  // the picture fills whatever room the panel gives it
  const visualRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = visualRef.current
    if (!el) return
    const measure = () => {
      const w = Math.round(el.clientWidth)
      const h = Math.round(el.clientHeight)
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const subsRef = useRef<HTMLDivElement>(null)
  const said = useRef({ step: -1, n: -1, top: -1 })
  const dirty = useRef(true)
  // any render (step, size, play state) is worth one fresh frame
  useEffect(() => {
    dirty.current = true
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || box.w < 40 || box.h < 40) return
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    canvas.width = Math.round(box.w * ratio)
    canvas.height = Math.round(box.h * ratio)
    dirty.current = true
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(250, now - last)
      last = now
      player.tick(dt * SPEED)
      if (!player.animating && !dirty.current) return
      dirty.current = false
      const s = player.snapshot
      const scene = scenes[s.step] ?? null
      const prev = player.prevStep >= 0 ? (scenes[player.prevStep] ?? null) : null
      // a step without its own picture keeps the last one as it ended
      const own = !!lesson.steps[s.step]?.visual
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      try {
        drawFrame(ctx, box.w, box.h, { scene, prev, since: player.sinceChange, motion: own ? player.motion : 1 })
      } catch (err) {
        console.warn('lesson: frame skipped', err)
      }
      dotRef.current?.style.setProperty('--p', String(player.progress))

      // subtitles: the words said so far are inked in; the line being said is kept in view
      const subs = subsRef.current
      const sweep = sweeps[s.step]
      if (!subs || !sweep) return
      const resting = !s.playing && player.narration === 0 // not being read out: just show it
      const n = resting ? sweep.words.length : wordsSpoken(sweep, player.narration)
      const was = said.current
      if (was.step === s.step && was.n === n) return
      const words = subs.querySelectorAll<HTMLElement>('[data-w]')
      words.forEach((el, i) => el.classList.toggle('said', i < n))
      const cur = words[Math.max(0, Math.min(words.length - 1, n - 1))]
      const top = resting || !cur ? 0 : cur.offsetTop
      if (was.step !== s.step || top !== was.top) {
        const line = parseFloat(getComputedStyle(subs).lineHeight) || 28
        subs.scrollTo({ top: Math.max(0, top - line), behavior: was.step === s.step ? 'smooth' : 'auto' })
      }
      said.current = { step: s.step, n, top }
    }
    raf = requestAnimationFrame(frame)
    // the plot's numbers use the math font, which arrives a moment after the first frame
    const redraw = () => (dirty.current = true)
    document.fonts?.addEventListener?.('loadingdone', redraw)
    return () => {
      cancelAnimationFrame(raf)
      document.fonts?.removeEventListener?.('loadingdone', redraw)
    }
  }, [player, scenes, sweeps, lesson, box.w, box.h])

  const steps = lesson.steps
  const step = steps[snap.step]
  const scene = scenes[snap.step] ?? null
  // the line of math stays up (greyed) through steps that don't write a new one
  let writeFrom = snap.step
  while (writeFrom > 0 && !steps[writeFrom]?.write) writeFrom--
  const write = steps[writeFrom]?.write
  const showStart = !snap.started || snap.needsTap
  const words = sweeps[snap.step]?.words ?? []

  return (
    <div
      className="lesson-panel"
      data-lesson={snap.playing ? 'playing' : snap.ended ? 'ended' : 'paused'}
      data-step={snap.step}
      data-voice={snap.loading ? 'loading' : (snap.voice ?? 'none')}
    >
      <div className="lesson-head">
        <div className="lesson-title">{lesson.title || 'Lesson'}</div>
        <div className="lesson-count">
          {snap.step + 1} of {steps.length}
        </div>
        {practice && snap.step >= steps.length - 1 && (
          <button className="lesson-turn" data-practice={turn ?? 'ready'} onClick={() => startPractice(practice, { lesson, explicit: true })}>
            {turn === 'solved' ? 'Another one' : 'Your turn'}
          </button>
        )}
        <button className="lesson-btn small" onClick={() => dock.collapse()} aria-label="Minimise the lesson">
          <Icon name="collapse" size={24} />
        </button>
        <button className="lesson-btn small" onClick={() => dock.close()} aria-label="Close the lesson">
          <Icon name="close" size={24} />
        </button>
      </div>

      <div className="lesson-body">
        <div ref={visualRef} className={'lesson-visual' + (scene ? '' : ' empty')}>
          <canvas ref={canvasRef} className="lesson-canvas" style={{ width: box.w, height: box.h }} />
          {scene?.kind === 'surface3d' && <Surface visual={scene.visual} spin={snap.playing} w={box.w} h={box.h} />}
          {snap.loading && (
            <div className="lesson-voice-wait" role="status">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
              </svg>
              Loading the voice…
            </div>
          )}
          {showStart && (
            <button className="lesson-start" onClick={() => player.toggle(true)} aria-label="Play lesson">
              <span className="lesson-start-disc">
                <Icon name="play" size={44} />
              </span>
              <span className="lesson-start-label">{snap.needsTap ? 'Tap to play with sound' : 'Play lesson'}</span>
            </button>
          )}
        </div>

        <div className="lesson-board">
          <div className="lesson-write">
            {write && <MathLine key={writeFrom} tex={write} className={'lesson-math' + (writeFrom === snap.step ? ' fresh' : ' kept')} />}
          </div>
          <div className="lesson-caption" key={snap.step}>
            {step?.caption ? <Caption text={step.caption} /> : null}
          </div>
        </div>
      </div>

      <div className="lesson-subs" aria-label={step?.say}>
        <div ref={subsRef} className="lesson-subs-lines" key={snap.step}>
          {words.map((w, i) => (
            <span key={i} data-w="">
              {w}{' '}
            </span>
          ))}
        </div>
      </div>

      <div className="lesson-controls">
        <div className="lesson-transport">
          <button className="lesson-btn" onClick={() => player.prev(true)} aria-label="Previous step">
            <Icon name="prev" />
          </button>
          <button className="lesson-btn lesson-play" onClick={() => player.toggle(true)} aria-label={snap.playing ? 'Pause' : 'Play'}>
            <Icon name={snap.playing ? 'pause' : snap.ended ? 'replay' : 'play'} size={30} />
          </button>
          <button className="lesson-btn" onClick={() => player.next(true)} aria-label="Next step" disabled={snap.step >= steps.length - 1}>
            <Icon name="next" />
          </button>
        </div>
        <div className="lesson-dots">
          {steps.map((_, i) => (
            <button
              key={i}
              className={'lesson-dot' + (i === snap.step ? ' now' : i < snap.step ? ' done' : '')}
              onClick={() => player.goto(i, true)}
              aria-label={`Step ${i + 1}`}
              aria-current={i === snap.step ? 'step' : undefined}
            >
              <span ref={i === snap.step ? dotRef : undefined} />
            </button>
          ))}
        </div>
        <div className="lesson-transport">
          <button className="lesson-btn" onClick={() => player.replay(true)} aria-label="Play again from the start">
            <Icon name="replay" />
          </button>
          <button
            className={'lesson-btn' + (snap.muted ? ' off' : '')}
            onClick={() => player.setMuted(!player.snapshot.muted)}
            aria-label={snap.muted ? 'Turn the voice on' : 'Turn the voice off'}
            aria-pressed={snap.muted}
          >
            <Icon name={snap.muted ? 'muted' : 'sound'} />
          </button>
        </div>
      </div>
    </div>
  )
}
