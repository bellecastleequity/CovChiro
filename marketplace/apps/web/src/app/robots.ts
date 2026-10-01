import type { MetadataRoute } from "next";
import { env } from "@cm/config";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/clinic", "/provider", "/api", "/agreements", "/c/", "/o/", "/offer/", "/unsubscribe", "/setup", "/mfa", "/reset-password", "/verify-email"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
