// Renders brand PNGs with headless Chromium:  node render.mjs <brand dir>
// (on this machine Chromium lives at /opt/pw-browsers/chromium)
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const dir = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await p.goto('file://' + dir + '/src/sheet.html'); await p.waitForTimeout(300);
await p.screenshot({ path: dir + '/injurycase-brand-sheet.png', fullPage: true });
// Transparent PNG exports: [svg, width px, output, square background?]
const jobs = [
  ['injurycase-mark.svg', 512, 'png/injurycase-mark-512.png'], ['injurycase-mark.svg', 1024, 'png/injurycase-mark-1024.png'],
  ['injurycase-logo-horizontal.svg', 1600, 'png/injurycase-logo-horizontal.png'], ['injurycase-logo-horizontal-dark.svg', 1600, 'png/injurycase-logo-horizontal-dark.png'],
  ['injurycase-logo-stacked.svg', 900, 'png/injurycase-logo-stacked.png'],
  ['injurycase-mark-small.svg', 16, 'png/favicon-16.png'], ['injurycase-mark.svg', 32, 'png/favicon-32.png'], ['injurycase-mark.svg', 48, 'png/favicon-48.png'],
  ['injurycase-mark.svg', 180, 'png/apple-touch-icon.png', true], ['injurycase-mark.svg', 512, 'png/icon-512-maskable.png', true],
];
for (const [svg, w, out, square] of jobs) {
  let src = readFileSync(dir + '/' + svg, 'utf8');
  // Phone home-screen icons get a square background (the OS rounds the corners itself).
  if (square) src = src.replace('rx="15"', 'rx="0"');
  const vb = src.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const h = Math.round(w * vb[2] / vb[1]);
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body></html>`);
  await p.screenshot({ path: dir + '/' + out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
await b.close();
