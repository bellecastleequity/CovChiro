import { brand, env } from "@cm/config";
import { blog } from "@cm/services";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** RSS 2.0 feed of published posts (helps discovery and lets people subscribe). */
export async function GET() {
  const b = brand();
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  const posts = await blog.publicPosts({ take: 30 });
  const items = posts
    .map(
      (p) => `<item><title>${esc(p.title)}</title><link>${base}/blog/${p.slug}</link><guid isPermaLink="true">${base}/blog/${p.slug}</guid><description>${esc(p.description)}</description>${p.publishedAt ? `<pubDate>${p.publishedAt.toUTCString()}</pubDate>` : ""}</item>`,
    )
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(`${b.name} blog`)}</title><link>${base}/blog</link><description>${esc(`Guides on clinic coverage and per diem work from ${b.name}.`)}</description><language>en-us</language>${items}</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900" } });
}
