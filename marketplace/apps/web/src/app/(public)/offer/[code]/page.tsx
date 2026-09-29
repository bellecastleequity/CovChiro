import { notFound } from "next/navigation";
import { promo } from "@cm/services";
import { LeadForm } from "@/components/site/lead-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Special offer", robots: { index: false } };

/** Campaign landing page (/offer/CODE): captures a lead and issues a personal code. */
export default async function OfferPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { code } = await params;
  const { preview } = await searchParams;
  const c = await promo.campaignForLanding(code, preview === "1");
  if (!c) notFound();
  return (
    <div className="bg-gradient-to-b from-accent-50 to-white">
      <div className="container-page grid gap-10 py-16 lg:grid-cols-2">
        <div>
          <span className="inline-flex rounded-full bg-amber-400/20 px-3 py-1 text-sm font-semibold text-amber-800">{c.offer}</span>
          <h1 className="mt-4 text-4xl font-semibold">{c.headline ?? `${c.offer} your first coverage shift`}</h1>
          {c.description ? <p className="mt-4 whitespace-pre-line text-lg text-slate-600">{c.description}</p> : null}
          <p className="mt-6 text-sm text-slate-500">Personal codes are valid until {c.expiresAt.toLocaleDateString("en-US")}.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
          <h2 className="text-lg font-semibold">{c.audience === "CLINIC" ? "Get your personal code" : "Get started"}</h2>
          <div className="mt-5">
            <LeadForm source="landing" campaign={c.code} audience={c.audience} cta={c.audience === "CLINIC" ? "Send me my code" : "Keep me posted"} />
          </div>
        </div>
      </div>
    </div>
  );
}
