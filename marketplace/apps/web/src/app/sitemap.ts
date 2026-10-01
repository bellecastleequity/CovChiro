import type { MetadataRoute } from "next";
import { env } from "@cm/config";
import { prisma } from "@cm/db";
import { blog } from "@cm/services";

// Reads the database, so it's built per request (the cPanel build has no DB).
export const dynamic = "force-dynamic";

const STATIC = ["/", "/for-clinics", "/for-providers", "/how-it-works", "/states", "/faq", "/contact", "/tools/cost-of-closing", "/blog"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  const [posts, professions] = await Promise.all([
    blog.publicPosts({ take: 1000 }).catch(() => []),
    prisma.profession.findMany({ select: { slug: true, active: true } }).catch(() => []),
  ]);
  return [
    ...STATIC.map((p) => ({ url: `${base}${p === "/" ? "" : p}`, changeFrequency: (p === "/blog" ? "weekly" : "monthly") as "weekly" | "monthly", priority: p === "/" ? 1 : 0.7 })),
    ...professions.filter((p) => p.slug).map((p) => ({ url: `${base}/${p.slug}`, changeFrequency: "monthly" as const, priority: p.active ? 0.8 : 0.4 })),
    ...posts.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
