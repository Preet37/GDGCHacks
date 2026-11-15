import { AssetRecordType, createShapeId, type Editor, type TLAsset, type TLShapePartial } from 'tldraw'

/** Pixel width a worksheet page is rendered at, so printed text stays sharp when zoomed. */
const RENDER_W = 1440
/** A page takes this much of the viewport width, at whatever zoom the student is at. */
export const SHEET_VIEW_FRACTION = 0.9
/** Space between pages, and between the worksheet and anything already on the canvas, as a fraction of the page width. */
export const SHEET_GAP_FRACTION = 0.045

export interface SheetSize {
  w: number
  h: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Stack pages top to bottom starting at `origin`, each scaled to `width` wide. */
export function layoutSheets(pages: SheetSize[], origin: { x: number; y: number }, width: number, gap = width * SHEET_GAP_FRACTION): Rect[] {
  let y = origin.y
  return pages.map((p) => {
    const h = (p.h / p.w) * width
    const rect = { x: origin.x, y, w: width, h }
    y += h + gap
    return rect
  })
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Where imported pages go: never on top of what is already there (`occupied` = bounds of every
 * shape on the page). In the viewport if that spot is free; otherwise the closest free spot
 * just outside all existing content (below, right, left or above it). Pages are sized to fill
 * most of the viewport width.
 */
export function placeSheets(pages: SheetSize[], view: Rect, occupied: Rect[]): Rect[] {
  const width = view.w * SHEET_VIEW_FRACTION
  const gap = width * SHEET_GAP_FRACTION
  const size = layoutSheets(pages, { x: 0, y: 0 }, width, gap)
  const height = size.length ? size[size.length - 1].y + size[size.length - 1].h : 0
  const here = { x: view.x + (view.w - width) / 2, y: view.y + gap }
  const blockAt = (o: { x: number; y: number }): Rect => ({ x: o.x - gap, y: o.y - gap, w: width + gap * 2, h: height + gap * 2 })
  const free = (o: { x: number; y: number }) => !occupied.some((r) => overlaps(r, blockAt(o)))

  let origin = here
  if (!free(here)) {
    const minX = Math.min(...occupied.map((r) => r.x))
    const minY = Math.min(...occupied.map((r) => r.y))
    const maxX = Math.max(...occupied.map((r) => r.x + r.w))
    const maxY = Math.max(...occupied.map((r) => r.y + r.h))
    const options = [
      { x: here.x, y: maxY + gap }, // below everything
      { x: maxX + gap, y: here.y }, // right of everything
      { x: minX - gap - width, y: here.y }, // left of everything
      { x: here.x, y: minY - gap - height }, // above everything
    ]
    const far = (o: { x: number; y: number }) => Math.hypot(o.x - here.x, o.y - here.y)
    origin = options.reduce((best, o) => (far(o) < far(best) ? o : best))
  }
  return layoutSheets(pages, origin, width, gap)
}

export function isWorksheetShape(shape: { meta: Record<string, unknown> }): boolean {
  return shape.meta?.worksheet === true
}

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

/**
 * Render every page of a PDF to an image and lay it on a free part of the canvas as a locked background
 * (not tutor feedback, so it is included in the exported image Gemini reads).
 */
export async function importPdf(editor: Editor, file: File) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const images: { src: string; size: SheetSize }[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: RENDER_W / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    images.push({ src: canvas.toDataURL('image/png'), size: { w: viewport.width, h: viewport.height } })
  }
  await doc.destroy()

  const view = editor.getViewportPageBounds()
  const occupied = editor.getCurrentPageShapes().flatMap((s) => {
    const b = editor.getShapePageBounds(s)
    return b ? [{ x: b.x, y: b.y, w: b.w, h: b.h }] : []
  })
  const rects = placeSheets(
    images.map((i) => i.size),
    view,
    occupied,
  )
  const assets: TLAsset[] = []
  const shapes: TLShapePartial[] = []
  images.forEach((img, i) => {
    const r = rects[i]
    const assetId = AssetRecordType.createId()
    assets.push(
      AssetRecordType.create({
        id: assetId,
        type: 'image',
        props: { name: `${file.name} p${i + 1}`, src: img.src, w: img.size.w, h: img.size.h, mimeType: 'image/png', isAnimated: false },
      }),
    )
    shapes.push({
      id: createShapeId(),
      type: 'image',
      x: r.x,
      y: r.y,
      isLocked: true,
      meta: { worksheet: true },
      props: { assetId, w: r.w, h: r.h },
    })
  })
  editor.run(() => {
    editor.createAssets(assets)
    editor.createShapes(shapes)
    editor.sendToBack(shapes.map((s) => s.id!))
  }, { ignoreShapeLock: true })

  // show the first page: its top just under the top of the screen, same zoom
  const first = rects[0]
  if (first) {
    const z = editor.getZoomLevel()
    const left = first.x - (view.w - first.w) / 2
    const top = first.y - first.w * SHEET_GAP_FRACTION
    editor.setCamera({ x: -left, y: -top, z }, { animation: { duration: 250 } })
  }
}
