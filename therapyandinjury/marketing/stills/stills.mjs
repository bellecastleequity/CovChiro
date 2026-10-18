// Renders the still image ads (still.html) for every language, concept and size:
//   node marketing/stills/stills.mjs        → marketing/stills/out/<lang>-<ad>-<size>.jpg
import fs from 'node:fs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const here = new URL('.', import.meta.url);
const out = fileURLToPath(new URL('out/', here));
fs.mkdirSync(out, { recursive: true });
const SIZES = { square: [1080, 1080], story: [1080, 1920], link: [1200, 628] };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
for (const lang of ['en', 'es', 'ht']) for (const ad of ['walk', 'attorney']) for (const [f, [w, h]] of Object.entries(SIZES)) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(new URL(`still.html?lang=${lang}&ad=${ad}&f=${f}`, here).href);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(250);
  const file = `${out}${lang}-${ad}-${f}.jpg`;
  await p.screenshot({ path: file, type: 'jpeg', quality: 90 });
  await p.close();
  console.log(file);
}
await b.close();
