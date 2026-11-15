import type { Pt, Rect, Stroke } from './types'

export function boundsOf(strokes: Stroke[]): Rect | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of strokes)
    for (const p of s) {
      if (p.x < x0) x0 = p.x
      if (p.y < y0) y0 = p.y
      if (p.x > x1) x1 = p.x
      if (p.y > y1) y1 = p.y
    }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function strokeLength(s: Stroke): number {
  let len = 0
  for (let i = 1; i < s.length; i++) len += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y)
  return len
}

export function median(values: number[]): number {
  if (!values.length) return NaN
  const v = [...values].sort((a, b) => a - b)
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** The same stroke as `n` points evenly spaced along its length (pressure is carried along). */
export function resample(s: Stroke, n: number): Stroke {
  if (s.length < 2 || n < 2) return s.slice()
  const total = strokeLength(s)
  if (total === 0) return [s[0], s[s.length - 1]]
  const out: Stroke = [s[0]]
  const step = total / (n - 1)
  let want = step
  let walked = 0
  for (let i = 1; i < s.length && out.length < n - 1; i++) {
    const a = s[i - 1]
    const b = s[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    while (seg > 0 && walked + seg >= want && out.length < n - 1) {
      const t = (want - walked) / seg
      const p: Pt = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      if (a.z !== undefined && b.z !== undefined) p.z = a.z + (b.z - a.z) * t
      out.push(p)
      want += step
    }
    walked += seg
  }
  out.push(s[s.length - 1])
  return out
}

/** Thin a stroke to at most `max` points (short strokes are left as they are). */
export function thin(s: Stroke, max: number): Stroke {
  return s.length > max ? resample(s, max) : s
}

/**
 * Round the gentle corners of a polyline (Chaikin), keeping the sharp ones, so a stroke made of a
 * few straight pieces reads as one pen movement. Ends stay where they are.
 */
export function roundCorners(s: Stroke, rounds = 2, sharp = Math.PI / 3): Stroke {
  let pts = s
  for (let r = 0; r < rounds; r++) {
    if (pts.length < 3) return pts
    const out: Stroke = [pts[0]]
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const c = pts[i + 1]
      const turn = Math.abs(angleBetween(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y))
      if (turn > sharp) out.push(b)
      else out.push({ x: b.x + (a.x - b.x) * 0.25, y: b.y + (a.y - b.y) * 0.25 }, { x: b.x + (c.x - b.x) * 0.25, y: b.y + (c.y - b.y) * 0.25 })
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
}

/** A small seeded random source, so layouts can be repeated in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * How far the writing leans: sideways movement per unit of upward movement, measured on the
 * near-vertical parts of the strokes (stems). 0 = upright, positive = leaning right.
 */
export function slantOf(strokes: Stroke[], maxAngle = Math.PI / 3.6): number {
  // each steep piece of a stroke, as if drawn upwards: its lean, and its height as its weight
  const leans: [number, number][] = []
  const lim = Math.tan(maxAngle)
  let total = 0
  for (const s of strokes)
    for (let i = 1; i < s.length; i++) {
      const x = s[i].x - s[i - 1].x
      const y = s[i].y - s[i - 1].y
      if (y === 0 || Math.abs(x / y) > lim) continue
      leans.push([(y < 0 ? x : -x) / Math.abs(y), Math.abs(y)])
      total += Math.abs(y)
    }
  if (!leans.length) return 0
  // the middle value by height: stems all lean the same way and carry most of the height, while
  // curves (the bowl of a b, the ends of a bracket) fall either side of them
  leans.sort((a, b) => a[0] - b[0])
  let seen = 0
  for (const [lean, weight] of leans) {
    seen += weight
    if (seen >= total / 2) return lean
  }
  return leans[leans.length - 1][0]
}

/**
 * Fill in a thinned stroke with a smooth curve through its points, so that points
 * are about `spacing` apart. Pressure is interpolated.
 */
export function densify(s: Stroke, spacing: number): Stroke {
  if (s.length < 2 || !(spacing > 0)) return s.slice()
  const out: Stroke = []
  const at = (i: number) => s[Math.min(s.length - 1, Math.max(0, i))]
  for (let i = 0; i < s.length - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const steps = Math.max(1, Math.min(24, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing)))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const t2 = t * t
      const t3 = t2 * t
      // a gentle spline (tangents at 0.3, not Catmull-Rom's 0.5): it rounds the path without swinging past corners
      const f = (a: number, b: number, c: number, d: number) =>
        (2 * t3 - 3 * t2 + 1) * b + (t3 - 2 * t2 + t) * 0.3 * (c - a) + (-2 * t3 + 3 * t2) * c + (t3 - t2) * 0.3 * (d - b)
      const p: Pt = { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) }
      if (p1.z !== undefined && p2.z !== undefined) p.z = p1.z + (p2.z - p1.z) * t
      out.push(p)
    }
  }
  out.push(s[s.length - 1])
  return out
}
