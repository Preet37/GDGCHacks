import type { CheckRequest, CheckResponse } from '../contract'

const MOCK = new URLSearchParams(location.search).has('mock') || import.meta.env.VITE_MOCK === '1'

export class ApiError extends Error {}

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
    const reply = structuredClone(mod.default) as unknown as CheckResponse
    return { ...reply, state: { ...reply.state, page_id: req.state.page_id } }
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
    throw new ApiError(body.error === 'bad_image' ? "Couldn't read the page image" : 'The tutor had a hiccup, try again')
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
