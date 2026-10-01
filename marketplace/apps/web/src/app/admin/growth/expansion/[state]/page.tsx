import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@cm/db";
import { growth } from "@cm/services";
import { US_STATES } from "@cm/core";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { starterCitiesAction, targetCitiesAction } from "../../actions";
import { GrowthTabs } from "../../ui";
import { TargetCell } from "../target-cell";

export const metadata = { title: "Expansion market" };
export const dynamic = "force-dynamic";

export default async function ExpansionMarket({ params, searchParams }: { params: Promise<{ state: string }>; searchParams: Promise<{ p?: string }> }) {
  const { actor } = await requireActor("admin");
  const state = (await params).state.toUpperCase();
  const professionCode = (await searchParams).p ?? "DC";
  if (!US_STATES[state]) notFound();
  const o = await growth.expansionOverview(actor);
  const profession = o.professions.find((p) => p.code === professionCode);
  if (!profession) notFound();
  const t = o.targets.find((x) => x.professionCode === professionCode && x.state === state);
  const status = t?.status ?? "OFF";
  const recent = await prisma.clinicProspect.findMany({ where: { state, professionCodes: { has: professionCode } }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, clinicName: true, city: true, researchStatus: true, email: true } });
  return (
    <>
      <PageHeader title={`${profession.displayName} · ${US_STATES[state]}`} description="Cities the bots search in the NPI registry for this market, a few per run, each re-searched on a cycle." actions={<Link href="/admin/growth/expansion" className="text-sm text-brand-700">← Expansion</Link>} />
      <GrowthTabs current="/admin/growth/expansion" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Cities" description={`${t?.cities.length ?? 0} in the rotation`} />
          <CardBody>
            <ActionForm action={targetCitiesAction} className="space-y-3">
              <input type="hidden" name="professionCode" value={professionCode} />
              <input type="hidden" name="state" value={state} />
              <Field label="One city per line (or comma separated)">
                <Textarea name="cities" defaultValue={(t?.cities ?? []).join("\n")} className="min-h-72 font-mono text-xs" />
              </Field>
              <Field label="Notes (optional)"><Input name="notes" defaultValue={t?.notes ?? ""} /></Field>
              <SubmitButton size="sm">Save cities</SubmitButton>
            </ActionForm>
            {growth.STATE_CITIES[state] ? (
              <ActionForm action={starterCitiesAction} className="mt-3" confirm="Replace the list with the starter cities?">
                <input type="hidden" name="professionCode" value={professionCode} />
                <input type="hidden" name="state" value={state} />
                <SubmitButton size="sm" variant="ghost">Load starter cities ({growth.STATE_CITIES[state].length})</SubmitButton>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Status" />
            <CardBody className="space-y-3 text-sm">
              <TargetCell professionCode={professionCode} state={state} status={status} />
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={t?.marketplaceOpen ? "green" : "gray"}>{t?.marketplaceOpen ? "Marketplace on" : "Marketplace off"}</Badge>
                {status === "LIVE" && !t?.marketplaceOpen ? <Badge tone="amber">Outreach held</Badge> : null}
              </div>
              <dl className="grid grid-cols-2 gap-2">
                <div><dt className="text-xs text-slate-500">Clinics found</dt><dd className="font-semibold tabular-nums">{t?.prospects ?? 0}</dd></div>
                <div><dt className="text-xs text-slate-500">Researched</dt><dd className="font-semibold tabular-nums">{t?.researched ?? 0}</dd></div>
                <div><dt className="text-xs text-slate-500">With email</dt><dd className="font-semibold tabular-nums">{t?.withEmail ?? 0}</dd></div>
                <div><dt className="text-xs text-slate-500">Providers (home state)</dt><dd className="font-semibold tabular-nums">{t?.providers ?? 0}</dd></div>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Latest clinics found" action={<Link href="/admin/growth/prospects" className="text-sm text-brand-700">All →</Link>} />
            <CardBody>
              {recent.length ? (
                <ul className="space-y-1.5 text-sm">
                  {recent.map((r) => (
                    <li key={r.id}><Link href={`/admin/growth/prospects/${r.id}`} className="hover:text-brand-700">{r.clinicName}</Link> <span className="text-xs text-slate-500">· {r.city} · {r.researchStatus.toLowerCase()}{r.email ? " · email" : ""}</span></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-500">None yet. Discovery runs every 10 minutes while the Clinic Prospecting agent is on.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
