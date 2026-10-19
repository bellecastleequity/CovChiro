// Renders thumb.html to a 1280x720 YouTube thumbnail: node marketing/thumbnails/render.mjs [out.jpg] [lang]
// lang: es (No se haga el fuerte) or ht (Pa neglije kò w); default English.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const here = new URL('.', import.meta.url);
const out = process.argv[2] || fileURLToPath(new URL('dont-walk-it-off-youtube.jpg', here));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const lang = process.argv[3];
await p.goto(new URL(`thumb.html${lang ? `?lang=${lang}` : ''}`, here).href);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(300);
await p.screenshot({ path: out, type: 'jpeg', quality: 92 });
await b.close();
console.log(out);
