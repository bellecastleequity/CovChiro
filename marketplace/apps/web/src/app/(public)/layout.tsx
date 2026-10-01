import { getSettings } from "@cm/services";
import { SiteFooter, SiteHeader } from "@/components/site/header";
import { JsonLd, organizationLd, websiteLd } from "@/lib/seo";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings();
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <JsonLd data={[organizationLd(s["seo.sameAs"]), websiteLd()]} />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
