// A recorded walkthrough of the real app: each scene is written with pen strokes on the dev page
// (its /api proxied to a real server), and the browser is filmed while the tutor answers. Nothing is
// faked or sped up; a caption bar on the page says what is being shown.
//
//   node web/e2e/capture.mjs            # all scenes -> $E2E_OUT/capture/scene-<n>.webm, then demo-capture.mp4
//   node web/e2e/capture.mjs 1 4        # only these scenes (the mp4 is rebuilt from every scene file there)
//   node web/e2e/capture.mjs --join     # only rebuild the mp4 from the scene files
//
// Costs about 10 /api/check calls in all and no voice clips (the lesson's narration is blocked; its
// subtitles show). Needs the dev page (E2E_URL, default http://localhost:5174), Chrome and ffmpeg.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as L from './lib.mjs'

const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg'
const DIR = path.join(L.OUT, 'capture')
fs.mkdirSync(DIR, { recursive: true })
const RUN = Date.now().toString(36)
const TARGET_S = Number(process.env.TARGET_S ?? 110)
const MAX_SPEED = 2.5
const VIEW = L.LANDSCAPE
const XH = 26
const LINE = 92
const X0 = 90
const args = process.argv.slice(2)
const only = args.filter((a) => /^\d+$/.test(a)).map(Number)

/** The caption bar: what the viewer is looking at, in a sentence. */
async function caption(s, text) {
  await s.page.evaluate((text) => {
    let el = document.getElementById('cap')
    if (!el) {
      el = document.createElement('div')
      el.id = 'cap'
      el.style.cssText =
        'position:fixed;left:46%;top:14px;transform:translateX(-50%);z-index:99999;max-width:640px;padding:12px 20px;border-radius:14px;' +
        'background:rgba(17,24,39,.92);color:#fff;font:600 19px/1.35 system-ui,-apple-system,sans-serif;text-align:center;pointer-events:none;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.25);transition:opacity .25s'
      document.body.appendChild(el)
    }
    if (!document.getElementById('cap-foot')) {
      const f = document.createElement('div')
      f.id = 'cap-foot'
      f.textContent = 'The real app with real Gemini replies. Shown faster than real time.'
      f.style.cssText = 'position:fixed;left:12px;bottom:46px;z-index:99999;padding:4px 10px;border-radius:8px;background:rgba(255,255,255,.85);color:#374151;font:500 12px system-ui,sans-serif;pointer-events:none'
      document.body.appendChild(f)
    }
    el.style.opacity = text ? '1' : '0'
    if (text) el.textContent = text
  }, text)
}

async function scene(n, opts, run) {
  const s = await L.open({ pageId: `cap-${RUN}-${n}`, viewport: VIEW, ...opts })
  s.tag = `cap${n}`
  await s.page.setViewport({ ...VIEW, deviceScaleFactor: 2, hasTouch: true })
  await L.sleep(600)
  await L.tool(s, 'draw')
  const file = path.join(DIR, `scene-${n}.webm`)
  const rec = await s.page.screencast({ path: file, ffmpegPath: FFMPEG })
  const t0 = Date.now()
  try {
    await run(s)
  } catch (e) {
    console.log(`scene ${n}: stopped early: ${e?.message ?? e}`)
  }
  await L.sleep(800)
  await rec.stop()
  console.log(`scene ${n}: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${s.api.filter((r) => r.path === '/api/check').length} checks -> ${file}`)
  await s.page.close()
}

/** L.write with coarser pen moves: the same strokes in about half the time, so the film isn't mostly waiting for ink. */
async function write(s, text, x, y, xh = XH) {
  if ((await L.view(s)).tool !== 'draw') await L.tool(s, 'draw')
  const l = L.layout(text, x, y, xh)
  for (const st of l.strokes) await L.stroke(s, st, { step: 6 })
  return { text, box: l.box, glyphs: l.glyphs, xh, endX: l.end }
}

const tapSel = async (s, sel) => {
  const r = await s.page.evaluate((sel) => {
    const b = document.querySelector(sel)?.getBoundingClientRect()
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null
  }, sel)
  if (r) await L.uiTap(s, r.x, r.y)
  return !!r
}

const SCENES = {
  // 1. a wrong step is circled; fixing it clears the mark
  1: [{}, async (s) => {
    await caption(s, 'Write your work by hand. Gemini reads it, and a math engine checks each step.')
    await L.sleep(1200)
    await write(s, 'f(x) = 3x^2 + 2x', X0, 250, XH)
    const wrong = await write(s, "f'(x) = 6x + 1", X0, 250 + LINE, XH)
    await L.waitCheck(s, { mode: 'auto', from: 0, timeout: 50000 })
    await L.sleep(900)
    await caption(s, 'A wrong step is circled where it went wrong, with a question, not the answer.')
    await L.sleep(4500)
    await caption(s, 'Fix it, and the mark clears.')
    const from = s.api.length
    await L.erase(s, wrong.box)
    await write(s, "f'(x) = 6x + 2", X0, 250 + LINE, XH)
    await L.waitCheck(s, { mode: 'auto', from, timeout: 50000 })
    for (let i = 0; i < 16; i++) {
      if (!(await L.aiShapes(s)).length) break
      await L.sleep(500)
    }
    await L.sleep(2500)
  }],

  // 2. Help: a hint, then a more specific one; Solve it writes every step
  2: [{}, async (s) => {
    await caption(s, 'Stuck before you start? Tap Help.')
    await write(s, 'd/dx (x sin x)', X0, 250, XH)
    await L.settle(s, 3000, 30000)
    let from = s.api.length
    await L.tapHelp(s)
    await L.waitCheck(s, { mode: 'help', from, timeout: 50000 })
    await L.sleep(800)
    await caption(s, 'A hint that explains the idea. Stay stuck and the next one is more specific.')
    await L.sleep(5500)
    await s.page.evaluate(() => document.querySelector('.tutor-next')?.click())
    await caption(s, 'Or tap Solve it: every step written out, each one checked before it is shown.')
    from = s.api.length
    await tapSel(s, '.tutor-solve')
    await L.waitCheck(s, { mode: 'help', from, timeout: 60000 })
    await L.sleep(6500)
  }],

  // 3. Teach me, then "Your turn"
  // (the narration is real, so the lesson plays as it does for a student; it costs one voice clip per step shown)
  3: [{}, async (s) => {
    await caption(s, 'Made a mistake you do not understand?')
    // written a little smaller, so the work and the tutor's question both fit beside the lesson panel
    await write(s, 'f(x) = 3x^2 + 2x', 60, 250, 20)
    await write(s, "f'(x) = 6x + 1", 60, 250 + 72, 20)
    await L.waitCheck(s, { mode: 'auto', from: 0, timeout: 50000 })
    await L.sleep(2000)
    await caption(s, 'Tap Teach me: Gemini writes a short lesson about this exact mistake and narrates it.')
    const from = s.api.length
    await L.tapTeach(s)
    const reply = await L.waitCheck(s, { mode: 'explain', from, timeout: 90000 })
    const lesson = reply?.res?.actions?.find((a) => a.type === 'lesson')?.lesson
    await s.page.waitForSelector('.lesson-panel', { timeout: 20000 }).catch(() => {})
    await L.sleep(6500)
    await caption(s, '')
    const steps = lesson?.steps?.length ?? 0
    for (let i = 0; i < steps; i++) {
      const next = await s.page.$('button[aria-label="Next step"]:not([disabled])')
      if (!next) break
      await next.click()
      await L.sleep(i < 3 ? 3800 : 1700)
    }
    for (let i = 0; i < 60; i++) {
      const state = await s.page.evaluate(() => document.querySelector('.lesson-panel')?.dataset.lesson)
      if (state === 'ended') break
      await L.sleep(500)
    }
    await caption(s, 'Then it is your turn: a new problem of the same kind, checked the same way.')
    await L.sleep(3000)
    const practice = (await L.aiShapes(s)).filter((x) => x.kind && /practice|given/.test(x.kind))
    const m = /(\d+)\*x\^2\s*\+\s*(\d+)\*x\s*$/.exec(lesson?.practice?.plain ?? '')
    const ask = practice.at(-1)
    if (m && ask && ask.screen.y > 60 && ask.screen.y + ask.screen.h < VIEW.height - 150) {
      const from2 = s.api.length
      await write(s, `${2 * Number(m[1])}x + ${m[2]}`, ask.screen.x + ask.screen.w + 20, ask.screen.y + ask.screen.h * 0.74, Math.max(16, ask.screen.h * 0.36))
      await L.waitCheck(s, { mode: 'auto', from: from2, timeout: 50000 })
      await L.sleep(4500)
    } else {
      console.log(`scene 3: practice not answered (plain ${JSON.stringify(lesson?.practice?.plain)}, ask ${ask ? L.brief(ask.screen) : 'none'})`)
      await L.sleep(2500)
    }
  }],

  // 4. a PDF worksheet: Solve it, a graph, a 3D surface
  4: [{}, async (s) => {
    await caption(s, 'Import any PDF worksheet and work right on it.')
    const input = await s.page.$('input[type=file]')
    await input.uploadFile(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/samples/mixed.pdf'))
    let sheet = null // eslint-disable-line prefer-const
    for (let i = 0; i < 60 && !sheet; i++) {
      await L.sleep(250)
      sheet = (await L.shapes(s)).find((x) => x.meta?.worksheet)?.screen ?? null
    }
    if (!sheet) throw new Error('the worksheet did not import')
    await L.sleep(2200)
    const rowY = (i) => sheet.y + ((150 + i * 226) / 1056) * sheet.h
    await caption(s, 'Solve it reads the printed problem and writes the worked steps under it.')
    let from = s.api.length
    await tapSel(s, '.tutor-solve')
    await L.waitCheck(s, { mode: 'help', from, timeout: 60000 })
    await L.sleep(5500)
    await caption(s, 'Write "graph it" next to anything and the graph is drawn from the checked formula.')
    // problems 3 and 4 are further down the page: scroll to them (two-finger scroll = wheel)
    const dy = Math.round(rowY(2) - VIEW.height * 0.16)
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: VIEW.width / 2, y: VIEW.height / 2, deltaX: 0, deltaY: dy, pointerType: 'mouse' })
    await L.sleep(900)
    sheet = (await L.shapes(s)).find((x) => x.meta?.worksheet).screen
    const k = sheet.w / 738 // write at a size that suits the sheet as it is shown
    from = s.api.length
    await write(s, 'y = x^2 - 4', sheet.x + 90 * k, rowY(2) + 70 * k, 20 * k)
    await write(s, 'graph it', sheet.x + 300 * k, rowY(2) + 74 * k, 20 * k)
    await L.waitCheck(s, { mode: 'auto', from, timeout: 60000 })
    await L.sleep(4500)
    await caption(s, 'Surfaces come out in 3D. Drag to spin.')
    // down to problem 4
    const dy2 = Math.round(sheet.y + ((150 + 3 * 226) / 1056) * sheet.h - VIEW.height * 0.14)
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: VIEW.width / 2, y: VIEW.height / 2, deltaX: 0, deltaY: dy2, pointerType: 'mouse' })
    await L.sleep(900)
    sheet = (await L.shapes(s)).find((x) => x.meta?.worksheet).screen
    from = s.api.length
    await write(s, 'z = x^2 + y^2', sheet.x + 90 * k, rowY(3) + 70 * k, 20 * k)
    await write(s, 'graph', sheet.x + 330 * k, rowY(3) + 76 * k, 20 * k)
    await L.waitCheck(s, { mode: 'auto', from, timeout: 30000 })
    await L.sleep(4000)
    const surf = (await L.shapes(s)).filter((x) => x.type === 'surface3d').at(-1)
    if (surf) {
      const cx = surf.screen.x + surf.screen.w / 2
      const cy = surf.screen.y + surf.screen.h / 2 + 15
      for (const [dx, dy] of [[90, 30], [-140, -20], [80, 40]]) {
        await L.stroke(s, [[cx - dx / 2, cy - dy / 2], [cx + dx / 2, cy + dy / 2]], { step: 3 })
        await L.sleep(500)
      }
    } else console.log('scene 4: no 3D surface on the page')
    await L.sleep(2500)
  }],
}

function join() {
  const files = Object.keys(SCENES).map((n) => path.join(DIR, `scene-${n}.webm`)).filter((f) => fs.existsSync(f))
  if (!files.length) return console.log('no scene files to join')
  const out = path.join(DIR, 'demo-capture.mp4')
  // each scene scaled to 1080 high and centred on a 1920x1080 dark frame, then joined
  const inputs = files.flatMap((f) => ['-i', f])
  // sped up just enough to fit TARGET_S (never more than MAX_SPEED); the page's footer says it is sped up
  const probe = (f) => {
    const out = execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-count_packets', '-show_entries', 'stream=nb_read_packets,r_frame_rate', '-of', 'csv=p=0', f]).toString().trim().split(',')
    const [num, den] = out[0].split('/').map(Number)
    return Number(out[1]) / (num / den)
  }
  const total = files.map(probe).reduce((a, b) => a + b, 0)
  const speed = Math.min(MAX_SPEED, Math.max(1, total / TARGET_S))
  console.log(`scenes run ${total.toFixed(1)} s; speed x${speed.toFixed(2)}`)
  const chains = files.map((_, i) => `[${i}:v]setpts=PTS/${speed.toFixed(3)},fps=30,scale=-2:1080:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x111827,setsar=1[v${i}]`).join(';')
  const filter = `${chains};${files.map((_, i) => `[v${i}]`).join('')}concat=n=${files.length}:v=1:a=0[out]`
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
  const secs = execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim()
  console.log(`wrote ${out} (${Number(secs).toFixed(1)} s, ${files.length} scenes)`)
}

if (!args.includes('--join')) {
  for (const n of Object.keys(SCENES).map(Number)) {
    if (only.length && !only.includes(n)) continue
    const [opts, run] = SCENES[n]
    await scene(n, opts, run)
  }
  await L.closeBrowser()
  console.log(`API calls this run: ${JSON.stringify(L.budget)}`)
}
join()
