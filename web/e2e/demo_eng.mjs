// Engineering demo set E-1 to E-5 (docs/ENGINEERING.md), drawn with pen strokes on the dev page and checked
// against each promise. The page's /api must point at the engineering server, never production:
//
//   cd web && API_TARGET=https://tutor-api-eng-191803288552.us-central1.run.app npm run dev -- --port 5174
//   E2E_OUT=web/e2e/eng node web/e2e/demo_eng.mjs        # all; or: node web/e2e/demo_eng.mjs 4 5
//
// Paid calls: every /api/check is one (E-1 1, E-2 1, E-3 0, E-4 1, E-5 4: about 7). The run stops before going
// over MAX_PAID. Results: web/e2e/RESULTS_ENG.md, screenshots in $E2E_OUT.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as L from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAX_PAID = 8
const RUN = Date.now().toString(36)
const results = []
let paid = 0

const checksOf = (s) => L.checks(s).length
const ai = async (s) => (await L.shapes(s)).filter((x) => x.ai)
const red = (list) => list.filter((x) => x.color === 'red')
const xray = (list) => list.filter((x) => x.kind === 'xray')

async function page(tag) {
  const s = await L.open({ pageId: `eng-${RUN}-${tag}`, viewport: L.PORTRAIT })
  await L.tool(s, 'draw')
  return s
}
const line = (s, pts) => L.stroke(s, pts)
const text = (s, sel) => s.page.$eval(sel, (el) => el.textContent).catch(() => null)
async function fill(s, sel, value) {
  await s.page.$eval(sel, (el) => { el.value = '' })
  await s.page.type(sel, value)
}

/** A 9 V source, R1 = 1k on top, R2 = 2k on the right, as pen strokes (plates, zigzags, wires) + labels. */
async function drawCircuit(s) {
  await line(s, [[120, 380], [120, 260], [260, 260]])
  await line(s, [[260, 260], [272, 240], [292, 280], [312, 240], [332, 280], [352, 240], [368, 260], [380, 260]]) // R1
  await line(s, [[380, 260], [520, 260], [520, 330]])
  await line(s, [[520, 330], [500, 342], [540, 362], [500, 382], [540, 402], [500, 422], [540, 442], [520, 450]]) // R2
  await line(s, [[520, 450], [520, 520], [120, 520], [120, 402]])
  await line(s, [[82, 380], [158, 380]]) // long plate (+)
  await line(s, [[100, 402], [140, 402]]) // short plate (-)
  await L.write(s, '+', 168, 384, 16)
  await L.write(s, '-', 168, 410, 16)
  await L.write(s, '9V', 14, 400, 20)
  await L.write(s, 'R1 = 1k', 262, 222, 18)
  await L.write(s, 'R2 = 2k', 556, 400, 18)
}

/** A 30 degree ramp, a block sitting on it, arrows for gravity and normal only, "at rest", "m = 2 kg". */
async function drawRamp(s) {
  const t = Math.tan(Math.PI / 6)
  const slopeY = (x) => 640 - (x - 90) * t // the slope line from (90, 640) up to (560, 369)
  await line(s, [[90, 640], [560, 640], [560, slopeY(560)], [90, 640]])
  await line(s, [[160, 640], [157, 622], [151, 605]]) // angle mark
  await L.write(s, '30', 172, 628, 14)
  // the block: its base on the slope, its sides along the outward normal (-sin 30, -cos 30)
  const side = 66
  const A = [300, slopeY(300)]
  const B = [A[0] + side * Math.cos(Math.PI / 6), A[1] - side * Math.sin(Math.PI / 6)]
  const n = [-side * Math.sin(Math.PI / 6), -side * Math.cos(Math.PI / 6)]
  const C = [B[0] + n[0], B[1] + n[1]]
  const D = [A[0] + n[0], A[1] + n[1]]
  await line(s, [A, B, C, D, A])
  const c = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2]
  await line(s, [c, [c[0], c[1] + 150]]) // mg straight down
  await line(s, [[c[0] - 12, c[1] + 132], [c[0], c[1] + 152], [c[0] + 12, c[1] + 132]])
  await L.write(s, 'mg', c[0] + 10, c[1] + 168, 18)
  const tip = [c[0] - 0.5 * 110, c[1] - 0.866 * 110] // N out of the slope, 120 degrees
  await line(s, [c, tip])
  await line(s, [[tip[0] - 3, tip[1] + 22], tip, [tip[0] + 17, tip[1] + 11]])
  await L.write(s, 'N', tip[0] - 28, tip[1] - 2, 18)
  await L.write(s, 'at rest', 110, 720, 24)
  await L.write(s, 'm = 2 kg', 110, 780, 24)
}

function record(r) {
  results.push(r)
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id} ${r.name} | ${r.saw}${r.time ? ` | ${r.time}` : ''}`)
}

async function waitPaid(s, from, mode) {
  const reply = await L.waitCheck(s, { from, mode, timeout: 90000 })
  await L.settle(s, 3000, 90000)
  return reply
}

async function e1e2e3({ onlyFixed = false } = {}) {
  const s = await page('circuit')
  let from = s.api.length
  await drawCircuit(s)
  if (onlyFixed) return fixedAndWhatIf(s, from, null)
  const ans = await L.write(s, 'I = 9 mA', 140, 620, 26)
  const r1 = await waitPaid(s, from, 'auto')
  paid += checksOf(s)
  let list = await ai(s)
  const tools1 = r1?.res?.debug?.tool_calls ?? []
  const notes1 = red(list).filter((x) => x.kind === 'note').map((x) => x.text)
  record({
    id: 'E-1', name: 'Circuit checking: I = 9 mA is wrong', pass: red(list).some((x) => x.kind === 'circle') && notes1.length > 0,
    saw: `red ${red(list).map((x) => x.kind).join('+') || 'none'}; note "${notes1[0] ?? ''}"; tools ${tools1.join('; ')}`,
    time: r1?.ms ? `${(r1.ms / 1000).toFixed(1)} s` : '',
  })
  await L.shot(s, 'E1-wrong-answer')
  if (paid >= MAX_PAID) return
  // E-2: rub out the answer, write the right one
  return fixedAndWhatIf(s, s.api.length, ans)
}

/** E-2 (the right answer: circle clears, x-ray labels + card) and E-3 (change R2 on the card, no Gemini). */
async function fixedAndWhatIf(s, from, wrong) {
  if (wrong) await L.erase(s, wrong.box)
  await L.write(s, 'I = 3 mA', 140, 620, 26)
  const r2 = await waitPaid(s, from, 'auto')
  paid += wrong ? 1 : checksOf(s)
  const list = await ai(s)
  const labels = xray(list).map((x) => x.text)
  const card = await s.page.$('[data-circuit-card]')
  const summary = card ? await text(s, '[data-summary]') : null
  record({
    id: 'E-2', name: wrong ? 'Fix it to I = 3 mA: circle clears, x-ray + card' : 'Right answer I = 3 mA: no red, x-ray + card',
    pass: red(list).length === 0 && labels.length >= 4 && Boolean(card) && /3 mA/.test(summary ?? ''),
    saw: `red left ${red(list).length}; x-ray ${JSON.stringify(labels)}; card ${card ? `"${summary}"` : 'none'}; tools ${(r2?.res?.debug?.tool_calls ?? []).join('; ')}`,
    time: r2?.ms ? `${(r2.ms / 1000).toFixed(1)} s` : '',
  })
  await L.shot(s, 'E2-fixed-xray-card')
  if (!card) return record({ id: 'E-3', name: 'What-if: R2 to 4k', pass: false, saw: 'no card to edit' })
  // E-3: change R2 on the card, no Gemini
  const before = checksOf(s)
  await s.page.click('[data-value="R2"]')
  await fill(s, 'input[aria-label="R2 value"]', '4k')
  const t0 = Date.now()
  await s.page.keyboard.press('Enter')
  const ok = await s.page.waitForFunction(() => document.querySelector('[data-summary]')?.textContent?.includes('1.8 mA'), { timeout: 5000 }).then(() => true, () => false)
  const ms = Date.now() - t0
  await L.sleep(1500)
  const after = xray(await ai(s)).map((x) => x.text)
  record({
    id: 'E-3', name: 'What-if card: R2 to 4 kΩ',
    pass: ok && ms < 1000 && checksOf(s) === before && after.some((t) => t.includes('7.2 V')) && after.some((t) => t.includes('1.8 mA')),
    saw: `summary "${await text(s, '[data-summary]')}", labels ${JSON.stringify(after)}, new /api/check: ${checksOf(s) - before}`,
    time: `${ms} ms incl. 250 ms debounce`,
  })
  await L.shot(s, 'E3-what-if')
}

async function e4() {
  const s = await page('units')
  const from = s.api.length
  await L.write(s, 'F = 2 kg * 9.8 m/s = 19.6 N', 60, 300, 20) // small enough for one capture window
  const r = await waitPaid(s, from, 'auto')
  paid += checksOf(s)
  const list = await ai(s)
  const note = red(list).find((x) => x.kind === 'note')?.text ?? ''
  record({
    id: 'E-4', name: 'Units: F = 2 kg · 9.8 m/s = 19.6 N', pass: red(list).length > 0 && /unit|acceleration/i.test(note),
    saw: `read ${JSON.stringify((r?.res?.lines ?? []).map((l) => l.plain))}; red ${red(list).map((x) => x.kind).join('+')}; note "${note}"; tools ${(r?.res?.debug?.tool_calls ?? []).join('; ')}`,
    time: r?.ms ? `${(r.ms / 1000).toFixed(1)} s` : '',
  })
  await L.shot(s, 'E4-units')
}

async function e5() {
  const s = await page('fbd')
  const from = s.api.length
  await drawRamp(s)
  const auto = await waitPaid(s, from, 'auto')
  // Tap Help three times. The page may prefetch the next hint on its own (Part 1's hint chain), so replies are
  // judged by the hint level each one carries, not by which tap came first.
  for (let i = 1; i <= 3 && checksOf(s) < MAX_PAID - paid; i++) {
    const before = s.api.length
    await L.tapHelp(s)
    await waitPaid(s, before, 'help')
    await L.shot(s, `E5-help-${i}`)
  }
  paid += checksOf(s)
  const byLevel = {}
  for (const r of L.checks(s, 'help')) {
    const level = Math.max(0, ...(r.res?.state?.problems ?? []).map((p) => p.hint_level))
    const acts = r.res?.actions ?? []
    byLevel[level] = { notes: acts.filter((a) => a.type === 'note').map((a) => a.text), fig: acts.find((a) => a.type === 'figure' && a.figure?.kind === 'fbd') }
  }
  const missingDashed = (fig) => (fig?.figure?.fbd?.expected ?? []).filter((e) => !fig.figure.fbd.forces.some((d) => d.label === e.label))
  const l1 = byLevel[1]
  const l2 = byLevel[2]
  const l3 = byLevel[3]
  const dashed = missingDashed(l2?.fig)
  record({
    id: 'E-5', name: 'Force diagram on a 30° ramp, at rest',
    pass: Boolean(l1?.notes.length) && !/friction/i.test(l1?.notes.join(' ') ?? '') && dashed.length > 0
      && dashed.every((f) => Math.abs(((f.angle_deg - 30 + 540) % 360) - 180) <= 15) && Boolean(l3?.notes.some((t) => /9\.8/.test(t))),
    saw: [`auto: ${(auto?.res?.debug?.tool_calls ?? []).join('; ')}`,
      `hint 1: "${l1?.notes[0] ?? ''}"`,
      `hint 2: "${l2?.notes[0] ?? ''}" + diagram, dashed ${dashed.map((f) => `${f.label} at ${f.angle_deg}°`).join(', ') || 'none'}`,
      `hint 3: "${l3?.notes[0] ?? ''}"`].join(' | '),
  })
}

const want = process.argv.slice(2).map(Number)
const run = (n) => !want.length || want.includes(n)
try {
  if (run(1)) await e1e2e3()
  else if (run(2) || run(3)) await e1e2e3({ onlyFixed: true })
  if (run(4) && paid < MAX_PAID) await e4()
  if (run(5) && paid + 4 <= MAX_PAID) await e5()
  else if (run(5)) record({ id: 'E-5', name: 'Force diagram', pass: false, saw: `skipped: ${paid} paid calls used, E-5 needs 4 (max ${MAX_PAID})` })
} finally {
  await L.closeBrowser()
}

const passed = results.filter((r) => r.pass).length
const md = [
  '# Engineering demo results',
  '',
  `Run ${new Date().toISOString()} · dev page against Cloud Run \`tutor-api-eng\` · pen strokes via \`web/e2e/lib.mjs\` · **${passed}/${results.length} passed** · paid /api/check calls: ${paid}`,
  '',
  '| Demo | What | Result | What happened | Time |',
  '| --- | --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${String(r.saw).replace(/\|/g, '/')} | ${r.time ?? ''} |`),
  '',
  `Screenshots: \`${path.relative(path.resolve(HERE, '../..'), L.OUT)}\`.`,
  '',
].join('\n')
fs.writeFileSync(path.join(HERE, 'RESULTS_ENG.md'), md)
console.log(`\n${passed}/${results.length} passed, paid calls ${paid}`)
