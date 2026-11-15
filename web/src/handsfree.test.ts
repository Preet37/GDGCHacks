import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COOLDOWN_MS, HandsFree, intentOf, MAX_DUDS, SETTLE_MS, spokenText, TICK_MS } from './handsfree'
import type { Recognition } from './voice'

describe('intentOf', () => {
  it.each([
    ['help me here', 'help'],
    ["I'm stuck on this", 'help'],
    ['im stuck', 'help'],
    ['I am really stuck on this one', 'help'],
    ['I’m confused', 'help'],
    ['what did I do wrong', 'help'],
    ['how do I factor this', 'help'],
    ['teach me this', 'teach'],
    ['can you walk me through it', 'teach'],
    ["I don't understand", 'teach'],
    ['help me, explain this', 'teach'],
  ])('%s -> %s', (text, intent) => {
    expect(intentOf(text)?.intent).toBe(intent)
  })

  it.each(['so then x is four', 'the helper function', 'pass me the stucko', 'what time is it', ''])('ignores "%s"', (text) => {
    expect(intentOf(text)).toBeNull()
  })

  it('keeps the question, drops the chatter long before it', () => {
    const chatter = 'and then we went to the store and bought some things for the party tonight which was really fun and'
    const hit = intentOf(`${chatter} okay help me here with the chain rule`)
    expect(hit?.said.endsWith('help me here with the chain rule')).toBe(true)
    expect(hit!.said.length).toBeLessThan(120)
    expect(hit!.said.startsWith('and then')).toBe(false)
  })
})

describe('spokenText', () => {
  it('prefers the speak action', () => {
    expect(spokenText({ actions: [{ type: 'note', text: 'written' }, { type: 'speak', text: 'said' }] as never })).toBe('said')
  })
  it('falls back to notes and questions, once each', () => {
    const t = spokenText({ actions: [{ type: 'note', text: 'Check the sign' }, { type: 'circle' }, { type: 'ask', text: 'What is next?' }, { type: 'note', text: 'Check the sign' }] as never })
    expect(t).toBe('Check the sign. What is next?')
  })
  it('is empty when there is nothing to say', () => {
    expect(spokenText({ actions: [{ type: 'circle' }] as never })).toBe('')
  })
})

class FakeRec implements Recognition {
  lang = ''
  interimResults = true
  continuous = true
  started = false
  aborted = false
  onresult: Recognition['onresult'] = null
  onend: Recognition['onend'] = null
  onerror: Recognition['onerror'] = null
  start() {
    this.started = true
  }
  stop() {}
  abort() {
    this.aborted = true
  }
  say(text: string, isFinal: boolean) {
    const r = Object.assign([{ transcript: text }], { isFinal })
    this.onresult?.({ resultIndex: 0, results: [r] as never })
  }
}

describe('HandsFree', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = (opts: { quiet?: () => boolean } = {}) => {
    const recs: FakeRec[] = []
    let finish: () => void = () => {}
    const onIntent = vi.fn(() => new Promise<void>((r) => (finish = r)))
    const hf = new HandsFree({
      make: () => {
        const r = new FakeRec()
        recs.push(r)
        return r
      },
      quiet: opts.quiet ?? (() => true),
      onIntent,
    })
    return { hf, recs, onIntent, finish: () => finish(), last: () => recs[recs.length - 1] }
  }

  it('opens the microphone when turned on and closes it when turned off', () => {
    const { hf, last } = make()
    expect(hf.start()).toBe(true)
    expect(last().started).toBe(true)
    expect(hf.snapshot.phase).toBe('listening')
    hf.stop()
    expect(last().aborted).toBe(true)
    expect(hf.snapshot.on).toBe(false)
  })

  it("says so when the browser can't listen", () => {
    const hf = new HandsFree({ make: () => null, quiet: () => true, onIntent: async () => {} })
    expect(hf.start()).toBe(false)
    expect(hf.snapshot.error).toBeTruthy()
  })

  it('a finished key phrase asks at once, and the microphone closes while the tutor answers', async () => {
    const { hf, recs, onIntent, finish, last } = make()
    hf.start()
    last().say('so x is four', true)
    expect(onIntent).not.toHaveBeenCalled()
    last().say("I'm stuck on this", true)
    expect(onIntent).toHaveBeenCalledWith('help', "I'm stuck on this")
    expect(hf.snapshot.phase).toBe('thinking')
    expect(hf.snapshot.heard).toBe("I'm stuck on this")
    expect(last().aborted).toBe(true)
    vi.advanceTimersByTime(TICK_MS * 3)
    expect(recs).toHaveLength(1)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    vi.advanceTimersByTime(COOLDOWN_MS + TICK_MS)
    expect(recs).toHaveLength(2)
    expect(hf.snapshot.phase).toBe('listening')
    expect(hf.snapshot.heard).toBe('')
  })

  it('a phrase never marked finished counts once it stops changing', () => {
    const { hf, onIntent, last } = make()
    hf.start()
    last().say('teach me', false)
    vi.advanceTimersByTime(SETTLE_MS - 100)
    expect(onIntent).not.toHaveBeenCalled()
    last().say('teach me this part', false)
    vi.advanceTimersByTime(SETTLE_MS - 100)
    expect(onIntent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onIntent).toHaveBeenCalledWith('teach', 'teach me this part')
  })

  it('does not listen while the tutor is making sound', () => {
    let quiet = true
    const { hf, recs } = make({ quiet: () => quiet })
    hf.start()
    quiet = false
    vi.advanceTimersByTime(TICK_MS)
    expect(recs[0].aborted).toBe(true)
    expect(hf.snapshot.phase).toBe('speaking')
    vi.advanceTimersByTime(TICK_MS * 3)
    expect(recs).toHaveLength(1)
    quiet = true
    vi.advanceTimersByTime(TICK_MS)
    expect(recs).toHaveLength(2)
  })

  it('reopens after the browser ends a session, and steps aside for hold-to-talk', () => {
    const { hf, recs, last } = make()
    hf.start()
    last().say('hello', true)
    vi.advanceTimersByTime(5000)
    last().onend?.()
    vi.advanceTimersByTime(TICK_MS)
    expect(recs).toHaveLength(2)
    hf.hold(true)
    expect(last().aborted).toBe(true)
    vi.advanceTimersByTime(TICK_MS * 2)
    expect(recs).toHaveLength(2)
    hf.hold(false)
    expect(recs).toHaveLength(3)
  })

  it('gives up when sessions keep ending at once, and when the microphone is blocked', () => {
    const { hf, last } = make()
    hf.start()
    for (let i = 0; i < MAX_DUDS; i++) {
      last().onend?.()
      vi.advanceTimersByTime(TICK_MS)
    }
    expect(hf.snapshot.on).toBe(false)
    expect(hf.snapshot.error).toBeTruthy()

    const b = make()
    b.hf.start()
    b.last().onerror?.({ error: 'not-allowed' })
    expect(b.hf.snapshot.on).toBe(false)
  })
})
