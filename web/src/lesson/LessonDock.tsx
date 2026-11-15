import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { dock, type DockState } from './dock'
import { dockLayout, type DockLayout } from './layout'
import './lesson.css'

// The player (canvas drawing, KaTeX and its fonts) is only loaded when a lesson is opened.
const LessonPanel = lazy(() => import('./LessonPanel'))

function useScreen(): { w: number; h: number } {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return size
}

/** The open lesson, and how the screen is split while its panel is showing (null = the notebook has it all). */
export function useLessonDock(): { state: DockState | null; layout: DockLayout | null } {
  const state = useSyncExternalStore(dock.subscribe, dock.get)
  const screen = useScreen()
  return { state, layout: state && !state.collapsed ? dockLayout(screen.w, screen.h) : null }
}

/**
 * The lesson panel, docked beside the notebook (below it on an upright screen, to its right on a
 * wide one), and the pill it shrinks to. Goes next to the notebook inside `.app-shell`.
 */
export function LessonDock({ state, layout }: { state: DockState | null; layout: DockLayout | null }) {
  if (!state) return null
  const title = state.lesson.title || 'Lesson'
  return (
    <>
      <aside
        className="lesson-dock"
        data-side={layout?.side}
        aria-label={`Lesson: ${title}`}
        style={layout ? (layout.side === 'bottom' ? { height: layout.size } : { width: layout.size }) : { display: 'none' }}
      >
        <Suspense fallback={<div className="lesson-panel-wait">{title}</div>}>
          <LessonPanel key={state.key} state={state} />
        </Suspense>
      </aside>
      {state.collapsed && (
        <button className="lesson-pill" onClick={() => dock.open(state.lesson, { fromTap: true })} aria-label={`Open the lesson: ${title}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M8 5.2v13.6a.9.9 0 0 0 1.37.77l11-6.8a.9.9 0 0 0 0-1.54l-11-6.8A.9.9 0 0 0 8 5.2z" fill="currentColor" />
          </svg>
          <span>Lesson: {title}</span>
        </button>
      )}
    </>
  )
}
