import { describe, expect, it } from 'vitest'
import type { CheckResponse, PageState, ReadLine } from '../contract'
import { mockReply } from './mock'

const line = (id: string, source?: ReadLine['source']): ReadLine => ({ line_id: id, problem_id: 'P1', latex: 'x', plain: 'x', box: [0, 0, 10, 10], relation: 'start', confidence: 'high', source })
const state = (lines: ReadLine[]): PageState => ({ page_id: 'example', lines, problems: [], flagged_line_ids: [] })
const example = (): CheckResponse => {
  const lines = [line('L1', 'printed'), line('L2'), line('L3', 'handwriting')]
  return { lines, actions: [], clear_line_ids: [], state: state(lines) }
}
const mine = state([])
mine.page_id = 'my-page'

describe('the mock server and has_worksheet', () => {
  it('reads every line as handwriting when the page says there is no worksheet in the picture', () => {
    const reply = mockReply({ has_worksheet: false, state: mine }, example())
    expect(reply.lines.map((l) => l.source)).toEqual(['handwriting', undefined, 'handwriting'])
    expect(reply.state.lines.map((l) => l.source)).toEqual(['handwriting', undefined, 'handwriting'])
  })

  it('leaves printed lines alone when there is a worksheet, or the page did not say', () => {
    expect(mockReply({ has_worksheet: true, state: mine }, example()).lines[0].source).toBe('printed')
    expect(mockReply({ state: mine }, example()).lines[0].source).toBe('printed')
  })

  it('answers for the page that asked, without changing the example', () => {
    const ex = example()
    expect(mockReply({ has_worksheet: false, state: mine }, ex).state.page_id).toBe('my-page')
    expect(ex.lines[0].source).toBe('printed')
    expect(ex.state.page_id).toBe('example')
  })
})
