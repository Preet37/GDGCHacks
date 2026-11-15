/**
 * "Your turn": the practice problem the tutor writes on the page after a lesson. Its shapes are
 * tutor shapes (`meta.ai`), but unlike every other tutor shape the problem itself is part of what
 * the student is working on. This file is the one place that says how each kind of shape is treated.
 */
export const PRACTICE_KIND = 'practice'

/** label = the small "Your turn" line; problem = the problem statement; ask = the start of the student's answer line */
export type PracticeRole = 'label' | 'problem' | 'ask'

type Tagged = { meta?: Record<string, unknown> | null }

export function isPracticeShape(shape: Tagged): boolean {
  return shape.meta?.ai === true && shape.meta.kind === PRACTICE_KIND
}

export function practiceRole(shape: Tagged): PracticeRole | null {
  if (!isPracticeShape(shape)) return null
  const role = shape.meta!.role
  return role === 'problem' || role === 'ask' ? role : 'label'
}

/** A practice line the student works from (the problem, the `ask` line): sent to the server as `given`. */
export function isGivenShape(shape: Tagged): boolean {
  const role = practiceRole(shape)
  return role === 'problem' || role === 'ask'
}

export interface ShapeUse {
  /** drawn into the image sent for a check */
  exported: boolean
  /** counts as writing when the window for a check is grown around what changed */
  working: boolean
  /** the student's own (ink or their worksheet): a change to it is a reason to check, and its strokes teach the handwriting */
  student: boolean
  /** tutor feedback that newer feedback for the same writing replaces */
  replaceable: boolean
}

/**
 * What a shape on the page is to the tutor.
 * - the student's ink and worksheet: sent, part of the working, theirs;
 * - a practice problem / ask line: sent and part of the working (the model must see the problem
 *   above the work), but not the student's and never replaced by feedback;
 * - the "Your turn" label: none of these (it is decoration);
 * - any other tutor shape (notes, circles, graphs, lessons): not sent, replaced by newer feedback.
 */
export function shapeUse(shape: Tagged): ShapeUse {
  if (shape.meta?.ai !== true) return { exported: true, working: true, student: true, replaceable: false }
  const role = practiceRole(shape)
  if (role === 'problem' || role === 'ask') return { exported: true, working: true, student: false, replaceable: false }
  if (role) return { exported: false, working: false, student: false, replaceable: false }
  return { exported: false, working: false, student: false, replaceable: true }
}

/**
 * One LaTeX line in calculator syntax, as far as that can be had simply: fractions, roots, products
 * and grouped powers are rewritten; any other command just loses its backslash.
 */
export function latexToPlain(latex: string): string {
  let out = latex.replace(/\$/g, '').replace(/\\(?:left|right|,|;|!|:| |quad|qquad|displaystyle)(?![a-zA-Z])\.?/g, ' ')
  for (let i = 0; i < 6; i++) {
    const next = out
      .replace(/\\[dtc]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
      .replace(/([\^_])\{([^{}]*)\}/g, (_, op: string, body: string) => (/^[\w.]+$/.test(body) ? op + body : `${op}(${body})`))
    if (next === out) break
    out = next
  }
  return out
    .replace(/\\(?:cdot|times)(?![a-zA-Z])/g, '*')
    .replace(/\\prime(?![a-zA-Z])/g, "'")
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/(\d)\s*(?=[a-zA-Z(])/g, '$1*')
    .replace(/\s+/g, ' ')
    .trim()
}
