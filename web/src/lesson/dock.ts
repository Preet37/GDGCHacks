import type { Lesson } from '../contract'
import { audioOut } from './audio'
import { ClipSet } from './voice'

/** The lesson shown in the docked panel (there is one panel). null = no lesson is open. */
export interface DockState {
  lesson: Lesson
  /** identifies the lesson: the same lesson reopened keeps its player and its place */
  key: string
  /** shrunk to the "Lesson: ..." pill; the notebook has the whole screen */
  collapsed: boolean
  /** recorded narration, one clip per step */
  clips: ClipSet
  /** goes up each time the lesson should start (or carry on) playing */
  playRequest: number
  /** the last play request came from a tap, so sound is allowed to start */
  fromTap: boolean
}

let state: DockState | null = null
const listeners = new Set<() => void>()

/** Recordings of the last few lessons, so reopening one from its marker doesn't ask for them again. */
const clipCache = new Map<string, ClipSet>()
const KEEP = 3

function clipsFor(key: string, lesson: Lesson): ClipSet {
  let clips = clipCache.get(key)
  clipCache.delete(key)
  // every step's narration is asked for at once, now, so it is there by the time the step is reached
  if (!clips) clips = new ClipSet(lesson.steps.map((s) => s.say ?? ''), (text) => import('../sync/api').then((api) => api.speak(text)))
  clipCache.set(key, clips)
  for (const [k, old] of clipCache) {
    if (clipCache.size <= KEEP) break
    if (k === state?.key) continue
    clipCache.delete(k)
    old.dispose()
  }
  return clips
}

function set(next: DockState | null) {
  state = next
  for (const fn of listeners) fn()
}

export const dock = {
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  get: () => state,

  /** Open `lesson` in the panel and play it. `fromTap` = called inside a tap handler. */
  open(lesson: Lesson, opts: { fromTap?: boolean } = {}) {
    // sound may only start inside a tap, and the panel isn't on screen yet: unlock it now
    if (opts.fromTap) audioOut()?.unlock()
    const key = JSON.stringify(lesson)
    const same = state?.key === key
    set({
      lesson: same && state ? state.lesson : lesson,
      key,
      collapsed: false,
      clips: clipsFor(key, lesson),
      playRequest: (state?.playRequest ?? 0) + 1,
      fromTap: !!opts.fromTap,
    })
  },
  collapse() {
    if (state && !state.collapsed) set({ ...state, collapsed: true })
  },
  expand() {
    if (state?.collapsed) set({ ...state, collapsed: false })
  },
  close() {
    if (state) set(null)
  },
}
