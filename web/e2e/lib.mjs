// Shared harness for the end-to-end run: a headless iPad-sized Chrome, a stroke-font "hand" that
// writes on the real tldraw canvas with pointer events, network capture for /api, and page probes.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const require = createRequire(path.join(REPO, 'teaser/package.json'))
const puppeteer = require('puppeteer-core')

export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const DEV_URL = process.env.E2E_URL ?? 'http://localhost:5174'
export const LIVE_URL = 'https://tutor-1098c.web.app'
export const OUT =
  process.env.E2E_OUT ??
  '/private/tmp/claude-501/-Users-preet-Desktop-hackathons-gdgc/73dcfcc0-13da-4c28-8a85-abb9c652bd1f/scratchpad/e2e'
fs.mkdirSync(OUT, { recursive: true })

export const PORTRAIT = { width: 820, height: 1180 }
export const LANDSCAPE = { width: 1180, height: 820 }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const hhmmss = (t = Date.now()) => new Date(t).toTimeString().slice(0, 8)

// ---------------------------------------------------------------------------------------------
// Stroke font: the Hershey Simplex data embedded in web/src/handwriting/hershey.ts, read from the
// source file (so there is one copy), laid out here with a little jitter.
// ---------------------------------------------------------------------------------------------
const JHF = (() => {
  const src = fs.readFileSync(path.join(REPO, 'web/src/handwriting/hershey.ts'), 'utf8')
  const m = src.match(/const JHF: string\[\] = (\[[\s\S]*?\n\])/)
  if (!m) throw new Error('JHF table not found in hershey.ts')
  return Function(`return ${m[1]}`)()
})()
const X_HEIGHT = 14
const BASELINE = 9
const EXTRA = {
  '±': { left: -11, right: 11, strokes: [[[0, -12], [0, 2]], [[-8, -5], [8, -5]], [[-8, 7], [8, 7]]] },
}
function glyph(c) {
  if (EXTRA[c]) return EXTRA[c]
  const code = c.charCodeAt(0)
  if (code <= 32 || code >= 127) throw new Error(`no glyph for ${JSON.stringify(c)}`)
  const body = JHF[code - 32]
  const at = (i) => body.charCodeAt(i) - 82
  const strokes = [[]]
  for (let i = 2; i + 1 < body.length; i += 2) {
    if (body[i] === ' ' && body[i + 1] === 'R') strokes.push([])
    else strokes[strokes.length - 1].push([at(i), at(i + 1)])
  }
  return { left: at(0), right: at(1), strokes: strokes.filter((s) => s.length) }
}

let seed = 12345
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const jit = (a) => (rnd() * 2 - 1) * a

/**
 * `text` -> polylines in px. (x, y) = left end of the baseline; xh = height of a small letter in px.
 * `^` raises the next character (or a {...} group) as an exponent.
 */
export function layout(text, x, y, xh, { jitter = 1 } = {}) {
  const u = xh / X_HEIGHT
  const strokes = []
  const glyphs = [] // { c, box } per character written, in order
  let pen = x
  let drift = 0
  const chars = [...text]
  for (let i = 0; i < chars.length; i++) {
    let c = chars[i]
    let raised = false
    if (c === ' ') {
      pen += 9 * u
      continue
    }
    const group = []
    if (c === '^') {
      raised = true
      if (chars[i + 1] === '{') {
        i += 2
        while (chars[i] !== '}') group.push(chars[i++])
      } else group.push(chars[++i])
    } else group.push(c)
    for (c of group) {
      const g = glyph(c)
      const s = (raised ? 0.62 : 1) * u * (1 + jit(0.05 * jitter))
      const lift = raised ? -0.75 * xh : 0
      drift = Math.max(-0.12 * xh, Math.min(0.12 * xh, drift + jit(0.03 * xh * jitter)))
      const ox = pen + jit(0.04 * xh * jitter)
      const oy = y + lift + drift
      const lean = 0.14 + jit(0.07 * jitter) // a forward slant that varies from letter to letter
      const turn = jit(0.07 * jitter) // each letter slightly turned
      const tall = 1 + jit(0.08 * jitter)
      const wob = [jit(0.5 * jitter), jit(0.5 * jitter)] // a slow wobble along each stroke
      const mine = []
      for (const st of g.strokes) {
        const pts = st.map(([gx, gy]) => {
          const px = (gx - g.left) * s
          const py = (gy - BASELINE) * s * tall
          const wx = Math.sin(gy * 0.45 + ox) * wob[0]
          const wy = Math.cos(gx * 0.45 + oy) * wob[1]
          return [ox + px * Math.cos(turn) - py * (lean + Math.sin(turn)) + wx + jit(0.4 * jitter), oy + py * Math.cos(turn) + px * Math.sin(turn) + wy + jit(0.4 * jitter)]
        })
        strokes.push(pts)
        mine.push(...pts)
      }
      glyphs.push({ c, box: boxOf(mine) })
      pen += (g.right - g.left) * s * 0.92
    }
  }
  return { strokes, glyphs, box: boxOf(strokes.flat()), end: pen }
}
function boxOf(pts) {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

function densify(pts, step = 3) {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Browser session
// ---------------------------------------------------------------------------------------------
let browserPromise = null
export async function browser() {
  browserPromise ??= puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--force-device-scale-factor=1', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  })
  return browserPromise
}
export async function closeBrowser() {
  if (browserPromise) await (await browserPromise).close()
  browserPromise = null
}

export const budget = { check: 0, speak: 0, glyphs: 0 }

/**
 * Open the notebook in a fresh browser context (own localStorage / IndexedDB).
 * Returns a session: the page, captured /api traffic, console errors, and helpers.
 */
export async function open({ base = DEV_URL, pageId, viewport = PORTRAIT, query = '', context = null, pointer = 'pen', blockSpeak = false } = {}) {
  const b = await browser()
  const ctx = context ?? (await b.createBrowserContext())
  const page = await ctx.newPage()
  await page.setViewport({ ...viewport, deviceScaleFactor: 1, hasTouch: true })
  const cdp = await page.createCDPSession()
  const s = {
    page, ctx, cdp, viewport, pointer, base, pageId,
    api: [], // { n, path, mode, t0, t1, ms, status, req (no image), res, image }
    console: [], // errors and warnings
    loads: [], // times the document loaded (more than one = it reloaded under us)
    firestore: 0, // requests to Firestore (0 on a dev server without web/.env.local: cloud save is off there)
    hmr: [], // vite hot updates (these can remount the canvas without a page load)
    tag: pageId ?? 'page',
  }
  page.on('console', (m) => {
    if (m.text().startsWith('[vite]')) s.hmr.push({ at: hhmmss(), text: m.text().slice(0, 200) })
    if (m.type() === 'error' || m.type() === 'warn') s.console.push({ at: hhmmss(), type: m.type(), text: m.text().slice(0, 400) })
  })
  page.on('pageerror', (e) => s.console.push({ at: hhmmss(), type: 'pageerror', text: String(e).slice(0, 400) }))
  page.on('load', () => s.loads.push(Date.now()))
  const open = new Map()
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.hostname.includes('firestore')) s.firestore++
    if (!u.pathname.startsWith('/api/')) return
    const rec = { n: s.api.length, path: u.pathname, t0: Date.now(), at: hhmmss() }
    const kind = u.pathname.split('/').pop()
    if (kind in budget) budget[kind]++
    try {
      const body = JSON.parse(r.postData() ?? '{}')
      if (body.image_base64) {
        rec.image = path.join(OUT, `${s.tag}-req${rec.n}-${kind}.png`)
        fs.writeFileSync(rec.image, Buffer.from(body.image_base64, 'base64'))
        body.image_base64 = `<${body.image_base64.length} b64 chars>`
      }
      rec.mode = body.mode
      rec.req = body
    } catch {}
    s.api.push(rec)
    open.set(r, rec)
  })
  const finish = async (r, res) => {
    const rec = open.get(r)
    if (!rec) return
    open.delete(r)
    rec.t1 = Date.now()
    rec.ms = rec.t1 - rec.t0
    if (!res) return void (rec.status = 'failed: ' + (r.failure()?.errorText ?? '?'))
    rec.status = res.status()
    rec.type = res.headers()['content-type']
    try {
      if ((rec.type ?? '').includes('json')) rec.res = await res.json()
      else rec.bytes = (await res.buffer()).length
    } catch (e) {
      rec.resError = String(e)
    }
    rec.done = true
  }
  page.on('requestfinished', (r) => void finish(r, r.response()))
  page.on('requestfailed', (r) => void finish(r, null))

  // record what happens to audio elements (the lesson voice plays through `new Audio()`, not an element in the DOM)
  await page.evaluateOnNewDocument((blockSpeak) => {
    const log = (window.__audio = { src: [], plays: 0, errors: [], ended: 0 })
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...d,
      set(v) {
        log.src.push(String(v).slice(0, 60))
        this.addEventListener('ended', () => log.ended++, { once: true })
        this.addEventListener('error', () => log.errors.push(this.error?.message ?? 'error'), { once: true })
        d.set.call(this, v)
      },
    })
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      log.plays++
      const p = play.call(this)
      p?.catch?.((e) => log.errors.push('play: ' + e.name))
      return p
    }
    if (blockSpeak) {
      const f = window.fetch
      window.fetch = (u, o) => (String(u).includes('/api/speak') ? Promise.reject(new TypeError('blocked by the e2e harness')) : f(u, o))
    }
  }, blockSpeak)

  const url = `${base}/?${pageId ? `page=${encodeURIComponent(pageId)}` : ''}${query ? '&' + query : ''}`
  s.url = url
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('.tl-canvas', { timeout: 30000 })
  await page.waitForSelector('.tutor-help', { timeout: 30000 })
  await installProbe(s)
  await sleep(1200) // Firestore restore of an empty page, fonts
  return s
}

/** Finds the tldraw editor without ?dev: walks the React tree up from the canvas to the editor context. */
export async function installProbe(s) {
  await s.page.evaluate(() => {
    const find = () => {
      if (window.editor?.getCurrentPageShapes) return window.editor
      const el = document.querySelector('.tl-canvas') ?? document.querySelector('.tl-container')
      const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
      let f = key ? el[key] : null
      for (let i = 0; f && i < 200; i++, f = f.return) {
        for (const v of [f.memoizedProps?.value, f.memoizedProps?.editor]) if (v && typeof v.getCurrentPageShapes === 'function') return v
      }
      return null
    }
    const text = (rt) => {
      const out = []
      const walk = (n) => {
        if (!n) return
        if (typeof n.text === 'string') out.push(n.text)
        if (Array.isArray(n.content)) {
          n.content.forEach(walk)
          if (n.type === 'paragraph') out.push('\n')
        }
      }
      walk(rt)
      return out.join('').trim()
    }
    window.__e2e = {
      get editor() {
        return find()
      },
      shapes() {
        const ed = find()
        if (!ed) return null
        const z = ed.getZoomLevel()
        return ed.getCurrentPageShapesSorted().map((sh) => {
          const b = ed.getShapePageBounds(sh)
          const p = b ? ed.pageToViewport({ x: b.x, y: b.y }) : { x: 0, y: 0 }
          return {
            id: sh.id, type: sh.type, ai: sh.meta?.ai === true, kind: sh.meta?.kind ?? null, line_id: sh.meta?.line_id ?? null,
            text: sh.props?.richText ? text(sh.props.richText) : undefined,
            color: sh.props?.color, size: sh.props?.size, scale: sh.props?.scale, font: sh.props?.font, isPen: sh.props?.isPen,
            page: b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null,
            screen: b ? { x: p.x, y: p.y, w: b.w * z, h: b.h * z } : null,
            meta: sh.type === 'image' || sh.meta?.worksheet ? sh.meta : undefined,
            props: ['geo', 'line', 'arrow'].includes(sh.type) ? { geo: sh.props.geo, w: sh.props.w, h: sh.props.h } : sh.type.includes('surface') || sh.type.includes('lesson') ? sh.props : undefined,
          }
        })
      },
      view() {
        const ed = find()
        const v = ed.getViewportPageBounds()
        return { zoom: ed.getZoomLevel(), x: v.x, y: v.y, w: v.w, h: v.h, tool: ed.getCurrentToolId(), penMode: ed.getInstanceState().isPenMode }
      },
    }
  })
  const ok = await s.page.evaluate(() => !!window.__e2e.editor)
  if (!ok) throw new Error('could not find the tldraw editor on the page')
}

export const shapes = (s) => s.page.evaluate(() => window.__e2e.shapes())
export const view = (s) => s.page.evaluate(() => window.__e2e.view())
export const aiShapes = async (s, kinds) => (await shapes(s)).filter((x) => x.ai && x.kind !== 'reading' && (!kinds || kinds.includes(x.kind)))
export const inkShapes = async (s) => (await shapes(s)).filter((x) => !x.ai && x.type === 'draw')

export async function shot(s, name) {
  const file = path.join(OUT, `${name}.png`)
  await s.page.screenshot({ path: file })
  return file
}

// ---------------------------------------------------------------------------------------------
// Pointer input (CDP). pointer = 'pen' | 'mouse' | 'touch'
// ---------------------------------------------------------------------------------------------
async function ptr(s, type, x, y, opts = {}) {
  if (s.pointer === 'touch') {
    const t = { touchStart: 'touchStart', move: 'touchMove', up: 'touchEnd' }
    const kind = type === 'mousePressed' ? 'touchStart' : type === 'mouseMoved' ? 'touchMove' : 'touchEnd'
    await s.cdp.send('Input.dispatchTouchEvent', { type: kind, touchPoints: kind === 'touchEnd' ? [] : [{ x, y, radiusX: 1, radiusY: 1, force: 0.5 }] })
    return
  }
  await s.cdp.send('Input.dispatchMouseEvent', {
    type, x, y,
    button: type === 'mouseMoved' && !opts.down ? 'none' : 'left',
    buttons: opts.down || type === 'mousePressed' ? 1 : 0,
    clickCount: type === 'mouseMoved' ? 0 : 1,
    pointerType: s.pointer === 'pen' ? 'pen' : 'mouse',
    force: s.pointer === 'pen' ? 0.5 : undefined,
  })
}

/** One pen stroke through `pts` (screen px). */
export async function stroke(s, pts, { step = 3 } = {}) {
  const d = densify(pts, step)
  if (s.pointer !== 'touch') await ptr(s, 'mouseMoved', d[0][0], d[0][1])
  await ptr(s, 'mousePressed', d[0][0], d[0][1])
  for (let i = 1; i < d.length; i++) await ptr(s, 'mouseMoved', d[i][0], d[i][1], { down: true })
  const last = d[d.length - 1]
  await ptr(s, 'mouseReleased', last[0], last[1])
}

export async function tool(s, name) {
  const sel = `[data-testid="tools.${name}"]`
  const el = await s.page.$(sel)
  if (!el) throw new Error(`toolbar button ${sel} not found`)
  await el.click()
  await sleep(80)
  const v = await view(s)
  if (v.tool !== name) throw new Error(`tool is ${v.tool}, wanted ${name}`)
}

/**
 * Write `text` by hand with the draw tool. (x, y) = screen position of the left end of the baseline;
 * xh = x-height in screen px. Returns the screen box of the ink and how many strokes it took.
 */
export async function write(s, text, x, y, xh = 26, opts = {}) {
  if ((await view(s)).tool !== 'draw') await tool(s, 'draw')
  const before = (await inkShapes(s)).length
  const l = layout(text, x, y, xh, opts)
  for (const st of l.strokes) {
    await stroke(s, st)
    await sleep(15)
  }
  const after = (await inkShapes(s)).length
  return { text, box: l.box, glyphs: l.glyphs, xh, strokes: l.strokes.length, shapesAdded: after - before, endX: l.end, at: Date.now() }
}

/** Rub out everything inside a screen rect with the eraser tool (zigzag passes), then go back to the pen. */
export async function erase(s, box) {
  await tool(s, 'eraser')
  const pts = []
  const rows = Math.max(4, Math.ceil(box.h / 6))
  for (let r = 0; r <= rows; r++) {
    const y = box.y - 3 + ((box.h + 6) * r) / rows
    pts.push(r % 2 ? [box.x + box.w + 6, y] : [box.x - 6, y], r % 2 ? [box.x - 6, y] : [box.x + box.w + 6, y])
  }
  await stroke(s, pts, { step: 5 })
  await sleep(100)
  await tool(s, 'draw')
}

// ---------------------------------------------------------------------------------------------
// Waiting on the API and reading the page
// ---------------------------------------------------------------------------------------------
export const checks = (s, mode) => s.api.filter((r) => r.path === '/api/check' && (!mode || r.mode === mode))

/** Wait for a /api/check (of `mode`, sent after index `from`) to finish. Null on timeout. */
export async function waitCheck(s, { from = s.api.length, mode, timeout = 45000 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const hit = s.api.slice(from).find((r) => r.path === '/api/check' && (!mode || r.mode === mode) && (r.done || typeof r.status === 'string'))
    if (hit) {
      await sleep(900) // let the reply be drawn
      return hit
    }
    await sleep(150)
  }
  return null
}

/** Wait until no /api/check is in flight and none has started for `quiet` ms. */
export async function settle(s, quiet = 3500, timeout = 60000) {
  const t0 = Date.now()
  for (;;) {
    const open = s.api.filter((r) => r.path === '/api/check' && !r.done && typeof r.status !== 'string')
    const last = Math.max(0, ...s.api.filter((r) => r.path === '/api/check').map((r) => r.t1 ?? r.t0))
    if (!open.length && Date.now() - Math.max(last, t0) >= quiet) return true
    if (Date.now() - t0 > timeout) return false
    await sleep(200)
  }
}

export async function clickText(s, selector, text) {
  const ok = await s.page.evaluate(
    (selector, text) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.replace(/\s+/g, ' ').trim().includes(text))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    },
    selector,
    text,
  )
  if (!ok) throw new Error(`no ${selector} with text "${text}"`)
  await uiTap(s, ok.x, ok.y)
  return ok
}

/** A finger/mouse tap on page chrome (buttons), always as a mouse so it works in tldraw's pen mode too. */
export async function uiTap(s, x, y) {
  const base = { x, y, button: 'left', clickCount: 1, pointerType: 'mouse' }
  await s.cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none' })
  await s.cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', buttons: 1 })
  await sleep(60)
  await s.cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' })
  await sleep(60)
}

export async function showReading(s) {
  const on = await s.page.evaluate(() => [...document.querySelectorAll('.tutor-chip')].find((e) => e.textContent.includes('Show what AI read'))?.classList.contains('on'))
  if (!on) await clickText(s, '.tutor-chip', 'Show what AI read')
}
export const statusText = (s) => s.page.evaluate(() => document.querySelector('.tutor-status')?.textContent ?? null)
export const toastText = (s) => s.page.evaluate(() => document.querySelector('.tutor-toast')?.textContent ?? null)

export async function tapHelp(s) {
  const r = await s.page.evaluate(() => {
    const b = document.querySelector('.tutor-help').getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  await uiTap(s, r.x, r.y)
}
export async function tapTeach(s) {
  const r = await s.page.evaluate(() => {
    const b = document.querySelector('.tutor-teach').getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  await uiTap(s, r.x, r.y)
}

export const overlap = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}
export const unionBox = (list) => {
  const x = Math.min(...list.map((r) => r.x))
  const y = Math.min(...list.map((r) => r.y))
  return { x, y, w: Math.max(...list.map((r) => r.x + r.w)) - x, h: Math.max(...list.map((r) => r.y + r.h)) - y }
}
export const brief = (r) => (r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}` : 'none')
