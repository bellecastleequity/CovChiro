import Link from "next/link";
import { rewards } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { LevelBadge } from "@/components/rewards/rewards-view";
import { cn } from "@/lib/cn";
import { requireActor } from "@/lib/session";
import { awardRewardPointsAction } from "../actions";

export const metadata = { title: "Rewards" };

export default async function AdminRewards({ searchParams }: { searchParams: Promise<{ who?: string; days?: string; state?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const audience = f.who === "clinics" ? "CLINIC" : "PROVIDER";
  const days = f.days === "30" ? 30 : f.days === "90" ? 90 : null;
  const state = f.state?.trim().toUpperCase().slice(0, 2) || null;
  const rows = await rewards.leaderboard(actor, { audience, days, state, take: 100 });
  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries({ who: f.who ?? "providers", days: f.days ?? "", state: f.state ?? "", ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/admin/rewards?${p}`;
  };
  const tab = (active: boolean) => cn("rounded-full px-3 py-1 text-sm font-medium", active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200");
  return (
    <>
      <PageHeader title="Rewards" description="Points and levels for providers and clinics. Use the leaderboards for giveaways, bonus promos and thank-yous. Point values and level thresholds are in Settings → Rewards." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Leaderboard" />
          <CardBody className="flex flex-wrap items-center gap-2">
            <Link href={q({ who: "providers" })} className={tab(audience === "PROVIDER")}>Providers</Link>
            <Link href={q({ who: "clinics" })} className={tab(audience === "CLINIC")}>Clinics</Link>
            <span className="mx-2 text-slate-300">|</span>
            <Link href={q({ days: null })} className={tab(!days)}>All time</Link>
            <Link href={q({ days: "90" })} className={tab(days === 90)}>90 days</Link>
            <Link href={q({ days: "30" })} className={tab(days === 30)}>30 days</Link>
            <form className="ml-auto flex gap-2">
              <input type="hidden" name="who" value={f.who ?? "providers"} />
              {f.days ? <input type="hidden" name="days" value={f.days} /> : null}
              <Input name="state" defaultValue={f.state ?? ""} placeholder="State, e.g. FL" className="w-32" />
            </form>
          </CardBody>
          {rows.length ? (
            <Table>
              <thead><tr><Th>#</Th><Th>{audience === "PROVIDER" ? "Provider" : "Clinic"}</Th><Th>State</Th><Th>Level</Th><Th className="text-right">{days ? `Points (${days} days)` : "Points"}</Th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.accountId}>
                    <Td className="tabular-nums text-slate-500">{i + 1}</Td>
                    <Td>{r.href ? <Link href={r.href} className="font-medium text-brand-700">{r.name}</Link> : r.name}</Td>
                    <Td>{r.state ?? "—"}</Td>
                    <Td><LevelBadge level={r.level} /></Td>
                    <Td className="text-right font-semibold tabular-nums">{r.points.toLocaleString("en-US")}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody className="text-sm text-slate-500">No points yet.</CardBody>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Give or take points" description="A bonus, a contest prize, or a correction. They see your reason in their points history." />
          <CardBody>
            <ActionForm action={awardRewardPointsAction} className="space-y-3">
              <Field label="Who">
                <Select name="audience" defaultValue={audience}>
                  <option value="PROVIDER">Provider</option>
                  <option value="CLINIC">Clinic</option>
                </Select>
              </Field>
              <Field label="Their login email"><Input name="email" type="email" required /></Field>
              <Field label="Points" hint="Negative to take points away."><Input name="points" type="number" step={1} required /></Field>
              <Field label="Reason"><Input name="note" maxLength={200} required placeholder="e.g. October giveaway winner" /></Field>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
