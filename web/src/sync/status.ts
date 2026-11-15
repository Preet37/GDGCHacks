import type { CheckRequest } from '../contract'

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

/** One line: time, mode, lines read, actions received, actions drawn; or why nothing was sent; or the error. */
export function statusLine(s: CheckStatus): string {
  const head = `${clock(s.at)} ${s.mode}${s.held ? ' (ready ahead)' : ''}`
  if (s.error) return `${head}: failed: ${s.error}`
  if (s.skipped) return `${head}: not sent (${s.skipped})`
  const n = s.actions?.length ?? 0
  const got = n ? `${n} action${n === 1 ? '' : 's'} (${s.actions!.join(', ')})` : 'no actions'
  const took = s.ms === undefined ? '' : `, ${(s.ms / 1000).toFixed(1)} s`
  return `${head}: read ${s.read ?? 0} line${s.read === 1 ? '' : 's'}, ${got}, drew ${s.drawn ?? 0}${took}`
}
