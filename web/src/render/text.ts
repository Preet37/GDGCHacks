/**
 * Notes show inline `$...$` math as plain text for now: drop the dollar signs
 * and the most common LaTeX markup so it reads naturally in handwriting font.
 */
const SYMBOLS: Record<string, string> = {
  cdot: '·',
  times: '×',
  div: '÷',
  pm: '±',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  to: '→',
  rightarrow: '→',
  infty: '∞',
  pi: 'π',
  theta: 'θ',
  alpha: 'α',
  beta: 'β',
  Delta: 'Δ',
}

export function mathToPlain(text: string): string {
  return text
    .replace(/\$/g, '')
    .replace(/\\(?:left|right)(?![a-zA-Z])/g, '')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
    .replace(/\\(cdot|times|div|pm|le|leq|ge|geq|ne|neq|approx|to|rightarrow|infty|pi|theta|alpha|beta|Delta)(?![a-zA-Z])/g, (_, name: string) => SYMBOLS[name])
    .replace(/\\(?:,|;|!|quad)/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}
