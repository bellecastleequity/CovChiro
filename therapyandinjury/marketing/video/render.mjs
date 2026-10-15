// Renders the 844-84-TREAT video ads: ad.html frame by frame (30 fps) + the jingle audio -> MP4.
//
//   node marketing/jingles/make-spots.mjs        # once: the spots + out/cues-urban.json
//   node marketing/video/images.mjs              # once: the photo scenes (cached in scenes/)
//   node marketing/video/render.mjs [voice] [spot...]   # default voice: urban; all spots unless named
//
// Output: marketing/video/out/<spot>-<story|square|wide>.mp4 (1080x1920 for Reels/Stories/TikTok/Shorts,
// 1080x1080 for feeds, 1920x1080 for YouTube on the 15/30/60). H.264 + AAC, faststart. Needs Playwright (Chromium) and ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const jingles = path.join(here, '../jingles/out');
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const voice = process.argv[2] || 'urban';
const FPS = 30;
const FORMATS = { story: { width: 1080, height: 1920 }, square: { width: 1080, height: 1080 }, wide: { width: 1920, height: 1080 } };
// Wide (YouTube 16:9) needs the scenes/wide/ photo set; these spots have it.
const WIDE_SPOTS = ['3-ad-15s', '4-walk-it-off-30', '5-walk-it-off-60'];

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire(path.join(execSync('npm root -g').toString().trim(), 'x'))('playwright')); }

const cues = JSON.parse(fs.readFileSync(path.join(jingles, `cues-${voice}.json`), 'utf8'));
fs.writeFileSync(path.join(here, 'cues.js'), `window.CUES = ${JSON.stringify(cues)};\n`); // for ?preview=1

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function render(spot, format) {
  const page = await browser.newPage({ viewport: FORMATS[format] });
  const url = pathToFileURL(path.join(here, 'ad.html'));
  url.search = new URLSearchParams({ spot, format }).toString();
  await page.goto(url.href, { waitUntil: 'load' });
  const length = await page.evaluate((c) => setCues(c), cues);
  const file = path.join(out, `${spot}-${format}.mp4`);
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-i', path.join(jingles, cues[spot].audio),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c ? rej(new Error(`ffmpeg ${c}`)) : res())));
  const frames = Math.ceil(length * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => setTime(t), i / FPS);
    const jpg = await page.locator('#stage').screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  await page.close();
  console.log(`made ${path.relative(process.cwd(), file)} (${(frames / FPS).toFixed(1)}s, ${format})`);
}

const only = process.argv.slice(3); // optional spot names after the voice, e.g. `render.mjs urban 4-walk-it-off-30`
const jobs = Object.keys(cues)
  .filter((s) => !cues[s].audioOnly && (!only.length || only.includes(s)))
  .flatMap((spot) => Object.keys(FORMATS).filter((f) => f !== 'wide' || WIDE_SPOTS.includes(spot)).map((f) => [spot, f]));
await Promise.all([0, 1, 2].map(async (w) => { for (let j = w; j < jobs.length; j += 3) await render(...jobs[j]); }));
await browser.close();
