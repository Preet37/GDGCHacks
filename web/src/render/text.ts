/**
 * Notes show inline `$...$` math as plain text for now: drop the dollar signs
 * and the most common LaTeX markup so it reads naturally in handwriting font.
 */
export function mathToPlain(text: string): string {
  return text
    .replace(/\$/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\cdot/g, '·')
    .replace(/\\times/g, '×')
    .replace(/\\(?:,|;|!|quad)/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}
