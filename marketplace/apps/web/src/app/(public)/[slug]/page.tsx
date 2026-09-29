import { notFound } from "next/navigation";
import { US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { LinkButton } from "@/components/ui/button";
import { LeadForm } from "@/components/site/lead-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await prisma.profession.findUnique({ where: { slug: (await params).slug } });
  return p ? { title: `${p.displayName} coverage` } : {};
}

/** SEO landing page per profession (Addendum 01 §12). Inactive → waitlist. */
export default async function ProfessionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await prisma.profession.findUnique({ where: { slug } });
  if (!p) notFound();
  const states = (await prisma.professionStateConfig.findMany({ where: { professionCode: p.code, enabled: true } })).map((s) => s.state);
  const stateList = Object.entries(US_STATES).map(([code, name]) => ({ code, name }));
  return (
    <div className="container-page grid gap-12 py-16 lg:grid-cols-2">
      <div>
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">{p.displayName} coverage</div>
        <h1 className="mt-2 text-4xl font-semibold">
          {p.active ? `Licensed ${p.displayName.toLowerCase()}s when you need them` : `${p.displayName} coverage is coming soon`}
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          {p.active
            ? `Every ${p.credentialSuffix} is verified for your state before they can apply. Post a shift and get matched in hours.`
            : `We're preparing to launch ${p.displayName.toLowerCase()} coverage. Join the waitlist and we'll let you know as soon as we open in your state.`}
        </p>
        {p.active ? (
          <>
            <p className="mt-4 text-sm text-slate-500">Available in: {states.map((s) => US_STATES[s]).join(", ") || "coming soon"}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/signup?role=clinic" size="lg">
                Post a shift
              </LinkButton>
              <LinkButton href={`/signup?role=provider&profession=${p.code}`} variant="outline" size="lg">
                Join as a {p.credentialSuffix}
              </LinkButton>
            </div>
          </>
        ) : null}
      </div>
      {!p.active ? (
        <div className="rounded-2xl border border-slate-200 p-6 shadow-card">
          <h2 className="text-lg font-semibold">Join the waitlist</h2>
          <p className="mt-1 text-sm text-slate-500">For clinics and {p.displayName.toLowerCase()}s.</p>
          <div className="mt-5">
            <LeadForm source="waitlist" audience="PROVIDER" professionCode={p.code} states={stateList} cta="Join the waitlist" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
