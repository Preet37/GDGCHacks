import functionPlotModule from 'function-plot'
import { AssetRecordType, createShapeId, type Editor, type TLAsset, type TLShapePartial } from 'tldraw'
import type { Action, FigureSpec } from '../contract'
import { aiMeta } from './actions'
import { beside, boxToPage, type PageRect } from './geometry'

export const FIGURE_W = 360
export const FIGURE_H = 260
const GAP = 16

// function-plot ships CommonJS with `exports.default`; depending on the bundler's interop the
// default import is either the function or the whole exports object.
type PlotFn = typeof functionPlotModule
const functionPlot: PlotFn =
  typeof functionPlotModule === 'function' ? functionPlotModule : (functionPlotModule as unknown as { default: PlotFn }).default

/** Where a figure goes: beside its box (or the top-right of the sent area if it has none). */
export function figureRect(action: Action, bounds: PageRect): PageRect {
  const r = action.box ? boxToPage(action.box, bounds) : { x: bounds.x + bounds.w, y: bounds.y, w: 0, h: 0 }
  const at = beside(r, action.side ?? 'right', GAP)
  return { x: at.x, y: at.y, w: FIGURE_W, h: FIGURE_H }
}

/** Tidy math.js-ish input for function-plot: `**` -> `^`, implicit `2x` -> `2*x`. */
export function toPlotExpr(expr: string): string {
  return expr
    .replace(/\*\*/g, '^')
    .replace(/^\s*[a-zA-Z]\s*\(\s*x\s*\)\s*=\s*/, '') // "f(x) = ..." -> "..."
    .replace(/^\s*y\s*=\s*/, '')
    .replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2')
    .replace(/\)\s*([a-zA-Z(\d])/g, ')*$1')
}

/** Render a plot2d spec to an SVG data URL. Throws if function-plot can't parse it. */
export function plot2dToDataUrl(spec: FigureSpec, w = FIGURE_W, h = FIGURE_H): string {
  const target = document.createElement('div')
  target.style.cssText = 'position:absolute;left:-10000px;top:0'
  document.body.appendChild(target)
  try {
    functionPlot({
      target,
      width: w,
      height: h,
      grid: true,
      disableZoom: true,
      title: spec.title,
      xAxis: { domain: spec.x_range },
      yAxis: spec.y_range ? { domain: spec.y_range } : undefined,
      data: spec.expressions.map((e) => ({ fn: toPlotExpr(e), graphType: 'polyline' as const, sampler: 'builtIn' as const })),
    })
    const svg = target.querySelector('svg')
    if (!svg) throw new Error('function-plot produced no svg')
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    // white card behind the plot so it reads on the page
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', '100%')
    bg.setAttribute('height', '100%')
    bg.setAttribute('fill', '#fff')
    svg.insertBefore(bg, svg.firstChild)
    // function-plot's stylesheet doesn't travel with the serialized svg; inline what matters
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = 'text{font-family:system-ui,sans-serif} .title{font-size:16px} .line{stroke-width:2.5px}'
    svg.insertBefore(style, svg.firstChild)
    const xml = new XMLSerializer().serializeToString(svg)
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
  } finally {
    target.remove()
  }
}

/** Draw every figure action as an image shape. Unsupported or broken specs are skipped. */
export function drawFigures(editor: Editor, actions: Action[], bounds: PageRect) {
  const assets: TLAsset[] = []
  const shapes: TLShapePartial[] = []
  for (const action of actions) {
    if (action.type !== 'figure' || action.figure?.kind !== 'plot2d') continue // surface3d: tonight
    let src: string
    try {
      src = plot2dToDataUrl(action.figure)
    } catch (err) {
      console.warn('figure skipped', action.figure, err)
      continue
    }
    const r = figureRect(action, bounds)
    const assetId = AssetRecordType.createId()
    assets.push(
      AssetRecordType.create({
        id: assetId,
        type: 'image',
        props: { name: 'figure.svg', src, w: r.w, h: r.h, mimeType: 'image/svg+xml', isAnimated: false },
      }),
    )
    shapes.push({
      id: createShapeId(),
      type: 'image',
      x: r.x,
      y: r.y,
      meta: aiMeta('figure', action.line_id),
      props: { assetId, w: r.w, h: r.h },
    })
  }
  if (!shapes.length) return
  editor.run(
    () => {
      editor.createAssets(assets)
      editor.createShapes(shapes)
    },
    { history: 'ignore', ignoreShapeLock: true },
  )
}
