import type { Model3dFigure, ModelPart, Vec3 } from '../../contract'

/**
 * Engineering (Part 2): the plain maths behind a model3d figure, kept apart from three.js so it can be tested.
 * Model coordinates are whatever the tutor used (z up); the view fits them.
 */

export const LOAD_COLORS: Record<ModelPart['load'], string> = {
  tension: '#2563eb',
  compression: '#dc2626',
  bending: '#9333ea',
  none: '#8a8f99',
}

export const LOAD_WORDS: Record<ModelPart['load'], string> = {
  tension: 'Tension (pulled)',
  compression: 'Compression (pushed)',
  bending: 'Bending',
  none: 'No main load',
}

export const LOAD_ARROW_COLOR = '#16a34a'

export interface Bounds {
  min: Vec3
  max: Vec3
  center: Vec3
  /** half the diagonal: the radius of a sphere holding the whole model */
  radius: number
}

/** Every point a part covers (its corners, or its two ends). */
export function partPoints(p: ModelPart): Vec3[] {
  if (p.shape === 'member') return p.start && p.end ? [p.start, p.end] : []
  if (!p.at || !p.size) return []
  const [x, y, z] = p.at
  const [sx, sy, sz] = p.size
  const hx = p.shape === 'box' ? sx / 2 : sx
  const hy = p.shape === 'box' ? sy / 2 : sy
  const hz = p.shape === 'sphere' ? sx : sz / 2
  return [
    [x - hx, y - hy, z - hz],
    [x + hx, y + hy, z + hz],
  ]
}

export function modelBounds(model: Model3dFigure): Bounds {
  const pts = model.parts.flatMap(partPoints).concat((model.loads ?? []).map((l) => l.at))
  if (!pts.length) return { min: [-1, -1, -1], max: [1, 1, 1], center: [0, 0, 0], radius: Math.sqrt(3) }
  const min = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))) as Vec3
  const max = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))) as Vec3
  const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2) as Vec3
  const radius = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2)
  return { min, max, center, radius }
}

/** A member is drawn as a cylinder: where its middle is, how long it is, and its unit direction. */
export function memberAxis(start: Vec3, end: Vec3): { mid: Vec3; length: number; dir: Vec3 } {
  const d: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
  const length = Math.hypot(...d)
  return {
    mid: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2],
    length,
    dir: length > 0 ? [d[0] / length, d[1] / length, d[2] / length] : [0, 0, 1],
  }
}

/** A member's drawn radius: what the tutor said, but never so thin it can't be seen, nor fatter than a pier. */
export function memberRadius(p: ModelPart, radius: number): number {
  const asked = p.size?.[0] ?? 0
  return Math.min(radius * 0.03, Math.max(radius * 0.005, asked))
}

/** How thick a member must be to be tapped with a finger (an invisible sleeve around it). */
export function pickRadius(radius: number): number {
  return radius * 0.03
}

/** The parts grouped as the student sees them: segments with the same name are one part (a cable in pieces). */
export function partGroups(model: Model3dFigure): { name: string; load: ModelPart['load']; explain?: string; ids: string[] }[] {
  const groups = new Map<string, { name: string; load: ModelPart['load']; explain?: string; ids: string[] }>()
  for (const p of model.parts) {
    const g = groups.get(p.name)
    if (g) {
      g.ids.push(p.id)
      g.explain ??= p.explain
    } else groups.set(p.name, { name: p.name, load: p.load, explain: p.explain, ids: [p.id] })
  }
  return [...groups.values()]
}

/** Which loads appear in the model, in a fixed order, for the legend. */
export function loadsUsed(model: Model3dFigure): ModelPart['load'][] {
  const used = new Set(model.parts.map((p) => p.load))
  return (['tension', 'compression', 'bending'] as const).filter((l) => used.has(l))
}

/** A stroke the student drew on the model, stuck to it in 3D (model coordinates), so it turns with the model. */
export interface ModelMark {
  color: string
  /** x, y, z, x, y, z, ... (flat, so it stores as plain JSON) */
  pts: number[]
}

/** tldraw's colour names -> the hex its default theme draws them with. */
export const TL_COLORS: Record<string, string> = {
  black: '#1d1d1d',
  grey: '#9fa8b2',
  'light-violet': '#e085f4',
  violet: '#ae3ec9',
  blue: '#4465e9',
  'light-blue': '#4ba1f1',
  yellow: '#f1ac4b',
  orange: '#e16919',
  green: '#099268',
  'light-green': '#4cb05e',
  'light-red': '#f87777',
  red: '#e03131',
  white: '#ffffff',
}

/** Drop points closer than `min` to the last kept one (a pen sends many; a 3D tube needs few). */
export function thinStroke(pts: [number, number][], min = 3): [number, number][] {
  const out: [number, number][] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= min) out.push(p)
  }
  const end = pts[pts.length - 1]
  if (end && out[out.length - 1] !== end && out.length > 0) out.push(end)
  return out
}
