// Renders video.html frame by frame. node render.js <dir> <fps> [preview times] [timeline.json] [frames dir]
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const dir = process.argv[2], fps = +(process.argv[3] || 30), only = process.argv[4];
  const tl = process.argv[5] && fs.existsSync(process.argv[5]) ? JSON.parse(fs.readFileSync(process.argv[5], 'utf8')) : null;
  const out = process.argv[6] || path.join(dir, 'frames');
  const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + path.join(dir, 'video.html')); await p.waitForTimeout(800);
  await p.evaluate((tl) => applyTimeline(tl), tl);
  const T = await p.evaluate(() => window.TOTAL);
  if (only) { for (const t of only.split(',').map(Number)) { await p.evaluate((t) => render(t), t); await p.screenshot({ path: path.join(dir, `preview_${t}.jpg`), type: 'jpeg', quality: 90 }); } await br.close(); return; }
  fs.mkdirSync(out, { recursive: true });
  const n = Math.round(T * fps);
  for (let i = 0; i < n; i++) { await p.evaluate((t) => render(t), i / fps); await p.screenshot({ path: path.join(out, String(i).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 }); }
  await br.close(); console.log('frames', n);
})();
