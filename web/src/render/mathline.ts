import katex from 'katex'
import { CHAR_EM, TEXT_LINE_HEIGHT } from './geometry'
import { mathToPlain } from './text'

/** The tldraw shape type of one typeset line of math (see ../shapes/MathShape). */
export const MATH_TYPE = 'mathline'

/**
 * CSS font size of a typeset line over the font size of a handwriting-font text line. KaTeX draws
 * its glyphs at 1.21x the CSS size, so 0.9 gives letters about as tall as the handwriting font's
 * and a plain line about as tall as a text line (1.2 x 1.21 x 0.9 = 1.31 against 1.35).
 */
export const MATH_EM = 0.9

/** LaTeX that plain text can't show: stacked fractions, roots, big operators, accents, matrices. */
const STRUCTURE = /\\(?:[dtc]?frac|sqrt|binom|int|iint|oint|sum|prod|lim|over|begin|overline|bar|vec|hat|widehat|overrightarrow|underbrace|overbrace|stackrel|overset|underset)(?![a-zA-Z])/

/**
 * Does this step need a typesetter? Yes for a fraction, a root, an integral and the like, and for
 * a power or index Unicode has no characters for (x^{n+1}, a_{ij}); no for `3x^2 = 3`, `x = \pm 1`.
 */
export function needsTypeset(tex: string): boolean {
  return STRUCTURE.test(tex) || /[\^_]/.test(mathToPlain(tex))
}

const FUNCS = /^(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|ln|log|exp|lim|max|min|gcd)([xyzu]?)$/
/** Short words that are words, not products of letters (`at`, `as` and the like are left out: v = u + at). */
const WORDS = new Set(['or', 'and', 'so', 'if', 'then', 'is', 'are', 'not', 'no', 'all', 'any', 'let', 'the', 'of', 'to', 'by', 'we', 'in', 'on', 'it', 'for', 'but', 'has', 'get', 'use', 'add', 'now', 'set', 'two', 'one'])
const wordy = (w: string) => w.length >= 4 || WORDS.has(w.toLowerCase())

/** What KaTeX's text mode needs escaped. */
const textArg = (s: string) =>
  s
    .replace(/\\/g, '\\textbackslash ')
    .replace(/[{}$%#&_]/g, (c) => `\\${c}`)
    .replace(/\^/g, '\\textasciicircum ')
    .replace(/~/g, '\\textasciitilde ')

/** Commands whose braces hold a name or words, not math: left as they are. */
const PROTECTED = /\\(?:text[a-z]*|math[a-z]+|operatorname\*?|begin|end|mbox|hbox|color|textcolor|tag)\s*(?:\{[^{}]*\})+|\\[a-zA-Z]+|\\[^a-zA-Z]/g

/** Words written among the math without `\text` (x = 2 or x = 3; sin x) are set as words, with their spaces. */
function wordsInMath(math: string): string {
  let out = ''
  let at = 0
  const free = (chunk: string) =>
    chunk.replace(/[A-Za-z]{2,}(?:[ \t]+[A-Za-z]{2,})*/g, (run, offset: number) => {
      const words = run.split(/\s+/)
      const before = /\s/.test(chunk[offset - 1] ?? '') ? ' ' : ''
      const after = /\s/.test(chunk[offset + run.length] ?? '') ? ' ' : ''
      if (words.length === 1) {
        const fn = FUNCS.exec(run)
        if (fn) return `\\${fn[1]} ${fn[2]}`
        return wordy(run) ? `\\text{${before}${run}${after}}` : run
      }
      return words.some(wordy) ? `\\text{${before}${words.join(' ')}${after}}` : run
    })
  for (const m of math.matchAll(PROTECTED)) {
    out += free(math.slice(at, m.index)) + m[0]
    at = m.index + m[0].length
  }
  return out + free(math.slice(at))
}

/**
 * A step as the server sends it (LaTeX, perhaps with `$...$` among words) as one KaTeX expression.
 * Fractions are full size (\displaystyle), words stay words.
 */
export function stepTex(step: string): string {
  const s = step.trim().replace(/\\[([]|\\[)\]]/g, '$')
  let body: string
  if (s.includes('$')) {
    body = s
      .split('$')
      .map((part, i) => {
        if (i % 2 === 1) return wordsInMath(part)
        if (!part) return ''
        if (/[\\^_=]/.test(part)) return wordsInMath(part) // math outside the dollars: its words are still set as words
        const lead = /^\s/.test(part) ? ' ' : ''
        const trail = /\s$/.test(part) ? ' ' : ''
        return `\\text{${lead}${textArg(mathToPlain(part))}${trail}}`
      })
      .join('')
  } else {
    body = wordsInMath(s)
  }
  // a bare % starts a comment in TeX and would silently drop the rest of the line
  return `\\displaystyle ${body.replace(/(?<!\\)%/g, '\\%')}`
}

/** KaTeX HTML for one line, or null if KaTeX can't typeset it. */
export function texHtml(tex: string): string | null {
  try {
    return katex.renderToString(tex, { displayMode: false, throwOnError: true, output: 'html', strict: 'ignore', trust: false })
  } catch {
    return null
  }
}

export interface MathBox {
  /** page units */
  w: number
  h: number
  /** centre x of the first equals sign that isn't inside a fraction, a root or a script; null if there is none */
  eq: number | null
}

/** Size of the typeset `tex` (as from stepTex) when the text beside it is `font` px. */
export type MathMeasure = (tex: string, font: number) => MathBox

/** How many fractions are stacked inside one another at the deepest point. */
function fracDepth(tex: string): number {
  let best = 0
  const open: boolean[] = [] // per brace: is it the numerator or denominator of a fraction?
  let depth = 0
  let pending = 0 // brace groups the last \frac still has to open
  const re = /\\[dtc]?frac(?![a-zA-Z])|\\[a-zA-Z]+|\\.|[{}]/g
  for (const m of tex.matchAll(re)) {
    const t = m[0]
    if (/^\\[dtc]?frac$/.test(t)) {
      pending = 2
      best = Math.max(best, depth + 1)
    } else if (t === '{') {
      const part = pending > 0
      open.push(part)
      if (part) depth++
    } else if (t === '}') {
      if (open.pop()) {
        depth--
        pending = pending > 0 ? pending - 1 : 0
      }
    }
  }
  return best
}

/** The size without a browser to ask (tests, a page not yet laid out): from the flattened text. */
export const estimateMath: MathMeasure = (tex, font) => {
  const plain = mathToPlain(tex.replace(/\\displaystyle(?![a-zA-Z])/g, ''))
  const fracs = fracDepth(tex)
  const tall = fracs > 0 ? 2 + (fracs - 1) * 0.9 : /\\(?:sqrt|int|iint|oint|sum|prod|binom|begin)(?![a-zA-Z])/.test(tex) ? 1.3 : 1
  const char = font * CHAR_EM * 0.85
  const i = plain.indexOf('=')
  return { w: Math.max(char, plain.length * char), h: font * TEXT_LINE_HEIGHT * tall, eq: i < 0 ? null : (i + 0.5) * char }
}

/** The styles a typeset line is drawn (and measured) with; `size` is the CSS font size. */
export function mathBoxStyle(size: number, color: string): Record<string, string | number> {
  return { display: 'inline-block', fontSize: `${size}px`, lineHeight: 0, whiteSpace: 'nowrap', color, margin: 0, padding: 0 }
}

/** CSS px the lines are measured at; sizes scale with the font. */
const REF = 40

function measureInDom(tex: string): MathBox | null {
  const html = texHtml(tex)
  if (!html) return null
  const el = document.createElement('div')
  Object.assign(el.style, mathBoxStyle(REF, '#000'), { position: 'absolute', left: '-99999px', top: '0', visibility: 'hidden', pointerEvents: 'none' })
  el.style.lineHeight = '0'
  el.innerHTML = html
  document.body.appendChild(el)
  try {
    const r = el.getBoundingClientRect()
    if (!(r.width > 0) || !(r.height > 0)) return null
    let eq: number | null = null
    for (const rel of el.querySelectorAll('.mrel')) {
      if (rel.textContent !== '=' || rel.closest('.mfrac, .sqrt, .msupsub, .mop')) continue
      const b = rel.getBoundingClientRect()
      eq = b.left + b.width / 2 - r.left
      break
    }
    return { w: r.width, h: r.height, eq }
  } finally {
    el.remove()
  }
}

let fontsAsked = false
/** Fetch KaTeX's fonts before the first line is measured (they load only when first used otherwise). */
export function preloadMathFonts() {
  if (fontsAsked || typeof document === 'undefined' || !document.fonts?.load) return
  fontsAsked = true
  for (const f of ['KaTeX_Main', 'italic 16px KaTeX_Math', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4', 'bold 16px KaTeX_Main', 'italic 16px KaTeX_Main']) {
    void document.fonts.load(f.includes('px') ? f : `16px ${f}`).catch(() => {})
  }
}

const measured = new Map<string, MathBox | null>()

/** Size of a typeset line as the browser lays it out; the estimate where there is no layout (tests). */
export function domMathMeasure(): MathMeasure {
  if (typeof document === 'undefined' || !document.body) return estimateMath
  preloadMathFonts()
  return (tex, font) => {
    let box: MathBox | null | undefined
    try {
      box = measured.get(tex)
      if (box === undefined) {
        box = measureInDom(tex)
        // a size taken before the fonts were there is not kept
        if (!box || document.fonts?.check?.('16px KaTeX_Main')) measured.set(tex, box)
      }
    } catch {
      box = null
    }
    if (!box) return estimateMath(tex, font)
    const k = (font * MATH_EM) / REF
    return { w: box.w * k + 1, h: box.h * k, eq: box.eq === null ? null : box.eq * k }
  }
}

/** Shapes just put on the page by a step-by-step reveal: each is wiped on once, when first drawn. */
export const freshMath = new Set<string>()
