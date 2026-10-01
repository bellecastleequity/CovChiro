import type { Metadata, Viewport } from "next";
import { brand, env } from "@cm/config";
import { getSettings } from "@cm/services";
import { Inter, Outfit } from "next/font/google";
import { Analytics } from "@/components/site/analytics";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const b = brand();
  const s = await getSettings().catch(() => null);
  const google = s?.["seo.googleSiteVerification"], bing = s?.["seo.bingSiteVerification"];
  return {
    metadataBase: new URL(env().APP_BASE_URL),
    title: { default: `${b.name} — ${b.tagline}`, template: `%s · ${b.name}` },
    description: "On-demand coverage for clinics from licensed, verified chiropractors and other providers — matched by state license, paid through the platform.",
    applicationName: b.name,
    openGraph: { siteName: b.name, type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image" },
    formatDetection: { telephone: false, email: false, address: false },
    ...(google || bing ? { verification: { ...(google ? { google } : {}), ...(bing ? { other: { "msvalidate.01": bing } } : {}) } } : {}),
  };
}

// Self-hosted at build time by next/font (no runtime requests to Google).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-outfit", display: "swap" });

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#282472" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body className="min-h-dvh">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
