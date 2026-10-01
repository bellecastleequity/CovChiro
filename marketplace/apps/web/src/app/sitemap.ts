import type { MetadataRoute } from "next";
import { env } from "@cm/config";
import { blog, seo } from "@cm/services";

/**
 * sitemap.xml: every indexable page: marketing pages, profession/state/city
 * landing pages, live job postings (services seo.sitemapEntries) and published
 * blog posts. lastmod only where it's known (an always-"now" date teaches
 * crawlers to ignore it). Reads the database, so it's built per request.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  const [entries, posts] = await Promise.all([seo.sitemapEntries(), blog.publicPosts({ take: 1000 }).catch(() => [])]);
  return [
    ...entries.map((e) => ({ url: `${base}${e.path === "/" ? "" : e.path}`, ...(e.lastModified ? { lastModified: e.lastModified } : {}), changeFrequency: e.changeFrequency, priority: e.priority })),
    { url: `${base}/blog`, changeFrequency: "weekly" as const, priority: 0.7 },
    ...posts.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
