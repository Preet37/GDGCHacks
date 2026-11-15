import { describe, expect, it } from 'vitest'
import type { CheckResponse, PageState, ReadLine } from '../contract'
import { boxToPage } from '../render/geometry'
import { boxRect, freshId, inWindow, mergeReply, PAGE_FRAME, requestState, sweepErased, toImageLine, toPageLine, toSaved, type SavedState } from './frame'

const line = (line_id: string, problem_id: string, box: ReadLine['box'], extra: Partial<ReadLine> = {}): ReadLine => ({
  line_id,
  problem_id,
  latex: line_id,
  plain: line_id,
  box,
  relation: 'other',
  confidence: 'high',
  ...extra,
})

// page-coordinate boxes: [ymin, xmin, ymax, xmax]
const saved: SavedState = {
  page_id: 'pg',
  frame: 'page',
  lines: [
    line('L1', 'P1', [100, 100, 160, 400]),
    line('L2', 'P1', [200, 100, 260, 400]),
    line('L3', 'P2', [100, 5100, 160, 5400]), // far away
    line('L4', 'P2', [200, 5100, 260, 5400]),
  ],
  problems: [
    { problem_id: 'P1', hint_level: 1 },
    { problem_id: 'P2', hint_level: 2 },
  ],
  flagged_line_ids: ['L2', 'L4'],
}
const winA = { x: 50, y: 50, w: 500, h: 400 }

describe('frame conversion', () => {
  it('page -> image -> page round trip', () => {
    const win = { x: 37, y: -210, w: 913, h: 641 }
    const original = line('L1', 'P1', [-100.5, 120.25, -40, 700])
    const back = toPageLine(toImageLine(original, win), win)
    // 0-1000 integers over the window: at most half a unit of the grid off
    back.box.forEach((v, i) => expect(Math.abs(v - original.box[i])).toBeLessThanOrEqual(win.w / 2000 + 1e-9))
  })

  it('image -> page -> image round trip is exact', () => {
    const win = { x: 37, y: -210, w: 913, h: 641 }
    const fromServer = line('L1', 'P1', [120, 80, 180, 420])
    expect(toImageLine(toPageLine(fromServer, win), win).box).toEqual([120, 80, 180, 420])
  })

  it('page boxes read as page rects, and PAGE_FRAME maps them to themselves', () => {
    expect(boxRect([100, 5100, 160, 5400])).toEqual({ x: 5100, y: 100, w: 300, h: 60 })
    expect(boxToPage([100, 5100, 160, 5400], PAGE_FRAME)).toEqual({ x: 5100, y: 100, w: 300, h: 60 })
  })

  it('a line is in the window if most of its box is', () => {
    expect(inWindow(line('a', 'P', [100, 0, 160, 120]), winA)).toBe(true) // 70 of 120 wide inside
    expect(inWindow(line('b', 'P', [100, -100, 160, 90]), winA)).toBe(false) // 40 of 190 inside
  })
})

describe('requestState', () => {
  it('sends only the lines, flags and problems inside the window, in its frame', () => {
    const sent = requestState(saved, winA)
    expect(sent.lines.map((l) => l.line_id)).toEqual(['L1', 'L2'])
    expect(sent.lines[0].box).toEqual([125, 100, 275, 700])
    expect(sent.flagged_line_ids).toEqual(['L2'])
    expect(sent.problems).toEqual([{ problem_id: 'P1', hint_level: 1 }])
    expect(sent).not.toHaveProperty('frame')
  })
})

describe('mergeReply', () => {
  const sent = requestState(saved, winA)

  it('keeps everything outside the window exactly as it was', () => {
    // the server re-read window A: L2 was fixed, so its flag is cleared
    const lines = [line('L1', 'P1', [125, 100, 275, 700]), line('L2', 'P1', [375, 100, 525, 700])]
    const reply: CheckResponse = {
      lines,
      actions: [],
      clear_line_ids: ['L2'],
      state: { page_id: 'x', lines, problems: [{ problem_id: 'P1', hint_level: 2 }], flagged_line_ids: [] },
    }
    const { state, reply: fixed } = mergeReply(saved, sent, reply, winA)
    expect(state.lines.filter((l) => l.problem_id === 'P2')).toEqual(saved.lines.slice(2))
    expect(state.flagged_line_ids).toEqual(['L4'])
    expect(state.problems).toEqual([
      { problem_id: 'P2', hint_level: 2 },
      { problem_id: 'P1', hint_level: 2 },
    ])
    expect(state.lines.find((l) => l.line_id === 'L1')!.box).toEqual([100, 100, 160, 400])
    expect(state.page_id).toBe('pg')
    expect(state.frame).toBe('page')
    expect(fixed.clear_line_ids).toEqual(['L2'])
  })

  it('renames a new id that collides with one outside the window, everywhere', () => {
    // the server saw L1, L2 / P1 and named the new line and problem "next unused": L3 / P2
    const lines = [
      line('L1', 'P1', [125, 100, 275, 700]),
      line('L2', 'P1', [375, 100, 525, 700]),
      line('L3', 'P2', [625, 100, 775, 700]),
    ]
    const reply: CheckResponse = {
      lines,
      actions: [
        { type: 'circle', line_id: 'L3', box: [625, 100, 775, 700], color: 'red' },
        { type: 'speak', text: 'hi' },
      ],
      clear_line_ids: ['L3'],
      state: {
        page_id: 'pg',
        lines,
        problems: [
          { problem_id: 'P1', hint_level: 1 },
          { problem_id: 'P2', hint_level: 1 },
        ],
        flagged_line_ids: ['L2', 'L3'],
      },
    }
    const { state, reply: fixed } = mergeReply(saved, sent, reply, winA)
    expect(fixed.lines.map((l) => [l.line_id, l.problem_id])).toEqual([['L1', 'P1'], ['L2', 'P1'], ['L5', 'P3']])
    expect(fixed.actions[0].line_id).toBe('L5')
    expect(fixed.actions[0].box).toEqual([625, 100, 775, 700]) // still in the sent image's frame
    expect(fixed.clear_line_ids).toEqual(['L5'])
    expect(state.flagged_line_ids).toEqual(['L4', 'L2', 'L5'])
    expect(state.lines.map((l) => l.line_id)).toEqual(['L3', 'L4', 'L1', 'L2', 'L5'])
    // the far lines and problem are untouched
    expect(state.lines.slice(0, 2)).toEqual(saved.lines.slice(2))
    expect(state.problems).toEqual([
      { problem_id: 'P2', hint_level: 2 },
      { problem_id: 'P1', hint_level: 1 },
      { problem_id: 'P3', hint_level: 1 },
    ])
    expect(state.lines[4].box).toEqual([300, 100, 360, 400])
  })

  it('a problem with lines on both sides of the window edge keeps its id', () => {
    const straddle: SavedState = { ...saved, lines: [...saved.lines, line('L9', 'P1', [100, 9000, 160, 9300])] }
    const s = requestState(straddle, winA)
    const lines = [line('L1', 'P1', [125, 100, 275, 700])]
    const { state } = mergeReply(straddle, s, { lines, actions: [], clear_line_ids: [], state: { ...s, lines } }, winA)
    expect(state.lines.find((l) => l.line_id === 'L1')!.problem_id).toBe('P1')
    expect(state.lines.find((l) => l.line_id === 'L9')!.problem_id).toBe('P1')
  })

  it('a line the window only half covers is read as new: it keeps its saved id, and is not saved twice', () => {
    // a tall flagged line (an integral) reaching above a window that follows the line being written below it
    const tall: SavedState = {
      page_id: 'pg',
      frame: 'page',
      lines: [line('L1', 'P1', [0, 100, 400, 700])],
      problems: [{ problem_id: 'P1', hint_level: 1 }],
      flagged_line_ids: ['L1'],
    }
    const win = { x: 0, y: 250, w: 1000, h: 500 } // covers 150 of the line's 400: it is not sent
    const s = requestState(tall, win)
    expect(s.lines).toEqual([])
    // the server sees the part in the window, reads it as its first line, and has a new hint for it
    const lines = [line('L1', 'P1', [0, 100, 300, 700]), line('L2', 'P1', [400, 100, 600, 700])]
    const reply: CheckResponse = {
      lines,
      actions: [{ type: 'note', line_id: 'L1', box: [0, 100, 300, 700], text: 'again' }],
      clear_line_ids: [],
      state: { page_id: 'x', lines, problems: [{ problem_id: 'P1', hint_level: 0 }], flagged_line_ids: ['L1'] },
    }
    const { state, reply: fixed } = mergeReply(tall, s, reply, win)
    // before: the reading was renamed L2/L3, the page kept two lines for one piece of writing,
    // and the new note was drawn on top of L1's old one
    expect(state.lines.map((l) => l.line_id)).toEqual(['L1', 'L2'])
    expect(fixed.actions[0].line_id).toBe('L1') // so the new note replaces L1's old one, by id
    expect(fixed.clear_line_ids).toEqual([])
    expect(state.flagged_line_ids).toEqual(['L1'])
    // the saved reading of the whole line stands, not the reading of the part that was in the image
    expect(state.lines[0].box).toEqual([0, 100, 400, 700])
    // and the line written under it belongs to the same problem, which keeps its hint level
    expect(state.lines[1].problem_id).toBe('P1')
    expect(state.problems).toEqual([{ problem_id: 'P1', hint_level: 1 }])
  })

  it('a flagged line the window half covers, re-read with nothing new to say: its mark is not wiped', () => {
    // headless repro: a red circle and note on line 2; the student writes further down, the window
    // catches the bottom of line 2, the server reads that sliver as a new line and has no feedback
    // for it. That used to put the line in clear_line_ids, and the red mark vanished.
    const two: SavedState = {
      ...saved,
      lines: [...saved.lines, line('L7', 'P1', [300, 100, 700, 400])], // tall, half outside window A (y 50..450)
      flagged_line_ids: ['L2', 'L4', 'L7'],
    }
    const s = requestState(two, winA)
    expect(s.lines.map((l) => l.line_id)).toEqual(['L1', 'L2'])
    // the server calls the re-read line L3 (next unused among what it was sent); L3 is taken far away
    const lines = [...s.lines, line('L3', 'P1', [625, 100, 1000, 700])]
    const { state, reply: fixed } = mergeReply(two, s, { lines, actions: [], clear_line_ids: [], state: { ...s, lines, flagged_line_ids: ['L2'] } }, winA)
    expect(state.lines.map((l) => l.line_id).sort()).toEqual(['L1', 'L2', 'L3', 'L4', 'L7'])
    expect(state.lines.filter((l) => l.line_id === 'L7')).toHaveLength(1)
    expect(state.lines.find((l) => l.line_id === 'L7')!.box).toEqual([300, 100, 700, 400]) // the saved reading, whole
    expect(fixed.clear_line_ids).toEqual([]) // nothing is removed from the page
    expect(state.flagged_line_ids.sort()).toEqual(['L2', 'L4', 'L7']) // and it still counts as having feedback
    expect(fixed.lines.map((l) => l.line_id)).toEqual(['L1', 'L2', 'L7']) // in the reply the fragment goes by the saved id
  })

  it('a saved line that is a second copy of a line that was sent: the copy and its feedback go', () => {
    // L7 lies over L2 (the same writing saved twice, L7 reaching out of the window); L2 was sent and comes back as itself
    const two: SavedState = { ...saved, lines: [...saved.lines, line('L7', 'P1', [200, 100, 700, 400])], flagged_line_ids: ['L2', 'L7'] }
    const s = requestState(two, winA)
    expect(s.lines.map((l) => l.line_id)).toEqual(['L1', 'L2'])
    const { state, reply: fixed } = mergeReply(two, s, { lines: s.lines, actions: [], clear_line_ids: [], state: { ...s, flagged_line_ids: ['L2'] } }, winA)
    expect(fixed.clear_line_ids).toEqual(['L7'])
    expect(state.lines.some((l) => l.line_id === 'L7')).toBe(false)
    expect(state.flagged_line_ids).toEqual(['L2'])
  })

  it('freshId', () => {
    expect(freshId('L2', new Set(['L1', 'L2', 'L7']))).toBe('L8')
    expect(freshId('odd', new Set(['odd']))).toBe('odd_2')
  })
})

describe('sweepErased', () => {
  it('forgets lines with no ink left on them, keeps the rest', () => {
    const ink = [{ x: 120, y: 110, w: 40, h: 40 }, { x: 5100, y: 210, w: 40, h: 40 }]
    const { state, erased } = sweepErased(saved, ink, [])
    expect(erased).toEqual(['L2', 'L3'])
    expect(state.lines.map((l) => l.line_id)).toEqual(['L1', 'L4'])
    expect(state.flagged_line_ids).toEqual(['L4'])
  })

  it('printed lines live on the worksheet, not on ink', () => {
    const s: SavedState = { ...saved, lines: [line('L1', 'P1', [100, 100, 160, 400], { source: 'printed' })], flagged_line_ids: [] }
    expect(sweepErased(s, [], [{ x: 0, y: 0, w: 900, h: 1200 }]).erased).toEqual([])
    expect(sweepErased(s, [], []).erased).toEqual(['L1'])
  })
})

describe('toSaved', () => {
  const legacy: PageState = { page_id: 'pg', lines: [line('L1', 'P1', [120, 80, 180, 420])], problems: [], flagged_line_ids: ['L1'] }

  it('migrates an old save using the image area it was relative to', () => {
    const s = toSaved(legacy, { x: 1000, y: 2000, w: 500, h: 400 })
    expect(s.frame).toBe('page')
    expect(s.lines[0].box).toEqual([2048, 1040, 2072, 1210])
    expect(s.flagged_line_ids).toEqual(['L1'])
  })

  it('without that area the old reading is dropped; a migrated state is left alone', () => {
    expect(toSaved(legacy, null).lines).toEqual([])
    expect(toSaved(saved, { x: 1, y: 1, w: 1, h: 1 })).toBe(saved)
  })
})
