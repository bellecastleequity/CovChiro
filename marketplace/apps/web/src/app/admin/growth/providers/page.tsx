import Link from "next/link";
import { growth } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Provider pipeline" };
export const dynamic = "force-dynamic";

const MESSAGE: Record<string, string> = { license: "Asking about license", malpractice: "Asking for malpractice", under_review: "Under review — no reminders", none: "—" };
const stageTone = (s: string) => (["COVERAGE_READY", "FIRST_SHIFT", "REPEAT_PROVIDER"].includes(s) ? "green" : s === "CREDENTIAL_REVIEW" ? "amber" : s === "STUDENT" ? "blue" : "gray") as "green" | "amber" | "blue" | "gray";

export default async function ProviderPipeline({ searchParams }: { searchParams: Promise<{ q?: string; campaign?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const rows = await growth.providerPipeline(actor, { q: f.q, campaign: f.campaign });
  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.stage] = (a[r.stage] ?? 0) + 1), a), {});
  return (
    <>
      <PageHeader title="Provider pipeline" description="Pre-licensure through repeat provider, for the launch profession and state. The stage drives which follow-up (if any) is sent; it never decides shift eligibility. Verify credentials under Verification." />
      <GrowthTabs current="/admin/growth/providers" />
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {["STUDENT", "REGISTERED", "PENDING_LICENSE", "CREDENTIAL_REVIEW", "PENDING_MALPRACTICE", "COVERAGE_READY", "FIRST_SHIFT", "REPEAT_PROVIDER"].map((s) => <Badge key={s} tone={stageTone(s)}>{humanize(s)} · {counts[s] ?? 0}</Badge>)}
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={f.q} placeholder="Name, email, school" className="w-64" />
        <Input name="campaign" defaultValue={f.campaign} placeholder="Campaign code (e.g. palmer)" className="w-56" />
        <button className={buttonClass("outline")}>Filter</button>
      </form>
      <Card>
        <CardHeader title={`${rows.length} provider${rows.length === 1 ? "" : "s"}`} />
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
