import { latestSignedAgreement } from "@cm/services";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@cm/db";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { AccountModeration } from "@/components/admin/account-moderation";
import { approveClinicAction, clinicStatusAction, clinicVerificationAdminAction } from "../../actions";
import { Textarea } from "@/components/ui/form";

export default async function AdminClinic({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("admin");
  const { id } = await params;
  const signedCopy = await latestSignedAgreement("CLINIC", id);
  const c = await prisma.clinicOrg.findUnique({ where: { id }, include: { locations: true, members: { include: { user: true } }, payments: { orderBy: { createdAt: "desc" }, take: 20 } } });
  if (!c) notFound();
  const owner = c.members.find((m) => m.role === "CLINIC_OWNER")?.user;
  // [label, done, still required to post even after approval]
  const steps: [string, boolean, boolean][] = [
    ["Owner email confirmed", !!owner?.emailVerifiedAt, false],
    ["Clinic location added", c.locations.some((l) => l.active), false],
    ["Clinic Agreement signed", !!c.agreementSignedAt, false],
    ["Payment method on file", c.hasPaymentMethod, true],
  ];
  const lastVerification = await prisma.clinicVerification.findFirst({ where: { clinicOrgId: id }, orderBy: { submittedAt: "desc" }, select: { id: true, status: true } });
  const shifts = await prisma.shift.findMany({ where: { location: { clinicOrgId: id } }, orderBy: { startsAt: "desc" }, take: 20 });
  return (
    <>
      <PageHeader back={{ href: "/admin/clinics", label: "Clinics" }}
        title={c.displayName}
        description={<>{c.legalName} · {c.billingEmail ?? ""} · agreement {c.agreementSignedAt ? `v${c.agreementVersion}` : "unsigned"}{signedCopy ? <> · <Link className="text-brand-700" href={`/agreements/signed/${signedCopy.id}`}>signed copy</Link></> : null}</>}
        actions={<StatusBadge status={c.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card><CardHeader title="Locations" /><CardBody className="space-y-1 text-sm">{c.locations.map((l) => <div key={l.id}>{l.name} — {l.addressLine1}, {l.city}, {l.state} {l.zip} · {l.professionCodes.join(", ")}{l.active ? "" : " (archived)"}</div>)}</CardBody></Card>
          <Card><CardHeader title="Shifts" /><CardBody className="space-y-1 text-sm">{shifts.map((s) => <div key={s.id} className="flex justify-between"><Link href={`/admin/shifts/${s.id}`} className="hover:text-brand-700">{dateLabel(s.startsAt)} · {s.professionCode}</Link><StatusBadge status={s.status} /></div>)}</CardBody></Card>
          <Card><CardHeader title="Payments" /><CardBody className="space-y-1 text-sm">{c.payments.map((p) => <div key={p.id} className="flex justify-between"><span>{dateLabel(p.createdAt)} · {p.type}</span><span>{money(p.amountCents)} · {p.status.toLowerCase()}</span></div>)}</CardBody></Card>
        </div>
        <div className="space-y-6">
          <Card><CardHeader title="Team" /><CardBody className="space-y-1 text-sm">{c.members.map((m) => <div key={m.id}>{m.user.name} · {m.user.email} · {m.role === "CLINIC_OWNER" ? "owner" : "staff"}</div>)}</CardBody></Card>
          <Card>
            <CardHeader title="Onboarding" description={c.adminApprovedAt ? `Approved by admin ${dateLabel(c.adminApprovedAt)}` : "Approve to skip the remaining setup steps."} />
            <CardBody className="space-y-3 text-sm">
              <ul className="space-y-1">
                {steps.map(([label, done, hard]) => (
                  <li key={label} className={done ? "text-slate-400 line-through" : hard ? "font-medium text-amber-800" : "text-slate-700"}>
                    {done ? "✓" : "○"} {label}{!done && hard ? " (still required to post)" : ""}
                  </li>
                ))}
              </ul>
              {c.adminApprovedAt ? null : (
                <ActionForm action={approveClinicAction} confirm="Approve this clinic now? Their dashboard will still show unfinished steps.">
                  <input type="hidden" name="clinicOrgId" value={c.id} />
                  <SubmitButton size="sm">Approve now</SubmitButton>
                </ActionForm>
              )}
              <p className="text-xs text-slate-500">Approval activates the clinic and skips the email, location and agreement steps. A payment method is still needed to post, because posting takes a deposit — and each shift needs a location.</p>
            </CardBody>
          </Card>
          <Card id="verification">
            <CardHeader
              title="Ownership verification"
              description={`${c.verificationStatus.replace("_", " ").toLowerCase()}${c.verifiedUntil && c.verificationStatus === "VERIFIED" ? ` · renew by ${dateLabel(c.verifiedUntil)}` : ""}${c.verificationGraceUntil ? ` · grace until ${dateLabel(c.verificationGraceUntil)}` : ""}`}
            />
            <CardBody className="space-y-3 text-sm">
              {lastVerification ? <Link href={`/admin/verification/clinics/${lastVerification.id}`} className="font-medium text-brand-700">Latest submission ({lastVerification.status.toLowerCase()}) →</Link> : <p className="text-slate-500">Nothing submitted yet.</p>}
              <ActionForm action={clinicVerificationAdminAction} className="space-y-2">
                <input type="hidden" name="clinicOrgId" value={c.id} />
                <Textarea name="note" placeholder="Note (required to verify by hand: how you checked)" className="min-h-16" />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton size="sm" name="action" value="VERIFY">Verify by hand</SubmitButton>
                  <SubmitButton size="sm" name="action" value="EXTEND" variant="outline">Give more time</SubmitButton>
                  <SubmitButton size="sm" name="action" value="RESET" variant="outline">Ask to verify again</SubmitButton>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Status" />
            <CardBody>
              <ActionForm action={clinicStatusAction} className="space-y-2">
                <input type="hidden" name="clinicOrgId" value={c.id} />
                <Select name="status" defaultValue={c.status}>{["ACTIVE", "SUSPENDED", "DEACTIVATED"].map((s) => <option key={s}>{s}</option>)}</Select>
                <Input name="note" placeholder="Note" />
                <SubmitButton size="sm">Update</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <AccountModeration kind="clinic" id={c.id} status={c.status} />
        </div>
      </div>
    </>
  );
}
