import { describe, expect, it } from 'vitest'
import { mathToPlain, mathToSpeech } from './text'

describe('mathToPlain', () => {
  it('strips dollars and common LaTeX', () => {
    expect(mathToPlain('Which rule handles $x \\sin x$?')).toBe('Which rule handles x sin x?')
    expect(mathToPlain('$\\frac{1}{2}x^{2}$')).toBe('(1/2)x²')
    expect(mathToPlain('\\frac{dy}{dx} = 2x')).toBe('dy/dx = 2x')
    expect(mathToPlain('\\frac{x+1}{x-1}')).toBe('(x+1)/(x−1)')
  })

  it('turns simple LaTeX into readable text', () => {
    expect(mathToPlain('\\text{graph this}')).toBe('graph this')
    expect(mathToPlain('$\\sqrt{x} \\le 2\\pi$')).toBe('√(x) ≤ 2π')
    expect(mathToPlain('$\\left(x \\cdot y\\right) \\to \\infty$')).toBe('(x · y) → ∞')
    expect(mathToPlain('\\int 2x \\, dx')).toBe('∫ 2x dx')
  })

  it('writes simple powers and indices as superscripts and subscripts', () => {
    expect(mathToPlain('x^2 - 5x + 6 = 0')).toBe('x² − 5x + 6 = 0')
    expect(mathToPlain("h'(x) = 3x^2 + x")).toBe("h'(x) = 3x² + x")
    expect(mathToPlain('= x^2 + C')).toBe('= x² + C')
    expect(mathToPlain('2^10 - 1')).toBe('2¹⁰ − 1')
    expect(mathToPlain('$-3x^{-1}$')).toBe('−3x⁻¹')
    expect(mathToPlain('x^2y')).toBe('x²y')
    expect(mathToPlain('x_2')).toBe('x₂')
    expect(mathToPlain('a_{12} + x^n')).toBe('a₁₂ + xⁿ')
  })

  it('drops the stray spaces and stars of calculator notation', () => {
    expect(mathToPlain('3 x^2 + 2')).toBe('3x² + 2')
    expect(mathToPlain('12 x')).toBe('12x')
    expect(mathToPlain('f(x) = 3*x^2 + 2*x')).toBe('f(x) = 3x² + 2x')
    expect(mathToPlain('2*(x + 1)')).toBe('2(x + 1)')
    expect(mathToPlain('3*4')).toBe('3×4')
    expect(mathToPlain('y = -x')).toBe('y = −x')
  })

  it('leaves what it cannot convert safely', () => {
    expect(mathToPlain('e^x')).toBe('e^x')
    expect(mathToPlain('x^{n+1}')).toBe('x^(n+1)') // grouping survives the braces going
    expect(mathToPlain('e^{-x}')).toBe('e^(−x)')
    expect(mathToPlain('x^2.5')).toBe('x^2.5')
    expect(mathToPlain('x^12.5')).toBe('x^12.5')
  })

  it('only touches the math in a sentence', () => {
    expect(mathToPlain('Did you mean h\'(x)?')).toBe("Did you mean h'(x)?")
    expect(mathToPlain('Use the well-known rule for x^3 - not x^2.')).toBe('Use the well-known rule for x³ - not x².')
    expect(mathToPlain('Step 2 is wrong')).toBe('Step 2 is wrong')
    expect(mathToPlain('You have 2 answers - check $3 x - 1$ again')).toBe('You have 2 answers - check 3x − 1 again')
    expect(mathToPlain('Check the derivative of $2x$. What happens to the $x$?')).toBe('Check the derivative of 2x. What happens to the x?')
  })
})

describe('LaTeX the model sends in notes', () => {
  it('writes Greek letters and common commands as Unicode', () => {
    expect(mathToPlain('Find $\\omega$ where the phase is $-180^\\circ$')).toBe('Find ω where the phase is −180°')
    expect(mathToPlain('$\\alpha = \\frac{b}{a} = 4$ and $\\omega = 1$')).toBe('α = b/a = 4 and ω = 1')
    expect(mathToPlain('$\\omega_0 \\pm \\Delta\\omega$, $\\tau \\geq 2\\pi$, $a \\times b \\neq a \\cdot b$')).toBe('ω₀ ± Δω, τ ≥ 2π, a × b ≠ a · b')
    expect(mathToPlain('$\\theta \\approx \\phi$, $x \\in A \\Rightarrow \\lambda \\mu \\sigma \\Omega$')).toBe('θ ≈ φ, x ∈ A ⇒ λ μ σ Ω')
  })

  it('handles nested fractions and roots', () => {
    expect(mathToPlain('Rewrite $G(s)$ in standard Bode form $\\frac{1}{5s(1 + \\frac{s}{5})}$ first')).toBe('Rewrite G(s) in standard Bode form 1/(5s(1 + s/5)) first')
    expect(mathToPlain('$\\omega = \\sqrt{0.5 \\times 2} = 1$')).toBe('ω = √(0.5 × 2) = 1')
    expect(mathToPlain('$\\sqrt{\\frac{a}{b}}$ and $\\sqrt[3]{x}$ and $\\sqrt 2$')).toBe('√(a/b) and ∛(x) and √2')
    expect(mathToPlain('$\\dfrac{s+1}{(s+5)(s+10)}$')).toBe('(s+1)/((s+5)(s+10))')
  })

  it('takes \\( \\) and \\[ \\] as math marks, and drops styling commands', () => {
    expect(mathToPlain('Use \\(\\frac{1}{5s}\\) here')).toBe('Use 1/(5s) here')
    expect(mathToPlain('$\\mathbf{v} = \\vec{a} + \\hat{b}$, $50\\%$')).toBe('v = a + b, 50%')
    expect(mathToPlain('$\\big(x\\big)$')).toBe('(x)')
    expect(mathToPlain('$\\pm 1$')).toBe('±1')
    expect(mathToPlain('$x = \\pm 1$')).toBe('x = ±1')
    expect(mathToPlain('$a \\pm b$')).toBe('a ± b')
  })
})

describe('mathToSpeech', () => {
  it('says Greek letters by name', () => {
    expect(mathToSpeech('Find $\\omega$ and $2\\pi$')).toBe('Find omega and 2pi')
  })

  it('keeps plain characters for the voice', () => {
    expect(mathToSpeech('Try $x^2 - 1$ again')).toBe('Try x^2 - 1 again')
  })
})

describe('LaTeX in worked solution steps', () => {
  it('fractions and roots with powers inside come out whole', () => {
    expect(mathToPlain('\\sqrt{x^{2}+1}')).toBe('√(x²+1)')
    expect(mathToPlain('x = \\frac{x^{2}}{3}')).toBe('x = (x²)/3')
    expect(mathToPlain('\\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}')).toBe('(−b ± √(b² − 4ac))/(2a)')
    expect(mathToPlain('\\sqrt{x^{n+1}}')).toBe('√(x^(n+1))')
  })

  it('drops layout commands', () => {
    expect(mathToPlain('\\displaystyle x &= \\boxed{2}')).toBe('x = 2')
    expect(mathToPlain('\\begin{aligned} x &= 1 \\end{aligned}')).toBe('x = 1')
    expect(mathToPlain('x = \\pm 1')).toBe('x = ±1')
  })
})
