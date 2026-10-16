import type { APIRoute } from 'astro';
import { abs } from '../lib/site';
import { publicPaths } from '../lib/paths';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Every indexable page with its last-changed date, plus a video entry for pages showing the commercial
// (Google video results). Google ignores changefreq/priority but they're harmless for other engines.
export const GET: APIRoute = async () => {
  const urls = (await publicPaths())
    .map((p) => {
      const v = p.video;
      const video = v
        ? `\n    <video:video><video:thumbnail_loc>${esc(v.poster)}</video:thumbnail_loc><video:title>${esc(v.title)}</video:title><video:description>${esc(v.description)}</video:description>${v.contentUrl ? `<video:content_loc>${esc(v.contentUrl)}</video:content_loc>` : ''}${v.embedUrl ? `<video:player_loc>${esc(v.embedUrl)}</video:player_loc>` : ''}${v.seconds ? `<video:duration>${v.seconds}</video:duration>` : ''}<video:publication_date>${v.date}</video:publication_date><video:family_friendly>yes</video:family_friendly></video:video>\n  `
        : '';
      return `  <url><loc>${abs(p.path)}</loc>${p.lastmod ? `<lastmod>${p.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}<changefreq>${p.changefreq}</changefreq><priority>${p.priority.toFixed(1)}</priority>${video}</url>`;
    })
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
