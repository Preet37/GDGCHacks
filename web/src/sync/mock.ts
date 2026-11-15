import type { CheckRequest, CheckResponse } from '../contract'

/**
 * What the server does with `has_worksheet: false`: with no worksheet in the picture nothing in it
 * can be printed text, so every line is the student's handwriting. The mock (?mock) does the same
 * to its example replies.
 */
export function mockReply(req: Pick<CheckRequest, 'has_worksheet' | 'state'>, example: CheckResponse): CheckResponse {
  const hand = <T extends { source?: string }>(lines: T[]): T[] => (req.has_worksheet === false ? lines.map((l) => (l.source === 'printed' ? { ...l, source: 'handwriting' } : l)) : lines)
  return {
    ...example,
    lines: hand(example.lines),
    state: { ...example.state, lines: hand(example.state.lines), page_id: req.state.page_id },
  }
}
