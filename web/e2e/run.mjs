#!/usr/bin/env node
// End-to-end run of the tutor notebook: real pen ink on the real canvas, the real API behind it.
//   node web/e2e/run.mjs            every flow (1-15) on the dev page, then the live smoke pass
//   node web/e2e/run.mjs 1 4 13     only these flows
//   node web/e2e/run.mjs live       only the smoke pass against https://tutor-1098c.web.app
//   --landscape                     1180x820 instead of 820x1180
//   --no-retry                      do not retry a failed flow (a pass on the retry is reported FLAKY)
//   --no-speak                      block /api/speak in flow 10 (tests the fallback voice, costs no TTS calls)
// Evidence: screenshots, sent images and flow-<n>.json go to E2E_OUT (see lib.mjs).
import fs from 'node:fs'
import path from 'node:path'
import * as L from './lib.mjs'

const args = process.argv.slice(2)
const LANDSCAPE = args.includes('--landscape')
const NO_RETRY = args.includes('--no-retry')
const NO_SPEAK = args.includes('--no-speak')
const wanted = args.filter((a) => !a.startsWith('--'))
const VIEW = LANDSCAPE ? L.LANDSCAPE : L.PORTRAIT
const SUFFIX = LANDSCAPE ? '-land' : ''
const RUN = Date.now().toString(36)
const XH = 26 // x-height of the writing in screen px (capitals and digits about 39 px)
const LINE = 92 // distance between baselines
const X0 = 90

const norm = (t) =>
  String(t ?? '')
    .replace(/\\left|\\right|\\,|\\!|\\cdot|\$/g, '')
    .replace(/\*\*/g, '^')
    .replace(/[\s*{}]/g, '')
    .replace(/\\prime|′|’/g, "'")
    .replace(/\^'/g, "'")
    .replace(/−/g, '-')
    .toLowerCase()

/** One flow's record: checks (pass/fail with a reason), free-form evidence, screenshots, timings. */
class Rec {
  constructor(n, name) {
    Object.assign(this, { n, name, started: L.hhmmss(), fails: [], notes: [], shots: [], timings: {}, evidence: {} })
  }
  ok(cond, what) {
    if (cond) this.notes.push('ok: ' + what)
    else this.fails.push(what)
    return !!cond
  }
  note(t) {
    this.notes.push(t)
  }
}

function apiBrief(s) {
  return s.api.map((r) => ({
    n: r.n, at: r.at, path: r.path, mode: r.mode, status: r.status, ms: r.ms, image: r.image, bytes: r.bytes, type: r.type,
    help_box: r.req?.help_box, question: r.req?.question, sent_lines: r.req?.state?.lines?.length, flagged: r.req?.state?.flagged_line_ids,
    text: r.path === '/api/speak' ? r.req?.text : undefined,
    lines: r.res?.lines?.map((l) => ({ id: l.line_id, p: l.problem_id, latex: l.latex, plain: l.plain, rel: l.relation, conf: l.confidence, src: l.source, box: l.box })),
    actions: r.res?.actions?.map((a) => ({
      type: a.type, line_id: a.line_id, color: a.color, side: a.side, text: a.text, box: a.box, steps: a.steps, options: a.options, figure: a.figure,
      lesson: a.lesson && { title: a.lesson.title, steps: a.lesson.steps.length, practice: a.lesson.practice ?? null, says: a.lesson.steps.map((x) => x.say) },
    })),
    clear: r.res?.clear_line_ids,
    problems: r.res?.state?.problems,
    debug: r.res?.debug,
    glyphs: r.res?.glyphs?.map((g) => g.char).join(''),
    error: r.res?.error ?? r.resError,
  }))
}

/** Did Gemini read what was written? Compares each intended line with the reply's lines. */
function readCheck(rec, reply, intended) {
  // brackets are ignored too: "d/dx (x sin x)" read as "d/dx(x*sin(x))" is the same reading
  const loose = (t) => norm(t).replace(/[()]/g, '').replace(/\\(sin|cos|frac)/g, '$1')
  const lines = reply?.res?.lines ?? []
  const got = lines.map((l) => loose(l.plain))
  const gotTex = lines.map((l) => loose(l.latex))
  const missing = intended.filter((t) => !got.includes(loose(t)) && !gotTex.includes(loose(t)))
  const printed = lines.filter((l) => l.source === 'printed' && intended.some((t) => loose(t) === loose(l.plain) || loose(t) === loose(l.latex)))
  rec.ok(printed.length === 0, `handwriting was classified as handwriting` + (printed.length ? `: ${printed.length} handwritten line(s) came back as source "printed" (${printed.map((l) => l.plain).join(' | ')}), which the server never marks or completes` : ''))
  // no worksheet on these pages: the page must say so (the server then never labels handwriting "printed")
  rec.ok(reply?.req?.has_worksheet === false, `the request said there is no worksheet in the picture (has_worksheet: ${JSON.stringify(reply?.req?.has_worksheet)})`)
  rec.evidence.read = { intended, got: (reply?.res?.lines ?? []).map((l) => l.plain) }
  rec.ok(missing.length === 0, `Gemini read the ink as written (${intended.length} lines)` + (missing.length ? `: NOT read as written: ${JSON.stringify(missing)}; got ${JSON.stringify(rec.evidence.read.got)}` : ''))
  return missing.length === 0
}

/** Does the status line under "Show what AI read" say what the last check did? */
async function statusCheck(rec, s, reply) {
  const text = await L.statusText(s)
  rec.evidence.status = text
  if (!reply?.res) return rec.note(`status line: ${text}`)
  const types = reply.res.actions.map((a) => a.type)
  const want = types.length ? `${types.length} action${types.length === 1 ? '' : 's'} (${types.join(', ')})` : 'no actions'
  const good = !!text && text.includes(` ${reply.mode}`) && text.includes(want)
  rec.ok(good, `status line matches the last check: "${text}"` + (good ? '' : ` (expected mode ${reply.mode}, "${want}")`))
  const drew = Number(text?.match(/drew (\d+)/)?.[1] ?? -1)
  rec.evidence.statusDrew = drew
}

async function finish(rec, s, name) {
  rec.shots.push(await L.shot(s, name))
  rec.evidence.api = apiBrief(s)
  rec.evidence.console = s.console
  rec.evidence.reloads = s.loads.length - 1
  if (s.loads.length > 1) rec.note(`page reloaded ${s.loads.length - 1}x during the flow (hot reload) at ${s.loads.slice(1).map((t) => L.hhmmss(t)).join(', ')}`)
  rec.evidence.hmr = s.hmr.filter((h) => !/connect/.test(h.text))
  if (rec.evidence.hmr.length) rec.note(`vite hot updates during the flow: ${rec.evidence.hmr.map((h) => `${h.at} ${h.text}`).join(' | ').slice(0, 500)}`)
  rec.evidence.toolAtEnd = (await L.view(s)).tool
  rec.note(`tool at the end: ${rec.evidence.toolAtEnd}, pen mode ${(await L.view(s)).penMode}`)
  const errors = s.console.filter((c) => c.type !== 'warn')
  rec.evidence.consoleErrors = errors.length
  if (errors.length) rec.note(`console errors: ${errors.map((e) => e.text).join(' | ').slice(0, 600)}`)
  rec.evidence.shapes = (await L.shapes(s))?.filter((x) => x.ai)
}

const pid = (n) => `e2e-${RUN}-f${n}${SUFFIX}`

async function begin(n, opts = {}) {
  const s = await L.open({ pageId: pid(n), viewport: VIEW, ...opts })
  s.tag = `f${n}${SUFFIX}`
  await L.showReading(s)
  await L.tool(s, 'draw')
  return s
}

/** Writes lines one under another; returns what was written (screen boxes). */
async function writeLines(s, lines, x = X0, y = 250, xh = XH, pitch = LINE * (xh / XH)) {
  const out = []
  for (let i = 0; i < lines.length; i++) out.push(await L.write(s, lines[i], x, y + i * pitch, xh))
  return out
}

const redMarks = (list) => list.filter((x) => ['circle', 'underline'].includes(x.kind))
const notes = (list) => list.filter((x) => ['note', 'ask'].includes(x.kind) && x.type === 'text')

async function inkBox(s) {
  const ink = await L.inkShapes(s)
  return ink.length ? L.unionBox(ink.map((i) => i.screen)) : null
}
/** Feedback text must not sit on the handwriting. Returns the overlapping pairs. */
async function overlapsInk(s, list) {
  const ink = await L.inkShapes(s)
  const hits = []
  for (const a of list) for (const i of ink) if (L.overlap(a.screen, i.screen) > 12) hits.push({ kind: a.kind, text: a.text?.slice(0, 30), with: L.brief(i.screen) })
  return hits
}
/** Screen font size of a tldraw text shape. */
const SIZE_PX = { s: 18, m: 24, l: 36, xl: 44 }
const fontPx = (sh, zoom = 1) => (SIZE_PX[sh.size] ?? 18) * (sh.scale ?? 1) * zoom

// ------------------------------------------------------------------------------------------------
// Flows
// ------------------------------------------------------------------------------------------------

async function wrongDerivative(rec, s, y = 250) {
  const from = s.api.length
  const w = await writeLines(s, ['f(x) = 3x^2 + 2x', "f'(x) = 6x + 1"], X0, y)
  const reply = await L.waitCheck(s, { from, mode: 'auto' })
  rec.timings.write_to_reply_ms = reply ? reply.t1 - w[1].at : null
  rec.timings.check_ms = reply?.ms
  if (!rec.ok(reply?.status === 200, `auto check returned 200 (${reply?.status}, ${reply?.ms} ms)`)) return { w, reply }
  readCheck(rec, reply, ['f(x) = 3x^2 + 2x', "f'(x) = 6x + 1"])
  const ai = await L.aiShapes(s)
  const marks = redMarks(ai)
  const qs = notes(ai)
  const wrongTerm = L.unionBox(w[1].glyphs.slice(-2).map((g) => g.box)) // "+ 1"
  rec.evidence.wrongTerm = L.brief(wrongTerm)
  rec.evidence.marks = marks.map((m) => ({ kind: m.kind, color: m.color, screen: L.brief(m.screen) }))
  rec.evidence.notes = qs.map((m) => ({ kind: m.kind, color: m.color, text: m.text, screen: L.brief(m.screen), font: fontPx(m) }))
  if (rec.ok(marks.length >= 1, `a circle/underline was drawn (${marks.length})`)) {
    const m = marks[0]
    const cx = m.screen.x + m.screen.w / 2
    const cy = m.screen.y + m.screen.h / 2
    rec.ok(m.color === 'red', `the mark is red (${m.color})`)
    rec.ok(
      cx > wrongTerm.x - XH && cx < wrongTerm.x + wrongTerm.w + XH && cy > wrongTerm.y - XH && cy < wrongTerm.y + wrongTerm.h + XH,
      `the mark is centred on "+ 1" (mark ${L.brief(m.screen)}, "+ 1" at ${L.brief(wrongTerm)})`,
    )
    rec.ok(m.screen.w < w[1].box.w * 0.7, `the mark is narrowed to a term, not the whole line (mark ${Math.round(m.screen.w)} px wide, line ${Math.round(w[1].box.w)} px)`)
  }
  if (rec.ok(qs.length >= 1, `a note/question was drawn (${qs.length})`)) {
    rec.ok(qs.some((q) => q.color === 'red'), `the question is red (${qs.map((q) => q.color)})`)
    rec.ok(qs.some((q) => /\?/.test(q.text)), `it is a question: "${qs[0].text}"`)
    const hits = await overlapsInk(s, qs)
    rec.ok(hits.length === 0, `the question does not sit on the ink` + (hits.length ? ` (overlaps ${JSON.stringify(hits)})` : ''))
    const v = VIEW
    rec.ok(qs.every((q) => q.screen.x >= 0 && q.screen.y >= 0 && q.screen.x + q.screen.w <= v.width && q.screen.y + q.screen.h <= v.height), `the question is on screen (${qs.map((q) => L.brief(q.screen))})`)
  }
  await statusCheck(rec, s, reply)
  return { w, reply, marks, qs }
}

const flows = {
  1: {
    name: 'Wrong derivative, then corrected',
    async run(rec) {
      const s = await begin(1)
      const { w } = await wrongDerivative(rec, s)
      rec.shots.push(await L.shot(s, `f1${SUFFIX}-a-wrong`))
      // correct it: rub out the wrong line, write the right one in its place
      const before = (await L.inkShapes(s)).length
      const from = s.api.length
      await L.erase(s, w[1].box)
      const left = (await L.inkShapes(s)).length
      rec.ok(left === before - w[1].strokes, `eraser removed the wrong line (${before} -> ${left} strokes, line had ${w[1].strokes})`)
      const fixedAt = Date.now()
      await L.write(s, "f'(x) = 6x + 2", X0, 250 + LINE, XH)
      const reply = await L.waitCheck(s, { from, mode: 'auto' })
      await L.settle(s, 3000)
      const last = L.checks(s, 'auto').at(-1)
      rec.timings.fix_to_clear_ms = last ? last.t1 - fixedAt : null
      rec.ok(reply?.status === 200, `check after the fix returned 200 (${reply?.status}, ${reply?.ms} ms)`)
      readCheck(rec, last, ['f(x) = 3x^2 + 2x', "f'(x) = 6x + 2"])
      const ai = await L.aiShapes(s)
      const stale = [...redMarks(ai), ...notes(ai)].filter((x) => x.color === 'red')
      rec.ok(stale.length === 0, `red marks cleared after the fix` + (stale.length ? ` (still there: ${stale.map((x) => `${x.kind} "${x.text ?? ''}" at ${L.brief(x.screen)}`).join('; ')})` : ''))
      rec.evidence.afterFix = ai.map((x) => ({ kind: x.kind, color: x.color, text: x.text }))
      await statusCheck(rec, s, last)
      await finish(rec, s, `f1${SUFFIX}-b-fixed`)
      return s
    },
  },

  2: {
    name: 'Correct work, no marks',
    async run(rec) {
      const s = await begin(2)
      const lines = ['2x + 6 = 14', '2x = 8', 'x = 4']
      const w = await writeLines(s, lines)
      const reply = await L.waitCheck(s, { mode: 'auto', from: 0 })
      rec.timings.check_ms = reply?.ms
      rec.timings.write_to_reply_ms = reply ? reply.t1 - w[2].at : null
      rec.ok(reply?.status === 200, `auto check returned 200 (${reply?.status})`)
      await L.settle(s, 4000)
      const last = L.checks(s, 'auto').at(-1)
      readCheck(rec, last, lines)
      const ai = await L.aiShapes(s)
      rec.evidence.ai = ai.map((x) => ({ kind: x.kind, color: x.color, text: x.text, screen: L.brief(x.screen) }))
      rec.ok(ai.filter((x) => x.color === 'red').length === 0, `no red marks on correct work (${ai.filter((x) => x.color === 'red').length})`)
      rec.ok(ai.length === 0, `no marks at all (${ai.map((x) => `${x.kind}:${x.color}:"${x.text ?? ''}"`).join(', ') || 'none'})`)
      rec.ok(L.checks(s).length === 1, `one check was enough (${L.checks(s).length} sent)`)
      await statusCheck(rec, s, last)
      await finish(rec, s, `f2${SUFFIX}`)
      return s
    },
  },

  3: {
    name: 'Algebra mistake',
    async run(rec, opts = {}) {
      const s = await begin(opts.live ? 'live' : 3, opts.live ? { base: L.LIVE_URL } : {})
      const lines = ['2x + 6 = 14', '2x = 20']
      const w = await writeLines(s, lines)
      const reply = await L.waitCheck(s, { mode: 'auto', from: 0 })
      rec.timings.check_ms = reply?.ms
      rec.timings.write_to_reply_ms = reply ? reply.t1 - w[1].at : null
      if (rec.ok(reply?.status === 200, `auto check returned 200 (${reply?.status})`)) {
        readCheck(rec, reply, lines)
        const ai = await L.aiShapes(s)
        const marks = redMarks(ai)
        const qs = notes(ai)
        rec.evidence.marks = marks.map((m) => ({ kind: m.kind, color: m.color, screen: L.brief(m.screen) }))
        rec.evidence.notes = qs.map((m) => ({ kind: m.kind, color: m.color, text: m.text, screen: L.brief(m.screen) }))
        if (rec.ok(marks.length >= 1 && marks[0].color === 'red', `a red circle/underline was drawn (${marks.length})`)) {
          const m = marks[0]
          rec.ok(L.overlap(m.screen, w[1].box) > 0 && L.overlap(m.screen, w[0].box) < L.overlap(m.screen, w[1].box), `the mark is on the wrong line "2x = 20" (mark ${L.brief(m.screen)}, line ${L.brief(w[1].box)})`)
        }
        rec.ok(qs.length >= 1, `a note/question was drawn: ${qs.map((q) => `"${q.text}"`).join(' ')}`)
        const hits = await overlapsInk(s, qs)
        rec.ok(hits.length === 0, `the note does not sit on the ink` + (hits.length ? ` (${JSON.stringify(hits)})` : ''))
        await statusCheck(rec, s, reply)
        if (opts.live) {
          // the live build has cloud save: the same ?page= in a fresh browser must bring everything back
          await L.sleep(6000)
          rec.evidence.firestoreRequests = s.firestore
          rec.ok(s.firestore > 0, `the live page talks to Firestore (${s.firestore} requests)`)
          await freshBrowserRestore(rec, s, countShapes(await L.shapes(s)), countShapes)
        }
      }
      await finish(rec, s, opts.live ? 'live-mistake' : `f3${SUFFIX}`)
      return s
    },
  },

  4: {
    name: 'Finish my line',
    async run(rec) {
      const s = await begin(4)
      await finishLine(rec, s, 250)
      await finish(rec, s, `f4${SUFFIX}`)
      return s
    },
  },

  5: {
    name: 'Full solve',
    async run(rec) {
      const s = await begin(5)
      const a = await L.write(s, '3x^2 - 3 = 0', X0, 250, XH)
      const b = await L.write(s, 'solve', a.box.x + a.box.w + 90, 250, XH)
      const reply = await L.waitCheck(s, { mode: 'auto', from: 0, timeout: 70000 })
      rec.timings.check_ms = reply?.ms
      rec.timings.write_to_reply_ms = reply ? reply.t1 - b.at : null
      if (rec.ok(reply?.status === 200, `auto check returned 200 (${reply?.status}, ${reply?.ms} ms)`)) {
        readCheck(rec, reply, ['3x^2 - 3 = 0'])
        const sol = reply.res.actions.find((x) => x.type === 'solution')
        rec.ok(!!sol, `the server sent a solution action (${reply.res.actions.map((x) => x.type).join(', ') || 'no actions'})`)
        rec.evidence.steps = sol?.steps
        await L.sleep(5000) // steps are revealed 0.8 s apart
        const ai = await L.aiShapes(s)
        const steps = ai.filter((x) => x.kind === 'solution' || x.kind === 'hand').sort((p, q) => p.screen.y - q.screen.y)
        const texts = steps.filter((x) => x.text).map((x) => x.text)
        rec.evidence.drawn = steps.map((x) => ({ kind: x.kind, type: x.type, text: x.text, screen: L.brief(x.screen), font: x.type === 'text' ? fontPx(x) : undefined, color: x.color }))
        const want = ['3x^2=3', 'x^2=1', 'x=±1']
        const got = texts.map((t) => norm(t).replace(/²/g, '^2').replace(/\\pm/g, '±'))
        rec.ok(JSON.stringify(got) === JSON.stringify(want), `steps on the page, top to bottom: ${JSON.stringify(texts)} (expected 3x² = 3, x² = 1, x = ±1)`)
        if (steps.length) {
          const ink = await inkBox(s)
          rec.ok(steps[0].screen.y >= a.box.y + a.box.h - 6, `steps are under the equation (first step y ${Math.round(steps[0].screen.y)}, equation bottom ${Math.round(a.box.y + a.box.h)})`)
          const hits = await overlapsInk(s, steps)
          rec.ok(hits.length === 0, `steps do not sit on the ink` + (hits.length ? ` (${JSON.stringify(hits)})` : ''))
          const fonts = steps.filter((x) => x.type === 'text').map((x) => fontPx(x))
          if (fonts.length) rec.ok(fonts.every((f) => f > XH * 0.9 && f < XH * 2.6), `steps are sized like the writing (font ${fonts.map((f) => f.toFixed(0)).join('/')} px; handwriting x-height ${XH} px, capitals ${Math.round(XH * 1.5)} px)`)
          rec.ok(steps.every((x) => x.screen.x + x.screen.w <= VIEW.width && x.screen.y + x.screen.h <= VIEW.height && x.screen.x >= 0), `steps are on screen (${steps.map((x) => L.brief(x.screen)).join(' | ')}; ink ${L.brief(ink)})`)
        }
        await statusCheck(rec, s, reply)
      }
      await finish(rec, s, `f5${SUFFIX}`)
      return s
    },
  },

  6: {
    name: 'Graph (2D)',
    async run(rec) {
      const s = await begin(6)
      const lines = ['g(x) = x^2 - 4', 'graph it']
      const w = await writeLines(s, lines)
      const reply = await L.waitCheck(s, { mode: 'auto', from: 0, timeout: 60000 })
      rec.timings.check_ms = reply?.ms
      rec.timings.write_to_reply_ms = reply ? reply.t1 - w[1].at : null
      if (rec.ok(reply?.status === 200, `auto check returned 200 (${reply?.status}, ${reply?.ms} ms)`)) {
        readCheck(rec, reply, ['g(x) = x^2 - 4'])
        const fig = reply.res.actions.find((x) => x.type === 'figure')
        rec.ok(!!fig, `the server sent a figure (${reply.res.actions.map((x) => x.type).join(', ') || 'no actions'})`)
        rec.evidence.figure = fig?.figure
        await L.sleep(1500)
        const ai = await L.aiShapes(s)
        const figs = ai.filter((x) => x.kind === 'figure')
        rec.evidence.drawn = figs.map((x) => ({ type: x.type, screen: L.brief(x.screen) }))
        if (rec.ok(figs.length >= 1, `a graph is on the page (${figs.length} figure shapes)`)) {
          const box = L.unionBox(figs.map((f) => f.screen))
          const hits = await overlapsInk(s, [{ kind: 'figure', screen: box }])
          rec.ok(hits.length === 0, `the graph is not on top of the ink (graph ${L.brief(box)})` + (hits.length ? ` overlaps ${hits.length} strokes` : ''))
          rec.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= VIEW.width && box.y + box.h <= VIEW.height, `the graph is fully on screen (${L.brief(box)} in ${VIEW.width}x${VIEW.height})`)
          const ctl = await s.page.evaluate(() => {
            const r = document.querySelector('.tutor-controls').getBoundingClientRect()
            return { x: r.x, y: r.y, w: r.width, h: r.height }
          })
          rec.ok(L.overlap(box, ctl) === 0, `the graph is not under the Help/Teach buttons (controls ${L.brief(ctl)})`)
          if (fig?.figure) {
            const [x0, x1] = fig.figure.x_range
            const yr = fig.figure.y_range
            rec.ok(x0 < 0 && x1 > 0 && (!yr || (yr[0] <= -4 && yr[1] > -4)), `the plotted range contains the vertex (0, -4): x ${JSON.stringify(fig.figure.x_range)}, y ${JSON.stringify(yr ?? 'auto')}`)
            if (yr) rec.ok(yr[0] < -4, `there is room below the vertex (y_min ${yr[0]} < -4)`)
          }
        }
        await statusCheck(rec, s, reply)
      }
      await finish(rec, s, `f6${SUFFIX}`)
      return s
    },
  },

  7: {
    name: '3D surface, rotate',
    async run(rec) {
      const s = await begin(7)
      const lines = ['z = x^2 + y^2', 'graph this']
      const w = await writeLines(s, lines)
      const reply = await L.waitCheck(s, { mode: 'auto', from: 0, timeout: 60000 })
      rec.timings.check_ms = reply?.ms
      rec.timings.write_to_reply_ms = reply ? reply.t1 - w[1].at : null
      if (rec.ok(reply?.status === 200, `auto check returned 200 (${reply?.status}, ${reply?.ms} ms)`)) {
        readCheck(rec, reply, ['z = x^2 + y^2'])
        const fig = reply.res.actions.find((x) => x.type === 'figure')
        rec.evidence.figure = fig?.figure
        rec.ok(fig?.figure?.kind === 'surface3d', `the server sent a surface3d figure (${fig?.figure?.kind ?? reply.res.actions.map((x) => x.type).join(', ') ?? 'nothing'})`)
        await L.sleep(3000) // three.js loads on demand
        const surf = (await L.shapes(s)).find((x) => x.type === 'surface3d')
        if (rec.ok(!!surf, 'a surface3d shape is on the page')) {
          const r = surf.screen
          const hits = await overlapsInk(s, [{ kind: 'figure', screen: r }])
          rec.ok(hits.length === 0, `the surface is not on top of the ink (${L.brief(r)})`)
          rec.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= VIEW.width && r.y + r.h <= VIEW.height, `the surface is fully on screen (${L.brief(r)})`)
          const clip = { x: Math.max(0, r.x), y: Math.max(0, r.y) + 32, width: Math.min(r.w, VIEW.width - r.x), height: Math.min(r.h - 34, VIEW.height - r.y - 32) }
          const grab = async (name) => {
            const file = path.join(L.OUT, name)
            const buf = await s.page.screenshot({ path: file, clip })
            return { file, buf }
          }
          const a = await grab(`f7${SUFFIX}-surface-before.png`)
          const webgl = await s.page.evaluate(() => {
            const c = document.querySelector('.tl-shape[data-shape-type="surface3d"] canvas') ?? document.querySelector('[data-shape-type="surface3d"] canvas')
            return c ? { w: c.width, h: c.height } : null
          })
          rec.ok(!!webgl, `the surface rendered a WebGL canvas (${JSON.stringify(webgl)})`)
          const inkBefore = (await L.inkShapes(s)).length
          const cx = r.x + r.w / 2
          const cy = r.y + r.h / 2 + 15
          await L.stroke(s, [[cx - 60, cy], [cx + 70, cy + 40]], { step: 6 })
          await L.sleep(600)
          const b = await grab(`f7${SUFFIX}-surface-after.png`)
          rec.shots.push(a.file, b.file)
          rec.ok(!a.buf.equals(b.buf), 'dragging on the surface changed the picture (it rotated)')
          const inkAfter = (await L.inkShapes(s)).length
          rec.ok(inkAfter === inkBefore, `dragging on the surface did not draw ink (${inkBefore} -> ${inkAfter} strokes)`)
          const moved = (await L.shapes(s)).find((x) => x.type === 'surface3d')
          rec.ok(Math.abs(moved.page.x - surf.page.x) < 1 && Math.abs(moved.page.y - surf.page.y) < 1, 'the drag rotated the surface rather than moving the card')
          await L.sleep(3500)
          rec.note(`checks sent after the drag: ${L.checks(s).length - 1}`)
        }
        await statusCheck(rec, s, reply)
      }
      await finish(rec, s, `f7${SUFFIX}`)
      return s
    },
  },

  8: {
    name: 'Help ladder (3 hints, auto-continue)',
    async run(rec) {
      const s = await begin(8)
      const w = await L.write(s, 'd/dx (x sin x)', X0, 250, XH)
      const auto = await L.waitCheck(s, { mode: 'auto', from: 0 })
      rec.note(`auto check before Help: ${auto?.status}, actions ${JSON.stringify(auto?.res?.actions?.map((a) => a.type))}, read ${JSON.stringify(auto?.res?.lines?.map((l) => l.plain))}`)
      await L.settle(s, 1500)
      const seen = [] // { t, text } each time the hint on the page changes
      let lastText = null
      const t0 = Date.now()
      const poll = async () => {
        const ai = await L.aiShapes(s)
        const text = notes(ai).map((x) => x.text).join(' || ')
        if (text && text !== lastText) {
          seen.push({ t: Date.now() - t0, text, shapes: notes(ai).map((x) => ({ color: x.color, screen: L.brief(x.screen), font: fontPx(x) })), label: await s.page.evaluate(() => document.querySelector('.tutor-next-label')?.textContent ?? null) })
          lastText = text
          rec.shots.push(await L.shot(s, `f8${SUFFIX}-hint${seen.length}`))
        }
      }
      await poll()
      const preHelp = seen.length
      const from = s.api.length
      await L.tapHelp(s)
      const labels = []
      const deadline = Date.now() + 75000
      while (Date.now() < deadline && seen.length - preHelp < 3) {
        await poll()
        const label = await s.page.evaluate(() => document.querySelector('.tutor-next-label')?.textContent ?? null)
        if (label && labels.at(-1)?.label !== label) labels.push({ t: Date.now() - t0, label })
        await L.sleep(400)
      }
      await L.sleep(1500)
      const hints = seen.slice(preHelp)
      rec.evidence.hints = hints
      rec.evidence.countdown = labels
      rec.evidence.helpCalls = s.api.slice(from).filter((r) => r.path === '/api/check').map((r) => ({ mode: r.mode, ms: r.ms, status: r.status, at: r.at, actions: r.res?.actions?.map((a) => ({ type: a.type, text: a.text })), problems: r.res?.state?.problems }))
      const h1 = L.checks(s, 'help')[0]
      rec.timings.hint1_ms = hints[0]?.t
      rec.timings.hint2_after_hint1_ms = hints[1] ? hints[1].t - hints[0].t : null
      rec.timings.hint3_after_hint2_ms = hints[2] ? hints[2].t - hints[1].t : null
      rec.ok(h1?.status === 200, `the Help request returned 200 (${h1?.status}, ${h1?.ms} ms)`)
      if (h1?.res) readCheck(rec, h1, ['d/dx (x sin x)'])
      rec.ok(hints.length >= 1, `hint 1 appeared after the tap (${hints[0]?.t} ms): "${hints[0]?.text}"`)
      rec.ok(labels.some((l) => /Next hint in \d+ s/.test(l.label)), `the countdown pill was shown (${labels.slice(0, 4).map((l) => l.label).join(' / ')})`)
      rec.ok(hints.length >= 2, `hint 2 arrived without a tap (${rec.timings.hint2_after_hint1_ms} ms after hint 1): "${hints[1]?.text}"`)
      rec.ok(hints.length >= 3, `hint 3 arrived without a tap (${rec.timings.hint3_after_hint2_ms} ms after hint 2): "${hints[2]?.text}"`)
      rec.ok(new Set(hints.map((h) => norm(h.text))).size === hints.length && hints.length === 3, 'the three hints differ')
      // a rough automatic screen (the texts are in the evidence for a human to judge): a hint that only
      // instructs is short and has neither a reason nor any worked math in it
      const explains = hints.map((h) => h.text.length >= 60 && /because|since|so |which|means|rule|remember|think of|why|is the|are the|comes from|gives|=/i.test(h.text))
      rec.ok(explains.every(Boolean) && hints.length === 3, `each hint explains rather than only instructs (at least 60 characters with a reason or worked math): ${JSON.stringify(explains)}; lengths ${hints.map((h) => h.text.length)}`)
      const ai = await L.aiShapes(s)
      const hits = await overlapsInk(s, notes(ai))
      rec.ok(hits.length === 0, `hints do not sit on the ink` + (hits.length ? ` (${JSON.stringify(hits)})` : ''))
      rec.ok(notes(ai).every((q) => q.screen.x >= 0 && q.screen.x + q.screen.w <= VIEW.width && q.screen.y + q.screen.h <= VIEW.height), `hints are on screen (${notes(ai).map((q) => L.brief(q.screen))})`)
      rec.evidence.teachTag = await s.page.evaluate(() => document.querySelector('.tutor-teach-tag')?.textContent ?? null)
      rec.note(`"Still stuck?" tag on Teach me after hint 3: ${rec.evidence.teachTag}`)
      await statusCheck(rec, s, null)
      await s.page.evaluate(() => document.querySelector('.tutor-next')?.click())
      await finish(rec, s, `f8${SUFFIX}-end`)
      return s
    },
  },

  9: {
    name: 'Help on finished, correct work',
    async run(rec) {
      const s = await begin(9)
      const lines = ['2x + 6 = 14', '2x = 8', 'x = 4']
      await writeLines(s, lines)
      const auto = await L.waitCheck(s, { mode: 'auto', from: 0 })
      rec.ok(auto?.status === 200, `auto check 200 (${auto?.status})`)
      await L.settle(s, 2500)
      const before = await L.aiShapes(s)
      const from = s.api.length
      const t0 = Date.now()
      await L.tapHelp(s)
      const help = await L.waitCheck(s, { from, mode: 'help' })
      rec.timings.help_ms = help?.ms
      rec.ok(help?.status === 200, `Help returned 200 (${help?.status}, ${help?.ms} ms)`)
      await L.sleep(1200)
      const after = await L.aiShapes(s)
      const fresh = after.filter((x) => !before.some((b) => b.id === x.id))
      const toast = await L.toastText(s)
      rec.evidence.response = { actions: help?.res?.actions?.map((a) => ({ type: a.type, text: a.text, color: a.color })), fresh: fresh.map((x) => ({ kind: x.kind, text: x.text, color: x.color, screen: L.brief(x.screen) })), toast }
      rec.ok((help?.res?.actions?.length ?? 0) > 0, `the server answered with something (${JSON.stringify(help?.res?.actions?.map((a) => `${a.type}:${a.color}:${a.text}`))})`)
      rec.ok(fresh.some((x) => x.text) || !!toast, `the student sees a response on the page (${fresh.map((x) => `${x.kind} "${x.text}"`).join('; ') || 'nothing new'}${toast ? `; toast "${toast}"` : ''})`)
      rec.ok(!fresh.some((x) => x.color === 'red'), 'nothing red on correct work')
      const hits = await overlapsInk(s, fresh.filter((x) => x.text))
      rec.ok(hits.length === 0, `the response does not sit on the ink` + (hits.length ? ` (${JSON.stringify(hits)})` : ''))
      rec.timings.tap_to_visible_ms = help ? help.t1 - t0 : null
      await statusCheck(rec, s, help)
      await s.page.evaluate(() => document.querySelector('.tutor-next')?.click())
      await finish(rec, s, `f9${SUFFIX}`)
      return s
    },
  },

  10: {
    name: 'Teach me (lesson panel, voice)',
    noRetry: true,
    async run(rec) {
      const s = await begin(10, { hookAudio: true, blockSpeak: NO_SPEAK })
      const { w } = await wrongDerivative(rec, s)
      rec.fails = rec.fails.map((f) => '[setup: wrong derivative] ' + f)
      await L.settle(s, 1500)
      const from = s.api.length
      const t0 = Date.now()
      const camera = () => s.page.evaluate(() => { const c = window.__e2e.editor.getCamera(); return { x: Math.round(c.x), y: Math.round(c.y), z: Math.round(c.z * 1000) / 1000 } })
      const lineOne = L.unionBox(w[0].map ? w[0].map((c) => c.box) : [w[0].box])
      rec.evidence.cameraBefore = await camera()
      await L.tapTeach(s)
      await L.sleep(350)
      const prep = await s.page.evaluate(() => ({ cls: document.querySelector('.tutor-teach')?.className, text: document.querySelector('.tutor-teach')?.textContent }))
      rec.ok(/preparing/.test(prep.cls ?? '') && /Preparing a lesson/.test(prep.text ?? ''), `"Preparing a lesson…" is shown after the tap (${JSON.stringify(prep)})`)
      rec.shots.push(await L.shot(s, `f10${SUFFIX}-a-preparing`))
      const reply = await L.waitCheck(s, { from, mode: 'explain', timeout: 60000 })
      rec.timings.lesson_ms = reply?.ms
      const lesson = reply?.res?.actions?.find((a) => a.type === 'lesson')?.lesson
      if (!rec.ok(reply?.status === 200 && !!lesson, `the explain request returned a lesson (${reply?.status}, ${reply?.ms} ms, actions ${JSON.stringify(reply?.res?.actions?.map((a) => a.type))})`)) {
        await finish(rec, s, `f10${SUFFIX}-failed`)
        return s
      }
      rec.evidence.lesson = { title: lesson.title, steps: lesson.steps.map((x) => ({ say: x.say, write: x.write, caption: x.caption, visual: x.visual?.kind })), practice: lesson.practice ?? null }
      await s.page.waitForSelector('.lesson-panel', { timeout: 8000 }).catch(() => {})
      const panelAt = Date.now()
      rec.timings.tap_to_panel_ms = panelAt - t0
      const geom = async () =>
        s.page.evaluate(() => {
          const r = (sel) => {
            const e = document.querySelector(sel)
            if (!e) return null
            const b = e.getBoundingClientRect()
            return { x: b.x, y: b.y, w: b.width, h: b.height }
          }
          const p = document.querySelector('.lesson-panel')
          const subs = document.querySelector('.lesson-subs')
          return {
            dock: r('.lesson-dock'), panel: r('.lesson-panel'), canvas: r('.app-canvas'), subs: r('.lesson-subs'), controls: r('.tutor-controls'),
            side: document.querySelector('.lesson-dock')?.dataset.side,
            state: p?.dataset.lesson, step: p?.dataset.step, voice: p?.dataset.voice,
            title: document.querySelector('.lesson-title')?.textContent, count: document.querySelector('.lesson-count')?.textContent,
            subsText: subs?.textContent?.trim().slice(0, 200), subsFont: subs ? getComputedStyle(subs.querySelector('[data-w]') ?? subs).fontSize : null,
            dots: document.querySelectorAll('.lesson-dot').length,
            write: document.querySelector('.lesson-write')?.textContent, caption: document.querySelector('.lesson-caption')?.textContent,
            needsTap: document.querySelector('.lesson-start-label')?.textContent ?? null,
          }
        })
      let g = await geom()
      rec.ok(!!g.panel, `the docked lesson panel opened (${rec.timings.tap_to_panel_ms} ms after the tap; side ${g.side}; panel ${L.brief(g.panel)})`)
      // voice: wait for the /api/speak calls to come back
      // the page asks for the first step's clip and the two after it; later ones as the lesson plays
      const firstClips = Math.min(lesson.steps.length, 3)
      const speakDeadline = Date.now() + 40000
      while (Date.now() < speakDeadline) {
        const sp = s.api.filter((r) => r.path === '/api/speak')
        if (sp.length >= firstClips && sp.every((r) => r.status !== undefined)) break
        await L.sleep(300)
      }
      const sp = s.api.filter((r) => r.path === '/api/speak')
      rec.evidence.speak = sp.map((r) => ({ status: r.status, ms: r.ms, type: r.type, bytes: r.bytes, text: r.req?.text?.slice(0, 60) }))
      rec.timings.speak_ms = sp.map((r) => r.ms)
      if (!NO_SPEAK) rec.ok(sp.length >= firstClips && sp.length <= lesson.steps.length, `/api/speak was called for the first steps only, not the whole lesson at once (${sp.length} calls so far for ${lesson.steps.length} steps)`)
      if (!NO_SPEAK) rec.ok(sp.length > 0 && sp.every((r) => r.status === 200 && /^audio\//.test(r.type ?? '')), `every /api/speak returned 200 audio (${sp.map((r) => `${r.status}${r.bytes ? ` ${Math.round(r.bytes / 1024)}k` : ''}`).join(', ')})`)
      await L.sleep(1500)
      g = await geom()
      rec.shots.push(await L.shot(s, `f10${SUFFIX}-b-panel`))
      const audio = await s.page.evaluate(() => window.__audio ?? null)
      rec.evidence.audio = audio
      const realSrc = (audio?.src ?? []).filter((u) => u.startsWith('blob:'))
      rec.ok(realSrc.length >= 1 && (audio?.plays ?? 0) >= 1, `an <audio> element was given a source and played (${audio?.src?.length ?? 0} src sets, ${new Set(realSrc).size} distinct blob urls, ${audio?.plays ?? 0} play() calls, errors ${JSON.stringify(audio?.errors ?? [])})`)
      // data-voice: "audio" = the server's recorded voice, anything else = a fallback (browser speech or timed silence)
      if (NO_SPEAK) rec.ok(g.voice !== 'audio', `with /api/speak blocked the lesson still plays on a fallback voice: data-voice="${g.voice}", state ${g.state}`)
      else rec.ok(g.voice === 'audio', `the lesson is narrated by the server voice, not a fallback: data-voice="${g.voice}"`)
      if (NO_SPEAK && g.needsTap) {
        // headless Chrome has no speech voices, so the browser-speech fallback cannot start either
        rec.note(`voice blocked and no browser speech: the panel waits with "${g.needsTap}" (state ${g.state}); tapping it`)
        await s.page.evaluate(() => document.querySelector('.lesson-start')?.click())
        await L.sleep(2500)
        g = await geom()
        rec.ok(g.state === 'playing' && !g.needsTap, `after the tap the lesson plays without a voice (state ${g.state}, data-voice="${g.voice}")`)
      } else rec.ok(!g.needsTap, `the lesson started by itself (start button: ${g.needsTap})`)
      const tl = await s.page.evaluate(() => [...document.querySelectorAll('.tlui-layout button, .tlui-layout [role="toolbar"], .tlui-style-panel, .tlui-toolbar')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.width < 500).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })))
      rec.evidence.zoomDuringLesson = (await L.view(s)).zoom
      // the panel must not cover the problem
      const ink = await L.inkShapes(s)
      const inkR = L.unionBox(ink.map((i) => i.screen))
      rec.evidence.layout = { dock: L.brief(g.dock), canvas: L.brief(g.canvas), ink: L.brief(inkR), subs: L.brief(g.subs) }
      rec.ok(g.dock && L.overlap(g.dock, inkR) === 0, `the panel does not cover the problem (panel ${L.brief(g.dock)}, ink ${L.brief(inkR)})`)
      rec.ok(g.canvas && inkR.x >= g.canvas.x && inkR.y >= g.canvas.y && inkR.x + inkR.w <= g.canvas.x + g.canvas.w && inkR.y + inkR.h <= g.canvas.y + g.canvas.h, `the whole problem is visible in the notebook area (${L.brief(g.canvas)})`)
      const covered = ink.filter((i) => tl.some((b) => L.overlap(b, i.screen) > 20))
      rec.ok(covered.length === 0, `none of the problem is hidden under the notebook's own buttons` + (covered.length ? `: ${covered.length} of ${ink.length} strokes are under tldraw's menu / "Exit pen mode" / style panel (ink ${L.brief(inkR)})` : ''))
      rec.ok(Math.abs(rec.evidence.zoomDuringLesson - 1) < 0.01, `opening the lesson did not change the student's zoom (now ${Math.round(rec.evidence.zoomDuringLesson * 100)}%, was 100%)`)
      rec.evidence.cameraOpen = await camera()
      // line 1 by its own strokes: the first line written is the lowest-numbered ink at the top
      const top = ink.filter((i) => i.screen.y + i.screen.h / 2 < inkR.y + inkR.h * 0.45)
      const l1 = L.unionBox(top.map((i) => i.screen))
      const l1Hidden = top.filter((i) => tl.some((b) => L.overlap(b, i.screen) > 0) || (g.dock && L.overlap(g.dock, i.screen) > 0) || i.screen.x < 0 || i.screen.y < 0)
      rec.evidence.lineOne = { box: L.brief(l1), strokes: top.length, hidden: l1Hidden.length, written: L.brief(lineOne) }
      rec.ok(top.length > 0 && l1Hidden.length === 0, `line 1 is fully visible beside the panel (${top.length} strokes at ${L.brief(l1)}, ${l1Hidden.length} under a control or the panel)`)
      rec.note(`camera before the tap ${JSON.stringify(rec.evidence.cameraBefore)}, with the lesson open ${JSON.stringify(rec.evidence.cameraOpen)}`)
      const marks = redMarks(await L.aiShapes(s))
      rec.ok(marks.length >= 1 && marks.every((m) => g.dock && L.overlap(g.dock, m.screen) === 0), `the red mark is still there and visible beside the panel (${marks.length})`)
      rec.ok(g.controls && g.dock && L.overlap(g.dock, g.controls) === 0, `Help / Teach me are not under the panel (controls ${L.brief(g.controls)})`)
      // subtitles
      rec.ok(!!g.subsText && g.subs && g.subs.h > 10 && g.subs.y + g.subs.h <= VIEW.height + 1, `subtitles are visible: "${g.subsText?.slice(0, 70)}…" (${L.brief(g.subs)}, font ${g.subsFont})`)
      rec.ok(g.dots === lesson.steps.length, `${g.dots} step dots for ${lesson.steps.length} steps`)
      // step through with the Next button
      const walk = []
      for (let i = 0; i < lesson.steps.length + 1; i++) {
        const st = await geom()
        walk.push({ step: st.step, state: st.state, subs: st.subsText?.slice(0, 60), write: st.write, caption: st.caption?.slice(0, 60), count: st.count })
        if (i === Math.floor(lesson.steps.length / 2)) rec.shots.push(await L.shot(s, `f10${SUFFIX}-c-midstep`))
        const next = await s.page.$('button[aria-label="Next step"]:not([disabled])')
        if (!next) break
        await next.click()
        await L.sleep(700)
      }
      rec.evidence.walk = walk
      const stepsSeen = new Set(walk.map((x) => x.step))
      // the lesson plays by itself while the clips are awaited, so the walk may start a step or two in
      const first = Math.min(...[...stepsSeen].map(Number))
      rec.ok(stepsSeen.size === lesson.steps.length - first && [...stepsSeen].map(Number).includes(lesson.steps.length - 1), `Next steps through every remaining step (${[...stepsSeen].join(',')} of ${lesson.steps.length})`)
      rec.ok(walk.every((x, i) => norm(x.subs ?? '').length > 0 && norm(lesson.steps[Number(x.step)]?.say ?? '').startsWith(norm(x.subs ?? '').slice(0, 20))), 'each step shows its own narration as subtitles')
      // let the last step play out, then see what "practice" does
      const endDeadline = Date.now() + 45000
      let end = await geom()
      while (Date.now() < endDeadline && end.state !== 'ended') {
        await L.sleep(500)
        end = await geom()
      }
      rec.timings.last_step_to_end_ms = 45000 - (endDeadline - Date.now())
      rec.ok(end.state === 'ended', `the lesson reached its end (data-lesson="${end.state}", step ${end.step})`)
      await L.sleep(2500)
      const afterAi = await L.aiShapes(s)
      const practiceShapes = afterAi.filter((x) => x.kind && /practice|given/.test(x.kind))
      const panelText = await s.page.evaluate(() => document.querySelector('.lesson-panel')?.innerText ?? '')
      rec.evidence.practice = { sent: lesson.practice ?? null, shapesOnCanvas: practiceShapes.map((x) => ({ kind: x.kind, text: x.text, screen: L.brief(x.screen) })), panelMentions: /your turn/i.test(panelText), kinds: [...new Set(afterAi.map((x) => x.kind))] }
      if (lesson.practice) {
        const shown = practiceShapes.length > 0 || panelText.includes(lesson.practice.prompt) || afterAi.some((x) => x.text && norm(x.text).includes(norm(lesson.practice.problem).slice(0, 6)))
        rec.ok(shown, `the practice problem the server sent (${JSON.stringify(lesson.practice)}) is shown to the student (canvas shapes: ${practiceShapes.length}, panel says "Your turn": ${/your turn/i.test(panelText)})`)
      } else rec.note('the server sent no practice problem with this lesson')
      rec.shots.push(await L.shot(s, `f10${SUFFIX}-d-end`))
      rec.evidence.audioEnd = await s.page.evaluate(() => window.__audio ?? null)
      rec.note(`audio by the end: ${rec.evidence.audioEnd?.src.length} src sets, ${rec.evidence.audioEnd?.plays} play() calls, ${rec.evidence.audioEnd?.ended} ended, errors ${JSON.stringify(rec.evidence.audioEnd?.errors)}`)
      await statusCheck(rec, s, reply)
      // "Your turn": answer the practice problem by hand and see whether it is checked (recorded, not judged:
      // this part of the page is being built while this run happens)
      if (lesson.practice && practiceShapes.length) {
        const ask = practiceShapes.at(-1)
        const inView = ask.screen.y > 60 && ask.screen.y + ask.screen.h < VIEW.height - 150
        rec.note(`practice written on the canvas: ${practiceShapes.map((x) => `"${x.text}" at ${L.brief(x.screen)}`).join('; ')}; in view: ${inView}`)
        const ctl = await geom()
        const hidden = practiceShapes.filter((x) => (ctl.dock && L.overlap(ctl.dock, x.screen) > 0) || x.screen.y < 0 || x.screen.y + x.screen.h > VIEW.height || x.screen.x + x.screen.w > VIEW.width)
        rec.ok(hidden.length === 0, `the practice problem is fully visible (not under the panel or off screen)` + (hidden.length ? `: ${hidden.map((x) => `"${x.text}" at ${L.brief(x.screen)}`).join('; ')}; dock ${L.brief(ctl.dock)}` : ''))
        const hits = await overlapsInk(s, practiceShapes)
        rec.ok(hits.length === 0, `the practice problem is not written over the student's ink` + (hits.length ? ` (${JSON.stringify(hits.slice(0, 2))})` : ''))
        if (inView) {
          const from2 = s.api.length
          const ans = await L.write(s, '8x + 5', ask.screen.x + ask.screen.w + 24, ask.screen.y + ask.screen.h * 0.74, XH)
          const chk = await L.waitCheck(s, { from: from2, mode: 'auto', timeout: 45000 })
          await L.sleep(1200)
          const now = await L.aiShapes(s)
          const fresh = now.filter((x) => !afterAi.some((y) => y.id === x.id))
          rec.evidence.practiceAnswer = { wrote: '8x + 5 (correct)', at: L.brief(ans.box), status: chk?.status, ms: chk?.ms, given: chk?.req?.given, read: chk?.res?.lines?.map((l) => ({ plain: l.plain, src: l.source, id: l.line_id })), actions: chk?.res?.actions?.map((a) => ({ type: a.type, color: a.color, text: a.text })), drawn: fresh.map((x) => ({ kind: x.kind, color: x.color, text: x.text, screen: L.brief(x.screen) })), debug: chk?.res?.debug }
          rec.note(`practice answered correctly by hand ("8x + 5" after the tutor's "g'(x) ="): check ${chk?.status} in ${chk?.ms} ms, request.given ${JSON.stringify(chk?.req?.given?.map((g) => g.plain))}, read ${JSON.stringify(chk?.res?.lines?.map((l) => l.plain))}, actions ${JSON.stringify(chk?.res?.actions?.map((a) => `${a.type}:${a.color}:${a.text}`))}, new on page ${JSON.stringify(fresh.map((x) => `${x.kind}:${x.color}:${x.text ?? ''}`))}`)
          rec.ok(!fresh.some((x) => x.color === 'red'), 'a correct practice answer gets no red mark')
          const zNow = (await L.view(s)).zoom
          const tall = Math.max(...practiceShapes.map((x) => x.screen.h))
          rec.evidence.practiceSize = { zoom: zNow, tallestLinePx: Math.round(tall), answerPx: Math.round(ans.box.h) }
          rec.ok(Math.abs(zNow - 1) < 0.01 && tall >= 40, `the practice problem is at normal size (zoom ${Math.round(zNow * 100)}%, its lines up to ${Math.round(tall)} px tall on screen, the answer written beside it ${Math.round(ans.box.h)} px)`)
          rec.shots.push(await L.shot(s, `f10${SUFFIX}-f-practice-answered`))
        }
      }
      // close: the marker stays on the canvas
      // open it again from the pill (it folded away for the practice), then close: the page must not move
      if (!(await geom()).panel) {
        await s.page.evaluate(() => document.querySelector('.lesson-pill')?.click())
        await L.sleep(1800)
      }
      const camOpen2 = await camera()
      await s.page.evaluate(() => document.querySelector('button[aria-label="Close the lesson"]')?.click())
      await L.sleep(900)
      const closed = await geom()
      const camClosed = await camera()
      rec.evidence.cameraClose = { open: camOpen2, closed: camClosed }
      rec.ok(JSON.stringify(camOpen2) === JSON.stringify(camClosed), `closing the lesson does not move or zoom the page (camera ${JSON.stringify(camOpen2)} -> ${JSON.stringify(camClosed)})`)
      rec.ok(camClosed.z === 1, `the zoom is still 100% after the lesson (${Math.round(camClosed.z * 100)}%)`)
      rec.ok(!closed.panel, 'Close removes the panel')
      rec.ok((await L.shapes(s)).some((x) => x.kind === 'lesson'), 'a lesson marker stays on the canvas to reopen it')
      await finish(rec, s, `f10${SUFFIX}-e-closed`)
      return s
    },
  },

  11: {
    name: 'Two problems far apart',
    async run(rec) {
      const s = await begin(11)
      const first = await wrongDerivative(rec, s, 230)
      await L.settle(s, 1500)
      const before = await L.aiShapes(s)
      rec.shots.push(await L.shot(s, `f11${SUFFIX}-a-first`))
      const from = s.api.length
      const y2 = LANDSCAPE ? 560 : 800
      const x2 = LANDSCAPE ? 560 : X0
      const lines = ['2x + 6 = 14', '2x = 20']
      const w = await writeLines(s, lines, x2, y2)
      const reply = await L.waitCheck(s, { from, mode: 'auto' })
      await L.settle(s, 3000)
      rec.timings.second_check_ms = reply?.ms
      rec.ok(reply?.status === 200, `check on the second problem returned 200 (${reply?.status})`)
      rec.evidence.secondImage = reply?.image
      rec.evidence.secondRead = reply?.res?.lines?.map((l) => l.plain)
      rec.ok((reply?.res?.lines ?? []).length === 2, `only the second problem was sent (read ${JSON.stringify(reply?.res?.lines?.map((l) => l.plain))})`)
      const after = await L.aiShapes(s)
      const firstBox = L.unionBox(first.w.map((x) => x.box))
      const secondBox = L.unionBox(w.map((x) => x.box))
      const near = (list, box) => list.filter((x) => Math.abs(x.screen.y + x.screen.h / 2 - (box.y + box.h / 2)) < box.h + 90)
      const b1 = near(before, firstBox)
      const a1 = near(after, firstBox)
      rec.evidence.first = { before: b1.map((x) => `${x.kind}:${x.text ?? ''}`), after: a1.map((x) => `${x.kind}:${x.text ?? ''}`) }
      rec.ok(b1.length > 0 && b1.every((x) => after.some((y) => y.id === x.id || (y.kind === x.kind && y.text === x.text && Math.abs(y.screen.y - x.screen.y) < 3))), `feedback on the first problem survived (${b1.length} shapes before, ${a1.length} after: ${a1.map((x) => x.kind).join(', ')})`)
      const m2 = redMarks(after).filter((m) => L.overlap(m.screen, w[1].box) > 0)
      rec.ok(m2.length >= 1, `the second problem's mistake got its own red mark (${m2.length})`)
      const q2 = notes(after).filter((q) => !before.some((b) => b.id === q.id))
      rec.ok(q2.length >= 1, `the second problem got a note: ${q2.map((q) => `"${q.text}"`).join(' ')}`)
      const hits = await overlapsInk(s, notes(after))
      rec.ok(hits.length === 0, `notes do not sit on the ink` + (hits.length ? ` (${JSON.stringify(hits)})` : ''))
      rec.evidence.boxes = { first: L.brief(firstBox), second: L.brief(secondBox) }
      await statusCheck(rec, s, L.checks(s, 'auto').at(-1))
      await finish(rec, s, `f11${SUFFIX}-b-both`)
      return s
    },
  },

  12: {
    name: 'Zoomed out to 40%, large writing',
    async run(rec) {
      const s = await begin(12)
      // zoom out with the page's own zoom control (keyboard: there is no pinch in headless Chrome)
      await s.page.evaluate(() => {
        const ed = window.__e2e.editor
        ed.setCamera({ x: 0, y: 0, z: 0.4 })
      })
      await L.sleep(300)
      const v = await L.view(s)
      rec.ok(Math.abs(v.zoom - 0.4) < 0.01, `zoom is 40% (${v.zoom})`)
      const { w } = await wrongDerivative(rec, s)
      const ai = await L.aiShapes(s)
      const qs = notes(ai)
      const ink = await L.inkShapes(s)
      const digitH = Math.max(...w[1].glyphs.filter((g) => /[0-9]/.test(g.c)).map((g) => g.box.h))
      const fonts = qs.map((q) => fontPx(q, v.zoom))
      rec.evidence.zoom = { zoom: v.zoom, handwriting_xheight_screen_px: XH, digit_height_screen_px: Math.round(digitH), ink_page_height: Math.round(ink[0]?.page.h ?? 0), note_font_screen_px: fonts, note_boxes: qs.map((q) => L.brief(q.screen)) }
      rec.ok(fonts.length > 0 && fonts.every((f) => f >= 12), `the note is readable on screen: font ${fonts.map((f) => f.toFixed(1)).join('/')} px on screen (handwriting digits ${Math.round(digitH)} px tall, x-height ${XH} px)`)
      rec.ok(fonts.every((f) => f <= digitH * 1.5), `the note is not bigger than the handwriting (${fonts.map((f) => f.toFixed(1))} px vs digits ${Math.round(digitH)} px)`)
      const reading = (await L.shapes(s)).filter((x) => x.kind === 'reading')
      rec.evidence.zoom.reading_font_screen_px = reading.map((x) => fontPx(x, v.zoom))
      rec.ok(reading.length > 0 && reading.every((x) => fontPx(x, v.zoom) >= 9), `"what AI read" text is legible (${reading.map((x) => fontPx(x, v.zoom).toFixed(1)).join('/')} px)`)
      const marks = redMarks(ai)
      rec.evidence.zoom.mark_screen = marks.map((m) => L.brief(m.screen))
      await finish(rec, s, `f12${SUFFIX}`)
      return s
    },
  },

  13: {
    name: 'Worksheet PDF',
    async run(rec) {
      const pdf = await makeWorksheet()
      const s = await begin(13)
      const input = await s.page.$('input[type=file]')
      const t0 = Date.now()
      await input.uploadFile(pdf.file)
      let sheets = []
      for (let i = 0; i < 60 && !sheets.length; i++) {
        await L.sleep(250)
        sheets = (await L.shapes(s)).filter((x) => x.meta?.worksheet)
      }
      rec.timings.import_ms = Date.now() - t0
      if (!rec.ok(sheets.length === 1, `the PDF was imported as ${sheets.length} page image(s) in ${rec.timings.import_ms} ms`)) {
        await finish(rec, s, `f13${SUFFIX}-import-failed`)
        return s
      }
      await L.sleep(800)
      const sheet = (await L.shapes(s)).find((x) => x.meta?.worksheet).screen
      const at = (r) => ({ x: sheet.x + r.x * sheet.w, y: sheet.y + r.y * sheet.h, w: r.w * sheet.w, h: r.h * sheet.h })
      let print = pdf.rects.map(at)
      rec.evidence.sheet = { sheet: L.brief(sheet), print: print.map(L.brief) }
      rec.ok(sheet.x >= 0 && sheet.x + sheet.w <= VIEW.width, `the sheet fits the screen width (${L.brief(sheet)})`)
      await L.tool(s, 'draw')
      // write under problem 1 (a wrong derivative: the +2x should be +2)
      const y1 = print[0].y + print[0].h + 75
      const w = await L.write(s, "f'(x) = 3x^2 + 2x", sheet.x + 70, y1, 22)
      const reply = await L.waitCheck(s, { mode: 'auto', from: 0, timeout: 50000 })
      await L.settle(s, 2500)
      rec.timings.check_ms = reply?.ms
      rec.ok(reply?.status === 200, `auto check returned 200 (${reply?.status}, ${reply?.ms} ms)`)
      rec.ok(reply?.req?.has_worksheet === true, `the request said a worksheet is in the picture (has_worksheet: ${JSON.stringify(reply?.req?.has_worksheet)})`)
      rec.evidence.read1 = reply?.res?.lines?.map((l) => ({ plain: l.plain, src: l.source }))
      rec.ok((reply?.res?.lines ?? []).some((l) => l.source === 'printed' && /x\^3|x\*\*3/.test(l.plain)), `the printed problem 1 was read as printed context (${JSON.stringify(rec.evidence.read1)})`)
      rec.ok((reply?.res?.lines ?? []).some((l) => l.source !== 'printed' && norm(l.plain) === norm("f'(x) = 3x^2 + 2x")), 'the handwriting under it was read as written')
      const ai = await L.aiShapes(s)
      const fb = ai.filter((x) => ['note', 'ask', 'circle', 'underline', 'figure', 'solution'].includes(x.kind))
      rec.evidence.feedback1 = fb.map((x) => ({ kind: x.kind, color: x.color, text: x.text, screen: L.brief(x.screen) }))
      rec.ok(redMarks(fb).length >= 1 && notes(fb).length >= 1, `the wrong step under problem 1 got a mark and a note (${fb.map((x) => x.kind).join(', ') || 'nothing'})`)
      const onPrint = notes(fb).filter((x) => print.some((p) => L.overlap(x.screen, p) > 8))
      rec.ok(onPrint.length === 0, `feedback text does not sit on printed text` + (onPrint.length ? ` (${onPrint.map((x) => `"${x.text?.slice(0, 30)}" at ${L.brief(x.screen)}`).join('; ')}; print at ${print.map(L.brief).join(' | ')})` : ''))
      const marksOnPrint = redMarks(fb).filter((x) => print.some((p) => L.overlap(x.screen, p) > 8))
      rec.ok(marksOnPrint.length === 0, `the red mark is on the handwriting, not on the print (${redMarks(fb).map((m) => L.brief(m.screen))})`)
      const hits = await overlapsInk(s, notes(fb))
      rec.ok(hits.length === 0, `feedback text does not sit on the ink` + (hits.length ? ` (${JSON.stringify(hits)})` : ''))
      await statusCheck(rec, s, reply)
      rec.shots.push(await L.shot(s, `f13${SUFFIX}-a-problem1`))
      // scroll down to problem 2 (two-finger scroll = wheel), nothing written there
      const dy = Math.round(print[1].y - VIEW.height * 0.3)
      await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: VIEW.width / 2, y: VIEW.height / 2, deltaX: 0, deltaY: dy, pointerType: 'mouse' })
      await L.sleep(800)
      const sheet2 = (await L.shapes(s)).find((x) => x.meta?.worksheet).screen
      rec.ok(Math.abs(sheet2.y - (sheet.y - dy)) < 30, `scrolled down ${dy} px (sheet top ${Math.round(sheet.y)} -> ${Math.round(sheet2.y)})`)
      const at2 = (r) => ({ x: sheet2.x + r.x * sheet2.w, y: sheet2.y + r.y * sheet2.h, w: r.w * sheet2.w, h: r.h * sheet2.h })
      print = pdf.rects.map(at2)
      const inkNow = await L.inkShapes(s)
      rec.note(`after scrolling: problem 2 at ${L.brief(print[1])}; handwriting at ${L.brief(L.unionBox(inkNow.map((i) => i.screen)))} (viewport ${VIEW.width}x${VIEW.height})`)
      const before = await L.aiShapes(s)
      const from = s.api.length
      await L.tapHelp(s)
      const help = await L.waitCheck(s, { from, mode: 'help', timeout: 50000 })
      await L.sleep(1500)
      rec.timings.help_ms = help?.ms
      rec.ok(help?.status === 200, `Help returned 200 (${help?.status}, ${help?.ms} ms)`)
      rec.evidence.help = { image: help?.image, help_box: help?.req?.help_box, read: help?.res?.lines?.map((l) => ({ plain: l.plain, src: l.source })), actions: help?.res?.actions?.map((a) => ({ type: a.type, text: a.text, line_id: a.line_id, box: a.box })) }
      const hintText = (help?.res?.actions ?? []).map((a) => a.text ?? '').join(' ')
      const aboutP2 = /3\s*x|7|11|18|add|both sides|isolate|subtract|divide/i.test(hintText) && !/deriv|power rule|x\^3|x\^\{?3/i.test(hintText)
      rec.ok(aboutP2, `the hint is about problem 2 (3x - 7 = 11), not problem 1: "${hintText}"`)
      const after = await L.aiShapes(s)
      const fresh = notes(after).filter((x) => !before.some((b) => b.id === x.id))
      rec.evidence.hint2 = fresh.map((x) => ({ text: x.text, screen: L.brief(x.screen) }))
      if (rec.ok(fresh.length >= 1, `a hint was drawn (${fresh.length})`)) {
        const h = fresh[0]
        rec.ok(h.screen.y >= 0 && h.screen.y + h.screen.h <= VIEW.height && h.screen.x >= 0 && h.screen.x + h.screen.w <= VIEW.width, `the hint is on screen (${L.brief(h.screen)})`)
        rec.ok(Math.abs(h.screen.y - print[1].y) < 320, `the hint is near problem 2 (hint ${L.brief(h.screen)}, problem 2 ${L.brief(print[1])})`)
        const onP = fresh.filter((x) => print.some((p) => L.overlap(x.screen, p) > 8))
        rec.ok(onP.length === 0, `the hint does not sit on printed text` + (onP.length ? ` (hint ${L.brief(onP[0].screen)}; print ${print.map(L.brief).join(' | ')})` : ''))
      }
      await statusCheck(rec, s, help)
      await s.page.evaluate(() => document.querySelector('.tutor-next')?.click())
      await finish(rec, s, `f13${SUFFIX}-b-problem2`)
      return s
    },
  },

  16: {
    name: 'Worksheet zoomed out: circle a printed problem, then Help',
    async run(rec) {
      const pdf = await makeWorksheet()
      const s = await begin(16)
      const input = await s.page.$('input[type=file]')
      await input.uploadFile(pdf.file)
      let sheets = []
      for (let i = 0; i < 60 && !sheets.length; i++) {
        await L.sleep(250)
        sheets = (await L.shapes(s)).filter((x) => x.meta?.worksheet)
      }
      if (!rec.ok(sheets.length === 1, `the PDF was imported (${sheets.length} page image)`)) {
        await finish(rec, s, `f16${SUFFIX}-import-failed`)
        return s
      }
      await L.sleep(800)
      // zoom far out, the way a whole page is looked at on the iPad
      await s.page.evaluate(() => {
        const ed = window.__e2e.editor
        const z = 0.4
        const b = ed.getCurrentPageBounds()
        const v = ed.getViewportScreenBounds()
        ed.setCamera({ x: v.w / 2 / z - (b.x + b.w / 2), y: v.h / 2 / z - (b.y + b.h / 2), z })
      })
      await L.sleep(400)
      const v = await L.view(s)
      rec.ok(v.zoom < 0.5, `zoomed out below 50% (${v.zoom})`)
      const sheet = (await L.shapes(s)).find((x) => x.meta?.worksheet).screen
      const at = (r) => ({ x: sheet.x + r.x * sheet.w, y: sheet.y + r.y * sheet.h, w: r.w * sheet.w, h: r.h * sheet.h })
      const print = pdf.rects.map(at)
      rec.note(`sheet on screen ${L.brief(sheet)}; problem 1 ${L.brief(print[0])}; problem 2 ${L.brief(print[1])}`)
      await L.tool(s, 'draw')
      // circle problem 2, then an arrow from it out past the edge of the page
      const p = print[1]
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2, rx = p.w / 2 + 10, ry = p.h / 2 + 9
      const ring = []
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * Math.PI * 2.1
        ring.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])
      }
      await L.stroke(s, ring)
      await L.stroke(s, [[cx + rx, cy], [sheet.x + sheet.w * 0.8, cy - 12], [sheet.x + sheet.w + 30, cy - 40]])
      // the pause after drawing sends an auto check: let it finish before asking
      await L.settle(s, 3500)
      const before = await L.aiShapes(s)
      const from = s.api.length
      await L.tapHelp(s)
      const help = await L.waitCheck(s, { from, mode: 'help', timeout: 60000 })
      await L.sleep(1500)
      rec.timings.help_ms = help?.ms
      rec.ok(help?.status === 200, `Help returned 200 (${help?.status}, ${help?.ms} ms)`)
      rec.ok((help?.ms ?? 1e9) < 20000, `Help answered in under 20 s (${help?.ms} ms)`)
      const read = help?.res?.lines?.map((l) => ({ plain: l.plain, src: l.source })) ?? []
      rec.evidence.help = { image: help?.image, help_box: help?.req?.help_box, read, actions: help?.res?.actions?.map((a) => ({ type: a.type, text: a.text })) }
      rec.ok(!read.some((l) => /x\^3|x\*\*3/.test(l.plain)), `only the circled part of the sheet was sent, not problem 1 (${JSON.stringify(read.map((l) => l.plain))})`)
      const hintText = (help?.res?.actions ?? []).map((a) => a.text ?? '').join(' ')
      const aboutP2 = /3\s*x|7|11|18|add|both sides|isolate|subtract|divide/i.test(hintText) && !/deriv|power rule|x\^3|x\^\{?3/i.test(hintText)
      rec.ok(aboutP2, `the hint is about the circled problem (3x - 7 = 11): "${hintText}"`)
      const after = await L.aiShapes(s)
      const fresh = notes(after).filter((x) => !before.some((b) => b.id === x.id))
      rec.ok(fresh.length >= 1, `a hint was drawn (${fresh.length}${fresh[0] ? `: ${L.brief(fresh[0].screen)}` : ''})`)
      await statusCheck(rec, s, help)
      await s.page.evaluate(() => document.querySelector('.tutor-next')?.click())
      await finish(rec, s, `f16${SUFFIX}-circled`)
      return s
    },
  },

  17: {
    name: 'Sample worksheet: 3D graph under a printed problem, then the Solve button',
    async run(rec) {
      const s = await begin(17)
      const input = await s.page.$('input[type=file]')
      await input.uploadFile(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/samples/mixed.pdf'))
      let sheets = []
      for (let i = 0; i < 60 && !sheets.length; i++) {
        await L.sleep(250)
        sheets = (await L.shapes(s)).filter((x) => x.meta?.worksheet)
      }
      if (!rec.ok(sheets.length === 1, `mixed.pdf was imported (${sheets.length} page image)`)) {
        await finish(rec, s, `f17${SUFFIX}-import-failed`)
        return s
      }
      await L.sleep(800)
      const sheet = (await L.shapes(s)).find((x) => x.meta?.worksheet).screen
      // the four problems are printed at these heights of the page (see how the samples were made)
      const rowY = (i) => sheet.y + ((150 + i * 226) / 1056) * sheet.h
      rec.note(`sheet on screen ${L.brief(sheet)}`)
      // the Solve button on a fresh sheet, nothing written or selected: problem 1, every step
      const before = await L.aiShapes(s)
      const from = s.api.length
      const b = await s.page.evaluate(() => {
        const r = document.querySelector('.tutor-solve')?.getBoundingClientRect()
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
      })
      if (rec.ok(!!b, 'there is a Solve button')) {
        await L.uiTap(s, b.x, b.y)
        const solve = await L.waitCheck(s, { from, mode: 'help', timeout: 60000 })
        await L.sleep(4000)
        rec.timings.solve_ms = solve?.ms
        rec.ok(solve?.status === 200, `Solve returned 200 (${solve?.status}, ${solve?.ms} ms)`)
        const sol = (solve?.res?.actions ?? []).find((x) => x.type === 'solution')
        rec.evidence.solve = { question: solve?.req?.question, help_box: solve?.req?.help_box, actions: solve?.res?.actions?.map((x) => ({ type: x.type, line_id: x.line_id, text: x.text, steps: x.steps })), tools: solve?.res?.debug?.tool_calls }
        rec.ok(!!sol && (sol.steps?.length ?? 0) >= 2, `the reply is a worked solution with steps (${JSON.stringify(sol?.steps ?? (solve?.res?.actions ?? []).map((x) => x.type + ':' + (x.text ?? '')))})`)
        const after = await L.aiShapes(s)
        const fresh = after.filter((x) => !before.some((o) => o.id === x.id))
        rec.evidence.solutionShapes = fresh.map((x) => ({ kind: x.kind, text: x.text, screen: L.brief(x.screen) }))
        rec.ok(fresh.length >= 2, `the steps were written on the page (${fresh.length} new shapes: ${fresh.map((x) => `${x.kind} ${L.brief(x.screen)}`).join('; ')})`)
        const printRows = [0, 1, 2, 3].map((i) => ({ x: sheet.x + sheet.w * 0.07, y: rowY(i) - 4, w: sheet.w * 0.6, h: 34 }))
        const onPrint = fresh.filter((x) => printRows.some((p) => L.overlap(x.screen, p) > 8))
        rec.ok(onPrint.length === 0, `no step is written over a printed problem` + (onPrint.length ? ` (${onPrint.map((x) => L.brief(x.screen)).join('; ')})` : ''))
      }
      rec.shots.push(await L.shot(s, `f17${SUFFIX}-a-solved`))
      const afterSolve = s.api.length
      await L.tool(s, 'draw')
      // under problem 4: the surface and the word "graph", the way Preet wrote it
      const y4 = rowY(3) + 70
      await L.write(s, 'z = x^2 + y^2', sheet.x + 90, y4, 20)
      await L.write(s, 'graph', sheet.x + 330, y4 + 6, 20)
      const reply = await L.waitCheck(s, { mode: 'auto', from: afterSolve, timeout: 60000 })
      await L.sleep(3500)
      rec.ok(reply?.status === 200, `auto check returned 200 (${reply?.status}, ${reply?.ms} ms)`)
      const fig = reply?.res?.actions?.find((x) => x.type === 'figure')
      rec.evidence.read = reply?.res?.lines?.map((l) => ({ plain: l.plain, src: l.source }))
      rec.ok(fig?.figure?.kind === 'surface3d', `the server sent a surface3d figure (${fig?.figure?.kind ?? (reply?.res?.actions ?? []).map((x) => x.type).join(', ') ?? 'nothing'})`)
      const surf = (await L.shapes(s)).find((x) => x.type === 'surface3d')
      if (rec.ok(!!surf, 'a surface3d shape is on the page')) {
        const r = surf.screen
        rec.ok(r.x + r.w > 0 && r.y + r.h > 0 && r.x < VIEW.width && r.y < VIEW.height, `the surface is in view (${L.brief(r)}; screen ${VIEW.width}x${VIEW.height})`)
        rec.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= VIEW.width && r.y + r.h <= VIEW.height, `the surface is fully on screen (${L.brief(r)})`)
      }
      rec.note(`status line: ${await L.statusText(s)}; toast: ${await L.toastText(s)}`)
            await finish(rec, s, `f17${SUFFIX}-b-surface`)
      return s
    },
  },

  14: {
    name: 'Handwriting toggle, finish my line',
    async run(rec) {
      const s = await begin(14)
      await L.clickText(s, '.tutor-chip', 'Write in my handwriting')
      const on = await s.page.evaluate(() => [...document.querySelectorAll('.tutor-chip')].find((e) => e.textContent.includes('handwriting'))?.getAttribute('aria-pressed'))
      rec.ok(on === 'true', `the chip switched on (aria-pressed=${on})`)
      await L.tool(s, 'draw')
      const lines = ['2x + 6 = 14', '2x = 8', 'x = 4']
      await writeLines(s, lines, X0, 200)
      const auto = await L.waitCheck(s, { mode: 'auto', from: 0 })
      rec.ok(auto?.status === 200, `auto check 200 (${auto?.status})`)
      // the hand is learned in the background after the reply
      const gDeadline = Date.now() + 40000
      while (Date.now() < gDeadline) {
        const g = s.api.filter((r) => r.path === '/api/glyphs')
        if (g.length && g.every((r) => r.status !== undefined)) break
        await L.sleep(300)
      }
      await L.sleep(1200)
      const bank = async () =>
        s.page.evaluate(() => {
          try {
            const b = JSON.parse(localStorage.getItem('tutor.glyphs.v1') ?? 'null')
            if (!b) return null
            const chars = b.chars ?? b.samples ?? b.glyphs ?? b
            return { keys: Object.keys(b), chars: typeof chars === 'object' ? Object.keys(chars).join('') : String(chars).slice(0, 80) }
          } catch (e) {
            return { error: String(e) }
          }
        })
      rec.evidence.bankAfterThreeLines = await bank()
      rec.note(`glyph bank after three lines: ${JSON.stringify(rec.evidence.bankAfterThreeLines)}`)
      await finishLine(rec, s, 620, { hand: true })
      await L.sleep(1500)
      const g = s.api.filter((r) => r.path === '/api/glyphs')
      rec.evidence.glyphCalls = g.map((r) => ({ at: r.at, status: r.status, ms: r.ms, image: r.image, found: r.res?.glyphs?.length, chars: r.res?.glyphs?.map((x) => x.char).join('') }))
      rec.evidence.bankEnd = await bank()
      rec.ok(g.length >= 1 && g.every((r) => r.status === 200), `/api/glyphs: ${g.length} call(s), status ${g.map((r) => r.status).join(', ')}, characters found ${g.map((r) => r.res?.glyphs?.length).join(', ')}`)
      await finish(rec, s, `f14${SUFFIX}`)
      return s
    },
  },

  15: {
    name: 'Reload with the same ?page= id',
    async run(rec) {
      const s = await begin(15)
      await wrongDerivative(rec, s)
      rec.fails = rec.fails.map((f) => '[setup: wrong derivative] ' + f)
      await L.sleep(6000) // autosave: 3 s after the last change
      const before = await L.shapes(s)
      const count = (list) => ({ ink: list.filter((x) => !x.ai && x.type === 'draw').length, marks: redMarks(list.filter((x) => x.ai)).length, notes: notes(list.filter((x) => x.ai)).map((x) => x.text), reading: list.filter((x) => x.kind === 'reading').length })
      const b = count(before)
      rec.shots.push(await L.shot(s, `f15${SUFFIX}-a-before`))
      const apiBefore = s.api.length
      // (a) reload in the same browser
      await s.page.reload({ waitUntil: 'domcontentloaded' })
      await s.page.waitForSelector('.tutor-help')
      await L.installProbe(s)
      await L.sleep(3500)
      const a = count(await L.shapes(s))
      rec.evidence.sameBrowser = { before: b, after: a }
      rec.ok(a.ink === b.ink, `same browser: the ink came back (${b.ink} strokes before, ${a.ink} after)`)
      rec.ok(a.marks === b.marks && a.marks > 0, `same browser: the red mark came back (${b.marks} -> ${a.marks})`)
      rec.ok(JSON.stringify(a.notes) === JSON.stringify(b.notes) && a.notes.length > 0, `same browser: the question came back (${JSON.stringify(a.notes)})`)
      await L.sleep(3500)
      const extra = s.api.slice(apiBefore).filter((r) => r.path === '/api/check')
      rec.ok(extra.length === 0, `no new check was sent just because the page reloaded (${extra.length} sent)`)
      const dup = count(await L.shapes(s))
      rec.ok(dup.marks === b.marks && dup.notes.length === b.notes.length, `feedback was not duplicated after the reload (${dup.marks} marks, ${dup.notes.length} notes)`)
      rec.shots.push(await L.shot(s, `f15${SUFFIX}-b-reloaded`))
      s.loads.pop() // that reload was ours
      // (b) a fresh browser (nothing local): only what Firestore has
      rec.evidence.firestoreRequests = s.firestore
      if (s.firestore === 0) {
        rec.note('cloud save is OFF on this page (no request to Firestore: the dev server has no web/.env.local), so the restore is done by hand: the saved page is loaded into a fresh browser with the same two calls restorePage() makes')
        await simulatedRestore(rec, s, b, count)
      } else {
        await freshBrowserRestore(rec, s, b, count)
      }
      await finish(rec, s, `f15${SUFFIX}-d-end`)
      return s
    },
  },

  live: {
    name: 'Live site smoke (tutor-1098c.web.app)',
    async run(rec) {
      const probe = await L.open({ base: L.LIVE_URL, pageId: pid('live-load'), viewport: VIEW })
      const ui = await probe.page.evaluate(() => ({
        draw: !!document.querySelector('[data-testid="tools.draw"]'),
        eraser: !!document.querySelector('[data-testid="tools.eraser"]'),
        help: !!document.querySelector('.tutor-help'),
        teach: !!document.querySelector('.tutor-teach'),
        chips: [...document.querySelectorAll('.tutor-chip')].map((e) => e.textContent.trim()),
        license: document.body.innerText.includes('Get a license'),
        scripts: [...document.scripts].map((x) => x.src.split('/').pop()).filter(Boolean),
      }))
      rec.evidence.ui = ui
      rec.ok(ui.draw && ui.eraser, 'page loads and the tldraw toolbar is present')
      rec.ok(ui.help && ui.teach, 'Help and Teach me are present')
      rec.note(`chips on the live build: ${ui.chips.join(' | ')} (bundle ${ui.scripts.join(', ')})`)
      rec.ok(ui.chips.some((c) => /handwriting/i.test(c)), 'the live build has the "Write in my handwriting" chip (i.e. it is not a deploy behind)')
      const health = await probe.page.evaluate(() => fetch('/api/health').then((r) => r.json()).catch((e) => String(e)))
      rec.ok(health?.ok === true, `/api/health: ${JSON.stringify(health)}`)
      // one short narration clip, fetched the way the page does, to see the real size of the audio
      const clip = NO_SPEAK ? null : await probe.page.evaluate(async () => {
        const t0 = performance.now()
        const r = await fetch('/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'The slope of two x is two.' }) })
        const b = await r.blob()
        return { status: r.status, type: r.headers.get('content-type'), bytes: b.size, ms: Math.round(performance.now() - t0) }
      })
      rec.evidence.speakClip = clip
      if (clip) rec.timings.speak_ms = clip.ms
      if (clip) rec.ok(clip.status === 200 && /^audio\//.test(clip.type ?? '') && clip.bytes > 10000, `/api/speak returns playable audio: ${JSON.stringify(clip)}`)
      rec.shots.push(await L.shot(probe, 'live-loaded'))
      rec.evidence.loadConsole = probe.console
      await probe.page.close()
      return flows[3].run(rec, { live: true })
    },
  },
}

const tutorOf = () => {
  const el = document.querySelector('.tutor-help')
  const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  for (let f = key ? el[key] : null, i = 0; f && i < 100; i++, f = f.return) if (f.memoizedProps?.tutor?.adoptState) return f.memoizedProps.tutor
  return null
}

/**
 * The dev page has no Firestore, so restorePage() finds nothing there. This does what it does when
 * it finds a page (editor.loadSnapshot, then tutor.adoptState) in a fresh browser, with the first
 * browser's document and state: nothing may be sent until the student draws, and the first stroke must be.
 */
async function simulatedRestore(rec, s, b, count) {
  const saved = await s.page.evaluate(`(() => { const t = (${tutorOf})(); return { doc: JSON.stringify(window.__e2e.editor.getSnapshot().document), state: JSON.stringify(t.state) } })()`)
  const s2 = await L.open({ base: s.base, pageId: s.pageId, viewport: VIEW })
  s2.tag = `${s.tag}-fresh`
  await L.showReading(s2)
  const empty = count(await L.shapes(s2))
  const seen = await s2.page.evaluate(`((saved) => {
    const ed = window.__e2e.editor
    const t = (${tutorOf})()
    window.__seen = { added: 0 }
    // what the tutor's own listener is told: the load arrives later, as changes the user made
    ed.store.listen(({ changes }) => { window.__seen.added += Object.values(changes.added).filter((r) => r.typeName === 'shape').length }, { scope: 'document', source: 'user' })
    ed.loadSnapshot({ document: JSON.parse(saved.doc) })
    t.adoptState(JSON.parse(saved.state))
    return { tutor: !!t }
  })(${JSON.stringify(saved)})`)
  const loadedAt = Date.now()
  await L.sleep(1500)
  const c = count(await L.shapes(s2))
  rec.evidence.restore = { emptyBefore: empty, after: c, storeReportedAsUserChanges: await s2.page.evaluate(() => window.__seen.added), ...seen }
  rec.ok(empty.ink === 0 && c.ink === b.ink && c.marks === b.marks, `fresh browser: the saved page was restored (${c.ink} of ${b.ink} strokes, ${c.marks} of ${b.marks} marks; the page was empty before)`)
  rec.ok(rec.evidence.restore.storeReportedAsUserChanges >= b.ink, `the store reported the restored shapes to listeners as user changes (${rec.evidence.restore.storeReportedAsUserChanges} shapes): the case that used to trigger a check`)
  await L.sleep(6500)
  const sent = L.checks(s2)
  rec.ok(sent.length === 0, `fresh browser: no check in the ${Math.round((Date.now() - loadedAt) / 100) / 10} s after the restore` + (sent.length ? `: ${sent.length} /api/check sent (mode ${sent[0].mode})` : ''))
  rec.note(`status line after the restore: ${await L.statusText(s2)}`)
  rec.shots.push(await L.shot(s2, `${s.tag}-restored`))
  // the first real stroke: the wrong "+ 1" is still there, a third line is written under it
  await L.tool(s2, 'draw')
  const ink = await L.inkShapes(s2)
  const box = L.unionBox(ink.map((i) => i.screen))
  const from = s2.api.length
  const t0 = Date.now()
  await L.write(s2, "f''(x) = 6", box.x, box.y + box.h + LINE * 0.8, XH)
  const chk = await L.waitCheck(s2, { from, mode: 'auto', timeout: 45000 })
  rec.evidence.afterStroke = { status: chk?.status, ms: chk?.ms, sentAfterMs: chk ? chk.t0 - t0 : null, read: chk?.res?.lines?.map((l) => l.plain), savedLinesSent: chk?.req?.state?.lines?.length, flagged: chk?.req?.state?.flagged_line_ids, has_worksheet: chk?.req?.has_worksheet }
  rec.ok(chk?.status === 200, `the first stroke after the restore is checked (status ${chk?.status}, ${chk?.ms} ms; the request carried ${chk?.req?.state?.lines?.length} saved lines, flagged ${JSON.stringify(chk?.req?.state?.flagged_line_ids)})`)
  await L.settle(s2, 2500, 30000)
  rec.ok(L.checks(s2).length === 1, `exactly one check was sent in the fresh browser (${L.checks(s2).length})`)
  const d = count(await L.shapes(s2))
  rec.ok(d.marks >= 1, `the red mark on the wrong line is still there after that check (${d.marks})`)
  rec.shots.push(await L.shot(s2, `${s.tag}-restored-stroke`))
  rec.evidence.freshConsole = s2.console
  rec.evidence.freshApi = apiBrief(s2)
  await s2.ctx.close()
}

/** Open the same ?page= in a browser with nothing stored locally: ink and feedback must come back from Firestore. */
async function freshBrowserRestore(rec, s, b, count) {
  const s2 = await L.open({ base: s.base, pageId: s.pageId, viewport: VIEW })
  s2.tag = `${s.tag}-fresh`
  await L.sleep(3000)
  const c = count(await L.shapes(s2))
  rec.evidence.freshBrowser = c
  rec.ok(c.ink === b.ink && b.ink > 0, `fresh browser, same ?page=: the ink came back from the cloud (${c.ink} of ${b.ink} strokes)`)
  rec.ok(c.marks === b.marks && JSON.stringify(c.notes) === JSON.stringify(b.notes), `fresh browser: the feedback came back (${c.marks} of ${b.marks} marks, notes ${JSON.stringify(c.notes)})`)
  rec.shots.push(await L.shot(s2, `${s.tag}-fresh-browser`))
  await L.sleep(3000)
  await L.settle(s2, 2500, 40000)
  const sent = L.checks(s2)
  rec.evidence.freshApi = apiBrief(s2)
  const d = count(await L.shapes(s2))
  rec.evidence.freshAfterCheck = d
  rec.ok(sent.length === 0, `fresh browser: no check sent just because a saved page was opened` + (sent.length ? `: ${sent.length} /api/check sent ${Math.round((sent[0].t0 - s2.loads[0]) / 100) / 10} s after load (mode ${sent[0].mode}, ${sent[0].status}, ${sent[0].ms} ms, read ${sent[0].res?.lines?.length} lines, actions ${JSON.stringify(sent[0].res?.actions?.map((a) => a.type))}, request carried ${sent[0].req?.state?.lines?.length} saved lines and flagged ${JSON.stringify(sent[0].req?.state?.flagged_line_ids)})` : ''))
  rec.ok(d.marks === b.marks && d.notes.length === b.notes.length, `fresh browser: feedback is neither lost nor doubled afterwards (${d.marks} of ${b.marks} marks, notes ${JSON.stringify(d.notes)})`)
  rec.shots.push(await L.shot(s2, `${s.tag}-fresh-browser-later`))
  rec.evidence.freshConsole = s2.console
  await s2.ctx.close()
}
const countShapes = (list) => ({ ink: list.filter((x) => !x.ai && x.type === 'draw').length, marks: redMarks(list.filter((x) => x.ai)).length, notes: notes(list.filter((x) => x.ai)).map((x) => x.text), reading: list.filter((x) => x.kind === 'reading').length })

/** `g(x) = 6x^2` then `g'(x) =`: the tutor should write 12x after the equals sign, at the handwriting's size. */
async function finishLine(rec, s, y, { hand = false } = {}) {
  const from = s.api.length
  const lines = ['g(x) = 6x^2', "g'(x) ="]
  const w = await writeLines(s, lines, X0, y)
  const reply = await L.waitCheck(s, { from, mode: 'auto' })
  rec.timings.finish_check_ms = reply?.ms
  rec.timings.finish_write_to_reply_ms = reply ? reply.t1 - w[1].at : null
  if (!rec.ok(reply?.status === 200, `auto check returned 200 (${reply?.status}, ${reply?.ms} ms)`)) return
  readCheck(rec, reply, lines)
  const inline = reply.res.actions.find((a) => a.type === 'note' && a.side === 'inline')
  rec.evidence.inlineAction = inline ?? reply.res.actions
  rec.ok(!!inline, `the server sent an inline note (${JSON.stringify(reply.res.actions.map((a) => `${a.type}/${a.side ?? ''}/${a.text ?? ''}`))})`)
  if (inline) rec.ok(norm(inline.text) === '12x', `its text is 12x ("${inline.text}")`)
  await L.sleep(hand ? 4000 : 800) // ink is written stroke by stroke
  const all = await L.shapes(s)
  const eq = w[1].glyphs.at(-1).box
  const line2 = w[1].box
  const answers = all.filter((x) => x.ai && ['note', 'hand'].includes(x.kind) && x.screen.y < line2.y + line2.h + 40 && x.screen.y + x.screen.h > line2.y - 40 && x.screen.x > eq.x)
  const texts = answers.filter((x) => x.type === 'text')
  const strokes = answers.filter((x) => x.type === 'draw')
  rec.evidence.answer = { text: texts.map((x) => ({ text: x.text, color: x.color, screen: L.brief(x.screen), font: fontPx(x) })), inkStrokes: strokes.length, inkBox: strokes.length ? L.brief(L.unionBox(strokes.map((x) => x.screen))) : null, eq: L.brief(eq), line: L.brief(line2) }
  if (hand) {
    rec.evidence.drawnAs = strokes.length ? 'ink strokes (draw shapes)' : texts.length ? 'text' : 'nothing'
    rec.ok(strokes.length > 0, `with the handwriting toggle on, the answer is drawn as ink strokes (${strokes.length} draw shapes, ${texts.length} text shapes: ${texts.map((x) => x.text).join(',')})`)
  }
  if (!rec.ok(answers.length > 0, `an answer was written after the equals sign (${texts.length} text, ${strokes.length} ink strokes)`)) return
  const box = L.unionBox(answers.map((x) => x.screen))
  const gap = box.x - (eq.x + eq.w)
  rec.ok(gap > -4 && gap < XH * 3, `it starts just after the equals sign (gap ${Math.round(gap)} px; answer ${L.brief(box)}, "=" ${L.brief(eq)})`)
  const digitH = XH * 1.5
  const cy = box.y + box.h / 2
  rec.ok(cy > line2.y - 6 && cy < line2.y + line2.h + 6, `it sits on the line (answer centre y ${Math.round(cy)}, line ${Math.round(line2.y)}..${Math.round(line2.y + line2.h)})`)
  if (texts.length) {
    const f = fontPx(texts[0])
    rec.ok(norm(texts[0].text) === '12x', `it says 12x ("${texts[0].text}")`)
    // a font's digits are about 0.7 em tall: compare digit height with the handwriting's digits
    rec.ok(f * 0.72 > digitH * 0.6 && f * 0.72 < digitH * 1.5, `it is sized like the writing (font ${f.toFixed(0)} px so digits about ${(f * 0.72).toFixed(0)} px; handwritten digits ${digitH.toFixed(0)} px)`)
    rec.ok(texts[0].color === 'black', `it is in the ink's colour (${texts[0].color})`)
  } else {
    rec.ok(box.h > digitH * 0.5 && box.h < digitH * 1.8, `it is sized like the writing (ink answer ${Math.round(box.h)} px tall; handwritten digits ${digitH.toFixed(0)} px)`)
  }
  const hits = await overlapsInk(s, answers)
  rec.ok(hits.length === 0, `it does not overlap the student's ink` + (hits.length ? ` (${JSON.stringify(hits.slice(0, 3))})` : ''))
  await statusCheck(rec, s, reply)
}

/** A one-page worksheet with two printed problems far apart. Returns the PDF and where the print is (fractions of the page). */
async function makeWorksheet() {
  const file = path.join(L.OUT, 'worksheet.pdf')
  const b = await L.browser()
  const page = await b.newPage()
  await page.setViewport({ width: 816, height: 1056 })
  await page.setContent(`<!doctype html><html><head><style>
    @page { size: 8.5in 11in; margin: 0 }
    body { margin: 0; width: 816px; height: 1056px; position: relative; font-family: Georgia, 'Times New Roman', serif; }
    h1 { position: absolute; left: 60px; top: 36px; font-size: 22px; margin: 0 }
    p { position: absolute; left: 60px; font-size: 24px; margin: 0; white-space: nowrap }
  </style></head><body>
    <h1 id="t">Worksheet 3: Practice</h1>
    <p id="p1" style="top: 110px">1. Find the derivative of f(x) = x<sup>3</sup> + 2x</p>
    <p id="p2" style="top: 640px">2. Solve for x: 3x &minus; 7 = 11</p>
  </body></html>`)
  const rects = await page.evaluate(() =>
    ['p1', 'p2', 't'].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect()
      return { x: r.x / 816, y: r.y / 1056, w: r.width / 816, h: r.height / 1056 }
    }),
  )
  await page.pdf({ path: file, width: '8.5in', height: '11in', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } })
  await page.close()
  return { file, rects }
}

// ------------------------------------------------------------------------------------------------
// Runner
// ------------------------------------------------------------------------------------------------
async function attempt(key, n) {
  const flow = flows[key]
  const rec = new Rec(key, flow.name)
  rec.attempt = n
  let s = null
  const t0 = Date.now()
  try {
    s = await flow.run(rec)
  } catch (err) {
    rec.fails.push(`harness error: ${err?.stack?.split('\n').slice(0, 3).join(' | ') ?? err}`)
  }
  rec.timings.total_ms = Date.now() - t0
  rec.finished = L.hhmmss()
  try {
    if (s && !rec.evidence.api) await finish(rec, s, `f${key}${SUFFIX}-crash`)
    if (s) await s.ctx.close()
  } catch {}
  return rec
}

const keys = wanted.length ? wanted : [...Array(15).keys()].map((i) => String(i + 1)).concat('live')
const summary = []
for (const key of keys) {
  if (!flows[key]) {
    console.log(`no flow "${key}"`)
    continue
  }
  let rec = await attempt(key, 1)
  let verdict = rec.fails.length ? 'FAIL' : 'PASS'
  const tries = [rec]
  if (rec.fails.length && !NO_RETRY && !flows[key].noRetry) {
    console.log(`flow ${key} failed at ${rec.finished} (${rec.fails.length} problems); retrying once`)
    rec = await attempt(key, 2)
    tries.push(rec)
    verdict = rec.fails.length ? 'FAIL' : 'FLAKY'
  }
  const out = path.join(L.OUT, `flow-${key}${SUFFIX}.json`)
  const body = JSON.stringify({ flow: key, name: flows[key].name, verdict, viewport: VIEW, run: RUN, tries }, null, 2)
  fs.writeFileSync(out, body) // the latest run of this flow
  fs.writeFileSync(path.join(L.OUT, `flow-${key}${SUFFIX}-${RUN}.json`), body) // and a copy that later runs do not overwrite
  summary.push({ key, name: flows[key].name, verdict, rec, tries })
  console.log(`\n=== flow ${key}: ${flows[key].name} -> ${verdict}  (${rec.started}-${rec.finished}, ${JSON.stringify(rec.timings)})`)
  for (const [i, t] of tries.entries()) {
    if (tries.length > 1) console.log(`  attempt ${i + 1}:`)
    for (const f of t.fails) console.log(`  FAIL: ${f}`)
  }
  for (const nline of rec.notes) console.log(`  ${nline}`)
  console.log(`  shots: ${rec.shots.join('\n         ')}`)
  console.log(`  evidence: ${out}`)
}
await L.closeBrowser()
console.log(`\nAPI calls this run: ${JSON.stringify(L.budget)}`)
console.log(summary.map((x) => `${x.key.padStart(4)}  ${x.verdict.padEnd(5)}  ${x.name}`).join('\n'))
// running total across runs, to keep an eye on the paid calls
const tally = path.join(L.OUT, 'api-calls.json')
const total = fs.existsSync(tally) ? JSON.parse(fs.readFileSync(tally, 'utf8')) : { check: 0, speak: 0, glyphs: 0, runs: 0 }
for (const k of ['check', 'speak', 'glyphs']) total[k] += L.budget[k]
total.runs++
fs.writeFileSync(tally, JSON.stringify(total))
console.log(`API calls so far (all runs): ${JSON.stringify(total)}`)
