// Exports every post/story template to PNG for the brand account and each branch.
//   npm run social:export                 -> all cities
//   npm run social:export -- Ocala        -> one city ("brand" for the brand-level account)
// Output: social/export/<city>/<template>.png
// First time on a new computer: npx playwright install chromium
import { chromium } from 'playwright';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const branches = JSON.parse(readFileSync(join(here, '../src/data/branches.json'), 'utf8'));
const only = process.argv[2]?.toLowerCase();

const hhmm = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h >= 12 ? ' pm' : ' am'}`;
};
const hours = (b) =>
  b.hours.length
    ? `${b.hours.map((h) => h.day.slice(0, 3)).join(', ')} · ${hhmm(b.hours[0].opens)}–${hhmm(b.hours[0].closes)}`
    : '';

const targets = [
  { key: 'brand', params: { city: '' }, open: false },
  ...branches.map((b) => ({
    key: b.slug,
    open: b.status === 'open',
    params: {
      city: b.city,
      address: b.address ? `${b.address.street}, ${b.address.city}, ${b.address.state} ${b.address.zip}` : '',
      hours: hours(b),
      phone: b.phone,
    },
  })),
].filter((t) => !only || t.key === only || t.params.city?.toLowerCase() === only);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const kind of ['posts', 'stories']) {
  const files = readdirSync(join(here, kind)).filter((f) => f.endsWith('.html'));
  const size = kind === 'posts' ? { width: 1080, height: 1080 } : { width: 1080, height: 1920 };
  for (const t of targets) {
    const outDir = join(here, 'export', t.key);
    mkdirSync(outDir, { recursive: true });
    for (const f of files) {
      // "Now open" templates only make sense for open branches.
      if (f.includes('now-open') && !t.open) continue;
      const page = await browser.newPage({ viewport: size });
      const url = pathToFileURL(join(here, kind, f));
      url.search = new URLSearchParams(t.params).toString();
      await page.goto(url.href, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.canvas').screenshot({ path: join(outDir, f.replace('.html', '.png')) });
      await page.close();
    }
    console.log(`exported ${t.key}`);
  }
}
await browser.close();
