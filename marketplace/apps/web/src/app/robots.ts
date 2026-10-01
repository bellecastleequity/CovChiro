import type { MetadataRoute } from "next";
import { env } from "@cm/config";

export const dynamic = "force-dynamic";

/** robots.txt: public marketing pages, blog and landing pages are crawlable; portals, auth, APIs and one-tap links are not. */
export default function robots(): MetadataRoute.Robots {
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/clinic", "/provider", "/api/", "/login", "/mfa", "/setup", "/forgot-password", "/reset-password", "/verify-email", "/agreements", "/c/", "/o/", "/unsubscribe", "/offer/", "/*?c=", "/*&c="],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
