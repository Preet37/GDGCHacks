import { Box, type Editor, type TLShape } from 'tldraw'
import type { PageRect } from '../render/geometry'

export const MAX_SIDE = 1280

/** Scale that makes the longest side of `bounds` at most MAX_SIDE pixels (never upscales). */
export function exportScale(bounds: PageRect, maxSide = MAX_SIDE): number {
  return Math.min(1, maxSide / Math.max(bounds.w, bounds.h))
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Export `shapes` as a PNG covering exactly `bounds` (page space), so 0-1000 boxes
 * in the reply map straight back onto the page.
 */
export async function exportPng(editor: Editor, shapes: TLShape[], bounds: PageRect): Promise<string> {
  const { blob } = await editor.toImage(shapes, {
    format: 'png',
    bounds: new Box(bounds.x, bounds.y, bounds.w, bounds.h),
    padding: 0,
    scale: exportScale(bounds),
    pixelRatio: 1,
    background: true,
    darkMode: false,
  })
  return blobToBase64(blob)
}
