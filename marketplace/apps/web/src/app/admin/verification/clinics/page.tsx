import Link from "next/link";
import { clinicVerify } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel, relative } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Clinic verification" };

const TONE: Record<string, "gray" | "green" | "amber" | "red" | "blue"> = { PENDING: "blue", NEEDS_INFO: "amber", APPROVED: "green", REJECTED: "red" };

export default async function ClinicVerificationQueue({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { actor } = await requireActor("admin");
  const all = (await searchParams).all === "1";
  const q = await clinicVerify.listClinicVerifications(actor, all ? "all" : "open");
  return (
    <>
      <PageHeader
        back={{ href: "/admin/verification", label: "Verification" }}
        title="Clinic verification"
        description="Clinics' ownership details and the automatic checks. Clean practitioner-owned clinics are approved automatically; these need a person."
        actions={<Link href={all ? "/admin/verification/clinics" : "/admin/verification/clinics?all=1"} className="text-sm font-medium text-brand-700">{all ? "Open only" : "All decisions"}</Link>}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title={all ? `Submissions (${q.rows.length})` : `To review (${q.rows.length})`} />
          {q.rows.length ? (
            <div className="divide-y divide-slate-100">
              {q.rows.map((r) => {
                const open = r.checks.filter((c) => c.outcome === "FAIL" || c.outcome === "REVIEW").length;
                const fail = r.checks.some((c) => c.outcome === "FAIL");
                return (
                  <Link key={r.id} href={`/admin/verification/clinics/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50">
                    <div>
                      <div className="font-medium">{r.clinicOrg.displayName}</div>
                      <div className="text-xs text-slate-500">{r.entityName} · {r.entityState} #{r.entityNumber} · sent {relative(r.submittedAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.autoApproved ? <Badge tone="green">Automatic</Badge> : null}
                      <Badge tone={fail ? "red" : "amber"}>{open} to check</Badge>
                      <Badge tone={TONE[r.status] ?? "gray"}>{r.status.replace("_", " ").toLowerCase()}</Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="p-5"><Empty title="Nothing to review" /></div>
          )}
        </Card>
        {!all ? (
          <Card>
            <CardHeader title={`Not started (${q.notStarted.length})`} description="Clinics that haven't sent their details. New clinics' shifts wait; existing clinics keep going until their deadline." />
            {q.notStarted.length ? (
              <div className="divide-y divide-slate-100">
                {q.notStarted.map((o) => (
                  <Link key={o.id} href={`/admin/clinics/${o.id}#verification`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-slate-50">
                    <span className="font-medium">{o.displayName}</span>
                    <span className="text-xs text-slate-500">{o.graceActive && o.verificationGraceUntil ? `deadline ${dateLabel(o.verificationGraceUntil, "America/New_York", { month: "short", day: "numeric" })}` : "shifts on hold"}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
