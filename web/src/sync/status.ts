import type { CheckRequest, ReadLine } from '../contract'

/** What the last check came to. Shown next to "Show what AI read", so a photo of the screen says what happened. */
export interface CheckStatus {
  /** when it finished (ms since epoch) */
  at: number
  mode: CheckRequest['mode']
  /** shown from a hint that was fetched ahead of time */
  held?: boolean
  /** not sent, and why */
  skipped?: string
  /** it failed, and how */
  error?: string
  /** lines in the reply's reading */
  read?: number
  /** action types in the reply, in order */
  actions?: string[]
  /** nothing came back: what was read (the lines, in calculator syntax) */
  lines?: string[]
  /** nothing came back: why, as far as the server's log of the check says */
  why?: string
  /** how many of them ended up on the page */
  drawn?: number
  /** how long the request took */
  ms?: number
}

function clock(at: number): string {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const short = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text)

/**
 * A reply that read lines but sent nothing to draw: what it read, and why nothing came of it, taken
 * from the server's own log of the check (`debug.tool_calls`, e.g. "verify_step(L1->L2, derivative) = correct",
 * "submit_feedback(0/1 actions kept)"). `sheet` = a worksheet was in the picture that was sent.
 */
export function silence(lines: ReadLine[], calls: string[] | undefined, sheet: boolean): Pick<CheckStatus, 'lines' | 'why'> {
  if (!lines.length) return {}
  return { lines: lines.map((l) => l.plain || l.latex || '?'), why: whySilent(lines, calls ?? [], sheet) }
}

function whySilent(lines: ReadLine[], calls: string[], sheet: boolean): string | undefined {
  if (lines.every((l) => l.source === 'printed')) return sheet ? 'only printed worksheet text, no handwriting' : 'the writing was taken for printed text'
  const result = (c: string) => c.slice(c.lastIndexOf(' = ') + 3).trim()
  const verdicts = calls.filter((c) => c.startsWith('verify_step(')).map(result)
  const worked = calls.filter((c) => c.startsWith('compute_step(') && !/= (nothing|refused)/.test(c)).map(result)
  const had = worked.length ? ` (it had ${short(worked.at(-1)!, 24)})` : ''
  const kept = calls.map((c) => /^submit_feedback\((\d+)\/(\d+) actions kept\)/.exec(c)).findLast((m) => m)
  if (kept && Number(kept[2]) > Number(kept[1])) return `the server dropped ${Number(kept[2]) - Number(kept[1])} of ${plural(Number(kept[2]), 'action')}${had}`
  const dropped = calls.findLast((c) => /\bdropped\b/.test(c))
  if (dropped) return short(dropped, 70)
  const wrong = verdicts.filter((v) => v === 'incorrect').length
  if (wrong) return `${plural(wrong, 'step')} checked incorrect, nothing new sent`
  if (verdicts.length && verdicts.every((v) => v === 'correct')) return `${verdicts.length === 1 ? 'the step' : `all ${verdicts.length} steps`} checked correct`
  if (verdicts.some((v) => v.startsWith('skipped'))) return 'the last line is still open'
  if (worked.length) return `the tutor worked out ${short(worked.at(-1)!, 24)} but sent nothing`
  const back = calls.findLast((c) => c.startsWith('submit_feedback sent back'))
  if (back) return short(back, 70)
  if (kept) return 'the tutor had nothing to say'
  return calls.length ? short(calls.at(-1)!, 70) : undefined
}

/**
 * One line: time, mode, lines read, actions received, actions drawn; or why nothing was sent; or the
 * error. When lines were read and nothing came back, it also says what was read and why.
 */
export function statusLine(s: CheckStatus): string {
  const head = `${clock(s.at)} ${s.mode}${s.held ? ' (ready ahead)' : ''}`
  if (s.error) return `${head}: failed: ${s.error}`
  if (s.skipped) return `${head}: not sent (${s.skipped})`
  const n = s.actions?.length ?? 0
  const got = n ? `${plural(n, 'action')} (${s.actions!.join(', ')})` : `no actions${s.why ? `: ${s.why}` : ''}`
  const took = s.ms === undefined ? '' : `, ${(s.ms / 1000).toFixed(1)} s`
  // the last two lines: the newest writing is what the check was about
  const shown = (s.lines ?? []).slice(-2).map((l) => short(l, 28))
  const what = !n && shown.length ? ` (${(s.lines?.length ?? 0) > 2 ? '…; ' : ''}${shown.join('; ')})` : ''
  return `${head}: read ${plural(s.read ?? 0, 'line')}${what}, ${got}, drew ${s.drawn ?? 0}${took}`
}
