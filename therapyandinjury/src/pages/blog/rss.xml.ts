import type { APIRoute } from 'astro';
import { posts } from '../../lib/blog';
import { site, abs } from '../../lib/site';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async () => {
  const items = (await posts())
    .map(
      (p) => `    <item>
      <title>${esc(p.data.title)}</title>
      <link>${abs(`/blog/${p.id}/`)}</link>
      <guid>${abs(`/blog/${p.id}/`)}</guid>
      <description>${esc(p.data.description)}</description>
      <pubDate>${p.data.pubDate.toUTCString()}</pubDate>
    </item>`,
    )
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(site.brandName)} blog</title>
    <link>${abs('/blog/')}</link>
    <description>Injury recovery, posture, and car safety tips from ${esc(site.brandName)}.</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`,
    { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } },
  );
};
