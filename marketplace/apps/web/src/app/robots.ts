import type { MetadataRoute } from "next";
import { env } from "@cm/config";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  const disallow = ["/admin", "/clinic", "/provider", "/api", "/agreements", "/c/", "/o/", "/offer/", "/s/", "/t/", "/unsubscribe", "/setup", "/mfa", "/reset-password", "/verify-email"];
  // AI search and answer engines are welcome on the public pages (that's how answers cite us).
  const aiBots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended", "Bingbot"];
  return {
    rules: [{ userAgent: "*", allow: "/", disallow }, ...aiBots.map((userAgent) => ({ userAgent, allow: "/", disallow }))],
    sitemap: `${base}/sitemap.xml`,
  };
}
