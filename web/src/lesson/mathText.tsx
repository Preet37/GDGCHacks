import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useLayoutEffect, useRef } from 'react'
import { mathToPlain } from '../render/text'
import { splitCaption } from './timing'

/** LaTeX to KaTeX HTML, or null if KaTeX can't typeset it. */
export function texToHtml(tex: string, display: boolean): string | null {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true, output: 'html', strict: 'ignore', trust: false })
  } catch {
    return null
  }
}

/** One line of math, shrunk to fit its box if it is too wide. Plain text if KaTeX can't typeset it. */
export function MathLine({ tex, className }: { tex: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  const html = texToHtml(tex, true)

  useLayoutEffect(() => {
    const b = box.current
    const i = inner.current
    if (!b || !i) return
    i.style.transform = ''
    // a long line or a tall fraction is shrunk to the space the card gives it
    const k = Math.min(b.clientWidth / Math.max(1, i.offsetWidth), b.clientHeight / Math.max(1, i.offsetHeight))
    if (k > 0 && k < 1) i.style.transform = `scale(${k})`
  }, [tex])

  return (
    <div ref={box} className={className} aria-label={mathToPlain(tex)}>
      {html ? (
        <span ref={inner} className="lesson-math-inner" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span ref={inner} className="lesson-math-inner lesson-math-plain">
          {mathToPlain(tex)}
        </span>
      )}
    </div>
  )
}

/** Plain words with inline `$math$`. */
export function Caption({ text }: { text: string }) {
  return (
    <>
      {splitCaption(text).map((part, i) => {
        if (!part.math) return <span key={i}>{part.text}</span>
        const html = texToHtml(part.text, false)
        return html ? <span key={i} dangerouslySetInnerHTML={{ __html: html }} /> : <span key={i}>{mathToPlain(part.text)}</span>
      })}
    </>
  )
}
