import type { CheckRequest, CheckResponse, CircuitElement, CircuitSolveResponse } from '../contract'
import { mockReply } from './mock'

const MOCK = new URLSearchParams(location.search).has('mock') || import.meta.env.VITE_MOCK === '1'

export class ApiError extends Error {
  /** true = trying again won't help (the Gemini account is out of credit): keep the message up */
  sticky = false
}

/** What to tell the student when the server says why it failed. */
export function failureMessage(body: { error?: string; reason?: string | null }): { message: string; sticky: boolean } {
  if (body.error === 'bad_image') return { message: "Couldn't read the page image", sticky: false }
  if (body.reason === 'out_of_credit') return { message: 'The tutor is offline: its Gemini account is out of credit. Nothing will be checked until it is topped up.', sticky: true }
  if (body.reason === 'timeout') return { message: 'That took too long. Zoom in on one problem and try again', sticky: false }
  if (body.reason === 'busy') return { message: 'Gemini is busy right now. Try again in a moment', sticky: false }
  return { message: 'The tutor had a hiccup, try again', sticky: false }
}

/** POST /api/check. With ?mock (or VITE_MOCK=1) it returns an example reply without a server. */
export async function postCheck(req: CheckRequest): Promise<CheckResponse> {
  if (MOCK) {
    // "Teach me" gets the example lesson, after a wait long enough to see the "preparing" state
    const explain = req.mode === 'explain'
    // work under a practice problem: the short green note the server sends when the answer is right
    if (req.mode === 'auto' && req.given?.length) {
      await new Promise((r) => setTimeout(r, 600))
      return { lines: [], actions: [{ type: 'note', color: 'green', text: 'Correct!', box: req.given.at(-1)!.box, side: 'right' }], clear_line_ids: [], state: req.state }
    }
    const mod = explain
      ? await import('../../../contract/examples/lesson.json')
      : await import('../../../contract/examples/wrong_derivative.json')
    await new Promise((r) => setTimeout(r, explain ? 1800 : 600))
    return mockReply(req, structuredClone(mod.default) as unknown as CheckResponse)
  }
  let res: Response
  try {
    res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
  } catch {
    throw new ApiError("Can't reach the tutor server")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const why = failureMessage(body)
    const err = new ApiError(why.message)
    err.sticky = why.sticky
    throw err
  }
  return res.json()
}

/**
 * POST /api/speak: the narration `text` read out by the server's voice, as audio (WAV).
 * Rejects if there is no voice to be had (no server, an error reply, ?mock): the caller falls back
 * to the browser's own speech.
 */
export async function speak(text: string, signal?: AbortSignal): Promise<Blob> {
  if (MOCK) throw new ApiError('No recorded voice without a server')
  let res: Response
  try {
    res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    })
  } catch {
    throw new ApiError("Can't reach the voice server")
  }
  // errors come back as JSON with a non-200 status; anything that isn't audio is treated the same
  const type = res.headers.get('Content-Type') ?? ''
  if (!res.ok || !type.startsWith('audio/')) throw new ApiError('The voice is not available')
  const blob = await res.blob()
  if (!blob.size) throw new ApiError('The voice came back empty')
  return blob
}

/**
 * POST /api/circuit/solve: re-solve a circuit for the what-if card. No Gemini, so it's free to call on every edit.
 * Always resolves: a network problem comes back as { ok: false, detail } like a circuit the server can't solve.
 */
export async function solveCircuit(elements: CircuitElement[], signal?: AbortSignal): Promise<CircuitSolveResponse> {
  try {
    const res = await fetch('/api/circuit/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elements }),
      signal,
    })
    const body = (await res.json().catch(() => null)) as CircuitSolveResponse | null
    if (!body || typeof body.ok !== 'boolean') return { ok: false, detail: `the solver answered ${res.status}` }
    return body
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    return { ok: false, detail: "can't reach the solver" }
  }
}
