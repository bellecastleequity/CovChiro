import type { Metadata } from "next";
import { brand, isSandbox } from "@cm/config";
import { organizationLd, websiteLd } from "@cm/core";
import { getSettings } from "@cm/services";
import { SiteFooter, SiteHeader } from "@/components/site/header";
import { JsonLd } from "@/components/site/json-ld";
import { GoogleAnalytics } from "@/components/site/google-analytics";
import { siteUrl } from "@/lib/seo";

// Reads live Settings (analytics ID, social links, FAQ answers), so public pages render
// per request instead of baking in whatever the build machine's database had.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  if (isSandbox()) return {};
  const s = await getSettings().catch(() => null);
  const google = s?.["seo.googleSiteVerification"]?.trim();
  const bing = s?.["seo.bingSiteVerification"]?.trim();
  return google || bing ? { verification: { ...(google ? { google } : {}), ...(bing ? { other: { "msvalidate.01": bing } } : {}) } } : {};
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const b = brand();
  const base = siteUrl();
  const s = await getSettings().catch(() => null);
  const sameAs = s ? [s["site.instagramUrl"], s["site.youtubeUrl"]].filter(Boolean) : [];
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <JsonLd data={[organizationLd({ name: b.name, url: base, logo: `${base}/brand/logo.png`, email: b.supportEmail, sameAs }), websiteLd({ name: b.name, url: base })]} />
      {s?.["seo.gaMeasurementId"] && !isSandbox() ? <GoogleAnalytics id={s["seo.gaMeasurementId"]} /> : null}
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
