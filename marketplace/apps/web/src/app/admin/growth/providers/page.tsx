import Link from "next/link";
import { growth } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { prisma } from "@cm/db";
import { FunnelBars, GrowthTabs } from "../ui";

export const metadata = { title: "Provider pipeline" };
export const dynamic = "force-dynamic";

const MESSAGE: Record<string, string> = { license: "Asking about license", malpractice: "Asking for malpractice", under_review: "Under review — no reminders", none: "—" };
const stageTone = (s: string) => (["COVERAGE_READY", "FIRST_SHIFT", "REPEAT_PROVIDER"].includes(s) ? "green" : s === "CREDENTIAL_REVIEW" ? "amber" : s === "STUDENT" ? "blue" : "gray") as "green" | "amber" | "blue" | "gray";

type F = growth.ProviderFilter & { q?: string };
const SOURCES = ["ai_prospecting", "recruitment", "school", "event", "ads", "social", "email", "referral", "organic", "other"];

export default async function ProviderPipeline({ searchParams }: { searchParams: Promise<F> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as F;
  const [rows, funnel, markets, professions] = await Promise.all([
    growth.providerPipeline(actor, { q: f.q, campaign: f.campaign }),
    growth.providerFunnel(clean),
    prisma.growthMarket.findMany({ orderBy: [{ state: "asc" }, { name: "asc" }], select: { key: true, name: true } }),
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, displayName: true } }),
  ]);
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.stage] = (a[r.stage] ?? 0) + 1), a), {});
  return (
    <>
      <PageHeader title="Providers" description="Provider acquisition from registry discovery to repeat provider. Stages drive which message (if any) is sent; they never decide shift eligibility (credentials are verified under Verification)." />
      <GrowthTabs current="/admin/growth/providers" />
      <Card className="mb-6">
        <CardHeader title="Provider acquisition funnel" description={funnel.prospectsIncluded ? "Each step includes everyone who got further. Discovered prospects not yet registered are included." : "Filtered to registered providers (prospect stages don't carry school, credential or activity)."} />
        <div className="grid gap-6 p-5 lg:grid-cols-[2fr_1fr]">
          <FunnelBars steps={funnel.steps} />
          <form className="grid grid-cols-2 content-start gap-2 text-xs">
            <Select name="profession" defaultValue={f.profession ?? ""}><option value="">All professions</option>{professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}</Select>
            <Input name="state" defaultValue={f.state} placeholder="State (FL)" maxLength={2} />
            <Select name="market" defaultValue={f.market ?? ""}><option value="">All metros</option>{markets.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</Select>
            <Input name="county" defaultValue={f.county} placeholder="County" />
            <Input name="zip" defaultValue={f.zip} placeholder="ZIP (prefix)" />
            <Select name="source" defaultValue={f.source ?? ""}><option value="">All sources</option>{SOURCES.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>
            <Input name="school" defaultValue={f.school} placeholder="School" />
            <Input name="campaign" defaultValue={f.campaign} placeholder="Campaign code" />
            <Select name="credential" defaultValue={f.credential ?? ""}><option value="">Any credential status</option><option value="none">No license yet</option><option value="pending">License under review</option><option value="verified">License verified</option></Select>
            <Select name="recruitment" defaultValue={f.recruitment ?? ""}><option value="">Any recruitment status</option>{["DISCOVERED", "CONTACT_FOUND", "CONTACT_VERIFIED", "CONTACTED", "ENGAGED", "NOT_INTERESTED"].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>
            <Select name="ready" defaultValue={f.ready ?? ""}><option value="">Coverage-ready: any</option><option value="yes">Coverage-ready</option><option value="no">Not yet</option></Select>
            <Select name="firstShift" defaultValue={f.firstShift ?? ""}><option value="">First shift: any</option><option value="yes">Has worked a shift</option><option value="no">No shift yet</option></Select>
            <Select name="activity" defaultValue={f.activity ?? ""}><option value="">Any activity</option><option value="active90">Shift in last 90 days</option><option value="inactive">No shift in 90 days</option></Select>
            <Input name="q" defaultValue={f.q} placeholder="Name, email (table)" />
            <button className={buttonClass("outline", "sm")}>Filter</button>
            <Link href="/admin/growth/providers" className={buttonClass("ghost", "sm")}>Clear</Link>
          </form>
        </div>
      </Card>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {["STUDENT", "REGISTERED", "PENDING_LICENSE", "CREDENTIAL_REVIEW", "PENDING_MALPRACTICE", "COVERAGE_READY", "FIRST_SHIFT", "REPEAT_PROVIDER"].map((s) => <Badge key={s} tone={stageTone(s)}>{humanize(s)} · {counts[s] ?? 0}</Badge>)}
      </div>
      <Card>
        <CardHeader title={`Registered providers (${rows.length})`} description="Where each registered provider is in credentialing and activation, and which follow-up is due." />
        <Table>
          <thead><tr><Th>Provider</Th><Th>School / campaign</Th><Th>Graduation</Th><Th>Stage</Th><Th>Follow-up</Th><Th>Availability</Th><Th className="text-right">Shifts</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/providers/${r.id}`} className="font-medium hover:text-brand-700">{r.name}</Link><div className="text-xs text-slate-400">{humanize(r.status)} · joined {dateLabel(r.createdAt)}{r.inLaunchProfession ? "" : " · other profession"}</div></Td>
                <Td className="text-xs">{r.school ?? "—"}{r.campaignCode ? <div className="text-slate-400">/join/{r.campaignCode}</div> : null}</Td>
                <Td className="text-xs">{r.graduationDate ? dateLabel(r.graduationDate, "UTC", { month: "short", year: "numeric" }) : "—"}{r.isStudent ? <div className="text-slate-400">student</div> : null}</Td>
                <Td><Badge tone={stageTone(r.stage)}>{humanize(r.stage)}</Badge></Td>
                <Td className="text-xs">{MESSAGE[r.message]}<div className="text-slate-400">{r.nurtureCount} sent{r.lastNurtureAt ? ` · last ${dateLabel(r.lastNurtureAt)}` : ""}</div></Td>
                <Td className="text-xs">{r.hasAvailability ? "Set" : <span className="text-amber-700">Not set</span>}<div className="text-slate-400">{r.activationCount} activation nudge{r.activationCount === 1 ? "" : "s"}</div></Td>
                <Td className="text-right tabular-nums">{r.shifts}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
