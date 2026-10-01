import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { growthProfessionAction, starterDraftsAction } from "../actions";
import { GrowthTabs } from "../ui";
import { TargetCell } from "./target-cell";

export const metadata = { title: "Expansion" };
export const dynamic = "force-dynamic";

export default async function Expansion({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { actor } = await requireActor("admin");
  const { all } = await searchParams;
  const o = await growth.expansionOverview(actor);
  const cell = (p: string, s: string) => o.targets.find((t) => t.professionCode === p && t.state === s);
  const open = new Set(o.open);
  const shown = all ? o.states : o.states.filter((s) => o.targets.some((t) => t.state === s.code && t.status !== "OFF") || o.open.some((k) => k.endsWith(`|${s.code}`)) || ["FL", "GA", "AL"].includes(s.code));
  const warnings = o.targets.filter((t) => t.status === "LIVE" && !t.marketplaceOpen);
  return (
    <>
      <PageHeader
        title="Expansion"
        description="Where the growth bots work, by profession and state. Prelaunch: they find practices and licensed providers in the NPI registry, research them on the web, find provider contacts and recruit providers (and send welcome and credential emails), without contacting clinics. Live: clinic outreach runs too, but only while the marketplace has that profession turned on in that state."
        actions={<Link className="text-sm text-brand-700" href={all ? "/admin/growth/expansion" : "/admin/growth/expansion?all=1"}>{all ? "Show active" : "Show all 51"}</Link>}
      />
      <GrowthTabs current="/admin/growth/expansion" />
      {warnings.length ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Live but the marketplace is off for {warnings.map((t) => `${t.professionCode} in ${t.state}`).join(", ")}: no clinic outreach goes out there (treated as prelaunch) until it&apos;s turned on in <Link href="/admin/states" className="font-medium underline">States &amp; professions</Link>.
        </div>
      ) : null}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2.5">State</th>
              {o.professions.map((p) => <th key={p.code} className="px-2 py-2.5 text-center" title={p.displayName}>{p.code}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.code} className="border-b border-slate-100 align-top">
                <td className="px-4 py-2 font-medium" title={s.name}>{s.code}</td>
                {o.professions.map((p) => {
                  const t = cell(p.code, s.code);
                  const status = t?.status ?? "OFF";
                  return (
                    <td key={p.code} className="min-w-24 px-1.5 py-2">
                      <TargetCell professionCode={p.code} state={s.code} status={status} />
                      {t && (status !== "OFF" || t.prospects) ? (
                        <Link href={`/admin/growth/expansion/${s.code}?p=${p.code}`} className="mt-1 block text-[11px] leading-tight text-slate-500 hover:text-brand-700">
                          {t.prospects} clinics · {t.cities.length} cities
                          {status === "LIVE" && !t.marketplaceOpen ? <span className="block text-amber-700">marketplace off</span> : null}
                        </Link>
                      ) : open.has(`${p.code}|${s.code}`) ? <span className="mt-1 block text-[11px] text-emerald-700">marketplace on</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-xs text-slate-500">Turning a market on with no cities loads a starter list of that state&apos;s larger cities; click the counts under a switch to edit its cities. Live needs the marketplace on for that pair and approved outreach emails for the profession.</p>

      <Card className="mt-8">
        <CardHeader
          title={<>Professions<InfoTip label="About profession settings">How the bots find each profession&apos;s practices in the public NPI registry (the registry&apos;s taxonomy name and code prefix), and whether its emails are ready. A profession only ever gets emails written for it, or written for any profession; until those are approved, its people and clinics are skipped, never sent chiropractic wording.</InfoTip></>}
          description="Registry search, practice naming, email readiness and schools per profession."
        />
        <CardBody className="space-y-4">
          {o.professions.map((p) => {
            const providerReady = p.readiness.providerMissing.length === 0;
            const outreachReady = p.readiness.outreachMissing.length === 0;
            return (
              <div key={p.code} className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.displayName}</span>
                  <Badge tone={p.active ? "green" : "gray"}>{p.active ? "Live on platform" : "Not live"}</Badge>
                  <Badge tone={providerReady ? "green" : "amber"}>{providerReady ? "Provider emails ready" : `Provider emails: ${p.readiness.providerMissing.length} to approve`}</Badge>
                  <Badge tone={outreachReady ? "green" : "amber"}>{outreachReady ? "Clinic outreach ready" : `Outreach: ${p.readiness.outreachMissing.length} to approve`}</Badge>
                  <Badge tone={p.readiness.recruitmentMissing.length ? "amber" : "green"}>{p.readiness.recruitmentMissing.length ? `Recruitment: ${p.readiness.recruitmentMissing.length} to approve` : "Provider recruitment ready"}</Badge>
                  <Link href="/admin/schools"><Badge tone={p.schools ? "blue" : "amber"}>{p.schools} schools</Badge></Link>
                </div>
                <ActionForm action={growthProfessionAction} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1.4fr_0.7fr_auto] sm:items-end">
                  <input type="hidden" name="professionCode" value={p.code} />
                  <label className="text-xs text-slate-600">Registry taxonomy name<Input name="registrySearch" defaultValue={p.registrySearch} placeholder="e.g. Physical Therapist" /></label>
                  <label className="text-xs text-slate-600">Taxonomy code prefixes<Input name="taxonomyCodes" defaultValue={p.taxonomyCodes.join(", ")} placeholder="e.g. 2251" className="font-mono" /></label>
                  <label className="text-xs text-slate-600">Practice noun<Input name="practiceNoun" defaultValue={p.practiceNoun} placeholder="physical therapy clinic" /></label>
                  <label className="text-xs text-slate-600">Name suffix<Input name="nameSuffix" defaultValue={p.nameSuffix} placeholder="PT" /></label>
                  <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                </ActionForm>
                {!p.registrySearch ? <p className="mt-2 text-xs text-amber-800">No registry search yet: prelaunch markets for {p.displayName} won&apos;t discover practices until this is filled in.</p> : null}
                {p.code !== "DC" && (!providerReady || !outreachReady || p.readiness.recruitmentMissing.length > 0) ? (
                  <ActionForm action={starterDraftsAction} className="mt-3">
                    <input type="hidden" name="professionCode" value={p.code} />
                    <div className="flex flex-wrap items-center gap-3">
                      <SubmitButton size="sm" variant="outline">Create starter drafts for {p.displayName}</SubmitButton>
                      <span className="text-xs text-slate-500">Copies the chiropractic emails as drafts with the wording swapped; review and approve them under <Link href="/admin/growth/prompts" className="underline">Prompts</Link>.</span>
                    </div>
                  </ActionForm>
                ) : null}
              </div>
            );
          })}
        </CardBody>
      </Card>
    </>
  );
}
