// Renders banner.html: YouTube channel banner (2560×1440) and Facebook cover (1640×624).
//   node marketing/thumbnails/banners.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const here = new URL('.', import.meta.url);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
for (const [f, w, h, name] of [['yt', 2560, 1440, 'youtube-banner-2560x1440.jpg'], ['fb', 1640, 624, 'facebook-cover-1640x624.jpg']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(new URL(`banner.html?f=${f}`, here).href);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const out = fileURLToPath(new URL(name, here));
  await p.screenshot({ path: out, type: 'jpeg', quality: 90 });
  console.log(out);
}
await b.close();
