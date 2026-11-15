/** Lesson cards that were just placed by the tutor (not restored from a saved page) start playing by themselves. */
const pending = new Set<string>()

export function requestAutoplay(shapeId: string) {
  pending.add(shapeId)
}

/** true once for a card that was asked to start by itself. */
export function takeAutoplay(shapeId: string): boolean {
  return pending.delete(shapeId)
}
