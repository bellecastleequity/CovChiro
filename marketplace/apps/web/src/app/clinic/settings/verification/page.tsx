import { ShieldCheck } from "lucide-react";
import { prisma } from "@cm/db";
import { clinicVerify } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { clinicVerificationAction } from "../../actions";
import { VerificationForm } from "@/components/clinic/verification-form";

export const metadata = { title: "Clinic verification" };

const STATUS: Record<string, { label: string; tone: "gray" | "green" | "amber" | "red" | "blue" }> = {
  NOT_STARTED: { label: "Not verified yet", tone: "amber" },
  PENDING: { label: "Under review", tone: "blue" },
  NEEDS_INFO: { label: "We need more information", tone: "amber" },
  VERIFIED: { label: "Verified", tone: "green" },
  REJECTED: { label: "Not approved", tone: "red" },
};

const day = (d: Date) => dateLabel(d, "America/New_York", { month: "long", day: "numeric", year: "numeric" });

export default async function ClinicVerification() {
  const { actor } = await requireActor("clinic");
  const v = await clinicVerify.myVerification(actor);
  const owner = actor.role === "CLINIC_OWNER";
  const professions = await prisma.profession.findMany({ where: { active: true }, select: { code: true, displayName: true }, orderBy: { displayName: "asc" } });
  const st = STATUS[v.status] ?? STATUS.NOT_STARTED;
  return (
    <>
      <PageHeader
        back={{ href: "/clinic/settings", label: "Settings" }}
        title="Clinic verification"
        description="We confirm who owns every clinic on the platform, to protect providers and patients from fraud. It takes a few minutes, and most clinics are verified right away."
      />
      <div className="space-y-6">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="size-5 text-accent-600" />
              <span className="font-semibold">Status:</span>
              <Badge tone={st.tone}>{v.renewalPending ? "Verified · renewal under review" : st.label}</Badge>
            </div>
            {v.status === "VERIFIED" && v.verifiedUntil ? <p className="text-sm text-slate-600">Verified {v.verifiedAt ? `on ${day(v.verifiedAt)}` : ""}. Please renew by {day(v.verifiedUntil)}.</p> : null}
            {v.note ? <Alert tone={v.status === "REJECTED" ? "error" : "warning"} title={v.status === "REJECTED" ? "Why it wasn't approved" : "What we need"}>{v.note}</Alert> : null}
            {v.enabled && !v.cleared && v.status !== "REJECTED" ? (
              <Alert tone="warning" title="Your shifts are waiting">You can post shifts now. They go out to providers as soon as your clinic is verified.</Alert>
            ) : null}
            {v.enabled && v.cleared && v.status !== "VERIFIED" && v.deadline ? (
              <Alert tone="info" title={`Please verify by ${day(v.deadline)}`}>Your shifts keep going out to providers until then.</Alert>
            ) : null}
            {v.status === "PENDING" ? <p className="text-sm text-slate-600">Our team usually reviews within one business day and will email you.</p> : null}
          </CardBody>
        </Card>

        {v.status === "REJECTED" ? null : !owner ? (
          <Alert tone="info">Only the clinic owner can submit verification. Ask them to sign in and open Settings → Clinic verification.</Alert>
        ) : (
          <VerificationForm action={clinicVerificationAction} v={v} professions={professions} mode="clinic" />
        )}
      </div>
    </>
  );
}
