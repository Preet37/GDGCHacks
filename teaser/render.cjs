// Deterministic frame-accurate render of launch.html (the AI tutor notebook launch teaser).
// Adapted from the Huddle teaser pipeline (same contract, puppeteer-core + system Chrome).
// timeline.json is injected into the page as window.TIMELINE, so picture and sound
// (audio.py) read the same cue list. Each frame calls window.renderFrame(tMs).
//
//   node render.cjs                         -> all frames into $FRAMES_DIR (default: os tmp)
//   PROBE="2,5,8.5" PROBE_DIR=... node render.cjs  -> only stills at those seconds
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

// PAGE / TIMELINE env vars pick another film; defaults are launch.html + timeline.json.
const TL = JSON.parse(fs.readFileSync(path.join(__dirname, process.env.TIMELINE || 'timeline.json'), 'utf8'));
const FPS = TL.meta.fps;
const TOTAL = TL.meta.frames;
const OUT = process.env.FRAMES_DIR || path.join(os.tmpdir(), 'tutor-frames');
const PROBE = process.env.PROBE ? process.env.PROBE.split(',').map(Number) : null;
const PROBE_DIR = process.env.PROBE_DIR || OUT;
const PAGE = 'file://' + path.join(__dirname, process.env.PAGE || 'launch.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const START = Number(process.env.START || 0), END = Number(process.env.END || TOTAL);

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb', '--hide-scrollbars',
  '--disable-background-timer-throttling', '--font-render-hinting=none'];

async function launch() {
  const attempts = [
    { name: 'system Chrome', opts: { executablePath: CHROME, headless: 'new', args: ARGS, protocolTimeout: 600000 } },
    { name: 'channel chrome', opts: { channel: 'chrome', headless: 'new', args: ARGS, protocolTimeout: 600000 } },
  ];
  for (const a of attempts) {
    try { const b = await puppeteer.launch(a.opts); console.log('launched:', a.name); return b; }
    catch (e) { console.log('launch failed (' + a.name + '):', e.message); }
  }
  throw new Error('all launch attempts failed');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROBE_DIR, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument('window.TIMELINE = ' + JSON.stringify(TL) + ';');
  await page.goto(PAGE, { waitUntil: 'networkidle0' });
  try { await page.waitForFunction('window.__ready === true', { timeout: 45000 }); }
  catch (e) { console.log('READY TIMEOUT:\n' + errs.join('\n')); throw e; }
  if (errs.length) console.log('page messages:\n' + errs.slice(0, 10).join('\n'));
  const fontsOk = await page.evaluate(() => ['400 40px "Instrument Serif"', '500 20px Inter', '400 20px "JetBrains Mono"', '600 40px Caveat', '400 20px "Shantell Sans"'].map(f => document.fonts.check(f)));
  console.log('fonts loaded:', fontsOk.join(','));

  const shot = async (tMs, file) => {
    await page.evaluate(t => window.renderFrame(t), tMs);
    await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 }, optimizeForSpeed: true });
  };

  if (PROBE) {
    for (const s of PROBE) {
      const f = path.join(PROBE_DIR, 'probe_' + s.toFixed(2) + '.png');
      await shot(s * 1000, f);
      console.log('probe', s, '->', f);
    }
    if (errs.length) console.log('page messages:\n' + errs.join('\n'));
    await browser.close();
    return;
  }

  const t0 = Date.now();
  for (let i = START; i < END; i++) {
    const file = path.join(OUT, 'f' + String(i).padStart(5, '0') + '.png');
    if (process.env.RESUME === '1' && fs.existsSync(file) && fs.statSync(file).size > 0) continue;
    await shot((i * 1000) / FPS, file);
    if (i % 90 === 0) console.log('frame ' + i + '/' + TOTAL + '  (' + Math.round((Date.now() - t0) / 1000) + 's)');
  }
  if (errs.length) console.log('page messages:\n' + errs.join('\n'));
  await browser.close();
  console.log('done: frames ' + START + '..' + (END - 1) + ' -> ' + OUT + ' in ' + Math.round((Date.now() - t0) / 1000) + 's');
})().catch(e => { console.error('RENDER ERROR', e); process.exit(1); });
