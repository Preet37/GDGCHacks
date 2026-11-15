// 3D cards made in this page session start their WebGL view by themselves. A card that came back
// with a saved page waits for a tap. Why: if a 3D view ever takes the tab down (iPad Safari kills a
// page that uses too much memory), the reload restores the same card; starting it again would crash
// again, and Safari then refuses the page ("A problem repeatedly occurred").
const fresh = new Set<string>()

export function markFresh(id: string) {
  fresh.add(id)
}

export function isFresh(id: string): boolean {
  return fresh.has(id)
}

/** At most this many 3D cards (surface, model and asset cards together) run WebGL at once (iPad memory). */
export const MAX_LIVE = 2

/** Cards that are running WebGL now, oldest first, each with the way to put it back to "Tap to show". */
const liveViews = new Map<string, () => void>()

/**
 * A card says its WebGL view is starting. If that makes more than MAX_LIVE, the oldest live card is
 * released: its `release` is called, and it must drop its view and show "Tap to show…" (a tap claims again).
 * Returns the function that gives the place back; call it when the view is disposed.
 */
export function claimLive(id: string, release: () => void): () => void {
  liveViews.delete(id) // claiming again moves the card to the newest place
  liveViews.set(id, release)
  while (liveViews.size > MAX_LIVE) {
    const [oldest, sleep] = liveViews.entries().next().value as [string, () => void]
    liveViews.delete(oldest)
    sleep()
  }
  return () => {
    // only this claim's own place: the card may have been released and have claimed again since
    if (liveViews.get(id) === release) liveViews.delete(id)
  }
}

/** Ids of the cards running WebGL now, oldest first. */
export function liveIds(): string[] {
  return [...liveViews.keys()]
}
