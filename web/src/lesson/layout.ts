/** Where the lesson panel docks and how the screen is shared with the notebook. Pure, so it can be tested. */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface DockLayout {
  /** bottom sheet (upright screens) or a panel on the right (wide screens) */
  side: 'bottom' | 'right'
  /** the panel's height (bottom) or width (right), px */
  size: number
  /** what is left for the notebook, px */
  canvas: { w: number; h: number }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Split a w x h screen between the notebook and the lesson panel. The panel never lies over the
 * notebook: upright, it is a sheet across the bottom (about 45% of the height); on a wide screen
 * it is a column on the right (about 42% of the width). The notebook keeps the rest.
 */
export function dockLayout(w: number, h: number): DockLayout {
  if (w > h && w >= 760) {
    const size = Math.round(clamp(w * 0.42, 340, Math.max(340, w - 320)))
    return { side: 'right', size, canvas: { w: w - size, h } }
  }
  // a short screen still gets a usable sheet, and the notebook always keeps a strip to itself
  const size = Math.round(Math.max(h * 0.3, Math.min(Math.max(h * 0.45, 300), h - 200)))
  return { side: 'bottom', size, canvas: { w, h: h - size } }
}

/** Screen space at the edges of the notebook that its own controls take (px). */
export interface Insets {
  left: number
  top: number
  right: number
  bottom: number
}

/** Room kept clear around the problem: the page menu on top, the toolbar below, the Help buttons. */
export function canvasInsets(side: DockLayout['side']): Insets {
  return side === 'bottom' ? { left: 16, top: 56, right: 16, bottom: 168 } : { left: 16, top: 56, right: 104, bottom: 76 }
}

export interface Camera {
  x: number
  y: number
  z: number
}

/**
 * The camera that keeps `focus` (page space) inside a `screen`-sized notebook, clear of `pad`.
 * It moves as little as it can: no move if the focus is already in view, a slide if it fits at the
 * current zoom, and a zoom out (to half the current zoom at most) only if it doesn't.
 * tldraw's camera: screen = (page + camera) * z.
 */
export function cameraFor(focus: Rect, cam: Camera, screen: { w: number; h: number }, pad: Insets): Camera {
  const availW = Math.max(40, screen.w - pad.left - pad.right)
  const availH = Math.max(40, screen.h - pad.top - pad.bottom)
  const z0 = cam.z > 0 && Number.isFinite(cam.z) ? cam.z : 1
  let z = z0
  const fit = Math.min(availW / Math.max(1, focus.w), availH / Math.max(1, focus.h))
  if (fit < z) z = Math.max(z * 0.5, fit)
  // changing zoom keeps the middle of the clear area on the same spot of the page
  const midX = pad.left + availW / 2
  const midY = pad.top + availH / 2
  let x = cam.x + midX / z - midX / z0
  let y = cam.y + midY / z - midY / z0
  const shift = (lo: number, size: number, min: number, max: number) => {
    if (size > max - min) return min - lo // doesn't fit: show its start
    if (lo < min) return min - lo
    if (lo + size > max) return max - (lo + size)
    return 0
  }
  x += shift(focus.x, focus.w, -x + pad.left / z, -x + (screen.w - pad.right) / z)
  y += shift(focus.y, focus.h, -y + pad.top / z, -y + (screen.h - pad.bottom) / z)
  return { x, y, z }
}

/** A point on the screen (px). */
export interface Spot {
  x: number
  y: number
}

const hits = (a: Rect, b: Rect, gap: number) => a.x < b.x + b.w + gap && a.x + a.w > b.x - gap && a.y < b.y + b.h + gap && a.y + a.h > b.y - gap

/**
 * Where on a `screen`-sized notebook a `box` (screen px, where it is now) can sit in the clear:
 * inside the screen by `margin`, and `gap` away from every one of `obstacles` (the controls that
 * lie over the notebook). The answer is the clear place nearest to where the box is: the same place
 * if it is already clear. null = there is no such place (the box is too big).
 */
export function clearSpot(box: Rect, screen: { w: number; h: number }, obstacles: Rect[], margin = 12, gap = 8): Spot | null {
  const xs = [box.x, margin, screen.w - margin - box.w]
  const ys = [box.y, margin, screen.h - margin - box.h]
  for (const o of obstacles) {
    xs.push(o.x + o.w + gap, o.x - gap - box.w)
    ys.push(o.y + o.h + gap, o.y - gap - box.h)
  }
  const eps = 1e-6
  let best: Spot | null = null
  let bestD = Infinity
  for (const x of xs) {
    if (x < margin - eps || x + box.w > screen.w - margin + eps) continue
    for (const y of ys) {
      if (y < margin - eps || y + box.h > screen.h - margin + eps) continue
      const d = (x - box.x) ** 2 + (y - box.y) ** 2
      if (d >= bestD) continue
      const at = { x, y, w: box.w, h: box.h }
      if (obstacles.some((o) => hits(at, o, gap - eps))) continue
      best = { x, y }
      bestD = d
    }
  }
  return best
}

/** The biggest part of the screen with none of `obstacles` in it (same `margin` and `gap` as clearSpot). */
export function clearArea(screen: { w: number; h: number }, obstacles: Rect[], margin = 12, gap = 8): Rect {
  const xs = [...new Set([margin, screen.w - margin, ...obstacles.flatMap((o) => [o.x - gap, o.x + o.w + gap])])].filter((v) => v >= margin && v <= screen.w - margin).sort((a, b) => a - b)
  const ys = [...new Set([margin, screen.h - margin, ...obstacles.flatMap((o) => [o.y - gap, o.y + o.h + gap])])].filter((v) => v >= margin && v <= screen.h - margin).sort((a, b) => a - b)
  let best: Rect = { x: margin, y: margin, w: 0, h: 0 }
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const w = xs[j] - xs[i]
      // only the obstacles in this column matter
      const inCol = obstacles.filter((o) => o.x - gap < xs[j] - 1e-6 && o.x + o.w + gap > xs[i] + 1e-6)
      for (let k = 0; k < ys.length; k++) {
        for (let l = k + 1; l < ys.length; l++) {
          const h = ys[l] - ys[k]
          if (w * h <= best.w * best.h) continue
          if (inCol.some((o) => o.y - gap < ys[l] - 1e-6 && o.y + o.h + gap > ys[k] + 1e-6)) continue
          best = { x: xs[i], y: ys[k], w, h }
        }
      }
    }
  }
  return best
}

/**
 * The camera that shows `focus` (page space: the lines of the problem) in the clear part of a
 * `screen`-sized notebook, with `obstacles` (screen px) lying over it. The zoom never changes. The
 * page does not move if the lines are already in the clear, and otherwise slides the shortest way.
 * Lines that cannot all fit at this zoom are shown from their start, and the ones kept are those
 * next to `latest` (page space: the last thing the student wrote; without it, the last lines).
 * `also` (page space) is shown with the lines if the page has to move anyway and both fit.
 * tldraw's camera: screen = (page + camera) * z.
 */
export function panFor(focus: Rect, latest: Rect | null, cam: Camera, screen: { w: number; h: number }, obstacles: Rect[], also: Rect[] = [], margin = 12, gap = 8): Camera {
  const z = cam.z > 0 && Number.isFinite(cam.z) ? cam.z : 1
  const toScreen = (r: Rect): Rect => ({ x: (r.x + cam.x) * z, y: (r.y + cam.y) * z, w: r.w * z, h: r.h * z })
  let box = toScreen(focus)
  const here = clearSpot(box, screen, obstacles, margin, gap)
  if (here && Math.abs(here.x - box.x) < 0.5 && Math.abs(here.y - box.y) < 0.5) return { ...cam } // the lines are in the clear: nothing moves
  if (also.length) {
    // the page has to move: the tutor's marks and question on those lines come along when there is room for them too
    const wide = toScreen(also.reduce(union, focus))
    const at = clearSpot(wide, screen, obstacles, margin, gap)
    if (at) return { x: cam.x + (at.x - wide.x) / z, y: cam.y + (at.y - wide.y) / z, z: cam.z }
  }
  let spot = clearSpot(box, screen, obstacles, margin, gap)
  if (!spot) {
    const area = clearArea(screen, obstacles, margin, gap)
    const w = Math.min(box.w, area.w)
    const h = Math.min(box.h, area.h)
    let y = box.y + box.h - h
    if (latest && h < box.h) {
      const l = toScreen(latest)
      // the window ends just under the latest writing, and never leaves the problem
      y = clamp(l.y + l.h - h, box.y, box.y + box.h - h)
    }
    box = { x: box.x, y, w, h }
    spot = clearSpot(box, screen, obstacles, margin, gap) ?? { x: area.x, y: area.y }
  }
  return { x: cam.x + (spot.x - box.x) / z, y: cam.y + (spot.y - box.y) / z, z: cam.z }
}

/** Rects that are not inside another one of the list, each cut to the screen; empty ones dropped. */
export function obstacleRects(rects: Rect[], screen: { w: number; h: number }): Rect[] {
  const cut = rects.flatMap((r) => {
    const x = Math.max(0, r.x)
    const y = Math.max(0, r.y)
    const w = Math.min(screen.w, r.x + r.w) - x
    const h = Math.min(screen.h, r.y + r.h) - y
    return w > 1 && h > 1 ? [{ x, y, w, h }] : []
  })
  const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
  return cut.filter((r, i) => !cut.some((o, j) => j !== i && inside(r, o) && (!inside(o, r) || j < i)))
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

const touches = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * What must stay in view when a lesson opens: its marker and the writing next to it (`ink` = the
 * student's strokes; those within `reach` of the marker count), never more than `reach` around it.
 */
export function focusRect(marker: Rect, ink: Rect[], reach: number): Rect {
  const near: Rect = { x: marker.x - reach, y: marker.y - reach * 0.5, w: marker.w + reach * 2, h: marker.h + reach }
  let out = marker
  for (const r of ink) if (touches(r, near)) out = union(out, r)
  const x0 = Math.max(out.x, near.x)
  const y0 = Math.max(out.y, near.y)
  const x1 = Math.min(out.x + out.w, near.x + near.w)
  const y1 = Math.min(out.y + out.h, near.y + near.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Side of the lesson marker on the page, in page units: about 34 px on screen when it is placed. */
export function markerSize(zoom: number): number {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1
  return clamp(34 / z, 12, 64)
}

/** Gap between two rects (0 if they touch or overlap). */
function gap(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(dx, dy)
}

/**
 * Where the marker goes. `free` is the empty spot found next to the line (big enough for a whole
 * card, so it may reach well away from the writing); the marker takes the corner of it that is
 * nearest the writing, lined up with it. With no writing around, the spot's top-left.
 */
export function markerSpot(free: Rect, ink: Rect[], size: number): Rect {
  let nearest: Rect | null = null
  let best = Infinity
  for (const r of ink) {
    const d = gap(free, r)
    if (d < best) {
      best = d
      nearest = r
    }
  }
  if (!nearest) return { x: free.x, y: free.y, w: size, h: size }
  return {
    x: clamp(nearest.x, free.x, Math.max(free.x, free.x + free.w - size)),
    y: clamp(nearest.y, free.y, Math.max(free.y, free.y + free.h - size)),
    w: size,
    h: size,
  }
}
