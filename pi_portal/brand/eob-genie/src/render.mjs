// Renders the EOB Genie PNGs with headless Chromium:  node render.mjs <brand/eob-genie dir>
// (on this machine Chromium lives at /opt/pw-browsers/chromium)
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const dir = process.argv[2];
mkdirSync(dir + '/png/icons', { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ deviceScaleFactor: 1 });
// Default PNG width per file: logos large enough for print and slides.
const widthFor = (name) => name.startsWith('app-icon') ? 1024 : name === 'favicon' ? 64 : name === 'brand-sheet' ? 3600
  : name.includes('stacked') ? 1800 : name.startsWith('wordmark') ? 2000 : ['palette', 'typography', 'clear-space'].includes(name) ? 1600 : 2400;
const shoot = async (src, w, out) => {
  const vb = src.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const h = Math.round(w * vb[2] / vb[1]);
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<html><body style="margin:0;background:transparent">${src.replace(/width="[\d.]+" height="[\d.]+"/, `width="${w}" height="${h}" style="display:block"`)}</body></html>`);
  await p.screenshot({ path: dir + '/png/' + out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
};
for (const f of readdirSync(dir).filter((f) => f.startsWith('eob-genie-') && f.endsWith('.svg'))) {
  const name = f.slice('eob-genie-'.length, -4);
  await shoot(readFileSync(dir + '/' + f, 'utf8'), widthFor(name), f.replace('.svg', '.png'));
}
// App icon in every size stores and browsers ask for; phone home screens get
// the square version (the OS rounds the corners); the head-only favicon below 48 px.
const icon = readFileSync(dir + '/eob-genie-app-icon.svg', 'utf8');
for (const s of [512, 256, 192, 128, 64, 48]) await shoot(icon, s, `eob-genie-app-icon-${s}.png`);
await shoot(readFileSync(dir + '/eob-genie-app-icon-square.svg', 'utf8'), 180, 'apple-touch-icon.png');
await shoot(readFileSync(dir + '/eob-genie-app-icon-maskable.svg', 'utf8'), 512, 'icon-512-maskable.png');
const fav = readFileSync(dir + '/eob-genie-favicon.svg', 'utf8');
for (const s of [16, 32]) await shoot(fav, s, `favicon-${s}.png`);
await shoot(icon, 48, 'favicon-48.png');
for (const f of readdirSync(dir + '/icons').filter((f) => f.endsWith('.svg'))) {
  const src = readFileSync(dir + '/icons/' + f, 'utf8');
  for (const s of [128, 512]) await shoot(src, s, `icons/${f.replace('.svg', '')}-${s}.png`);
}
await b.close();
// favicon.ico with 16, 32 and 48 px images.
execFileSync('convert', [dir + '/png/favicon-16.png', dir + '/png/favicon-32.png', dir + '/png/favicon-48.png', dir + '/png/favicon.ico']);
