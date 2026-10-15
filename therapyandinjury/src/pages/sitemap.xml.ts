import type { APIRoute } from 'astro';
import { branches, branchPath, abs } from '../lib/site';

const pages = ['/', '/auto-accident-injuries/', '/services/', '/about/', '/locations/', '/privacy/', '/accessibility/'];

export const GET: APIRoute = () => {
  const urls = [...pages, ...branches.map(branchPath)]
    .map((p) => `  <url><loc>${abs(p)}</loc></url>`)
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
