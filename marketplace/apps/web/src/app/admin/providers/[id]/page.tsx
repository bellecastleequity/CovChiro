import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@cm/db";
import { earningsFor, latestSignedAgreement, providerChecklist } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader, Stat } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { approveProviderAction, providerStatusAction } from "../../actions";

export default async function AdminProvider({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("admin");
  const { id } = await params;
  const signedCopy = await latestSignedAgreement("PROVIDER", id);
  const p = await prisma.provider.findUnique({ where: { id }, include: { user: true, licenses: true, malpractice: true, professions: true, stats: true, assignments: { include: { shift: { include: { location: { include: { clinicOrg: true } } } } }, orderBy: { startsAt: "desc" }, take: 20 } } });
  if (!p) notFound();
  const [e, checklist] = await Promise.all([earningsFor(id), providerChecklist(id)]);
  const c = checklist.common;
  // [label, done, still required for matching even after approval]
  const steps: [string, boolean, boolean][] = [
    ["Email confirmed", c.emailVerified, false],
    ["Profile, phone & home base", c.profile && c.homeBase, false],
    ["Profile photo", c.photo, false],
    ["NPI", c.npi, false],
    ["Provider Agreement signed", c.agreement, false],
    ...checklist.perProfession.flatMap((x): [string, boolean, boolean][] => [
      [`${x.displayName}: verified license`, x.license, true],
      [`${x.displayName}: verified malpractice`, x.malpractice, true],
    ]),
    ["Stripe payouts", c.payouts, true],
  ];
  return (
    <>
      <PageHeader title={p.displayName} description={`${p.legalName} · ${p.user.email} · ${p.user.phone ?? "no phone"} · home ${p.homeCity ?? "?"}, ${p.homeState ?? "?"}`} actions={<StatusBadge status={p.status} />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Completed shifts" value={p.stats?.completedShifts ?? 0} />
        <Stat label="Late cancels / no-shows" value={`${p.stats?.lateCancels ?? 0} / ${p.stats?.noShows ?? 0}`} />
        <Stat label="Owed (not yet paid)" value={money(e.summary.upcomingCents + e.summary.scheduledCents + e.summary.readyCents + e.summary.onHoldCents)} tone="brand" />
        <Stat label="Paid YTD" value={money(e.summary.paidYtdCents)} tone="green" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Credentials" action={<Link className="text-sm text-brand-700" href="/admin/verification">Verification queue</Link>} />
            <CardBody className="space-y-2 text-sm">
              {p.licenses.map((l) => <div key={l.id} className="flex justify-between"><span>{l.professionCode} · {l.state} · #{l.licenseNumber} · exp {dateLabel(l.expiresAt, "UTC", { month: "short", day: "numeric", year: "numeric" })}</span><StatusBadge status={l.status} /></div>)}
              {p.malpractice.map((m) => <div key={m.id} className="flex justify-between"><span>Malpractice {m.carrier} · {m.coveredProfessionCodes.join(", ")} · {money(m.perOccurrenceCents)}/{money(m.aggregateCents)}</span><StatusBadge status={m.status} /></div>)}
              <div className="pt-2 text-xs text-slate-500">NPI {p.npi ?? "—"} {p.npiVerifiedAt ? "(verified)" : ""} · payouts {p.stripePayoutsEnabled ? "enabled" : "not set up"} · agreement {p.agreementSignedAt ? `v${p.agreementVersion}` : "unsigned"}{signedCopy ? <> · <Link className="text-brand-700" href={`/agreements/signed/${signedCopy.id}`}>signed copy</Link></> : null}</div>
              <div className="text-xs text-slate-500">Per profession: {checklist.perProfession.map((x) => `${x.professionCode} ${x.status.toLowerCase()}`).join(" · ")}</div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent shifts" />
            <CardBody className="space-y-1 text-sm">
              {p.assignments.map((a) => <div key={a.id} className="flex justify-between"><Link href={`/admin/shifts/${a.shiftId}`} className="hover:text-brand-700">{dateLabel(a.startsAt)} · {a.shift.location.clinicOrg.displayName} · {a.professionCode}</Link><StatusBadge status={a.status} /></div>)}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
        <Card>
          <CardHeader title="Onboarding" description={p.adminApprovedAt ? `Approved by admin ${dateLabel(p.adminApprovedAt)}` : "Approve to skip the remaining profile steps."} />
          <CardBody className="space-y-3 text-sm">
            <ul className="space-y-1">
              {steps.map(([label, done, hard]) => (
                <li key={label} className={done ? "text-slate-400 line-through" : hard ? "font-medium text-amber-800" : "text-slate-700"}>
                  {done ? "✓" : "○"} {label}{!done && hard ? " (still required for shifts)" : ""}
                </li>
              ))}
            </ul>
            {p.adminApprovedAt ? (
              <ActionForm action={approveProviderAction} confirm="Remove the admin approval?">
                <input type="hidden" name="providerId" value={p.id} />
                <input type="hidden" name="approve" value="no" />
                <SubmitButton size="sm" variant="outline">Remove approval</SubmitButton>
              </ActionForm>
            ) : (
              <ActionForm action={approveProviderAction} confirm="Approve this provider now? Their dashboard will still show unfinished steps.">
                <input type="hidden" name="providerId" value={p.id} />
                <SubmitButton size="sm">Approve now</SubmitButton>
              </ActionForm>
            )}
            <p className="text-xs text-slate-500">Approval skips profile, photo, email, NPI and agreement steps. A verified license and malpractice (licensing rules) and Stripe payouts are still needed before they're matched to shifts.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Account status" />
          <CardBody>
            <ActionForm action={providerStatusAction} className="space-y-2">
              <input type="hidden" name="providerId" value={p.id} />
              <Select name="status" defaultValue={p.status}>{["ACTIVE", "PAUSED", "SUSPENDED", "DEACTIVATED"].map((s) => <option key={s}>{s}</option>)}</Select>
              <Input name="note" placeholder="Note (kept in admin notes)" />
              <SubmitButton size="sm">Update</SubmitButton>
            </ActionForm>
            {p.adminNotes ? <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-500">{p.adminNotes}</pre> : null}
            <Link href={`/admin/payouts?provider=${p.id}`} className="mt-4 block text-sm font-medium text-brand-700">Pay ledger →</Link>
            <Link href={`/admin/providers/${p.id}/profile`} className="mt-2 block text-sm font-medium text-brand-700">Public profile & badges →</Link>
          </CardBody>
        </Card>
        </div>
      </div>
    </>
  );
}
