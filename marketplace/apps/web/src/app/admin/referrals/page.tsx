import Link from "next/link";
import { dollars } from "@cm/core";
import { referrals } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { referralDecisionAction } from "../actions";

export const metadata = { title: "Referrals" };
export const dynamic = "force-dynamic";

const STATUSES = ["FLAGGED", "PENDING", "REWARDED", "REJECTED", "EXPIRED"] as const;
const TONE: Record<string, "amber" | "gray" | "green" | "red"> = { FLAGGED: "amber", PENDING: "gray", REWARDED: "green", REJECTED: "red", EXPIRED: "gray" };
const LABEL: Record<string, string> = { FLAGGED: "Needs review", PENDING: "Waiting for first shift", REWARDED: "Paid", REJECTED: "Rejected", EXPIRED: "Expired" };
const who = (u: { name: string; email: string; role: string }) => (
  <><div className="font-medium text-slate-900">{u.name}</div><div className="text-xs text-slate-500">{u.email} · {u.role === "PROVIDER" ? "provider" : u.role === "PLATFORM_ADMIN" ? "admin" : "clinic"}</div></>
);
const reward = (cents: number, payoutId: string | null, credit: string | null) => (cents ? <>{dollars(cents)} <span className="text-xs text-slate-500">{credit ? `credit ${credit}` : payoutId ? "pay" : ""}</span></> : "—");

export default async function Referrals({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { actor } = await requireActor("admin");
  const { status } = await searchParams;
  const q = await referrals.referralQueue(actor, status || undefined);
  return (
    <>
      <PageHeader title="Referrals" description="Every account that signed up through someone's link. Once their first shift is done (plus the hold in Settings → Referrals), clean referrals pay both sides automatically: providers through their pay, clinics as a credit off their next shift. Anything odd waits here for you." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Needs review" value={q.counts.FLAGGED ?? 0} tone={q.counts.FLAGGED ? "amber" : "default"} />
        <Stat label="Waiting for first shift" value={q.counts.PENDING ?? 0} />
        <Stat label="Paid out" value={q.counts.REWARDED ?? 0} tone="green" />
        <Stat label="Rewards issued" value={dollars(q.paidCents)} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/admin/referrals" className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${!status ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>All</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/referrals?status=${s}`} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${status === s ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>{LABEL[s]} · {q.counts[s] ?? 0}</Link>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <Table>
          <thead><tr><Th>Referred by</Th><Th>New account</Th><Th>Status</Th><Th>Referrer reward</Th><Th>Friend bonus</Th><Th>Dates</Th></tr></thead>
          <tbody>
            {q.rows.length ? q.rows.map((r) => (
              <tr key={r.id} className="align-top">
                <Td>{who(r.referrer)}<div className="font-mono text-xs text-slate-400">{r.code}</div></Td>
                <Td>{who(r.referee)}</Td>
                <Td>
                  <Badge tone={TONE[r.status] ?? "gray"}>{LABEL[r.status] ?? r.status}</Badge>
                  {r.flagReasons.length ? <div className="mt-1 max-w-56 text-xs text-amber-800">{r.flagReasons.join(", ")}</div> : null}
                  {r.note ? <div className="mt-1 max-w-56 text-xs text-slate-500">{r.note}</div> : null}
                  {r.status === "FLAGGED" ? (
                    <div className="mt-2 space-y-2">
                      <ActionForm action={referralDecisionAction} confirm="Issue both rewards now?"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><SubmitButton size="sm">Approve &amp; pay</SubmitButton></ActionForm>
                      <ActionForm action={referralDecisionAction} className="flex gap-1"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><Input name="note" placeholder="Reason" className="h-8 w-32 text-xs" /><SubmitButton size="sm" variant="ghost">Reject</SubmitButton></ActionForm>
                    </div>
                  ) : null}
                </Td>
                <Td>{reward(r.referrerRewardCents, r.referrerPayoutId, r.referrerCreditCode)}</Td>
                <Td>{reward(r.refereeRewardCents, r.refereePayoutId, r.refereeCreditCode)}</Td>
                <Td className="text-xs text-slate-500">Joined {dateLabel(r.createdAt)}{r.qualifiedAt ? <><br />First shift done {dateLabel(r.qualifiedAt)}</> : null}{r.rewardedAt ? <><br />Paid {dateLabel(r.rewardedAt)}</> : null}{r.status === "PENDING" ? <><br />Open until {dateLabel(r.expiresAt)}</> : null}</Td>
              </tr>
            )) : <tr><Td className="text-slate-500">No referrals yet.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
