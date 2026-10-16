// Renders every page through the server build (dist/server) into dist/check/, so the SEO check can
// inspect real HTML now that pages are rendered per request. Crawls from /, the sitemap, every
// location (including noindex ones) and every internal link it finds. Run by `npm run build`.
import http from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'dist/client');
const out = join(root, 'dist/check');
const { handler } = await import(join(root, 'dist/server/entry.mjs'));
const branches = JSON.parse(readFileSync(join(root, 'src/data/branches.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
cpSync(client, out, { recursive: true }); // static assets + .htaccess, so link checks see them

const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => {
  const r = await fetch(base + p, { redirect: 'manual' });
  return { status: r.status, type: r.headers.get('content-type') || '', body: await r.text() };
};

const queue = ['/', '/robots.txt', '/llms.txt', '/sitemap.xml', '/blog/rss.xml', ...branches.map((b) => `/${b.slug}/`)];
const seen = new Set();
const failures = [];
while (queue.length) {
  const p = queue.shift();
  if (seen.has(p)) continue;
  seen.add(p);
  if (existsSync(join(client, p)) && !p.endsWith('/')) continue; // static file
  const r = await get(p);
  if (r.status !== 200) { failures.push(`${p} → HTTP ${r.status}`); continue; }
  const file = p.endsWith('/') ? join(out, p, 'index.html') : join(out, p);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, r.body);
  const links = [...r.body.matchAll(/(?:href|<loc>)="?(\/[^"#?<\s]*)|<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1] || m[2]);
  for (const l of links) if (!seen.has(l) && !l.startsWith('/api/') && !l.startsWith('/_astro/')) queue.push(l);
}
const nf = await get('/this-page-does-not-exist/');
if (nf.status !== 404 || !nf.type.includes('html')) failures.push(`unknown page → HTTP ${nf.status} ${nf.type} (expected the 404 page)`);
else writeFileSync(join(out, '404.html'), nf.body);
server.close();
console.log(`Rendered ${seen.size} URLs into dist/check/.`);
if (failures.length) { failures.forEach((f) => console.log(`  ERROR ${f}`)); process.exit(1); }
