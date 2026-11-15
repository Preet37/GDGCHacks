/**
 * Notes are plain tldraw text in the handwriting font, so math has to read well without a
 * typesetter: `$...$` and LaTeX markup are dropped, and what Unicode can say properly is said
 * that way (x², x₁, −, no `*`). Anything that can't be converted safely is left as it was.
 */
const SYMBOLS: Record<string, string> = {
  // operators and relations
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '*', star: '*', circ: '∘', bullet: '•',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', ll: '≪', gg: '≫',
  approx: '≈', sim: '~', simeq: '≃', cong: '≅', equiv: '≡', propto: '∝',
  to: '→', rightarrow: '→', longrightarrow: '→', leftarrow: '←', leftrightarrow: '↔', mapsto: '↦',
  Rightarrow: '⇒', implies: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', iff: '⇔',
  infty: '∞', partial: '∂', nabla: '∇', angle: '∠', degree: '°', perp: '⊥', parallel: '∥',
  int: '∫', iint: '∬', oint: '∮', sum: 'Σ', prod: 'Π', prime: '′',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', therefore: '∴', because: '∵',
  dots: '…', ldots: '…', cdots: '…', vdots: '⋮', ell: 'ℓ', hbar: 'ħ', Re: 'Re', Im: 'Im',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', mid: '|', vert: '|',
  // Greek
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', varrho: 'ρ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}
const SYMBOL_RE = new RegExp(`\\\\(${Object.keys(SYMBOLS).join('|')})(?![a-zA-Z])`, 'g')

const SUPER: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺', n: 'ⁿ' }
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' }

const map = (s: string, table: Record<string, string>) => [...s].map((c) => table[c]).join('')

/** A fraction part needs brackets unless it is a single number or name (`5s` is a product: 1/(5s)). */
const fracPart = (s: string) => (/^[\w.]+$/.test(s.trim()) && !/\d[a-zA-Z]/.test(s) ? s.trim() : `(${s.trim()})`)

/** `\\frac{a}{b}` -> `a/b` and `\\sqrt{x}` -> `√(x)`, innermost first so nested ones come out whole. */
function fractionsAndRoots(text: string): string {
  let out = text
  for (let i = 0; i < 8; i++) {
    const next = out
      .replace(/\\[dtc]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}(\s*[\w(\\])?/g, (_, a: string, b: string, after?: string) => {
        const frac = `${fracPart(a)}/${fracPart(b)}`
        return after ? `(${frac})${after}` : frac // (1/2)x, not 1/2x
      })
      .replace(/\\[dtc]?frac\s*(\d)\s*(\d)/g, '$1/$2') // \frac12
      .replace(/\\sqrt\s*\[([^\][{}]*)\]\s*\{([^{}]*)\}/g, (_, n: string, body: string) => `${n === '3' ? '∛' : n === '4' ? '∜' : `${n}√`}(${body})`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
      .replace(/\\sqrt\s*(\w)/g, '√$1')
    if (next === out) break
    out = next
  }
  return out
}

/** Drop LaTeX markup, keep the words and symbols. Carets and underscores are left alone. */
function stripLatex(text: string, spoken = false): string {
  return fractionsAndRoots(
    text
      .replace(/\\(?:left|right|big|Big|bigg|Bigg)(?![a-zA-Z])\.?/g, '')
      .replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|mathsf|mathcal|mathbb|boldsymbol|operatorname|bar|overline|vec|hat|tilde|underline)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°'),
  )
    // read aloud, a Greek letter is its name ("omega"), which is what is left when the backslash goes
    .replace(SYMBOL_RE, (all: string, name: string) => (spoken && /^[α-ωΑ-Ω]$/.test(SYMBOLS[name]) ? all : SYMBOLS[name]))
    .replace(/\\(?:,|;|!|:| |quad|qquad)/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\\([%$#&_{}])/g, '$1')
    .replace(/\\([a-zA-Z]+)/g, '$1')
}

/** Powers and indices that Unicode has characters for: x^2, x^{10}, x^-1, x^n, x_1, x_{12}. Others stay as typed. */
function scripts(text: string): string {
  return text
    .replace(/\^\{([-+]?\d+|n)\}|\^([-+]?\d+)(?!\d|\.\d|\^)|\^n(?![\w(^])/g, (_, braced?: string, bare?: string) => map(braced ?? bare ?? 'n', SUPER))
    .replace(/(?<=[A-Za-zα-ωΑ-Ω)])_\{(\d+)\}|(?<=[A-Za-zα-ωΑ-Ω)])_(\d+)/g, (_, braced?: string, bare?: string) => map(braced ?? bare ?? '', SUB))
    // a longer exponent or index keeps its grouping once the braces go: x^{n+1} -> x^(n+1)
    .replace(/([\^_])\{([^{}]*)\}/g, (_, op: string, body: string) => (/^[\w.]$/.test(body) ? op + body : `${op}(${body})`))
}

/** Tidy one run of math: scripts, `*`, minus signs, and the stray spaces a model puts in `12 x`. */
function tidyMath(math: string): string {
  return scripts(math)
    .replace(/[{}]/g, '')
    .replace(/(\d)(\s*)\*(\s*)(?=\d)/g, '$1$2×$3') // 2*3: a real product
    .replace(/\s*\*\s*/g, '') // 3*x, x*y, 2*(x+1): written side by side
    .replace(/(\d)\s+(?=[a-zA-Z(√π](?![a-zA-Z]))/g, '$1') // "12 x" -> "12x", but not "2 apples"
    .replace(/(^|[\s(=+×·/,])-(?=\s*[\w(√π])/g, '$1−') // leading / unary minus
    .replace(/(^|[(=,]\s*)([±∓])\s+(?=[\w(√π])/g, '$1$2') // a sign, not an operator: x = ±1
    .replace(/(?<=[\w)⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ₀-₉′'π]\s*)-(?=\s*[\w(√π−])/g, '−') // binary minus
}

/** Text with no `$` is treated as math unless it reads as a sentence (two words in a row). */
function looksLikeProse(text: string): boolean {
  return /[A-Za-z]{2,}[\s,.;:!?]+[A-Za-z]{2,}/.test(text) || /[A-Za-z]{2,}[.?!]\s*$/.test(text)
}

/** LaTeX / inline `$math$` -> plain words, for reading aloud: no Unicode tricks. */
export function mathToSpeech(text: string): string {
  return stripLatex(text.replace(/\\[([]|\\[)\]]|\$/g, ''), true)
    .replace(/[{}]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** LaTeX / calculator notation / inline `$math$` -> text that reads naturally in the handwriting font. */
export function mathToPlain(text: string): string {
  text = text.replace(/\\[([]|\\[)\]]/g, '$') // \( ... \) and \[ ... \] mark math just as $ ... $ does
  let out: string
  if (text.includes('$')) {
    // math is marked: tidy inside the dollars, only make safe changes to the words around it
    out = text
      .split('$')
      .map((part, i) => (i % 2 === 1 ? tidyMath(stripLatex(part)) : scripts(stripLatex(part)).replace(/[{}]/g, '')))
      .join('')
  } else {
    const plain = stripLatex(text)
    out = looksLikeProse(plain) ? scripts(plain).replace(/[{}]/g, '') : tidyMath(plain)
  }
  return out.replace(/ {2,}/g, ' ').trim()
}
