/** Where a character sits relative to the line it is written on. */
export type CharClass =
  | 'small' // as tall as an x, standing on the baseline: a c e m n o r s u v w x z
  | 'tall' // digits, capitals, letters with an ascender: standing on the baseline
  | 'hang' // letters with a descender: g j p q y
  | 'float' // operators, written around the middle of the line: + - = < >
  | 'bracket' // brackets and tall signs, taller than the text around them
  | 'high' // primes and quotes
  | 'low' // full stop, comma

const SMALL = 'acemnorsuvwxz'
const HANG = 'gjpqy'
const FLOAT = '+-=<>*~±×·≠≤≥→−'
const BRACKET = '()[]{}|/\\∫√Σ'
const HIGH = '\'"`^′’'
const LOW = '.,'

export function classOf(char: string): CharClass {
  if (SMALL.includes(char)) return 'small'
  if (HANG.includes(char)) return 'hang'
  if (FLOAT.includes(char)) return 'float'
  if (BRACKET.includes(char)) return 'bracket'
  if (HIGH.includes(char)) return 'high'
  if (LOW.includes(char)) return 'low'
  return 'tall'
}

/** Stands on the baseline, so its bottom edge says where the baseline is. */
export function sits(char: string): boolean {
  const c = classOf(char)
  return c === 'small' || c === 'tall'
}
