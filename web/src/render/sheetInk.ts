import type { Editor } from 'tldraw'
import type { PageRect } from './geometry'

/**
 * Where a worksheet page has something printed on it, as a coarse grid over its image. The
 * reading only lists the printed lines it was asked about; the image itself says where all the
 * text, rules and figures are, so feedback can keep off every one of them.
 */
export interface InkGrid {
  cols: number
  rows: number
  /** summed-area table of "this cell has print in it", (cols + 1) x (rows + 1) */
  sums: Uint32Array
}

/** Cells of the grid: this many across a page. */
export const GRID_COLS = 240
/** A pixel darker than this (0-255 luminance) is print. */
export const PRINT_BELOW = 200

/**
 * Build the grid from RGBA pixels (`w` x `h`): a cell counts as printed if any pixel in it is
 * dark, so thin strokes of small text are not averaged away. Transparent pixels are paper.
 */
export function inkGrid(rgba: ArrayLike<number>, w: number, h: number, cols = GRID_COLS): InkGrid {
  cols = Math.max(1, Math.min(cols, w))
  const rows = Math.max(1, Math.round((h / w) * cols))
  const dark = new Uint8Array(cols * rows)
  for (let y = 0; y < h; y++) {
    const row = Math.min(rows - 1, Math.floor((y * rows) / h))
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (rgba[i + 3] < 128) continue
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
      if (lum < PRINT_BELOW) dark[row * cols + Math.min(cols - 1, Math.floor((x * cols) / w))] = 1
    }
  }
  const sums = new Uint32Array((cols + 1) * (rows + 1))
  for (let r = 0; r < rows; r++) {
    let run = 0
    for (let c = 0; c < cols; c++) {
      run += dark[r * cols + c]
      sums[(r + 1) * (cols + 1) + c + 1] = sums[r * (cols + 1) + c + 1] + run
    }
  }
  return { cols, rows, sums }
}

/** Page area of the printed cells of a worksheet at `sheet` that `r` touches (0 = `r` is over blank paper, or off the page). */
export function printedUnder(grid: InkGrid, sheet: PageRect, r: PageRect): number {
  const cw = sheet.w / grid.cols
  const ch = sheet.h / grid.rows
  const c0 = Math.max(0, Math.floor((r.x - sheet.x) / cw))
  const c1 = Math.min(grid.cols, Math.ceil((r.x + r.w - sheet.x) / cw))
  const r0 = Math.max(0, Math.floor((r.y - sheet.y) / ch))
  const r1 = Math.min(grid.rows, Math.ceil((r.y + r.h - sheet.y) / ch))
  if (c1 <= c0 || r1 <= r0) return 0
  const at = (row: number, col: number) => grid.sums[row * (grid.cols + 1) + col]
  return (at(r1, c1) - at(r0, c1) - at(r1, c0) + at(r0, c0)) * cw * ch
}

const grids = new Map<string, InkGrid | null>() // by image source; null = loading or unreadable

/** Widest the image is drawn for measuring: enough to keep small print, small enough to be quick. */
const MEASURE_W = 960

async function measure(src: string): Promise<InkGrid | null> {
  const img = new Image()
  img.src = src
  await img.decode()
  const w = Math.min(MEASURE_W, img.naturalWidth)
  const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return inkGrid(ctx.getImageData(0, 0, w, h).data, w, h)
}

export interface SheetInk {
  /** worksheet pages, in page units */
  sheets: PageRect[]
  /** page area of print under a rect, over every worksheet whose image has been measured so far */
  printedArea: (r: PageRect) => number
}

/**
 * The worksheet pages on the canvas and what is printed on them. Measuring an image takes a
 * moment the first time, so pages not measured yet count as blank; call this early (when a
 * request is sent) and the grid is there by the time the reply is drawn.
 */
export function sheetInk(editor: Editor): SheetInk {
  const pages: { rect: PageRect; grid: InkGrid | null }[] = []
  for (const s of editor.getCurrentPageShapes()) {
    if (s.meta?.worksheet !== true) continue
    const b = editor.getShapePageBounds(s)
    if (!b) continue
    const assetId = (s.props as { assetId?: string }).assetId
    const asset = assetId ? editor.getAsset(assetId as Parameters<Editor['getAsset']>[0]) : undefined
    const src = (asset?.props as { src?: string | null } | undefined)?.src
    let grid: InkGrid | null = null
    if (src && typeof Image !== 'undefined' && typeof document !== 'undefined') {
      if (grids.has(src)) grid = grids.get(src) ?? null
      else {
        grids.set(src, null)
        measure(src)
          .then((g) => grids.set(src, g))
          .catch((err) => console.warn('worksheet not measured', err))
      }
    }
    pages.push({ rect: { x: b.x, y: b.y, w: b.w, h: b.h }, grid })
  }
  return {
    sheets: pages.map((p) => p.rect),
    printedArea: (r) => pages.reduce((sum, p) => sum + (p.grid ? printedUnder(p.grid, p.rect, r) : 0), 0),
  }
}
