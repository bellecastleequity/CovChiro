import { CheckCircle2, Lock } from "lucide-react";
import { CREDENTIAL_STATE_LABELS, type CredentialState } from "@cm/core";
import type { prelicensure } from "@cm/services";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checklist } from "@/components/ui/misc";

type Summary = Awaited<ReturnType<typeof prelicensure.readinessSummary>>;

const credHint = (s: CredentialState, what: string) =>
  s === "pending" ? "Verification pending — nothing more needed from you right now." : s === "rejected" ? "Needs a correction — see the reason on your credentials page." : s === "expired" ? "Expired — upload your renewal." : `Add your ${what} when you have it.`;

/** Student-path dashboard card ("Your Coverage Readiness"). Shown only while the student flag is on. */
export function ReadinessCard({
  summary,
  emailVerified,
  contactDone,
  graduationDone,
  laterSteps,
}: {
  summary: Summary;
  emailVerified: boolean;
  contactDone: boolean;
  graduationDone: boolean;
  laterSteps: { label: string; done: boolean; href?: string }[];
}) {
  const bothVerified = summary.license === "verified" && summary.malpractice === "verified";
  const bothIn = summary.license !== "not_provided" && summary.malpractice !== "not_provided" && !["rejected", "expired"].includes(summary.license) && !["rejected", "expired"].includes(summary.malpractice);
  const items = [
    { label: "Account created", done: true },
    { label: "Email confirmed", done: emailVerified, hint: "Check your inbox for the confirmation link." },
    { label: "Contact information", done: contactDone, href: "/provider/profile" },
    { label: "Graduation information", done: graduationDone, href: "/provider/profile#student" },
    { label: `Chiropractic license — ${CREDENTIAL_STATE_LABELS[summary.license]}`, done: summary.license === "verified", href: "/provider/credentials", hint: credHint(summary.license, "license") },
    { label: `Malpractice insurance — ${CREDENTIAL_STATE_LABELS[summary.malpractice]}`, done: summary.malpractice === "verified", href: "/provider/credentials", hint: credHint(summary.malpractice, "malpractice insurance") },
    { label: "Credential verification", done: bothVerified, hint: bothIn ? "Credentials under review." : "Waiting on your credentials." },
  ];
  return (
    <Card className="mb-6">
      <CardHeader title="Your Coverage Readiness" description={`Stage: ${summary.stageLabel}`} />
      <CardBody>
        <Checklist items={items} />
        {summary.coverageReady ? (
          <div className="mt-4 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
            <div>
              <div className="font-semibold text-emerald-900">COVERAGE READY</div>
              <p className="text-sm text-emerald-800">You are eligible to accept available coverage shifts.</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <Lock className="size-5 shrink-0 text-slate-500" />
            <div>
              <div className="font-semibold text-slate-900">Coverage shifts locked</div>
              <p className="text-sm text-slate-600">Complete credential verification to begin accepting coverage opportunities.</p>
            </div>
          </div>
        )}
        {laterSteps.some((s) => !s.done) ? (
          <div className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">After you're licensed</div>
            <p className="mb-1 text-xs text-slate-500">Needed before your first shift — no rush while you're waiting on your license.</p>
            <Checklist items={laterSteps} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
