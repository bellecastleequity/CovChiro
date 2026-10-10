import { getSettings, latestSignedAgreement, overdue } from "@cm/services";
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
import { approveClinicAction, clinicStatusAction, clinicVerificationAdminAction, excludeChargeAction, includeChargeAction, payInFullAction, retryChargeAction } from "../../actions";
import { Textarea } from "@/components/ui/form";

export default async function AdminClinic({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("admin");
  const { id } = await params;
  const signedCopy = await latestSignedAgreement("CLINIC", id);
  const c = await prisma.clinicOrg.findUnique({ where: { id }, include: { locations: true, members: { include: { user: { include: { provider: { select: { id: true, displayName: true } } } } } }, payments: { orderBy: { createdAt: "desc" }, take: 20 } } });
  if (!c) notFound();
  const owner = c.members.find((m) => m.role === "CLINIC_OWNER")?.user;
  // [label, done, still required to post even after approval]
  const steps: [string, boolean, boolean][] = [
    ["Owner email confirmed", !!owner?.emailVerifiedAt, false],
    ["Clinic location added", c.locations.some((l) => l.active), false],
    ["Clinic Agreement signed", !!c.agreementSignedAt, false],
    ["Payment method on file", c.hasPaymentMethod, true],
  ];
  const [due, settings] = await Promise.all([overdue.overdueForClinic(id), getSettings()]);
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
          <Card><CardHeader title="Team" /><CardBody className="space-y-1 text-sm">{c.members.map((m) => <div key={m.id}>{m.user.name} · {m.user.email} · {m.role === "CLINIC_OWNER" ? "owner" : "staff"}{m.user.provider ? <> · <Link className="text-brand-700" href={`/admin/providers/${m.user.provider.id}`}>also takes shifts</Link></> : null}</div>)}</CardBody></Card>
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
          <Card id="payment-terms">
            <CardHeader
              title="Payment terms"
              description={c.payInFull ? `Charged in full at confirmation since ${c.payInFullSince ? dateLabel(c.payInFullSince) : "—"}${c.payInFullReason ? ` · ${c.payInFullReason}` : ""}` : `Normal deposit (${settings["payments.depositPercent"]}%) at confirmation, balance after the shift`}
            />
            <CardBody className="space-y-3 text-sm">
              {due.unpaid.length ? (
                <div className="space-y-2">
                  <div className="font-medium text-red-700">Unpaid: {money(due.unpaidCents)}</div>
                  {due.unpaid.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                      <span>{p.description ?? p.type} · {money(p.amountCents)} · failed {dateLabel(p.firstFailedAt)}{p.retryCount ? ` · ${p.retryCount} retr${p.retryCount === 1 ? "y" : "ies"}` : ""}{p.failureReason ? ` · ${p.failureReason}` : ""}{p.autoChased ? "" : ` · older than ${settings["payments.autoCollectMaxAgeDays"]} days: not retried automatically`}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <ActionForm action={retryChargeAction}><input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="clinicOrgId" value={c.id} /><SubmitButton size="sm" variant="outline">Retry charge</SubmitButton></ActionForm>
                        <ActionForm action={excludeChargeAction} className="flex items-center gap-1" confirm="Exclude this charge from rebilling? It won't be retried, the clinic won't be asked to pay it, and it won't count toward pay-in-full.">
                          <input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="clinicOrgId" value={c.id} />
                          <Input name="note" required placeholder="Why (e.g. old test charge)" aria-label="Why exclude" className="h-8 w-44" />
                          <SubmitButton size="sm" variant="ghost">Exclude from rebilling</SubmitButton>
                        </ActionForm>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-slate-500">Nothing unpaid.</p>}
              {due.excluded.length ? (
                <details className="rounded-lg border border-slate-200 px-3 py-2">
                  <summary className="cursor-pointer font-medium text-slate-700">Excluded from rebilling ({due.excluded.length})</summary>
                  <div className="mt-2 space-y-2">
                    {due.excluded.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
                        <span>{p.description ?? p.type} · {money(p.amountCents)} · excluded {p.excludedAt ? dateLabel(p.excludedAt) : ""}{p.excludedNote ? ` · ${p.excludedNote}` : ""}</span>
                        <ActionForm action={includeChargeAction}><input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="clinicOrgId" value={c.id} /><SubmitButton size="sm" variant="ghost">Include again</SubmitButton></ActionForm>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              <ActionForm action={payInFullAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="clinicOrgId" value={c.id} />
                <input type="hidden" name="on" value={c.payInFull ? "0" : "1"} />
                <Input name="note" placeholder={c.payInFull ? "Why (e.g. paid in full Oct 12)" : "Reason (optional)"} required={c.payInFull} className="h-9 min-w-0 flex-1 sm:max-w-xs" />
                <SubmitButton size="sm" variant={c.payInFull ? "primary" : "outline"}>{c.payInFull ? "Restore normal deposit" : "Charge in full at confirmation"}</SubmitButton>
              </ActionForm>
              <p className="text-xs text-slate-500">Turns on by itself when a charge from the last {settings["payments.autoCollectMaxAgeDays"]} days is unpaid {settings["payments.payInFullAfterHours"]} hours after it failed (Settings → Payments). Older or excluded charges are never retried or counted automatically. Only an admin turns it off.</p>
            </CardBody>
          </Card>
          <Card id="verification">
            <CardHeader
              title="Ownership verification"
              description={`${c.verificationStatus.replace("_", " ").toLowerCase()}${c.verifiedUntil && c.verificationStatus === "VERIFIED" ? ` · renew by ${dateLabel(c.verifiedUntil)}` : ""}${c.verificationGraceUntil ? ` · grace until ${dateLabel(c.verificationGraceUntil)}` : ""}`}
            />
            <CardBody className="space-y-3 text-sm">
              {lastVerification ? <Link href={`/admin/verification/clinics/${lastVerification.id}`} className="block font-medium text-brand-700">Latest submission ({lastVerification.status.toLowerCase()}) →</Link> : <p className="text-slate-500">Nothing submitted yet.</p>}
              <Link href={`/admin/clinics/${c.id}/verification`} className="block font-medium text-brand-700">Enter the details for the clinic →</Link>
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
