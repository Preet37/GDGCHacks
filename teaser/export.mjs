// Renders the film to out/teaser-<format>.mp4 by stepping ?t= in headless Chrome.
//   npm i            (once, installs puppeteer-core)
//   node export.mjs            both formats
//   node export.mjs tall       1080x1920 only
//   node export.mjs wide       1920x1080 only
//   node export.mjs tall --stills 0.5,3,10.8 --dir /some/folder   PNG stills instead of video
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG || "/opt/homebrew/bin/ffmpeg";
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
const formats = args[0] === "tall" || args[0] === "wide" ? [args[0]] : ["tall", "wide"];
const stills = opt("--stills")?.split(",").map(Number);
const outDir = opt("--dir") || path.join(here, "out");
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--hide-scrollbars", "--force-device-scale-factor=1", "--font-render-hinting=none"] });
for (const format of formats) {
  const [width, height] = format === "tall" ? [1080, 1920] : [1920, 1080];
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(pathToFileURL(path.join(here, "index.html")).href + `?format=${format}&t=0`, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__ready === true", { timeout: 30000 });
  const { duration, fps } = await page.evaluate(() => window.__film);
  const seek = (t) => page.evaluate((t) => window.__film.seek(t), t);

  if (stills) {
    for (const t of stills) { await seek(t); await page.screenshot({ path: path.join(outDir, `${format}-${t.toFixed(2).padStart(5, "0")}.png`) }); }
    console.log(`${format}: ${stills.length} stills -> ${outDir}`);
  } else {
    const out = path.join(outDir, `teaser-${format}.mp4`);
    const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", String(fps), out], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((res, rej) => ff.on("close", (c) => c === 0 ? res() : rej(new Error("ffmpeg exited " + c))));
    const n = Math.round(duration * fps);
    for (let i = 0; i <= n; i++) {
      await seek(i / fps);
      const buf = await page.screenshot({ type: "jpeg", quality: 95, optimizeForSpeed: true });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (i % 150 === 0) console.log(`${format}: frame ${i}/${n}`);
    }
    for (let i = 0; i < fps; i++) ff.stdin.write(await page.screenshot({ type: "jpeg", quality: 95 })); // hold the end card 1 s
    ff.stdin.end(); await done;
    console.log(`${format}: wrote ${out}`);
  }
  await page.close();
}
await browser.close();
