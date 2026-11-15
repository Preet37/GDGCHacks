import { describe, expect, it } from 'vitest'
import { mathToPlain, mathToSpeech, prettyMath } from './text'

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

describe('prettyMath (graph titles)', () => {
  it('writes calculator syntax the way it is written by hand', () => {
    expect(prettyMath('y = x^2 - 4')).toBe('y = x² − 4')
    expect(prettyMath('z = x^2 + y^2')).toBe('z = x² + y²')
    expect(prettyMath('y = x^3 - 4*x')).toBe('y = x³ − 4x')
    expect(prettyMath('y = x^{10}')).toBe('y = x¹⁰')
    expect(prettyMath('y = x^(-1)')).toBe('y = x⁻¹')
    expect(prettyMath('y = sqrt(x)')).toBe('y = √x')
    expect(prettyMath('y = sqrt(x + 1)')).toBe('y = √(x + 1)')
    expect(prettyMath('y = sin(2*pi*x)')).toBe('y = sin(2π·x)')
    expect(prettyMath('z = x*y')).toBe('z = x·y')
    expect(prettyMath('x^2 <= 4, x >= -2')).toBe('x² ≤ 4, x ≥ −2')
  })

  it('leaves what it cannot write properly, and plain words, alone', () => {
    expect(prettyMath('y = e^(x/2)')).toBe('y = e^(x/2)')
    expect(prettyMath('y = 2^x')).toBe('y = 2^x')
    expect(prettyMath('Parabola and its tangent')).toBe('Parabola and its tangent')
    expect(prettyMath('Graph of y = x^2')).toBe('Graph of y = x²')
    expect(prettyMath('')).toBe('')
  })
})

describe('nothing raw reaches the page', () => {
  it('degrees', () => {
    expect(mathToPlain('\\sin 30^\\circ')).toBe('sin 30°')
    expect(mathToPlain('\\sin 30^{\\circ}')).toBe('sin 30°')
    expect(mathToPlain('Remember $\\sin 30^\\circ = \\frac{1}{2}$.')).toBe('Remember sin 30° = 1/2.')
    expect(mathToPlain('Use \\sin 30^{\\circ} here.')).toBe('Use sin 30° here.')
    expect(mathToPlain('45\\degree and 60^\\degree')).toBe('45° and 60°')
    expect(mathToPlain('angle \\to -90\\circ')).toBe('angle → −90°')
    expect(mathToPlain('\\sin 30^\\\\circ')).toBe('sin 30°') // a doubled backslash
    expect(mathToPlain('90^\\circ\\text{ angle}')).toBe('90° angle')
    expect(mathToPlain('f \\circ g')).toBe('f ∘ g') // composition is still composition
    expect(mathToSpeech('\\sin 30^\\circ')).toBe('sin 30°')
  })

  it('a cut-off power leaves no caret or backslash', () => {
    expect(mathToPlain('sin 30^\\.')).toBe('sin 30.')
    expect(mathToPlain('Try sin 30^\\')).toBe('Try sin 30')
    expect(mathToPlain('x^\\prime + y')).toBe('x′ + y')
    expect(mathToPlain("f^{\\prime\\prime}(x)")).toBe('f′′(x)')
  })

  it('spacing commands', () => {
    expect(mathToPlain('a\\,b\\;c\\!d\\quad e')).toBe('a b c d e')
    expect(mathToPlain('\\int_0^1 x^2 \\, dx')).toBe('∫_0¹ x² dx')
    expect(mathToPlain('5\\,\\mathrm{kg}')).toBe('5 kg')
    expect(mathToPlain('a \\\\ b')).toBe('a b')
    expect(mathToPlain('a \\\\[4pt] b')).toBe('a b')
    expect(mathToPlain('\\phantom{0}x \\hspace{1em} y')).toBe('x y')
  })

  it('\\left and \\right, with any bracket', () => {
    expect(mathToPlain('\\left(\\frac{a}{b}\\right)^2')).toBe('(a/b)²')
    expect(mathToPlain('\\left\\{ 1, 2 \\right\\}')).toBe('{ 1, 2 }')
    expect(mathToPlain('\\left| x \\right| + \\lvert y \\rvert')).toBe('| x | + | y |')
    expect(mathToPlain('\\left\\| v \\right\\|')).toBe('‖ v ‖')
    expect(mathToPlain('\\bigl( x \\bigr)')).toBe('( x )')
  })

  it('written braces, dollars and percent signs are kept', () => {
    expect(mathToPlain('x \\in [0, 1) \\cup \\{2\\}')).toBe('x ∈ [0, 1) ∪ {2}')
    expect(mathToPlain('\\mathbb{R} \\setminus \\{0\\}')).toBe('R ∖ {0}')
    expect(mathToPlain('It costs \\$5, a 20\\% saving')).toBe('It costs $5, a 20% saving')
    expect(mathToSpeech('\\{0\\}')).toBe('{0}')
  })

  it('words with an argument', () => {
    expect(mathToPlain('\\text{area} = \\pi r^2')).toBe('area = π r²')
    expect(mathToPlain('\\textcolor{red}{x} + \\color{blue} y')).toBe('x + y')
    expect(mathToPlain('\\overrightarrow{AB} \\cdot \\vec{v}')).toBe('AB · v')
    expect(mathToPlain('\\bar x + \\hat{y} + \\dot{z}')).toBe('x + y + z')
    expect(mathToPlain('\\binom{n}{k}')).toBe('C(n, k)')
    expect(mathToPlain('a \\stackrel{?}{=} b')).toBe('a = b')
    expect(mathToPlain('\\operatorname{lcm}(a,b)')).toBe('lcm(a,b)')
  })

  it('Greek letters, relations, arrows and big operators', () => {
    expect(mathToPlain('\\theta \\leq \\phi \\geq 2 \\neq 3 \\approx 4 \\to \\infty')).toBe('θ ≤ φ ≥ 2 ≠ 3 ≈ 4 → ∞')
    expect(mathToPlain('a \\leqslant b \\geqslant c \\not= d')).toBe('a ≤ b ≥ c ≠ d')
    expect(mathToPlain('\\sum_{i=1}^{n} i^2')).toBe('Σ_(i=1)ⁿ i²')
    expect(mathToPlain('\\int f(x)\\,dx')).toBe('∫ f(x) dx')
    expect(mathToPlain('p \\Longrightarrow q \\longleftrightarrow r')).toBe('p ⇒ q ↔ r')
    expect(mathToPlain('\\triangle ABC \\cong \\triangle DEF')).toBe('△ ABC ≅ △ DEF')
    expect(mathToPlain('p \\wedge q \\vee r')).toBe('p ∧ q ∨ r')
  })

  it('fractions in every spelling', () => {
    expect(mathToPlain('\\tan\\frac{\\pi}{4}')).toBe('tan π/4')
    expect(mathToPlain('\\frac ab + \\frac{a}b')).toBe('a/b + a/b')
    expect(mathToPlain('\\tfrac12 \\times 4')).toBe('1/2 × 4')
  })

  it('no backslash survives, whatever the command', () => {
    for (const s of ['\\foo{x} + \\bar', '\\begin{cases} x & x>0 \\\\ -x & x<0 \\end{cases}', '\\ 5 \\> \\: x', '\\hline a \\newline b', 'x \\', '\\underbrace{x+y}_{2}', '\\N \\R \\dfrac{}{}']) {
      expect(mathToPlain(s), s).not.toMatch(/\\/)
      expect(prettyMath(s), s).not.toMatch(/\\/)
      expect(mathToSpeech(s), s).not.toMatch(/\\/)
    }
  })
})
