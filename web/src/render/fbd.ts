import type { FbdFigure, Force } from '../contract'

/**
 * Engineering (Part 2): a `figure` with kind "fbd" drawn as a clean free-body diagram (SVG), placed like a plot2d
 * figure. The surface at its real angle, the body sitting on it, one arrow per force from the body's centre at its
 * direction, labelled. Forces the tutor expects but the student didn't draw are dashed: that is the hint.
 * Generic: it draws whatever bodies, surfaces and forces it gets.
 */

export const FBD_W = 360
export const FBD_H = 270

const COLOR = { drawn: '#1f2a44', missing: '#2563eb', surface: '#8a8f99', body: '#f3f6ff' }

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Forces in `expected` that the student didn't draw (matched by label, then by direction within 20 degrees). */
export function missingForces(fbd: FbdFigure): Force[] {
  const drawn = fbd.forces ?? []
  const near = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180) <= 20
  return (fbd.expected ?? []).filter(
    (e) => !drawn.some((d) => d.label.trim().toLowerCase() === e.label.trim().toLowerCase() || near(d.angle_deg, e.angle_deg)),
  )
}

/** End point of an arrow of `len` from (cx, cy) at `deg` (counter-clockwise from +x; SVG y grows downwards). */
export function arrowEnd(cx: number, cy: number, deg: number, len: number): [number, number] {
  const r = (deg * Math.PI) / 180
  return [cx + Math.cos(r) * len, cy - Math.sin(r) * len]
}

function arrow(cx: number, cy: number, f: Force, dashed: boolean): string {
  const len = 82
  const [x2, y2] = arrowEnd(cx, cy, f.angle_deg, len)
  const color = dashed ? COLOR.missing : COLOR.drawn
  const [hx1, hy1] = arrowEnd(x2, y2, f.angle_deg + 180 - 25, 12)
  const [hx2, hy2] = arrowEnd(x2, y2, f.angle_deg + 180 + 25, 12)
  const [lx, ly] = arrowEnd(cx, cy, f.angle_deg, len + 18)
  const label = f.magnitude ? `${f.label} = ${f.magnitude}` : f.label
  return [
    `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="3"${dashed ? ' stroke-dasharray="7 5"' : ''} stroke-linecap="round"/>`,
    `<polyline points="${hx1.toFixed(1)},${hy1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${hx2.toFixed(1)},${hy2.toFixed(1)}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<text x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" text-anchor="middle" font-size="16" font-weight="600" fill="${color}">${esc(label)}${dashed ? '?' : ''}</text>`,
  ].join('')
}

/** The diagram as an SVG string. */
export function fbdSvg(fbd: FbdFigure, title = 'Force diagram'): string {
  const W = FBD_W
  const H = FBD_H
  const cx = W / 2
  const cy = H / 2 + 10
  const surface = fbd.surfaces?.[0]
  const angle = surface ? surface.angle_deg : null
  const parts: string[] = [`<rect width="100%" height="100%" fill="#fff"/>`]
  parts.push(`<text x="12" y="22" font-size="15" font-weight="600" fill="${COLOR.drawn}">${esc(title)}</text>`)
  const box = 44
  if (angle !== null) {
    // the surface line passes under the body; the body sits on it, turned to its angle
    const [sx1, sy1] = arrowEnd(cx, cy + box / 2, angle, 170)
    const [sx2, sy2] = arrowEnd(cx, cy + box / 2, angle + 180, 170)
    parts.push(`<line x1="${sx1.toFixed(1)}" y1="${sy1.toFixed(1)}" x2="${sx2.toFixed(1)}" y2="${sy2.toFixed(1)}" stroke="${COLOR.surface}" stroke-width="3"/>`)
    if (angle > 0.5) {
      // the ground under the ramp and the angle mark, so the slope reads as a ramp
      const lowX = Math.min(sx1, sx2)
      const lowY = Math.max(sy1, sy2)
      parts.push(`<line x1="${lowX.toFixed(1)}" y1="${lowY.toFixed(1)}" x2="${(lowX + 300).toFixed(1)}" y2="${lowY.toFixed(1)}" stroke="${COLOR.surface}" stroke-width="2" stroke-dasharray="4 4"/>`)
      parts.push(`<text x="${(lowX + 46).toFixed(1)}" y="${(lowY - 6).toFixed(1)}" font-size="13" fill="${COLOR.surface}">${Math.round(angle)}°</text>`)
    }
  }
  const tilt = angle ?? 0
  const shape = fbd.bodies?.[0]?.shape ?? 'box'
  if (shape === 'point') parts.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="${COLOR.drawn}"/>`)
  else
    parts.push(
      `<rect x="${cx - box / 2}" y="${cy - box / 2}" width="${box}" height="${box}" rx="3" fill="${COLOR.body}" stroke="${COLOR.drawn}" stroke-width="2" transform="rotate(${-tilt} ${cx} ${cy})"/>`,
    )
  for (const f of fbd.forces ?? []) parts.push(arrow(cx, cy, f, false))
  for (const f of missingForces(fbd)) parts.push(arrow(cx, cy, f, true))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">${parts.join('')}</svg>`
}

export function fbdToDataUrl(fbd: FbdFigure, title?: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fbdSvg(fbd, title))
}
