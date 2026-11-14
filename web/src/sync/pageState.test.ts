import { describe, expect, it } from 'vitest'
import { emptyState, newPageId } from './pageState'

describe('pageState', () => {
  it('makes unique page ids without crypto.randomUUID', () => {
    expect(newPageId()).not.toBe(newPageId())
  })

  it('empty state matches the contract shape', () => {
    expect(emptyState('x')).toEqual({ page_id: 'x', lines: [], problems: [], flagged_line_ids: [] })
  })
})
