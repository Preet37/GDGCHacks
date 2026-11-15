import type { CheckRequest, CheckResponse } from '../contract'

const MOCK = new URLSearchParams(location.search).has('mock') || import.meta.env.VITE_MOCK === '1'

export class ApiError extends Error {}

/** POST /api/check. With ?mock (or VITE_MOCK=1) it returns an example reply without a server. */
export async function postCheck(req: CheckRequest): Promise<CheckResponse> {
  if (MOCK) {
    // "Teach me" gets the example lesson, after a wait long enough to see the "preparing" state
    const explain = req.mode === 'explain'
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
