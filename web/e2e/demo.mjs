// The README demo set, run for real: each problem written as pen ink on the dev page (its /api proxied
// to a real server), the page's own auto check, and what the tutor drew. Report only; nothing is faked.
//
//   cd web && API_TARGET=https://tutor-api-191803288552.us-central1.run.app npm run dev -- --port 5174
//   node web/e2e/demo.mjs            # all five problems (about 6 /api/check calls, no lessons, no voice)
//   node web/e2e/demo.mjs 2 3        # only these
//
// Results: one line per problem on stdout, details in $E2E_OUT/demo-<n>.json, screenshots demo-<n>.png.
import fs from 'node:fs'
import path from 'node:path'
import * as L from './lib.mjs'

const XH = 26
const LINE = 92
const X0 = 90
const RUN = Date.now().toString(36)

/** What the README promises for each problem, checked against what was drawn. */
const PROBLEMS = {
  1: {
    name: 'Wrong derivative',
    lines: ['f(x) = 3x^2 + 2x', "f'(x) = 6x + 1"],
    expect: (ai) => red(ai).some((m) => m.kind === 'circle') && notes(ai, 'red').length > 0,
    promise: 'red circle on the second line + a question',
  },
  2: {
    name: 'Sign error in algebra',
    lines: ['3x - 7 = 2', '3x = -5'],
    expect: (ai) => red(ai).length > 0 && notes(ai, 'red').length > 0,
    promise: 'red circle on 3x = -5 + a question',
  },
  3: {
    name: 'Wrong integral',
    lines: ['∫ cos(x) dx', '= -sin(x) + C'],
    expect: (ai) => red(ai).length > 0,
    promise: 'red circle on -sin(x) + C + a question',
  },
  4: {
    name: 'Correct work',
    lines: ['(x + 1)^2', '= x^2 + 2x + 1'],
    expect: (ai) => red(ai).length === 0,
    promise: 'no red marks',
  },
  5: {
    name: 'Graph this',
    lines: ['y = x^2 - 4', 'graph this'],
    expect: (ai) => ai.some((x) => x.kind === 'figure'),
    promise: 'a graph of the parabola beside the line',
  },
}

// The harness font (lib.mjs) has only the ASCII glyphs; the integral sign is drawn here from the same
// Hershey points as web/src/handwriting/hershey.ts, scaled like lib.mjs (x-height 14 units, baseline 9).
const INTEGRAL = { left: -9, right: 9, strokes: [[[6, -13], [5, -15], [3, -16], [1, -15], [0, -12], [-1, -4], [-1, 6], [-2, 13], [-3, 16], [-5, 17], [-7, 16], [-8, 14]]] }

/** L.write, except a leading "∫" is drawn as its own pen stroke first. */
async function writeLine(s, text, x, y, xh) {
  if (!text.startsWith('∫')) return L.write(s, text, x, y, xh)
  const u = xh / 14
  for (const st of INTEGRAL.strokes) await L.stroke(s, st.map(([gx, gy]) => [x + (gx - INTEGRAL.left) * u, y + (gy - 9) * u]))
  return L.write(s, text.slice(1).trimStart(), x + (INTEGRAL.right - INTEGRAL.left + 6) * u, y, xh)
}

const red = (ai) => ai.filter((x) => ['circle', 'underline'].includes(x.kind) && x.color === 'red')
const notes = (ai, color) => ai.filter((x) => ['note', 'ask'].includes(x.kind) && (!color || x.color === color))

async function run(n) {
  const p = PROBLEMS[n]
  const s = await L.open({ pageId: `demo-${RUN}-${n}`, viewport: L.PORTRAIT })
  await L.showReading(s)
  await L.tool(s, 'draw')
  const from = s.api.length
  for (let i = 0; i < p.lines.length; i++) await writeLine(s, p.lines[i], X0, 250 + i * LINE, XH)
  const reply = await L.waitCheck(s, { from, mode: 'auto', timeout: 60000 })
  await L.settle(s, 4000)
  const last = L.checks(s, 'auto').at(-1) ?? reply
  const ai = (await L.aiShapes(s)).map((x) => ({ kind: x.kind, color: x.color, text: x.text ?? null }))
  const ok = Boolean(last?.status === 200 && p.expect(ai))
  const result = {
    n,
    name: p.name,
    wrote: p.lines,
    promise: p.promise,
    pass: ok,
    status: last?.status ?? null,
    ms: last?.ms ?? null,
    read: (last?.res?.lines ?? []).map((l) => l.plain),
    tools: last?.res?.debug?.tool_calls ?? [],
    drawn: ai,
    checks: L.checks(s).length,
  }
  await L.shot(s, `demo-${n}`)
  fs.writeFileSync(path.join(L.OUT, `demo-${n}.json`), JSON.stringify(result, null, 2))
  await s.ctx?.close?.()
  return result
}

const wanted = process.argv.slice(2).map(Number).filter((n) => PROBLEMS[n])
const results = []
for (const n of wanted.length ? wanted : Object.keys(PROBLEMS).map(Number)) {
  const r = await run(n).catch((e) => ({ n, name: PROBLEMS[n].name, pass: false, error: String(e) }))
  results.push(r)
  const drawn = (r.drawn ?? []).map((x) => `${x.kind}:${x.color}${x.text ? ` "${x.text}"` : ''}`).join(', ') || 'nothing'
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${n}. ${r.name}: read ${JSON.stringify(r.read ?? [])} -> ${drawn}` +
    `${r.tools?.length ? ` | ${r.tools.join('; ')}` : ''}${r.error ? ` | error ${r.error}` : ''} (${r.ms ?? '?'} ms, ${r.checks ?? '?'} checks)`)
}
await L.closeBrowser()
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed. API calls: ${JSON.stringify(L.budget)}`)
