// Renders a PNG for every brand SVG with headless Chromium:  node render.mjs <brand dir>
// (on this machine Chromium lives at /opt/pw-browsers/chromium)
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
const dir = process.argv[2];
mkdirSync(dir + '/png', { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ deviceScaleFactor: 1 });
// Default PNG width per file (logos large enough for print and slides).
const widthFor = (name) => name === 'favicon-16' ? 16 : name === 'favicon-32' ? 32 : name === 'mark-small' ? 256
  : name.startsWith('mark') ? 1024 : name === 'brand-sheet' ? 3072 : name.includes('stacked') ? 1200
  : ['palette', 'typography', 'clear-space', 'icon-sizes'].includes(name) ? 1600 : 2400;
const shoot = async (src, w, out, square) => {
  // Phone home-screen icons get a square background (the OS rounds the corners itself).
  if (square) src = src.replace('rx="15"', 'rx="0"');
  const vb = src.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const h = Math.round(w * vb[2] / vb[1]);
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${w}" height="${h}" style="display:block" `)}</body></html>`);
  await p.screenshot({ path: dir + '/png/' + out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
};
for (const f of readdirSync(dir).filter((f) => f.startsWith('injurycase-') && f.endsWith('.svg'))) {
  const name = f.slice('injurycase-'.length, -4);
  await shoot(readFileSync(dir + '/' + f, 'utf8'), widthFor(name), f.replace('.svg', '.png'));
}
// App-icon sizes and site icons.
const mk = readFileSync(dir + '/injurycase-mark.svg', 'utf8');
for (const s of [512, 256, 128, 64, 48]) await shoot(mk, s, `injurycase-mark-${s}.png`);
await shoot(mk, 180, 'apple-touch-icon.png', true);
await shoot(mk, 512, 'icon-512-maskable.png', true);
await b.close();
