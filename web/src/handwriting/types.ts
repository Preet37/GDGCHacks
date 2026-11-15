/** A pen point. `z` is pressure (0..1) when the pen reported it. */
export interface Pt {
  x: number
  y: number
  z?: number
}

/** One pen stroke: pen down to pen up. */
export type Stroke = Pt[]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
