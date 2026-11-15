import 'katex/dist/katex.min.css'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, getColorValue, useColorMode, useEditor, type RecordProps, type TLShape } from 'tldraw'
import { MATH_TYPE, freshMath, mathBoxStyle, preloadMathFonts, texHtml } from '../render/mathline'
import { mathToPlain } from '../render/text'

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    /** One typeset line of math: `tex` is KaTeX input, `size` the CSS font size, `color` a tldraw colour name or a CSS colour. */
    mathline: { w: number; h: number; tex: string; color: string; size: number }
  }
}

export type MathShape = TLShape<typeof MATH_TYPE>

preloadMathFonts()

/** How long a line takes to be wiped on when a solution is revealed step by step. */
const WIPE_MS = 450

function MathLine({ shape }: { shape: MathShape }) {
  const editor = useEditor()
  const mode = useColorMode()
  const ref = useRef<HTMLDivElement>(null)
  const { tex, size, color, w, h } = shape.props
  const html = useMemo(() => texHtml(tex), [tex])
  let ink = color
  try {
    ink = getColorValue(editor.getCurrentTheme().colors[mode], color, 'solid')
  } catch {
    // an unknown colour name is used as it is
  }

  // written on, left to right, the first time a freshly revealed step is drawn
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !freshMath.delete(shape.id)) return
    try {
      el.animate([{ clipPath: 'inset(-10% 100% -10% 0)' }, { clipPath: 'inset(-10% -2% -10% 0)' }], { duration: WIPE_MS, easing: 'ease-out' })
    } catch {
      // no Web Animations: the line just appears
    }
  }, [shape.id])

  // The box was measured when the step was laid out; if that was before the math fonts were
  // there, the line is a little wider or narrower than its box: fit the box to it.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let gone = false
    const fit = () => {
      if (gone || !el.isConnected) return
      const mw = el.offsetWidth
      const mh = el.offsetHeight
      const now = editor.getShape<MathShape>(shape.id)
      if (!now || !(mw > 0) || !(mh > 0)) return
      if (Math.abs(mw - now.props.w) <= 1.5 && Math.abs(mh - now.props.h) <= 1.5) return
      editor.run(() => editor.updateShape({ id: shape.id, type: MATH_TYPE, props: { w: mw + 1, h: mh } }), { history: 'ignore', ignoreShapeLock: true })
    }
    fit()
    void document.fonts?.ready.then(fit).catch(() => {})
    return () => {
      gone = true
    }
  }, [editor, shape.id, tex, size])

  return (
    <div style={{ width: w, height: h, pointerEvents: 'none', userSelect: 'none', overflow: 'visible' }} aria-label={mathToPlain(tex.replace(/\\displaystyle(?![a-zA-Z])/g, ''))}>
      {html ? (
        <div ref={ref} data-mathline style={mathBoxStyle(size, ink)} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div ref={ref} data-mathline style={{ ...mathBoxStyle(size, ink), lineHeight: 1.3 }}>
          {mathToPlain(tex.replace(/\\displaystyle(?![a-zA-Z])/g, ''))}
        </div>
      )}
    </div>
  )
}

/** A line of typeset math the tutor wrote (a step of a worked solution). Not editable; found and replaced by its `meta` like the tutor's text. */
export class MathShapeUtil extends BaseBoxShapeUtil<MathShape> {
  static override type = MATH_TYPE
  static override props: RecordProps<MathShape> = { w: T.number, h: T.number, tex: T.string, color: T.string, size: T.number }

  override getDefaultProps(): MathShape['props'] {
    return { w: 120, h: 30, tex: '', color: 'black', size: 20 }
  }

  override canEdit() {
    return false
  }

  override canResize() {
    return false
  }

  override component(shape: MathShape) {
    return (
      <HTMLContainer style={{ pointerEvents: 'none' }}>
        <MathLine shape={shape} />
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: MathShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
}
