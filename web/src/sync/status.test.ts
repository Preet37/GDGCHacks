import { describe, expect, it } from 'vitest'
import { statusLine } from './status'

const at = new Date(2026, 10, 14, 18, 8, 5).getTime()

describe('statusLine', () => {
  it('says what a check read, got and drew', () => {
    expect(statusLine({ at, mode: 'auto', read: 2, actions: ['circle', 'note'], drawn: 2, ms: 3140 })).toBe('18:08:05 auto: read 2 lines, 2 actions (circle, note), drew 2, 3.1 s')
    expect(statusLine({ at, mode: 'auto', read: 1, actions: [], drawn: 0, ms: 900 })).toBe('18:08:05 auto: read 1 line, no actions, drew 0, 0.9 s')
  })

  it('shows a reply that was not drawn in full', () => {
    expect(statusLine({ at, mode: 'help', read: 3, actions: ['note', 'figure'], drawn: 1, ms: 5000 })).toContain('2 actions (note, figure), drew 1')
  })

  it('says when nothing was sent, and when it failed', () => {
    expect(statusLine({ at, mode: 'auto', skipped: 'nothing new to read' })).toBe('18:08:05 auto: not sent (nothing new to read)')
    expect(statusLine({ at, mode: 'help', error: "Can't reach the tutor server" })).toBe("18:08:05 help: failed: Can't reach the tutor server")
  })

  it('marks a hint that was fetched ahead of time', () => {
    expect(statusLine({ at, mode: 'help', held: true, read: 2, actions: ['note'], drawn: 1 })).toBe('18:08:05 help (ready ahead): read 2 lines, 1 action (note), drew 1')
  })
})
