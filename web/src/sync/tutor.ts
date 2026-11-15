import type { Editor, TLRecord, TLShape, TLShapeId } from 'tldraw'
import type { CheckRequest, CheckResponse, GivenLine, PageState } from '../contract'
import { handwritingEnabled, harvestGlyphs } from '../handwriting'
import { isAiShape } from '../render/actions'
import { applyResponse, renderContext } from '../render/apply'
import { readingRects, readingShapes } from '../render/reading'
import { pageToBox, type PageRect } from '../render/geometry'
import { autoWindow, checkShapes, coverage, EXPORT_PADDING, hasWorksheet, helpWindow, intersects, markOnSheet, pointedAt, rectOf, studentShapes, union } from '../page'
import { givenLines, openPractices, solvedPractices, type OpenPractice } from '../practice/given'
import { isGivenShape, shapeUse } from '../practice/kind'
import { bindPractice, markSolved } from '../practice/write'
import { isWorksheetShape } from '../worksheet'
import { ApiError, postCheck } from './api'
import { exportPng } from './exportImage'
import { boxRect, mergeReply, PAGE_FRAME, requestState, sweepErased, toSaved, type SavedState } from './frame'
import { HintChain, MAX_HINT_LEVEL, mistakeProblems, raisedProblem, stuckMsFromUrl, type HelpResult, type HelpTarget } from './hintChain'
import { emptyState, loadLastBounds, loadState, saveState } from './pageState'
import { hashString, PauseScheduler } from './scheduler'
import { silence, type CheckStatus } from './status'

export const PAUSE_MS = 2000
/** Below this zoom a whole worksheet page is in view: Help looks at the marked part, not all of it. */
export const FAR_ZOOM = 0.5
/** After a check, changes left in other parts of the page get their own check, at most this many in a row. */
export const MAX_FOLLOW_UPS = 2

export type TutorEvent =
  | { type: 'busy'; busy: boolean }
  | { type: 'error'; message: string; sticky?: boolean }
  | { type: 'reply'; reply: CheckResponse; mode?: CheckRequest['mode'] }
  /** the last hint (the worked step) was just given: a good moment to offer a lesson instead */
  | { type: 'offer-lesson' }
  /** what the last check came to (see status.ts) */
  | { type: 'status'; status: CheckStatus }

/** What a tap on "Teach me" came to. 'none' = the tutor answered without a lesson (or there was nothing to look at). */
export type ExplainResult = 'ok' | 'busy' | 'none' | 'failed'

/** The student's own strokes. A practice problem the tutor wrote is sent like ink but is never ink that "changed". */
function isInkRecord(r: TLRecord): r is TLShape {
  return r.typeName === 'shape' && shapeUse(r).student && !isWorksheetShape(r)
}

function isStudentShapeRecord(r: TLRecord): boolean {
  return r.typeName === 'shape' && shapeUse(r).student
}

/** Two records with the same content (the store may hand a listener a copy of what was loaded). */
function sameRecord(a: TLRecord, b: TLRecord): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** What one request did (see hintChain.ts). */
interface SendOutcome extends HelpResult {
  mistakes: string[]
  /** the reply carried a lesson to play */
  lesson: boolean
}

/** A reply that has arrived but is not on the page yet, with what is needed to put it there. */
interface Fetched {
  mode: CheckRequest['mode']
  win: PageRect
  sent: PageState
  raw: CheckResponse
  problemId?: string
  /** the saved state and the count of student changes when the request was built: a held reply is only good while both stand */
  base: SavedState
  touches: number
  ms: number
  /** unsent changes this request covers (never for a prefetch) */
  pending: { key: string; seq: number; rect: PageRect }[]
  /** an imported worksheet is in the picture that was sent */
  sheet: boolean
  /** unsolved practice problems in the window: a green note in the reply solves one */
  practices: OpenPractice[]
}

/** Tutor feedback that links one line of working to the next (see autoWindow). */
const BRIDGE_KINDS = new Set(['note', 'ask', 'figure'])

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
  lastSent: { window: PageRect; mode: CheckRequest['mode']; state: PageState; help_box?: CheckRequest['help_box']; given?: GivenLine[]; has_worksheet?: boolean } | null = null
  /** What the last check came to: shown beside "Show what AI read". */
  status: CheckStatus | null = null
  /** One tap on Help, then hints keep coming while the student is stuck (see hintChain.ts). */
  readonly hints: HintChain
  /** counts changes the student made, to tell whether a check is already out of date when it returns */
  private touches = 0
  private changes = new Map<string, Change>()
  private seq = 0
  private followUps = 0
  private known = new Map<string, PageRect>()
  /** when each stroke was last drawn or changed (a running count), to know what the student did last */
  private drawnAt = new Map<string, number>()
  /**
   * What a restore put on the page (see adoptState): the store reports those records after the
   * restore has returned, exactly as if the student had drawn them. They are not new work.
   */
  private restored = new Map<string, TLRecord>()
  /** ids a restore took off the page: their removal is not the student erasing */
  private replaced = new Set<string>()
  private scheduler: PauseScheduler
  private listeners = new Set<(e: TutorEvent) => void>()
  private unlisten: () => void
  private unbindPractice: () => void
  private editor: Editor

  constructor(editor: Editor, pageId?: string | null) {
    this.editor = editor
    this.state = toSaved(loadState(), loadLastBounds())
    if (pageId && pageId !== this.state.page_id) this.state = toSaved(emptyState(pageId), null)
    this.rememberAll()
    this.unbindPractice = bindPractice(editor, { workOf: (lineId) => this.workOf(lineId) })
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
      onSkip: () => {
        this.setStatus({ at: Date.now(), mode: 'auto', skipped: 'nothing changed since the last check' })
        this.hints.checked(null)
      },
      onIdle: () => this.hints.idle(),
    })
    this.hints = new HintChain({
      stuckMs: stuckMsFromUrl(typeof location === 'undefined' ? '' : location.search),
      request: (target) => this.requestHelp(target),
      prefetch: (target) => this.fetch({ mode: 'help', ...target }, true).catch(() => null),
      show: (held) => this.showHeld(held as Fetched),
    })
    this.unlisten = editor.store.listen(
      ({ changes }) => {
        let touched = false
        const live = (r: TLRecord) => {
          if (this.isRestored(r)) return
          touched ||= isStudentShapeRecord(r)
          if (!isInkRecord(r)) return
          this.remember(r.id)
          this.drawnAt.set(r.id, ++this.seq)
          this.mark(r.id, null)
        }
        Object.values(changes.added).forEach(live)
        Object.values(changes.updated).forEach(([, to]) => live(to))
        for (const r of Object.values(changes.removed)) {
          if (this.replaced.delete(r.id)) continue
          this.restored.delete(r.id)
          touched ||= isStudentShapeRecord(r)
          if (!isInkRecord(r)) continue
          this.changes.delete(r.id)
          const was = this.known.get(r.id)
          this.known.delete(r.id)
          this.drawnAt.delete(r.id)
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
    this.unbindPractice()
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
    if (ok && (out as SendOutcome | null)?.raised?.level === MAX_HINT_LEVEL) this.emit({ type: 'offer-lesson' })
    return ok ? out : 'busy'
  }

  /**
   * "Teach me" was tapped: send now with mode "explain" (same window rules as Help: the selection,
   * or what is on screen). The reply's `lesson` action is drawn like any other action, as a card
   * that plays itself. Hints stop: the student asked to be taught, not nudged.
   */
  async explain(area?: PageRect, question?: string): Promise<ExplainResult> {
    this.hints.cancel()
    let out: SendOutcome | null = null
    let failed = false
    const ok = await this.scheduler.exclusive(async () => {
      try {
        out = await this.send({ mode: 'explain', area, question: question?.trim() || undefined })
      } catch {
        failed = true // send() has already shown why
      }
    })
    if (!ok) {
      this.emit({ type: 'error', message: 'Still thinking about the last one…' })
      return 'busy'
    }
    if (failed) return 'failed'
    const sent = out as SendOutcome | null
    if (!sent) return 'none'
    if (!sent.lesson) this.emit({ type: 'error', message: "Couldn't make a lesson for this. Try Help instead" })
    return sent.lesson ? 'ok' : 'none'
  }

  /**
   * Replace the page state (e.g. loaded from Firestore, after the saved page was loaded into the
   * editor). The loaded page counts as already checked: nothing is sent until the student draws.
   */
  adoptState(state: PageState) {
    this.state = toSaved(state, loadLastBounds())
    saveState(this.state)
    this.hints.cancel()
    this.changes.clear()
    const before = [...this.known.keys()]
    this.known.clear()
    this.drawnAt.clear()
    this.rememberAll()
    // the store tells its listeners about the load later (on the next frame), as changes the user made
    this.restored.clear()
    this.replaced.clear()
    for (const r of this.editor.store.allRecords()) if (isStudentShapeRecord(r)) this.restored.set(r.id, r)
    for (const id of before) if (!this.restored.has(id)) this.replaced.add(id)
    // "nothing changed since the last check" now means: since this page was loaded
    this.scheduler.seed()
    this.drawReading()
  }

  /** `r` is on the page because a restore put it there, untouched since. */
  private isRestored(r: TLRecord): boolean {
    const was = this.restored.get(r.id)
    if (!was) return false
    if (was === r || sameRecord(was, r)) return true
    this.restored.delete(r.id) // changed since: the student's work from here on
    return false
  }

  /** Toggle the gray "what the AI read" text under each line. */
  setShowReading(on: boolean) {
    this.showReading = on
    this.drawReading()
  }

  private drawReading() {
    const old = this.editor.getCurrentPageShapes().filter((s) => isAiShape(s) && s.meta.kind === 'reading')
    // saved boxes are already page coordinates
    const fresh = this.showReading ? readingShapes(this.state.lines, PAGE_FRAME, renderContext(this.editor)) : []
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

  private setStatus(status: CheckStatus) {
    this.status = status
    this.emit({ type: 'status', status })
  }

  /** Everything already on the page: where it is, and its order (back to front is the order it was drawn in). */
  private rememberAll() {
    for (const s of this.editor.getCurrentPageShapesSorted()) {
      if (isAiShape(s)) continue
      this.remember(s.id)
      if (!isWorksheetShape(s)) this.drawnAt.set(s.id, ++this.seq)
    }
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

  /** Where the handwritten working of the problem that line `lineId` belongs to is, as last read. */
  private workOf(lineId: string): PageRect | null {
    const problem = this.state.lines.find((l) => l.line_id === lineId)?.problem_id
    if (!problem) return null
    return this.state.lines
      .filter((l) => l.problem_id === problem && l.source !== 'printed')
      .reduce<PageRect | null>((a, l) => union(a, boxRect(l.box)), null)
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
    this.emit({ type: 'busy', busy: true })
    try {
      const got = await this.fetch(opts, false)
      return got && this.apply(got)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      this.setStatus({ at: Date.now(), mode: opts.mode, error: message })
      this.emit({ type: 'error', message, sticky: err instanceof ApiError && err.sticky })
      throw err
    } finally {
      this.emit({ type: 'busy', busy: false })
    }
  }

  /**
   * Build one request and get its reply, without drawing it. `quiet` = a prefetch: nothing on the
   * page, in the saved state or in the list of unsent changes is touched, and nothing is reported.
   * Null if there was nothing to send. Throws if the request failed.
   */
  private async fetch(opts: { mode: CheckRequest['mode'] } & HelpTarget, quiet: boolean): Promise<Fetched | null> {
    const view = rectOf(this.editor.getViewportPageBounds())
    // the student's shapes, and the practice problems written for them (`given`): sent, and part of the
    // working around them, but not ink of the student's
    const items = checkShapes(this.editor).flatMap((shape) => {
      const b = this.editor.getShapePageBounds(shape)
      return b ? [{ shape, rect: rectOf(b), sheet: isWorksheetShape(shape), given: isGivenShape(shape) }] : []
    })
    const ink = items.filter((i) => !i.sheet).map((i) => i.rect)
    const sheets = items.filter((i) => i.sheet).map((i) => i.rect)
    // a practice line that was read stays read while its text is there, whatever the reading called it
    if (!quiet) this.sweep(ink, [...sheets, ...items.filter((i) => i.given).map((i) => i.rect)])
    // worksheet pages are measured now, so their printed text is known by the time the reply is drawn
    renderContext(this.editor)

    // unsent changes, oldest first
    const byId = new Map(items.map((i) => [i.shape.id as string, i.rect]))
    const pending: Fetched['pending'] = []
    if (!quiet) {
      for (const [key, c] of this.changes) {
        const rect = c.gone ?? byId.get(key)
        if (rect) pending.push({ key, seq: c.seq, rect })
        else this.changes.delete(key)
      }
    }

    // Zoomed far out over a worksheet with nothing selected: the whole sheet is too much to read
    // (slow, and too small to read well). The student's last mark on the print (a circle round a
    // problem, an underline) says which part they mean, so that is treated as their selection.
    let area = opts.area
    if (opts.mode !== 'auto' && !area && !opts.window && sheets.length && this.editor.getZoomLevel() < FAR_ZOOM) {
      const marks = items
        .filter((i) => !i.sheet && !i.given && intersects(i.rect, view))
        .sort((a, b) => (this.drawnAt.get(a.shape.id) ?? 0) - (this.drawnAt.get(b.shape.id) ?? 0))
        .map((i) => i.rect)
      area = markOnSheet(marks, sheets) ?? undefined
    }

    const win =
      opts.mode !== 'auto'
        ? opts.window
          ? this.chainWindow(opts.window, opts.problemId)
          : helpWindow(area, ink, sheets, view)
        : autoWindow(pending.map((p) => p.rect), ink, sheets, view, this.feedbackRects())
    const skip = (why: string) => {
      if (!quiet) this.setStatus({ at: Date.now(), mode: opts.mode, skipped: why })
      return null
    }
    if (!win) return skip('nothing new to read')

    const visible = items.filter((i) => intersects(i.rect, win))
    if (opts.mode === 'auto' && !visible.some((i) => !i.sheet && !i.given)) {
      this.settle(pending, win) // only erasures here: nothing to read
      return skip('only erasing, nothing to read')
    }
    if (!visible.length) {
      if (!quiet) this.emit({ type: 'error', message: 'Nothing on screen to help with yet' })
      return skip('nothing on screen')
    }

    const base = this.state
    const touches = this.touches
    const sent = requestState(base, win)
    const req: CheckRequest = {
      image_base64: await exportPng(this.editor, visible.map((i) => i.shape), win),
      mode: opts.mode,
      // no worksheet in the picture: every line in it is handwriting, whatever it looks like
      has_worksheet: hasWorksheet(sheets, win),
      state: sent,
    }
    // what the request is about: the selection, or else the last thing the student drew
    const about = area ?? (opts.mode === 'auto' ? undefined : this.lastDrawn(visible, win))
    if (about) req.help_box = pageToBox(about, win)
    if (opts.question) req.question = opts.question
    const placed = visible.filter((i) => i.given).map((i) => ({ meta: i.shape.meta as Record<string, unknown>, rect: i.rect }))
    const given = givenLines(placed, win)
    if (given.length) req.given = given
    this.lastSent = { window: win, mode: req.mode, state: sent, help_box: req.help_box, given: req.given, has_worksheet: req.has_worksheet }
    const started = Date.now()
    const raw = await postCheck(req)
    return { mode: opts.mode, win, sent, raw, problemId: opts.problemId, base, touches, ms: Date.now() - started, pending, sheet: !!req.has_worksheet, practices: openPractices(placed, win) }
  }

  /** Nothing selected: the last thing the student drew in the window, with a line of room above and below. */
  private lastDrawn(visible: { shape: TLShape; rect: PageRect; sheet: boolean; given: boolean }[], win: PageRect): PageRect | undefined {
    const strokes = visible
      .filter((i) => !i.sheet && !i.given)
      .sort((a, b) => (this.drawnAt.get(a.shape.id) ?? 0) - (this.drawnAt.get(b.shape.id) ?? 0))
      .map((i) => i.rect)
    return pointedAt(strokes, win) ?? undefined
  }

  /** Where the tutor's notes and graphs are (see autoWindow). */
  private feedbackRects(): PageRect[] {
    return this.editor.getCurrentPageShapes().flatMap((s) => {
      if (!isAiShape(s) || !BRIDGE_KINDS.has(s.meta.kind as string)) return []
      const b = this.editor.getShapePageBounds(s)
      return b ? [rectOf(b)] : []
    })
  }

  /** Changes inside the window are dealt with by this check; the rest wait for their own. */
  private settle(pending: Fetched['pending'], win: PageRect) {
    for (const p of pending) {
      if (this.changes.get(p.key)?.seq === p.seq && coverage(p.rect, win) > 0.5) this.changes.delete(p.key)
    }
    if (!this.changes.size) return
    if (this.followUps < MAX_FOLLOW_UPS) {
      this.followUps++
      this.scheduler.poke()
    } else this.changes.clear()
  }

  /**
   * "Write in my handwriting" is on: learn the student's letter shapes from the ink this check
   * looked at. In the background; whatever goes wrong there never reaches the tutor.
   */
  private learnHand() {
    try {
      if (!handwritingEnabled()) return
      void harvestGlyphs(this.editor).catch(() => {})
    } catch (err) {
      console.warn('handwriting: not learned', err)
    }
  }

  /** Put a reply on the page and fold it into the saved state. */
  private apply(got: Fetched, held = false): SendOutcome {
    const { win } = got
    // the page owns its id and its frame: fold the window's reply into the whole-page state
    const { reply, state } = mergeReply(this.state, got.sent, got.raw, win)
    const printed = state.lines.filter((l) => l.source === 'printed').map((l) => boxRect(l.box))
    // the gray labels are redrawn from the new reading after this: where they will be is already taken
    const labels = this.showReading ? readingRects(state.lines, PAGE_FRAME, renderContext(this.editor)) : []
    const { drawn } = applyResponse(this.editor, reply, win, printed, labels)
    const raised = raisedProblem(this.state.problems, state.problems, got.problemId)
    this.state = state
    saveState(state)
    this.drawReading()
    // the answer under a practice problem is right: its "Your turn" label says so
    for (const id of solvedPractices(reply.actions, got.practices, win)) {
      try {
        markSolved(this.editor, id)
      } catch (err) {
        console.warn('practice not marked solved', err)
      }
    }
    this.settle(got.pending, win)
    this.setStatus({
      at: Date.now(),
      mode: got.mode,
      held: held || undefined,
      read: reply.lines.length,
      actions: reply.actions.map((a) => a.type),
      ...(reply.actions.length ? {} : silence(reply.lines, got.raw.debug?.tool_calls, got.sheet)),
      drawn,
      ms: held ? undefined : got.ms,
    })
    this.emit({ type: 'reply', reply, mode: got.mode })
    this.learnHand()
    return { window: win, raised, mistakes: mistakeProblems(reply), lesson: reply.actions.some((a) => a.type === 'lesson' && !!a.lesson) }
  }

  /**
   * Show a hint that was fetched ahead of time (see hintChain.ts). Only if the page is still as
   * it was when the hint was asked for: null = out of date, 'busy' = another request is in flight.
   */
  private showHeld(got: Fetched): HelpResult | 'busy' | null {
    if (this.scheduler.busy) return 'busy'
    if (got.base !== this.state || got.touches !== this.touches) return null
    let out: SendOutcome
    try {
      out = this.apply(got, true)
    } catch (err) {
      console.warn('held hint not shown', err)
      return null
    }
    if (out.raised?.level === MAX_HINT_LEVEL) this.emit({ type: 'offer-lesson' })
    return out
  }
}
