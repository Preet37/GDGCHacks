import type { Editor, TLRecord } from 'tldraw'
import type { CheckRequest, CheckResponse, PageState } from '../contract'
import { isAiShape } from '../render/actions'
import { applyResponse } from '../render/apply'
import { readingShapes } from '../render/reading'
import { pageToBox, type PageRect } from '../render/geometry'
import { studentBounds, studentShapes } from '../page'
import { postCheck } from './api'
import { exportPng } from './exportImage'
import { loadState, saveState } from './pageState'
import { hashString, PauseScheduler } from './scheduler'

export const PAUSE_MS = 2000

export type TutorEvent = { type: 'busy'; busy: boolean } | { type: 'error'; message: string } | { type: 'reply'; reply: CheckResponse }

function isStudentShapeRecord(r: TLRecord): boolean {
  return r.typeName === 'shape' && !isAiShape(r)
}

/** Watches the student's strokes, sends the page after a pause, and draws the reply. */
export class Tutor {
  state: PageState
  showReading = false
  private lastBounds: PageRect | null = null
  private scheduler: PauseScheduler
  private listeners = new Set<(e: TutorEvent) => void>()
  private unlisten: () => void
  private editor: Editor

  constructor(editor: Editor) {
    this.editor = editor
    this.state = loadState()
    this.scheduler = new PauseScheduler({
      delayMs: PAUSE_MS,
      key: () => this.fingerprint(),
      send: () => this.send({ mode: 'auto' }),
    })
    this.unlisten = editor.store.listen(
      ({ changes }) => {
        const touched =
          Object.values(changes.added).some(isStudentShapeRecord) ||
          Object.values(changes.removed).some(isStudentShapeRecord) ||
          Object.values(changes.updated).some(([, to]) => isStudentShapeRecord(to))
        if (touched) this.scheduler.poke()
      },
      { scope: 'document', source: 'user' },
    )
  }

  on(fn: (e: TutorEvent) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  dispose() {
    this.unlisten()
    this.scheduler.dispose()
  }

  /** Help: send now with mode "help". `area` = page-space selection, or whole page if missing. */
  async help(area?: PageRect, question?: string): Promise<boolean> {
    const ok = await this.scheduler.exclusive(() => this.send({ mode: 'help', area, question }).catch(() => {}))
    if (!ok) this.emit({ type: 'error', message: 'Still thinking about the last one…' })
    return ok
  }

  /** Toggle the gray "what the AI read" text under each line. */
  setShowReading(on: boolean) {
    this.showReading = on
    this.drawReading()
  }

  private drawReading() {
    const old = this.editor.getCurrentPageShapes().filter((s) => isAiShape(s) && s.meta.kind === 'reading')
    const fresh = this.showReading && this.lastBounds ? readingShapes(this.state.lines, this.lastBounds) : []
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

  private fingerprint(): string {
    const parts = studentShapes(this.editor).map((s) => JSON.stringify([s.id, s.x, s.y, s.rotation, s.props]))
    return hashString(parts.sort().join('|'))
  }

  private async send(opts: { mode: CheckRequest['mode']; area?: PageRect; question?: string }) {
    const shapes = studentShapes(this.editor)
    const bounds = studentBounds(this.editor, shapes, opts.area)
    if (!bounds) return
    this.emit({ type: 'busy', busy: true })
    try {
      const req: CheckRequest = {
        image_base64: await exportPng(this.editor, shapes, bounds),
        mode: opts.mode,
        state: this.state,
      }
      if (opts.area) req.help_box = pageToBox(opts.area, bounds)
      if (opts.question) req.question = opts.question
      const reply = await postCheck(req)
      applyResponse(this.editor, reply, bounds)
      // the page owns its id; never let a reply (e.g. the mock) rename it
      this.state = { ...reply.state, page_id: this.state.page_id }
      saveState(this.state)
      this.lastBounds = bounds
      this.drawReading()
      this.emit({ type: 'reply', reply })
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' })
      throw err
    } finally {
      this.emit({ type: 'busy', busy: false })
    }
  }
}
