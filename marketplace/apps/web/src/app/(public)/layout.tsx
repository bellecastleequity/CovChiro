import { brand } from "@cm/config";
import { organizationLd, websiteLd } from "@cm/core";
import { getSettings } from "@cm/services";
import { SiteFooter, SiteHeader } from "@/components/site/header";
import { JsonLd } from "@/components/site/json-ld";
import { GoogleAnalytics } from "@/components/site/google-analytics";
import { siteUrl } from "@/lib/seo";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const b = brand();
  const base = siteUrl();
  const s = await getSettings().catch(() => null);
  const sameAs = s ? [s["site.instagramUrl"], s["site.youtubeUrl"]].filter(Boolean) : [];
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <JsonLd data={[organizationLd({ name: b.name, url: base, logo: `${base}/brand/logo.png`, email: b.supportEmail, sameAs }), websiteLd({ name: b.name, url: base })]} />
      {s?.["seo.gaMeasurementId"] ? <GoogleAnalytics id={s["seo.gaMeasurementId"]} /> : null}
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
