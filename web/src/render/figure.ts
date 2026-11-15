import functionPlotModule from 'function-plot'
import { AssetRecordType, createShapeId, type Editor, type TLAsset, type TLShapePartial } from 'tldraw'
import type { Action, FigureSpec } from '../contract'
import { compile } from 'mathjs'
import { aiMeta, cardRect, lineRect, sizesFor } from './actions'
import { renderCircuit } from './circuit'
import { fbdToDataUrl } from './fbd'
import { prettyMath } from './text'
import { DEFAULT_CONTEXT, FIGURE_BASE_H, FIGURE_BASE_W, type PageRect, type RenderContext } from './geometry'

/** Size the plot is rendered at; the image shape then scales it to the handwriting. */
export const FIGURE_W = FIGURE_BASE_W
export const FIGURE_H = FIGURE_BASE_H

type Surface3dModule = { renderSurface3d: (editor: Editor, action: Action, rect: PageRect) => Promise<void> }
// 3D surfaces live in ./figure3d (three.js, loaded only when needed). The glob resolves to
// nothing if that module isn't there, so the page still builds without it.
const figure3d = import.meta.glob<Surface3dModule>('./figure3d.ts')

/** Must match Model3dShapeUtil.type (web/src/shapes/Model3dShape.tsx, registered in App.tsx). */
export const MODEL3D_TYPE = 'model3d'
/** A model needs room to be turned and read: never smaller than this. */
export const MODEL3D_MIN_W = 520
export const MODEL3D_MIN_H = 460

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

/** Put a model3d card on the page. Never throws; false if the action has no model to show. */
export function drawModel3d(editor: Editor, action: Action, rect: PageRect): boolean {
  const model = action.figure?.model3d
  // no parts but a subject: the card builds it (POST /api/model3d)
  if (!model || !Array.isArray(model.parts) || (!model.parts.length && !model.subject)) return false
  try {
    editor.run(
      () =>
        editor.createShapes([
          {
            id: createShapeId(),
            type: MODEL3D_TYPE,
            x: rect.x,
            y: rect.y,
            meta: aiMeta('figure', action.line_id),
            props: {
              w: Math.max(MODEL3D_MIN_W, rect.w),
              h: Math.max(MODEL3D_MIN_H, rect.h),
              title: action.figure?.title ?? '',
              model: JSON.parse(JSON.stringify(model)),
            },
          },
        ]),
      { history: 'ignore', ignoreShapeLock: true },
    )
    return true
  } catch (err) {
    console.warn('model3d figure skipped', action.figure, err)
    return false
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
    .catch((err) => {
      console.warn('figure skipped', action.figure, err)
      // most often: the site was redeployed while this page was open, and the old 3D code is gone
      notice("Couldn't load the 3D view. Reload the page and ask again.")
    })
}

/** Tell the student something from the drawing code (shown by TutorOverlay). `reload` offers a Reload button. */
export function notice(message: string, reload = true) {
  try {
    window.dispatchEvent(new CustomEvent('tutor-notice', { detail: { message, reload } }))
  } catch {
    // no window (tests)
  }
}

/** A figure drawn where the student isn't looking is no use: bring it into view if most of it is off screen. */
function bringIntoView(editor: Editor, r: PageRect) {
  try {
    const v = editor.getViewportPageBounds()
    const w = Math.max(0, Math.min(r.x + r.w, v.x + v.w) - Math.max(r.x, v.x))
    const h = Math.max(0, Math.min(r.y + r.h, v.y + v.h) - Math.max(r.y, v.y))
    if (w * h >= 0.6 * r.w * r.h) return
    const zoom = editor.getZoomLevel()
    const pad = 24 / zoom
    const x = r.x + r.w + pad > v.x + v.w ? r.x + r.w + pad - v.w : r.x - pad < v.x ? r.x - pad : v.x
    const y = r.y + r.h + pad > v.y + v.h ? r.y + r.h + pad - v.h : r.y - pad < v.y ? r.y - pad : v.y
    editor.setCamera({ x: -x, y: -y, z: zoom }, { animation: { duration: 300 } })
  } catch (err) {
    console.warn('could not bring the figure into view', err)
  }
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
      const r3 = figureRect(action, bounds, ctx)
      drawSurface3d(editor, action, r3)
      bringIntoView(editor, r3)
      handed++
      continue
    }
    if (action.figure.kind === 'model3d') {
      // a structure to turn and tap (Part 2): its own card, the 3D scene loads when it mounts
      if (drawModel3d(editor, action, figureRect(action, bounds, ctx))) handed++
      continue
    }
    if (action.figure.kind === 'circuit') {
      // x-ray labels on the student's drawing + the what-if card (Part 2)
      if (renderCircuit(editor, action, bounds, ctx)) handed++
      continue
    }
    const kind = action.figure.kind
    if (kind !== 'plot2d' && kind !== 'fbd') continue // a kind this page doesn't know is skipped, never a crash
    if (kind === 'fbd' && !action.figure.fbd) continue
    let src: string
    try {
      // fbd: the clean free-body diagram (Part 2), drawn and placed like a graph
      src = kind === 'fbd' ? fbdToDataUrl(action.figure.fbd!, action.figure.title) : plot2dToDataUrl(action.figure)
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
    bringIntoView(editor, r)
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
