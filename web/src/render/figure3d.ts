import { createShapeId, type Editor } from 'tldraw'
import type { Action, FigureSpec } from '../contract'
import { aiMeta } from './actions'
import type { PageRect } from './geometry'

export { GRID_N, displayRange, heightColor, sampleSurface, surfaceIndices, toSurfaceExpr, trySampleSurface } from './figure3d/sample'

/** Must match Surface3dShapeUtil.type (web/src/shapes/Surface3dShape.tsx, registered in App.tsx). */
const SHAPE_TYPE = 'surface3d'
/** A 3D view needs a bit of room: never smaller than this, whatever rect we're given. */
const MIN_W = 320
const MIN_H = 280

/** The spec as plain JSON for the shape's props (no undefined keys, ranges as 2-tuples). */
export function cleanSpec(spec: FigureSpec): FigureSpec {
  const pair = (r: unknown): [number, number] | undefined =>
    Array.isArray(r) && r.length >= 2 ? [Number(r[0]), Number(r[1])] : undefined
  const out: FigureSpec = {
    kind: 'surface3d',
    expressions: (Array.isArray(spec.expressions) ? spec.expressions : []).map(String),
    x_range: pair(spec.x_range) ?? [-1, 1],
  }
  const y = pair(spec.y_range)
  if (y) out.y_range = y
  if (typeof spec.title === 'string' && spec.title) out.title = spec.title
  return out
}

/** The shape for a surface3d figure action at `rect`, or null if the action isn't one. */
export function surface3dShape(action: Action, rect: PageRect) {
  if (action.type !== 'figure' || action.figure?.kind !== 'surface3d') return null
  return {
    id: createShapeId(),
    type: SHAPE_TYPE,
    x: rect.x,
    y: rect.y,
    meta: aiMeta('figure', action.line_id),
    props: { w: Math.max(MIN_W, rect.w), h: Math.max(MIN_H, rect.h), spec: cleanSpec(action.figure) },
  } as const
}

/**
 * Put an interactive 3D surface for a `figure` action (figure.kind === 'surface3d') on the page
 * at `rect` (page space). Only the FigureSpec is stored in the shape; the mesh is rebuilt from it
 * whenever the shape mounts, so it survives save/load. A spec that can't be drawn still gets a
 * card saying so. Never throws.
 */
export async function renderSurface3d(editor: Editor, action: Action, rect: { x: number; y: number; w: number; h: number }): Promise<void> {
  try {
    const shape = surface3dShape(action, rect)
    if (!shape) return
    editor.run(() => editor.createShapes([shape]), { history: 'ignore', ignoreShapeLock: true })
  } catch (err) {
    console.warn('surface3d figure skipped', action.figure, err)
  }
}
