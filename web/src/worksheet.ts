import { AssetRecordType, createShapeId, type Editor, type TLAsset, type TLShapePartial } from 'tldraw'

/** Width of an imported worksheet page on the canvas, in page units. */
export const SHEET_W = 900
export const SHEET_GAP = 40
/** Render resolution: pixels per page unit, so printed text stays sharp when zoomed. */
const RENDER_DENSITY = 1.6

export interface SheetSize {
  w: number
  h: number
}

/** Stack pages top to bottom starting at `origin`, each scaled to SHEET_W wide. */
export function layoutSheets(pages: SheetSize[], origin: { x: number; y: number }) {
  let y = origin.y
  return pages.map((p) => {
    const h = (p.h / p.w) * SHEET_W
    const rect = { x: origin.x, y, w: SHEET_W, h }
    y += h + SHEET_GAP
    return rect
  })
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
 * Render every page of a PDF to an image and lay it on the canvas as a locked background
 * (not tutor feedback, so it is included in the exported image Gemini reads).
 */
export async function importPdf(editor: Editor, file: File) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const images: { src: string; size: SheetSize }[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: (SHEET_W * RENDER_DENSITY) / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    images.push({ src: canvas.toDataURL('image/png'), size: { w: viewport.width, h: viewport.height } })
  }
  await doc.destroy()

  const view = editor.getViewportPageBounds()
  const rects = layoutSheets(
    images.map((i) => i.size),
    { x: view.x + Math.max(0, (view.w - SHEET_W) / 2), y: view.y + 40 },
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
}
