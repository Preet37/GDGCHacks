import { describe, expect, it } from 'vitest'
import type { ReadLine } from '../contract'
import { silence, statusLine } from './status'

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

  const line = (plain: string, source?: ReadLine['source']): ReadLine => ({ line_id: 'L1', problem_id: 'P1', latex: plain, plain, box: [0, 0, 10, 10], relation: 'start', confidence: 'high', source })
  const say = (lines: ReadLine[], calls: string[] | undefined, sheet = false) =>
    statusLine({ at, mode: 'auto', read: lines.length, actions: [], drawn: 0, ms: 5100, ...silence(lines, calls, sheet) })

  it('says what was read and why nothing was drawn when the server sent nothing', () => {
    const two = [line('g(x) = 6*x^2'), line("g'(x) =")]
    expect(say(two, ['compute_step(L1->L2, derivative) = 12*x', 'submit_feedback(0/1 actions kept)'])).toBe(
      "18:08:05 auto: read 2 lines (g(x) = 6*x^2; g'(x) =), no actions: the server dropped 1 of 1 action (it had 12*x), drew 0, 5.1 s",
    )
    expect(say(two, ['verify_step(L1->L2, derivative) = correct', 'submit_feedback(0/0 actions kept)'])).toContain('no actions: the step checked correct, drew 0')
    expect(say(two, ['verify_step(L1->L2, equals) = correct', 'verify_step(L2->L3, equals) = correct'])).toContain('all 2 steps checked correct')
    expect(say(two, ['verify_step(L1->L2, derivative) = incorrect', 'submit_feedback(0/0 actions kept)'])).toContain('1 step checked incorrect, nothing new sent')
    expect(say(two, ['verify_step(L1->L2, derivative) = skipped (open line)'])).toContain('the last line is still open')
    expect(say(two, ['submit_feedback(0/0 actions kept)'])).toContain('no actions: the tutor had nothing to say')
    expect(say(two, ["practice: 1 action(s) that did the student's practice dropped"])).toContain("no actions: practice: 1 action(s) that did the student's practice dropped")
  })

  it('says when handwriting was taken for printed text', () => {
    const printed = [line('g(x) = 6*x^2', 'printed'), line("g'(x) =", 'printed')]
    expect(say(printed, ['compute_step(L1->L2, derivative) = 12*x', 'submit_feedback(0/1 actions kept)'])).toContain('no actions: the writing was taken for printed text')
    expect(say(printed, [], true)).toContain('no actions: only printed worksheet text, no handwriting')
  })

  it('stays short: the last two lines, long ones cut, and no reason when the server gave none', () => {
    const many = [line('a'), line('b'), line('c'), line('f(x) = 3*x^2 + 2*x + 7*x^5 - 11*x^9 + 4')]
    const out = say(many, undefined)
    expect(out).toBe('18:08:05 auto: read 4 lines (…; c; f(x) = 3*x^2 + 2*x + 7*x^5…), no actions, drew 0, 5.1 s')
    expect(out).not.toContain('\n')
    expect(silence([], ['submit_feedback(0/0 actions kept)'], false)).toEqual({})
  })
})
