import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  output: "standalone",
  // Monorepo: trace workspace packages from the repo root into the standalone bundle.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@cm/config", "@cm/core", "@cm/db", "@cm/integrations", "@cm/services"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-neon", "@neondatabase/serverless", "@node-rs/argon2", "stripe"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // The old coveragechiropractor.com site 301s here with its paths kept (cPanel wildcard redirect).
  // Send each old page to its closest new page so its search ranking carries over.
  async redirects() {
    return [
      { source: "/index.html", destination: "/", statusCode: 301 },
      { source: "/articles.html", destination: "/blog", statusCode: 301 },
      { source: "/help-center.html", destination: "/faq", statusCode: 301 },
      { source: "/ime-services.html", destination: "/contact", statusCode: 301 },
      { source: "/offer.html", destination: "/for-clinics", statusCode: 301 },
      { source: "/dashboard.html", destination: "/login", statusCode: 301 },
      { source: "/admin.html", destination: "/login", statusCode: 301 },
      { source: "/documents/:path*", destination: "/how-it-works", statusCode: 301 },
      { source: "/assets/logo:rest(.*)", destination: "/brand/logo.png", statusCode: 301 },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
