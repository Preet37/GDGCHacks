// Read a short reply out with the tutor's recorded voice (the one lessons use), falling back to the
// browser's own voice. One reply at a time: a newer one replaces the one being said.

import { audioOut } from './lesson/audio'
import { narrator } from './lesson/speech'

let turn = 0
let saying = false
let lastUrl: string | null = null

/** A reply is being fetched or said right now. */
export function isSaying(): boolean {
  return saying
}

/** The tutor is making sound: a reply, a lesson's narration, or the browser's voice. */
export function tutorIsLoud(): boolean {
  if (saying) return true
  if (audioOut()?.isBusy?.()) return true
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking
  } catch {
    return false
  }
}

export function hush() {
  turn++
  saying = false
  narrator().stop()
}

/** Say `text`. Resolves when it is over (or was replaced, or could not be said). Never throws. */
export async function sayAloud(text: string): Promise<void> {
  if (!text.trim()) return
  const mine = ++turn
  saying = true
  const over = () => {
    if (mine === turn) saying = false
  }
  try {
    const out = audioOut()
    // a lesson is using the voice: don't talk over it
    if (out?.isBusy?.()) return
    let blob: Blob | null = null
    try {
      blob = await (await import('./sync/api')).speak(text)
    } catch {
      blob = null
    }
    if (mine !== turn) return
    if (blob && out && !out.isBusy?.()) {
      if (lastUrl) URL.revokeObjectURL(lastUrl)
      const url = (lastUrl = URL.createObjectURL(blob))
      const played = await new Promise<boolean>((resolve) => {
        out.play(url, { onStart: () => {}, onEnd: () => resolve(true), onError: () => resolve(false) })
        // a clip that never reports its end must not keep the microphone closed for ever
        setTimeout(() => resolve(true), 45_000)
      })
      if (played || mine !== turn) return
    }
    await new Promise<void>((resolve) => {
      narrator().speak(text, { trusted: true, onEnd: resolve })
      // stopped from elsewhere, its end is never reported
      setTimeout(resolve, 30_000)
    })
  } finally {
    over()
  }
}
