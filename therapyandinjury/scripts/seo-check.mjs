// Post-build SEO checks over dist/ (run automatically by `npm run build`).
// Same idea as CoverageOnCall's SEO invariant tests: every indexable page has a unique
// title and description, a self-referencing canonical, one <h1>, valid JSON-LD and an
// OG image; the sitemap lists exactly the indexable pages; internal links resolve.
// Errors fail the build. Length issues are warnings.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// Checks the pages rendered by scripts/render-pages.mjs (dist/check/).
const dist = new URL('../dist/check/', import.meta.url).pathname;
const site = JSON.parse(readFileSync(new URL('../src/data/site.json', import.meta.url), 'utf8')).domain;
const errors = [];
const warnings = [];

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const htmlFiles = walk(dist).filter((f) => f.endsWith('.html'));
const urlFor = (f) => '/' + relative(dist, f).replace(/index\.html$/, '').replace(/\\/g, '/');
const pick = (html, re) => (html.match(re) || [])[1];
const decode = (s) => s?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

const pages = [];
for (const f of htmlFiles) {
  const html = readFileSync(f, 'utf8');
  const path = urlFor(f);
  if (path === '/404.html') continue;
  const robots = pick(html, /<meta name="robots" content="([^"]+)"/) || '';
  pages.push({
    path,
    html,
    noindex: robots.includes('noindex'),
    title: decode(pick(html, /<title>([^<]*)<\/title>/)),
    desc: decode(pick(html, /<meta name="description" content="([^"]*)"/)),
    canonical: pick(html, /<link rel="canonical" href="([^"]+)"/),
    h1s: (html.match(/<h1[\s>]/g) || []).length,
    og: pick(html, /<meta property="og:image" content="([^"]+)"/),
  });
}

const indexable = pages.filter((p) => !p.noindex);
const seen = { title: new Map(), desc: new Map() };
for (const p of indexable) {
  if (!p.title) errors.push(`${p.path}: missing <title>`);
  if (!p.desc) errors.push(`${p.path}: missing meta description`);
  if (p.canonical !== site + p.path) errors.push(`${p.path}: canonical is ${p.canonical}, expected ${site + p.path}`);
  if (p.h1s !== 1) errors.push(`${p.path}: has ${p.h1s} <h1> elements (expected 1)`);
  if (!p.og) errors.push(`${p.path}: missing og:image`);
  if (p.title && p.title.length > 65) warnings.push(`${p.path}: title is ${p.title.length} chars (aim ≤ 60–65)`);
  if (p.desc && (p.desc.length < 70 || p.desc.length > 165)) warnings.push(`${p.path}: description is ${p.desc.length} chars (aim 120–160)`);
  if (/\[[A-Z][^\]]*\]/.test(p.title + p.desc)) errors.push(`${p.path}: placeholder text in title or description`);
  for (const k of ['title', 'desc']) {
    const v = p[k];
    if (v && seen[k].has(v)) errors.push(`${p.path}: duplicate ${k} (same as ${seen[k].get(v)})`);
    else if (v) seen[k].set(v, p.path);
  }
}

for (const p of pages) {
  for (const m of p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]);
      if (/\[[A-Z][^\]"]*\]/.test(JSON.stringify(data))) warnings.push(`${p.path}: JSON-LD contains placeholder text`);
    } catch {
      errors.push(`${p.path}: invalid JSON-LD`);
    }
  }
  for (const m of p.html.matchAll(/href="(\/[^"#?]*)/g)) {
    const href = m[1];
    const target = href.endsWith('/') ? join(dist, href, 'index.html') : join(dist, href);
    if (!existsSync(target) && !href.startsWith('/api/')) errors.push(`${p.path}: broken internal link ${href}`);
  }
}

const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
const inSitemap = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(site, '')));
for (const p of indexable) if (!inSitemap.has(p.path)) errors.push(`sitemap.xml: missing indexable page ${p.path}`);
for (const p of pages.filter((x) => x.noindex)) if (inSitemap.has(p.path)) errors.push(`sitemap.xml: lists noindex page ${p.path}`);
for (const u of inSitemap) if (!pages.some((p) => p.path === u)) errors.push(`sitemap.xml: lists ${u}, which was not built`);

for (const f of ['robots.txt', 'llms.txt', 'sitemap.xml', 'favicon.ico', '.htaccess']) if (!existsSync(join(dist, f))) errors.push(`missing dist/${f}`);

console.log(`SEO check: ${indexable.length} indexable pages, ${pages.length - indexable.length} noindex, ${inSitemap.size} in sitemap.`);
warnings.forEach((w) => console.log(`  warn  ${w}`));
errors.forEach((e) => console.log(`  ERROR ${e}`));
if (errors.length) {
  console.log(`SEO check failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log('SEO check passed.');
