import type { PageState } from '../contract'

const KEY = 'tutor-page-state'

// crypto.randomUUID only exists in secure contexts, and the iPad opens plain http://<laptop-ip>
export function newPageId(): string {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function emptyState(page_id = newPageId()): PageState {
  return { page_id, lines: [], problems: [], flagged_line_ids: [] }
}

export function loadState(): PageState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as PageState
  } catch {
    // fall through to a fresh page
  }
  return emptyState()
}

export function saveState(state: PageState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // storage full or blocked: the server still gets state with each request
  }
}

const BOUNDS_KEY = 'tutor-last-bounds'

/** Page-space area of the last image sent; boxes in `state.lines` are relative to it. */
export function loadLastBounds(): { x: number; y: number; w: number; h: number } | null {
  try {
    const raw = localStorage.getItem(BOUNDS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveLastBounds(b: { x: number; y: number; w: number; h: number }) {
  try {
    localStorage.setItem(BOUNDS_KEY, JSON.stringify(b))
  } catch {
    // not critical
  }
}
