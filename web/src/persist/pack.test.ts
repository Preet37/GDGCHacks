import { describe, expect, it } from 'vitest'
import type { TLStoreSnapshot } from 'tldraw'
import { packSnapshot } from './pack'

const snap = (store: Record<string, unknown>) => ({ store, schema: { schemaVersion: 2, sequences: {} } }) as unknown as TLStoreSnapshot

describe('packSnapshot', () => {
  it('leaves small snapshots alone', () => {
    const s = snap({ 'shape:a': { typeName: 'shape', id: 'shape:a' } })
    expect(packSnapshot(s)).toEqual({ json: JSON.stringify(s), dropped: [] })
  })

  it('drops the biggest image data first until it fits, keeping shapes', () => {
    const s = snap({
      'asset:big': { typeName: 'asset', props: { src: 'x'.repeat(5000) } },
      'asset:small': { typeName: 'asset', props: { src: 'y'.repeat(500) } },
      'shape:a': { typeName: 'shape', id: 'shape:a' },
    })
    const { json, dropped } = packSnapshot(s, 2000)
    expect(dropped).toEqual(['asset:big'])
    expect(json.length).toBeLessThanOrEqual(2000)
    const out = JSON.parse(json)
    expect(out.store['asset:big'].props.src).toBeNull()
    expect(out.store['asset:small'].props.src).toBe('y'.repeat(500))
    expect(out.store['shape:a']).toBeTruthy()
  })
})
