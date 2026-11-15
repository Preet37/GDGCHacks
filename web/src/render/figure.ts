import functionPlotModule from 'function-plot'
import { AssetRecordType, createShapeId, type Editor, type TLAsset, type TLShapePartial } from 'tldraw'
import type { Action, FigureSpec } from '../contract'
import { compile } from 'mathjs'
import { aiMeta, cardRect, lineRect, sizesFor } from './actions'
import { prettyMath } from './text'
import { DEFAULT_CONTEXT, FIGURE_BASE_H, FIGURE_BASE_W, type PageRect, type RenderContext } from './geometry'

/** Size the plot is rendered at; the image shape then scales it to the handwriting. */
export const FIGURE_W = FIGURE_BASE_W
export const FIGURE_H = FIGURE_BASE_H

type Surface3dModule = { renderSurface3d: (editor: Editor, action: Action, rect: PageRect) => Promise<void> }
// 3D surfaces live in ./figure3d (three.js, loaded only when needed). The glob resolves to
// nothing if that module isn't there, so the page still builds without it.
const figure3d = import.meta.glob<Surface3dModule>('./figure3d.ts')

// function-plot ships CommonJS with `exports.default`; depending on the bundler's interop the
// default import is either the function or the whole exports object.
type PlotFn = typeof functionPlotModule
const functionPlot: PlotFn =
  typeof functionPlotModule === 'function' ? functionPlotModule : (functionPlotModule as unknown as { default: PlotFn }).default

/**
 * Where a figure goes: beside its box (or the top-right of the sent area if it has none), on the
 * side that has room. About 3.5 line-heights of the handwriting tall, and never less than a
 * third of the screen's shorter side at the current zoom, so it can be read without zooming in.
 */
export function figureRect(action: Action, bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): PageRect {
  const sz = sizesFor(action, bounds, ctx)
  return cardRect(action, bounds, ctx, sz.figureW, sz.figureH)
}

const SAMPLES = 200
const FENCE = 4 // how many interquartile ranges beyond the quartiles still count as "the curve"

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

/**
 * A y window that shows the curves over `xRange`: sample every expression, drop non-finite
 * values, clip extreme outliers (so an asymptote doesn't flatten everything else), pad by 10%.
 * Returns undefined if nothing could be evaluated.
 */
export function sampleYRange(expressions: string[], xRange: [number, number], xLog = false): [number, number] | undefined {
  const [x0, x1] = xRange
  const ys: number[] = []
  for (const expr of expressions) {
    let fn: { evaluate: (scope: { x: number }) => unknown }
    try {
      fn = compile(toPlotExpr(expr))
    } catch {
      continue
    }
    for (let i = 0; i <= SAMPLES; i++) {
      try {
        // on a log axis the samples are spread evenly over the decades
        const x = xLog && x0 > 0 ? x0 * (x1 / x0) ** (i / SAMPLES) : x0 + ((x1 - x0) * i) / SAMPLES
        const y = fn.evaluate({ x })
        if (typeof y === 'number' && Number.isFinite(y)) ys.push(y)
      } catch {
        // undefined at this x (or not a function of x alone): skip the sample
      }
    }
  }
  if (!ys.length) return undefined
  ys.sort((a, b) => a - b)
  const q1 = quantile(ys, 0.25)
  const q3 = quantile(ys, 0.75)
  const iqr = q3 - q1
  let lo = ys[0]
  let hi = ys[ys.length - 1]
  if (iqr > 0) {
    lo = Math.max(lo, q1 - FENCE * iqr)
    hi = Math.min(hi, q3 + FENCE * iqr)
  }
  const pad = hi > lo ? (hi - lo) * 0.1 : Math.max(1, Math.abs(hi) * 0.1)
  return [lo - pad, hi + pad]
}

/** Tidy math.js-ish input for function-plot: `**` -> `^`, implicit `2x` -> `2*x`. */
export function toPlotExpr(expr: string): string {
  return expr
    .replace(/\*\*/g, '^')
    .replace(/^\s*[a-zA-Z]\s*\(\s*x\s*\)\s*=\s*/, '') // "f(x) = ..." -> "..."
    .replace(/^\s*y\s*=\s*/, '')
    .replace(/(?<![A-Za-z_]\d*)(\d)\s*([a-zA-Z(])/g, '$1*$2') // 2x -> 2*x, but log10(x) stays a name
    .replace(/\)\s*([a-zA-Z(\d])/g, ')*$1')
}

/** Render a plot2d spec to an SVG data URL. Throws if function-plot can't parse it. */
export function plot2dToDataUrl(spec: FigureSpec, w = FIGURE_W, h = FIGURE_H): string {
  const xLog = spec.x_log === true && spec.x_range[0] > 0
  const yRange = spec.y_range ?? sampleYRange(spec.expressions, spec.x_range, xLog)
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
      title: spec.title ? prettyMath(spec.title) : spec.title,
      xAxis: xLog ? { type: 'log', domain: spec.x_range } : { domain: spec.x_range },
      yAxis: yRange ? { domain: yRange } : undefined,
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

/** Hand a surface3d figure to ./figure3d, if that module is present. Never throws. */
function drawSurface3d(editor: Editor, action: Action, rect: PageRect) {
  const load = figure3d['./figure3d.ts']
  if (!load) {
    console.warn('figure skipped: no 3D renderer', action.figure)
    return
  }
  load()
    .then((m) => m.renderSurface3d(editor, action, rect))
    .catch((err) => console.warn('figure skipped', action.figure, err))
}

/**
 * Draw every figure action as an image shape (3D surfaces are drawn by ./figure3d, asynchronously).
 * Unsupported or broken specs are skipped. Returns how many figures were drawn (or handed to the 3D renderer).
 */
export function drawFigures(editor: Editor, actions: Action[], bounds: PageRect, ctx: RenderContext = DEFAULT_CONTEXT): number {
  const assets: TLAsset[] = []
  const shapes: TLShapePartial[] = []
  let handed = 0
  for (const action of actions) {
    if (action.type !== 'figure' || !action.figure) continue
    if (action.figure.kind === 'surface3d') {
      drawSurface3d(editor, action, figureRect(action, bounds, ctx))
      handed++
      continue
    }
    if (action.figure.kind !== 'plot2d') continue
    let src: string
    try {
      src = plot2dToDataUrl(action.figure)
    } catch (err) {
      console.warn('figure skipped', action.figure, err)
      continue
    }
    const r = figureRect(action, bounds, ctx)
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
      meta: aiMeta('figure', action.line_id, lineRect(action, bounds, ctx)),
      props: { assetId, w: r.w, h: r.h },
    })
  }
  if (!shapes.length) return handed
  editor.run(
    () => {
      editor.createAssets(assets)
      editor.createShapes(shapes)
    },
    { history: 'ignore', ignoreShapeLock: true },
  )
  return handed + shapes.length
}
