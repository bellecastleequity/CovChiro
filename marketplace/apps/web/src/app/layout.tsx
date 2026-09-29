import type { Metadata, Viewport } from "next";
import { brand, env } from "@cm/config";
import { Analytics } from "@/components/site/analytics";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const b = brand();
  return {
    metadataBase: new URL(env().APP_BASE_URL),
    title: { default: `${b.name} — ${b.tagline}`, template: `%s · ${b.name}` },
    description: "On-demand coverage for clinics from licensed, verified chiropractors and other providers — matched by state license, paid through the platform.",
    openGraph: { siteName: b.name, type: "website" },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0e7d73" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
