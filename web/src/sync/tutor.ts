import type { Editor, TLRecord, TLShape, TLShapeId } from 'tldraw'
import type { CheckRequest, CheckResponse, PageState } from '../contract'
import { isAiShape } from '../render/actions'
import { applyResponse } from '../render/apply'
import { readingShapes } from '../render/reading'
import { pageToBox, type PageRect } from '../render/geometry'
import { autoWindow, coverage, EXPORT_PADDING, helpWindow, intersects, rectOf, studentShapes, union } from '../page'
import { isWorksheetShape } from '../worksheet'
import { postCheck } from './api'
import { exportPng } from './exportImage'
import { boxRect, mergeReply, PAGE_FRAME, requestState, sweepErased, toSaved, type SavedState } from './frame'
import { HintChain, mistakeProblems, raisedProblem, stuckMsFromUrl, type HelpResult, type HelpTarget } from './hintChain'
import { emptyState, loadLastBounds, loadState, saveState } from './pageState'
import { hashString, PauseScheduler } from './scheduler'

export const PAUSE_MS = 2000
/** After a check, changes left in other parts of the page get their own check, at most this many in a row. */
export const MAX_FOLLOW_UPS = 2

export type TutorEvent = { type: 'busy'; busy: boolean } | { type: 'error'; message: string } | { type: 'reply'; reply: CheckResponse }

function isInkRecord(r: TLRecord): r is TLShape {
  return r.typeName === 'shape' && !isAiShape(r) && !isWorksheetShape(r)
}

function isStudentShapeRecord(r: TLRecord): boolean {
  return r.typeName === 'shape' && !isAiShape(r)
}

/** What one request did (see hintChain.ts). */
interface SendOutcome extends HelpResult {
  mistakes: string[]
}

/** A change not yet sent: a live stroke (looked up by id when sending) or the place where one was erased. */
interface Change {
  gone: PageRect | null
  seq: number
}

/** Watches the student's strokes, sends the part of the page they are working on after a pause, and draws the reply. */
export class Tutor {
  /** Saved state; line boxes are in page coordinates (see frame.ts). */
  state: SavedState
  showReading = false
  /** What the last request covered and carried (for the dev console and tests). */
  lastSent: { window: PageRect; mode: CheckRequest['mode']; state: PageState; help_box?: CheckRequest['help_box'] } | null = null
  /** One tap on Help, then hints keep coming while the student is stuck (see hintChain.ts). */
  readonly hints: HintChain
  /** counts changes the student made, to tell whether a check is already out of date when it returns */
  private touches = 0
  private changes = new Map<string, Change>()
  private seq = 0
  private followUps = 0
  private known = new Map<string, PageRect>()
  private scheduler: PauseScheduler
  private listeners = new Set<(e: TutorEvent) => void>()
  private unlisten: () => void
  private editor: Editor

  constructor(editor: Editor, pageId?: string | null) {
    this.editor = editor
    this.state = toSaved(loadState(), loadLastBounds())
    if (pageId && pageId !== this.state.page_id) this.state = toSaved(emptyState(pageId), null)
    for (const s of studentShapes(editor)) this.remember(s.id)
    this.scheduler = new PauseScheduler({
      delayMs: PAUSE_MS,
      key: () => this.fingerprint(),
      send: async () => {
        const at = this.touches
        let out: SendOutcome | null = null
        try {
          out = await this.send({ mode: 'auto' })
        } finally {
          this.hints.checked(out && { dirty: this.touches !== at, mistakes: out.mistakes })
        }
      },
      onSkip: () => this.hints.checked(null),
      onIdle: () => this.hints.idle(),
    })
    this.hints = new HintChain({
      stuckMs: stuckMsFromUrl(typeof location === 'undefined' ? '' : location.search),
      request: (target) => this.requestHelp(target),
    })
    this.unlisten = editor.store.listen(
      ({ changes }) => {
        let touched = false
        const live = (r: TLRecord) => {
          touched ||= isStudentShapeRecord(r)
          if (!isInkRecord(r)) return
          this.remember(r.id)
          this.mark(r.id, null)
        }
        Object.values(changes.added).forEach(live)
        Object.values(changes.updated).forEach(([, to]) => live(to))
        for (const r of Object.values(changes.removed)) {
          touched ||= isStudentShapeRecord(r)
          if (!isInkRecord(r)) continue
          this.changes.delete(r.id)
          const was = this.known.get(r.id)
          this.known.delete(r.id)
          if (was) this.mark(`gone:${r.id}`, was)
        }
        if (touched) {
          this.followUps = 0
          this.touches++
          this.hints.ink()
          this.scheduler.poke()
        }
      },
      { scope: 'document', source: 'user' },
    )
  }

  /** Show a quiet toast from outside the tutor (e.g. save errors). */
  notify(message: string) {
    this.emit({ type: 'error', message })
  }

  on(fn: (e: TutorEvent) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  dispose() {
    this.unlisten()
    this.scheduler.dispose()
    this.hints.dispose()
  }

  /**
   * Help was tapped: send now with mode "help". `area` = page-space selection; without one, what is on screen.
   * This starts a hint chain (or, during one on the same thing, brings its next hint right away).
   */
  async help(area?: PageRect, question?: string): Promise<boolean> {
    const res = await this.hints.tap(area, question, rectOf(this.editor.getViewportPageBounds()))
    if (res === 'busy') this.emit({ type: 'error', message: 'Still thinking about the last one…' })
    return res !== 'busy'
  }

  /** One help request, never alongside another request. */
  private async requestHelp(target: HelpTarget): Promise<HelpResult | 'busy' | null> {
    let out: SendOutcome | null = null
    const ok = await this.scheduler.exclusive(async () => {
      out = await this.send({ mode: 'help', ...target }).catch(() => null)
    })
    return ok ? out : 'busy'
  }

  /** Replace the page state (e.g. loaded from Firestore). The loaded page counts as already checked. */
  adoptState(state: PageState) {
    this.state = toSaved(state, loadLastBounds())
    saveState(this.state)
    this.hints.cancel()
    this.changes.clear()
    this.known.clear()
    for (const s of studentShapes(this.editor)) this.remember(s.id)
    this.drawReading()
  }

  /** Toggle the gray "what the AI read" text under each line. */
  setShowReading(on: boolean) {
    this.showReading = on
    this.drawReading()
  }

  private drawReading() {
    const old = this.editor.getCurrentPageShapes().filter((s) => isAiShape(s) && s.meta.kind === 'reading')
    // saved boxes are already page coordinates
    const fresh = this.showReading ? readingShapes(this.state.lines, PAGE_FRAME) : []
    this.editor.run(
      () => {
        if (old.length) this.editor.deleteShapes(old)
        if (fresh.length) this.editor.createShapes(fresh)
      },
      { history: 'ignore', ignoreShapeLock: true },
    )
  }

  private emit(e: TutorEvent) {
    for (const fn of this.listeners) fn(e)
  }

  private remember(id: string) {
    const b = this.editor.getShapePageBounds(id as TLShapeId)
    if (b) this.known.set(id, rectOf(b))
  }

  private mark(key: string, gone: PageRect | null) {
    this.changes.delete(key) // re-insert: newest last
    this.changes.set(key, { gone, seq: ++this.seq })
  }

  private fingerprint(): string {
    const parts = studentShapes(this.editor).map((s) => JSON.stringify([s.id, s.x, s.y, s.rotation, s.props]))
    return hashString(parts.sort().join('|') + '#' + [...this.changes.keys()].join(','))
  }

  /** Lines whose writing is gone are forgotten here, and their feedback removed. */
  private sweep(ink: PageRect[], sheets: PageRect[]) {
    const { state, erased } = sweepErased(this.state, ink, sheets)
    if (!erased.length) return
    this.state = state
    saveState(state)
    applyResponse(this.editor, { lines: [], actions: [], clear_line_ids: erased, state }, PAGE_FRAME)
    this.drawReading()
  }

  /** A hint chain's follow-up: the window its first request sent, stretched over what the problem has grown to. */
  private chainWindow(first: PageRect, problemId?: string): PageRect {
    let win = first
    for (const l of this.state.lines) {
      if (l.problem_id !== problemId) continue
      const r = boxRect(l.box)
      win = union(win, { x: r.x - EXPORT_PADDING, y: r.y - EXPORT_PADDING, w: r.w + EXPORT_PADDING * 2, h: r.h + EXPORT_PADDING * 2 })!
    }
    return win
  }

  /** Returns what the request did, or null if nothing was sent. */
  private async send(opts: { mode: CheckRequest['mode'] } & HelpTarget): Promise<SendOutcome | null> {
    const view = rectOf(this.editor.getViewportPageBounds())
    const items = studentShapes(this.editor).flatMap((shape) => {
      const b = this.editor.getShapePageBounds(shape)
      return b ? [{ shape, rect: rectOf(b), sheet: isWorksheetShape(shape) }] : []
    })
    const ink = items.filter((i) => !i.sheet).map((i) => i.rect)
    const sheets = items.filter((i) => i.sheet).map((i) => i.rect)
    this.sweep(ink, sheets)

    // unsent changes, oldest first
    const byId = new Map(items.map((i) => [i.shape.id as string, i.rect]))
    const pending: { key: string; seq: number; rect: PageRect }[] = []
    for (const [key, c] of this.changes) {
      const rect = c.gone ?? byId.get(key)
      if (rect) pending.push({ key, seq: c.seq, rect })
      else this.changes.delete(key)
    }

    const win =
      opts.mode === 'help'
        ? opts.window
          ? this.chainWindow(opts.window, opts.problemId)
          : helpWindow(opts.area, ink, sheets, view)
        : autoWindow(pending.map((p) => p.rect), ink, sheets, view)
    if (!win) return null
    /** Changes inside the window are dealt with by this check; the rest wait for their own. */
    const settle = () => {
      for (const p of pending) {
        if (this.changes.get(p.key)?.seq === p.seq && coverage(p.rect, win) > 0.5) this.changes.delete(p.key)
      }
      if (!this.changes.size) return
      if (this.followUps < MAX_FOLLOW_UPS) {
        this.followUps++
        this.scheduler.poke()
      } else this.changes.clear()
    }

    const visible = items.filter((i) => intersects(i.rect, win))
    if (opts.mode === 'auto' && !visible.some((i) => !i.sheet)) {
      settle() // only erasures here: nothing to read
      return null
    }
    if (!visible.length) {
      this.emit({ type: 'error', message: 'Nothing on screen to help with yet' })
      return null
    }

    this.emit({ type: 'busy', busy: true })
    try {
      const sent = requestState(this.state, win)
      const req: CheckRequest = {
        image_base64: await exportPng(this.editor, visible.map((i) => i.shape), win),
        mode: opts.mode,
        state: sent,
      }
      if (opts.area) req.help_box = pageToBox(opts.area, win)
      if (opts.question) req.question = opts.question
      this.lastSent = { window: win, mode: req.mode, state: sent, help_box: req.help_box }
      const raw = await postCheck(req)
      // the page owns its id and its frame: fold the window's reply into the whole-page state
      const { reply, state } = mergeReply(this.state, sent, raw, win)
      applyResponse(this.editor, reply, win)
      const raised = raisedProblem(this.state.problems, state.problems, opts.problemId)
      this.state = state
      saveState(state)
      this.drawReading()
      settle()
      this.emit({ type: 'reply', reply })
      return { window: win, raised, mistakes: mistakeProblems(reply) }
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' })
      throw err
    } finally {
      this.emit({ type: 'busy', busy: false })
    }
  }
}
