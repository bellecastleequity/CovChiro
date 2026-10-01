import { notFound } from "next/navigation";
import { CalendarClock, Car, MapPin, Wallet } from "lucide-react";
import { brand } from "@cm/config";
import { cityLabel, slugify, US_STATES } from "@cm/core";
import { seo } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/site/seo-blocks";
import { dateLabel, money, timeRange } from "@/lib/format";
import { breadcrumbLd, JsonLd, jobPostingLd, pageMeta } from "@/lib/seo";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function describe(j: seo.PublicJob) {
  const day = dateLabel(j.startsAt, j.timeZone, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return { day, hours: timeRange(j.startsAt, j.endsAt, j.timeZone), place: `${cityLabel(j.city)}, ${j.state}`, placeHtml: esc(`${cityLabel(j.city)}, ${j.state}`) };
}

export async function generateMetadata({ params }: Params) {
  const j = await seo.publicJob((await params).id);
  if (!j) return { robots: { index: false } };
  const d = describe(j);
  return pageMeta({
    title: `Per diem ${j.professionName} shift in ${d.place}, ${dateLabel(j.startsAt, j.timeZone)}`,
    description: `${j.professionName} fill-in shift in ${d.place} on ${d.day}, ${d.hours}. Pay ${money(j.providerPayCents)}${j.travelBudget ? " plus mileage" : ""}. Requires a verified ${US_STATES[j.state]} license.`,
    path: `/jobs/shift/${j.id}`,
  });
}

/** One open shift as a public job posting (Google for Jobs). Gone (404) once filled, cancelled or started. */
export default async function ShiftPosting({ params }: Params) {
  const j = await seo.publicJob((await params).id);
  if (!j) notFound();
  const b = brand();
  const d = describe(j);
  const stateName = US_STATES[j.state];
  const prof = j.professionName.toLowerCase();
  const signedIn = !!(await getSession());
  const cityPage = (await seo.seoCities(j.state)).some((c) => slugify(c) === slugify(j.city));
  const moreHref = `/jobs/${j.professionSlug}/${slugify(stateName)}${cityPage ? `/${slugify(j.city)}` : ""}`;
  const apply = signedIn ? "/provider/shifts" : `/signup?role=provider&profession=${j.professionCode}`;
  const title = `Per diem ${j.professionName} (fill-in) · ${d.place}`;
  const descriptionHtml = [
    `<p>A practice in ${d.placeHtml} needs a licensed ${prof} to cover ${d.day}, ${d.hours} (local time).</p>`,
    `<p>Pay: ${money(j.providerPayCents)} for the shift${j.travelBudget ? ", plus mileage at cost" : ""}${j.lodging ? "; lodging allowed" : ""}. Paid to your bank through ${b.name} after the shift.</p>`,
    `<p>Requirements: an active ${stateName} ${prof} license verified on ${b.name} and valid through the shift date, and verified malpractice insurance.</p>`,
    `<p>Apply with a free ${b.name} profile. Clinic details are shown in the app to verified providers.</p>`,
  ].join("");
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Jobs", path: "/jobs" },
    { name: `${j.professionName} jobs in ${stateName}`, path: `/jobs/${j.professionSlug}/${slugify(stateName)}` },
    { name: d.place, path: `/jobs/shift/${j.id}` },
  ];
  return (
    <div className="container-page py-12">
      <JsonLd data={[breadcrumbLd(crumbs), jobPostingLd(j, { title, descriptionHtml, stateName })]} />
      <Breadcrumbs items={crumbs} />
      <div className="max-w-2xl">
        {j.urgent ? <div className="mb-3 inline-block rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Urgent cover</div> : null}
        <h1 className="text-3xl font-semibold leading-tight">{title}</h1>
        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          {[
            { Icon: CalendarClock, k: "When", v: `${d.day} · ${d.hours}` },
            { Icon: MapPin, k: "Where", v: `${d.place} (clinic details in the app)` },
            { Icon: Wallet, k: "Your pay", v: money(j.providerPayCents) },
            { Icon: Car, k: "Travel", v: [j.travelBudget ? "Mileage paid at cost" : "Local", j.lodging ? "lodging allowed" : null].filter(Boolean).join(", ") },
          ].map(({ Icon, k, v }) => (
            <div key={k} className="rounded-2xl border border-slate-200 p-4">
              <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500"><Icon className="size-3.5 text-accent-600" aria-hidden />{k}</dt>
              <dd className="mt-1 font-medium text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 space-y-3 text-slate-700" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href={apply} size="lg">{signedIn ? "See it in your shifts" : "Apply with a free profile"}</LinkButton>
          <LinkButton href={moreHref} variant="outline" size="lg">More shifts near {cityLabel(j.city)}</LinkButton>
        </div>
      </div>
    </div>
  );
}
