import type { APIRoute } from 'astro';
import { abs } from '../lib/site';
import { publicPaths } from '../lib/paths';

export const GET: APIRoute = async () => {
  const urls = (await publicPaths())
    .map(
      (p) =>
        `  <url><loc>${abs(p.path)}</loc>${p.lastmod ? `<lastmod>${p.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}<changefreq>${p.changefreq}</changefreq><priority>${p.priority.toFixed(1)}</priority></url>`,
    )
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
