import { compile } from 'mathjs'
import type { FigureSpec } from '../../contract'

export const GRID_N = 60

export interface SurfaceGrid {
  /** samples per side: (n+1) x (n+1) vertices */
  n: number
  x_range: [number, number]
  y_range: [number, number]
  /** shown height range; values outside it are clamped */
  z_range: [number, number]
  /** row-major, index = j * (n + 1) + i (i along x, j along y). NaN = no value there */
  z: Float32Array
  finiteCount: number
}

/** "z = x^2 + y^2" / "f(x, y) = ..." -> the right-hand side; `**` -> `^`. */
export function toSurfaceExpr(expr: string): string {
  return expr
    .replace(/\*\*/g, '^')
    .replace(/^\s*[a-zA-Z]\w*\s*\(\s*x\s*,\s*y\s*\)\s*=\s*/, '')
    .replace(/^\s*z\s*=\s*/, '')
    .trim()
}

function validRange(r: unknown): r is [number, number] {
  return Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] < r[1]
}

/**
 * Height range to show. Normally min..max, but a pole (1/(x^2+y^2)) would flatten everything
 * else, so values far outside the 5th-95th percentile band are cut off.
 */
export function displayRange(values: ArrayLike<number>): [number, number] | null {
  const finite: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) finite.push(values[i])
  if (!finite.length) return null
  finite.sort((a, b) => a - b)
  const min = finite[0]
  const max = finite[finite.length - 1]
  const last = finite.length - 1
  const lo = finite[Math.floor(0.05 * last)]
  const hi = finite[Math.ceil(0.95 * last)]
  const spread = hi - lo
  let zmin = Math.max(min, lo - 1.5 * spread)
  let zmax = Math.min(max, hi + 1.5 * spread)
  if (!(zmax > zmin)) {
    // flat surface: give it some room so it isn't a zero-height box
    const pad = Math.abs(zmin) > 1e-9 ? Math.abs(zmin) * 0.5 : 1
    zmin -= pad
    zmax += pad
  }
  return [zmin, zmax]
}

/**
 * Sample spec.expressions[0] over x_range x y_range. Throws an Error if the spec can't be drawn
 * at all (bad ranges, unparsable expression, no finite value anywhere); single bad cells become NaN.
 */
export function sampleSurface(spec: FigureSpec, n = GRID_N): SurfaceGrid {
  const source = spec.expressions?.[0]
  if (typeof source !== 'string' || !source.trim()) throw new Error('no expression')
  if (!validRange(spec.x_range)) throw new Error('bad x_range')
  const y_range = spec.y_range ?? spec.x_range
  if (!validRange(y_range)) throw new Error('bad y_range')

  const code = compile(toSurfaceExpr(source)) // throws on a syntax error
  const [x0, x1] = spec.x_range
  const [y0, y1] = y_range
  const z = new Float32Array((n + 1) * (n + 1))
  const scope = { x: 0, y: 0 }
  let finiteCount = 0
  for (let j = 0; j <= n; j++) {
    scope.y = y0 + ((y1 - y0) * j) / n
    for (let i = 0; i <= n; i++) {
      scope.x = x0 + ((x1 - x0) * i) / n
      let v: unknown
      try {
        v = code.evaluate(scope)
      } catch {
        v = NaN // unknown symbol, wrong argument type, ...
      }
      // complex results (sqrt of a negative), units, matrices: not a height
      const num = typeof v === 'number' && Number.isFinite(v) ? v : NaN
      if (!Number.isNaN(num)) finiteCount++
      z[j * (n + 1) + i] = num
    }
  }
  const z_range = displayRange(z)
  if (!z_range) throw new Error('no finite values')
  for (let k = 0; k < z.length; k++) {
    if (!Number.isNaN(z[k])) z[k] = Math.min(z_range[1], Math.max(z_range[0], z[k]))
  }
  return { n, x_range: [x0, x1], y_range: [y0, y1], z_range, z, finiteCount }
}

/** Same, but never throws: null when the spec can't be drawn. */
export function trySampleSurface(spec: FigureSpec, n = GRID_N): SurfaceGrid | null {
  try {
    return sampleSurface(spec, n)
  } catch (err) {
    console.warn('surface3d: could not sample', spec, err)
    return null
  }
}

/** Triangle indices for every grid cell whose four corners all have a value. */
export function surfaceIndices(grid: SurfaceGrid): number[] {
  const { n, z } = grid
  const out: number[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      const b = a + 1
      const c = a + n + 1
      const d = c + 1
      if (Number.isNaN(z[a]) || Number.isNaN(z[b]) || Number.isNaN(z[c]) || Number.isNaN(z[d])) continue
      out.push(a, b, d, a, d, c)
    }
  }
  return out
}

// low -> high: deep blue, teal, green, yellow, warm red
const RAMP: [number, number, number][] = [
  [0.19, 0.27, 0.68],
  [0.13, 0.57, 0.7],
  [0.3, 0.74, 0.45],
  [0.96, 0.82, 0.25],
  [0.89, 0.34, 0.2],
]

/** Colour for a height, t in 0..1 (clamped). */
export function heightColor(t: number): [number, number, number] {
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (RAMP.length - 1)
  const k = Math.min(RAMP.length - 2, Math.floor(u))
  const f = u - k
  const a = RAMP[k]
  const b = RAMP[k + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** Short axis label for a number: 3 significant digits, no trailing zeros. */
export function tickLabel(v: number): string {
  return String(Number(v.toPrecision(3)))
}
