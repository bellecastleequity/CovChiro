import type { Metadata, Viewport } from "next";
import { brand, env, isSandbox } from "@cm/config";
import { Inter, Outfit } from "next/font/google";
import { Analytics } from "@/components/site/analytics";
import { SandboxBar } from "@/components/site/sandbox-bar";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const b = brand();
  return {
    metadataBase: new URL(env().APP_BASE_URL),
    title: { default: `${b.name} — ${b.tagline}`, template: `%s · ${b.name}` },
    description: "On-demand coverage for clinics from licensed, verified chiropractors and other providers — matched by state license, paid through the platform.",
    openGraph: { siteName: b.name, type: "website" },
    // The test site is never indexed.
    ...(isSandbox() ? { robots: { index: false, follow: false } } : {}),
  };
}

// Self-hosted at build time by next/font (no runtime requests to Google).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-outfit", display: "swap" });

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#282472" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`} data-sandbox={isSandbox() ? "" : undefined}>
      <body className="min-h-dvh">
        {isSandbox() ? <SandboxBar /> : null}
        {children}
        <Analytics />
      </body>
    </html>
  );
}
