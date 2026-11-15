import { b64Vecs, type Editor, type TLDrawShape, type TLShape } from 'tldraw'
import type { GlyphsResponse } from '../contract'
import { autoWindow } from '../page'
import { isAiShape } from '../render/actions'
import { boxToPage, type PageRect } from '../render/geometry'
import { exportPng } from '../sync/exportImage'
import { isWorksheetShape } from '../worksheet'
import { assignStrokes, type CharBox } from './assign'
import { getBank, learnLine, saveBank } from './bank'
import { groupLines, measureLine, type LineStats } from './lines'
import { handwritingEnabled } from './enabled'
import type { Stroke } from './types'

/** Fewer new strokes than this is not a new line worth a request. */
export const MIN_NEW_STROKES = 3
/** After a failed request, wait this long before trying again. */
const RETRY_MS = 30_000
const PADDING = 24

/** Is this a stroke the student wrote with the pen? */
export function isStudentStroke(shape: TLShape): shape is TLDrawShape {
  return shape.type === 'draw' && !isAiShape(shape) && !isWorksheetShape(shape) && (shape as TLDrawShape).props.isComplete !== false
}

/** A draw shape's pen points, in page space. */
export function strokePoints(editor: Editor, shape: TLDrawShape): Stroke {
  const { segments, scaleX = 1, scaleY = 1 } = shape.props
  const m = editor.getShapePageTransform(shape)
  const out: Stroke = []
  for (const seg of segments) {
    for (const p of b64Vecs.decodePoints(seg.path, seg.dim)) {
      const q = m.applyToPoint({ x: p.x * scaleX, y: p.y * scaleY })
      out.push({ x: q.x, y: q.y, z: p.z ?? 0.5 })
    }
  }
  return out
}

const rectOf = (b: { x: number; y: number; w: number; h: number }): PageRect => ({ x: b.x, y: b.y, w: b.w, h: b.h })
const touches = (a: PageRect, b: PageRect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

/** Strokes already looked at (by shape id), so each line is sent once. */
const seen = new Set<string>()
/** Lines measured this session, so an answer can be placed on a line's real baseline. */
const measured: LineStats[] = []
let busy = false
let retryAt = 0

/** Lines learned from in this session (newest last), with where their baseline is on the page. */
export function measuredLines(): readonly LineStats[] {
  return measured
}

async function fetchGlyphs(image_base64: string): Promise<GlyphsResponse | null> {
  if (new URLSearchParams(location.search).has('mock')) return null
  try {
    const res = await fetch('/api/glyphs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64 }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as GlyphsResponse
    return Array.isArray(data?.glyphs) ? data : null
  } catch {
    return null
  }
}

export interface HarvestOptions {
  /** only learn from ink in this part of the page (default: the working around the newest unseen strokes) */
  area?: PageRect
  /** learn even when the toggle is off */
  force?: boolean
}

/**
 * Learn the student's handwriting from ink that hasn't been looked at yet: one picture of it goes
 * to POST /api/glyphs, the characters that come back are matched to pen strokes and added to the
 * glyph bank. Call it after a successful check; don't await it. It never throws, does nothing when
 * the toggle is off, when a request is already running, or when there is no new line (fewer than
 * MIN_NEW_STROKES unseen strokes). Returns how many character samples were added.
 */
export async function harvestGlyphs(editor: Editor, opts: HarvestOptions = {}): Promise<number> {
  if (busy || (!opts.force && !handwritingEnabled()) || Date.now() < retryAt) return 0
  busy = true
  try {
    return await harvest(editor, opts)
  } catch (err) {
    console.warn('handwriting: harvest skipped', err)
    return 0
  } finally {
    busy = false
  }
}

async function harvest(editor: Editor, opts: HarvestOptions): Promise<number> {
  const bank = getBank()
  const known = new Set(Object.values(bank.samples).flatMap((l) => l.flatMap((s) => (s.src ? [s.src] : []))))
  const all = editor.getCurrentPageShapes().filter(isStudentStroke)
  const rects = new Map(all.map((s) => [s.id as string, rectOf(editor.getShapePageBounds(s) ?? { x: s.x, y: s.y, w: 0, h: 0 })]))
  const inArea = (s: TLDrawShape) => !opts.area || touches(rects.get(s.id)!, opts.area)
  const fresh = all.filter((s) => !seen.has(s.id) && !known.has(s.id) && inArea(s))
  if (fresh.length < MIN_NEW_STROKES) return 0

  // the part of the page to look at: the given area, else the working around the newest new strokes
  const view = rectOf(editor.getViewportPageBounds())
  const freshRects = fresh.map((s) => rects.get(s.id)!)
  const area = opts.area ?? autoWindow(freshRects, all.map((s) => rects.get(s.id)!), [], view)
  if (!area) return 0
  // every stroke that reaches into the picture is drawn in full, so no character is cut in half
  const shapes = all.filter((s) => touches(rects.get(s.id)!, area))
  let bounds: PageRect | null = null
  for (const s of shapes) {
    const r = rects.get(s.id)!
    const x = Math.min(bounds?.x ?? r.x, r.x)
    const y = Math.min(bounds?.y ?? r.y, r.y)
    bounds = { x, y, w: Math.max(bounds ? bounds.x + bounds.w : -Infinity, r.x + r.w) - x, h: Math.max(bounds ? bounds.y + bounds.h : -Infinity, r.y + r.h) - y }
  }
  if (!bounds || !shapes.length) return 0
  bounds = { x: bounds.x - PADDING, y: bounds.y - PADDING, w: bounds.w + PADDING * 2, h: bounds.h + PADDING * 2 }

  const png = await exportPng(editor, shapes, bounds)
  const reply = await fetchGlyphs(png)
  if (!reply) {
    retryAt = Date.now() + RETRY_MS
    return 0
  }
  for (const s of shapes) seen.add(s.id)

  const strokes = shapes.map((s) => strokePoints(editor, s))
  const boxes: CharBox[] = reply.glyphs.map((g) => ({ char: g.char, rect: boxToPage(g.box, bounds!) }))
  const chars = assignStrokes(strokes, boxes)
  let added = 0
  for (const line of groupLines(chars)) {
    const stats = measureLine(line, (c) => shapes[Math.min(...c.ids)]?.id)
    if (!stats) continue
    measured.push(stats)
    if (measured.length > 40) measured.shift()
    added += learnLine(bank, stats)
  }
  if (added) saveBank(bank)
  return added
}

/** For tests and the "forget my handwriting" case: start looking at the page afresh. */
export function resetHarvest() {
  seen.clear()
  measured.length = 0
  retryAt = 0
}
