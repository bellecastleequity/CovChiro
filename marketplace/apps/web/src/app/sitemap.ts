import type { MetadataRoute } from "next";
import { env } from "@cm/config";
import { seo } from "@cm/services";

/** sitemap.xml: every indexable page, including the state/city landing pages and live job postings. lastmod only where it's known (an always-"now" date teaches crawlers to ignore it). */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  const entries = await seo.sitemapEntries();
  return entries.map((e) => ({ url: `${base}${e.path === "/" ? "" : e.path}`, ...(e.lastModified ? { lastModified: e.lastModified } : {}), changeFrequency: e.changeFrequency, priority: e.priority }));
}
