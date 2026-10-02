import type { MetadataRoute } from "next";
import { env } from "@cm/config";
import { seo } from "@cm/services";

// Reads the database, so it's built per request (the cPanel build has no DB).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  return (await seo.publicPaths()).map((p) => ({ url: `${base}${p.path === "/" ? "" : p.path}`, changeFrequency: p.changeFrequency, priority: p.priority, ...(p.lastModified ? { lastModified: p.lastModified } : {}) }));
}
