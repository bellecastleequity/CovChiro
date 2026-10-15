// Submits every URL in dist/sitemap.xml to IndexNow (Bing, which also feeds ChatGPT and
// Copilot search, plus Yandex and others) so new and changed pages are crawled in minutes.
// Google doesn't use IndexNow: submit the sitemap in Google Search Console instead.
// Run AFTER uploading the new build:  npm run indexnow
import { readFileSync } from 'node:fs';

const site = JSON.parse(readFileSync(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const key = site.seo.indexNowKey;
if (!key) {
  console.error('No seo.indexNowKey in src/data/site.json.');
  process.exit(1);
}
const sitemap = readFileSync(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const host = new URL(site.domain).host;

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation: `${site.domain}/${key}.txt`, urlList: urls }),
});
console.log(`IndexNow: submitted ${urls.length} URLs, HTTP ${res.status}${res.ok ? ' (accepted)' : ` ${await res.text()}`}`);
if (!res.ok) process.exit(1);
