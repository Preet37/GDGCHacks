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
