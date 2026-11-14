import type { TLStoreSnapshot } from 'tldraw'

/** Firestore documents max out at 1 MiB; stay under it with room for PageState. */
export const MAX_SNAPSHOT_BYTES = 900_000

type Rec = { typeName?: string; type?: string; props?: { src?: string | null } }

/**
 * Serialize a tldraw document snapshot for Firestore. If it's too big, drop the image data of the
 * largest assets first (imported PDF pages), keeping the shapes so the layout survives.
 * Returns the JSON and the ids of assets whose image was dropped.
 */
export function packSnapshot(snapshot: TLStoreSnapshot, maxBytes = MAX_SNAPSHOT_BYTES): { json: string; dropped: string[] } {
  let json = JSON.stringify(snapshot)
  if (json.length <= maxBytes) return { json, dropped: [] }

  const store = { ...(snapshot.store as Record<string, Rec>) }
  const images = Object.entries(store)
    .filter(([, r]) => r.typeName === 'asset' && typeof r.props?.src === 'string')
    .sort(([, a], [, b]) => (b.props!.src!.length ?? 0) - (a.props!.src!.length ?? 0))
  const dropped: string[] = []
  for (const [id, rec] of images) {
    if (json.length <= maxBytes) break
    store[id] = { ...rec, props: { ...rec.props, src: null } }
    dropped.push(id)
    json = JSON.stringify({ ...snapshot, store })
  }
  return { json, dropped }
}
