import type { Box, CheckResponse, PageState, ProblemState, ReadLine } from '../contract'
import { boxToPage, overlapRatio, pageToBox, type PageRect } from '../render/geometry'
import { coverage, intersects } from '../page'

/**
 * The saved state. Same shape as the contract's PageState, but every `lines[].box` is in page
 * coordinates ([ymin, xmin, ymax, xmax] in page units), because each request sends a different
 * window of the page. Boxes are converted to and from the 0-1000 image frame per request.
 */
export interface SavedState extends PageState {
  frame: 'page'
}

/** Bounds under which a page-coordinate box maps to itself (for code that expects an image frame). */
export const PAGE_FRAME: PageRect = { x: 0, y: 0, w: 1000, h: 1000 }

export function boxRect(box: Box): PageRect {
  return { x: box[1], y: box[0], w: box[3] - box[1], h: box[2] - box[0] }
}

export function rectBox(r: PageRect): Box {
  return [r.y, r.x, r.y + r.h, r.x + r.w]
}

/** A line as the server returned it (box over the sent image) -> the same line in page coordinates. */
export function toPageLine(line: ReadLine, win: PageRect): ReadLine {
  return { ...line, box: rectBox(boxToPage(line.box, win)) }
}

/** A saved line (page coordinates) -> the line with its box over the image of `win`. */
export function toImageLine(line: ReadLine, win: PageRect): ReadLine {
  return { ...line, box: pageToBox(boxRect(line.box), win) }
}

/** A saved line belongs to a window if most of its box is inside. */
export function inWindow(line: ReadLine, win: PageRect): boolean {
  return coverage(boxRect(line.box), win) > 0.5
}

/** The state to send with the image of `win`: only what is in that window, in its frame. */
export function requestState(saved: PageState, win: PageRect): PageState {
  const lines = saved.lines
    .filter((l) => inWindow(l, win))
    .sort((a, b) => a.box[0] - b.box[0] || a.box[1] - b.box[1])
    .map((l) => toImageLine(l, win))
  const lineIds = new Set(lines.map((l) => l.line_id))
  const problemIds = new Set(lines.map((l) => l.problem_id))
  return {
    page_id: saved.page_id,
    lines,
    problems: saved.problems.filter((p) => problemIds.has(p.problem_id)),
    flagged_line_ids: saved.flagged_line_ids.filter((id) => lineIds.has(id)),
  }
}

/** An id like `taken` ones ("L7" -> "L8") that nothing uses yet. */
export function freshId(id: string, used: Set<string>): string {
  const m = /^(.*?)(\d+)$/.exec(id)
  const prefix = m ? m[1] : id + '_'
  let n = m ? Number(m[2]) : 1
  for (const u of used) {
    if (u.startsWith(prefix) && /^\d+$/.test(u.slice(prefix.length))) n = Math.max(n, Number(u.slice(prefix.length)))
  }
  let out: string
  do out = prefix + ++n
  while (used.has(out))
  return out
}

/** Old -> new names for incoming ids that the server could not know were taken. */
function renames(incoming: Iterable<string>, sent: Set<string>, reserved: Set<string>): Map<string, string> {
  const all = [...incoming]
  const used = new Set([...all, ...sent, ...reserved])
  const map = new Map<string, string>()
  for (const id of all) {
    if (map.has(id) || sent.has(id) || !reserved.has(id)) continue
    const to = freshId(id, used)
    used.add(to)
    map.set(id, to)
  }
  return map
}

/**
 * Fold a reply for window `win` back into the saved state.
 * - Everything that was not sent (lines, flags, problems outside the window) is kept exactly as it was.
 * - The server names new lines/problems "next unused" among what it was sent, so a new id can
 *   collide with one outside the window: those are renamed everywhere in the reply.
 * - A saved line the window showed less than half of keeps its saved reading, flag and feedback.
 * Returns the reply (ids fixed, boxes still over the sent image, ready to draw with `win`)
 * and the new saved state (boxes in page coordinates).
 */
export function mergeReply(
  saved: PageState,
  sent: PageState,
  reply: CheckResponse,
  win: PageRect,
): { reply: CheckResponse; state: SavedState } {
  const sentLines = new Set(sent.lines.map((l) => l.line_id))
  const sentFlags = new Set(sent.flagged_line_ids)
  const sentProblems = new Set([...sent.lines.map((l) => l.problem_id), ...sent.problems.map((p) => p.problem_id)])

  let keptLines = saved.lines.filter((l) => !sentLines.has(l.line_id))
  let keptFlags = saved.flagged_line_ids.filter((id) => !sentFlags.has(id))

  // A saved line the window only partly covered was not sent, so the server read the part it
  // could see as a new line. It is the same writing: the reading takes the saved line's id, so
  // new feedback for it replaces the old instead of piling up. The saved line itself stays as it
  // is, with its flag and its feedback: a reading of a fragment is worse than the one we have,
  // and a check that had nothing new to say about the line must not wipe the red mark on it.
  // Only a saved line that turns out to be a second copy of a line that WAS sent goes.
  const adopted = new Map<string, string>()
  const superseded = new Set<string>()
  for (const l of [...reply.state.lines, ...reply.lines]) {
    const r = boxToPage(l.box, win)
    for (const k of keptLines) {
      if (superseded.has(k.line_id) || overlapRatio(boxRect(k.box), r) < 0.5) continue
      superseded.add(k.line_id)
      if (!sentLines.has(l.line_id) && !adopted.has(l.line_id) && ![...adopted.values()].includes(k.line_id)) adopted.set(l.line_id, k.line_id)
    }
  }
  const adoptedIds = new Set(adopted.values())
  const duplicates = new Set([...superseded].filter((id) => !adoptedIds.has(id)))
  keptLines = keptLines.filter((l) => !duplicates.has(l.line_id))
  keptFlags = keptFlags.filter((id) => !duplicates.has(id))
  const keptProblems = saved.problems.filter((p) => !sentProblems.has(p.problem_id))
  // the fragment's problem is the saved line's problem: lines written under it join that one
  const adoptedProblems = new Map<string, string>()
  for (const l of [...reply.state.lines, ...reply.lines]) {
    const to = adopted.get(l.line_id)
    const home = to && saved.lines.find((k) => k.line_id === to)?.problem_id
    if (home && !sentProblems.has(l.problem_id) && !adoptedProblems.has(l.problem_id)) adoptedProblems.set(l.problem_id, home)
  }

  const lineMap = renames(
    [
      ...reply.lines.map((l) => l.line_id),
      ...reply.state.lines.map((l) => l.line_id),
      ...reply.actions.flatMap((a) => (a.line_id ? [a.line_id] : [])),
      ...reply.clear_line_ids,
      ...reply.state.flagged_line_ids,
    ],
    sentLines,
    new Set([...keptLines.map((l) => l.line_id), ...keptFlags, ...adopted.values()]),
  )
  for (const [from, to] of adopted) lineMap.set(from, to)
  const problemMap = renames(
    [
      ...reply.lines.map((l) => l.problem_id),
      ...reply.state.lines.map((l) => l.problem_id),
      ...reply.state.problems.map((p) => p.problem_id),
    ],
    sentProblems,
    new Set([...keptLines.map((l) => l.problem_id), ...keptProblems.map((p) => p.problem_id)]),
  )
  for (const [from, to] of adoptedProblems) problemMap.set(from, to)
  const lid = (id: string) => lineMap.get(id) ?? id
  const pid = (id: string) => problemMap.get(id) ?? id
  const fixLine = (l: ReadLine): ReadLine => ({ ...l, line_id: lid(l.line_id), problem_id: pid(l.problem_id) })
  const fixProblem = (p: ProblemState): ProblemState => ({ ...p, problem_id: pid(p.problem_id) })

  const fixed: CheckResponse = {
    ...reply,
    lines: reply.lines.map(fixLine),
    actions: reply.actions.map((a) => (a.line_id ? { ...a, line_id: lid(a.line_id) } : a)),
    clear_line_ids: [...new Set([...reply.clear_line_ids.map(lid), ...duplicates])],
    state: {
      page_id: saved.page_id,
      lines: reply.state.lines.map(fixLine),
      problems: reply.state.problems.map(fixProblem),
      flagged_line_ids: reply.state.flagged_line_ids.map(lid),
    },
  }
  // a problem the reply and the unsent part of the page both know: the server saw only a fragment of it, so the higher hint level stands
  const problems = [...keptProblems]
  for (const p of fixed.state.problems) {
    const i = problems.findIndex((k) => k.problem_id === p.problem_id)
    if (i < 0) problems.push(p)
    else if (p.hint_level > problems[i].hint_level) problems[i] = p
  }
  const state: SavedState = {
    page_id: saved.page_id,
    frame: 'page',
    lines: [...keptLines, ...fixed.state.lines.filter((l) => !adoptedIds.has(l.line_id)).map((l) => toPageLine(l, win))],
    problems,
    flagged_line_ids: [...keptFlags, ...fixed.state.flagged_line_ids.filter((id) => !keptFlags.includes(id))],
  }
  return { reply: fixed, state }
}

/**
 * Lines whose writing is gone (erased or moved away): handwritten lines with no ink left on
 * their box, printed lines with no worksheet under them. Done on the page, because the server
 * only hears about the window it is sent.
 */
export function sweepErased(saved: SavedState, ink: PageRect[], sheets: PageRect[]): { state: SavedState; erased: string[] } {
  const erased = saved.lines
    .filter((l) => {
      const r = boxRect(l.box)
      const pad = Math.max(r.h, 0) / 2
      const near = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
      return !(l.source === 'printed' ? sheets : ink).some((s) => intersects(s, near))
    })
    .map((l) => l.line_id)
  if (!erased.length) return { state: saved, erased }
  const gone = new Set(erased)
  return {
    erased,
    state: {
      ...saved,
      lines: saved.lines.filter((l) => !gone.has(l.line_id)),
      flagged_line_ids: saved.flagged_line_ids.filter((id) => !gone.has(id)),
    },
  }
}

/**
 * Bring any stored PageState up to the page-coordinate form. Older saves kept boxes relative
 * to one fixed image area (`legacyBounds`); without it their positions are unknown, so the
 * reading is dropped and the next check reads the lines again.
 */
export function toSaved(state: PageState, legacyBounds: PageRect | null): SavedState {
  if ((state as Partial<SavedState>).frame === 'page') return state as SavedState
  if (!legacyBounds) return { page_id: state.page_id, frame: 'page', lines: [], problems: state.problems ?? [], flagged_line_ids: [] }
  return {
    page_id: state.page_id,
    frame: 'page',
    lines: (state.lines ?? []).map((l) => toPageLine(l, legacyBounds)),
    problems: state.problems ?? [],
    flagged_line_ids: state.flagged_line_ids ?? [],
  }
}
