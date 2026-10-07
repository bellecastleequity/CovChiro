import { brand } from "@cm/config";
import { chargebackEvidence, disputeIsOpen, OPEN_DISPUTE_STATUSES } from "@cm/core";
import { prisma } from "@cm/db";
import { paymentsProvider } from "@cm/integrations";
import { audit, clock, getSettings, requireAdmin, SYSTEM, type Actor } from "./context";
import { notifyAdmins, notifyClinic } from "./notify";

/**
 * Card disputes (chargebacks). Stripe's charge.dispute.* webhooks land in recordStripeDispute:
 *  - opened: ChargeDispute row, admins alerted (billing inbox + text), the booking's unsent provider
 *    payouts put on hold (an admin releases them), the clinic told its posting is paused;
 *  - the clinic can't post new shifts while any dispute of theirs is open (Clinic Agreement v5);
 *  - an admin reviews the evidence built from the booking's records and submits it to Stripe;
 *  - closed (won/lost): admins told; recovery of a lost amount is a person's decision (Admin → Payments).
 */

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const OPEN = [...OPEN_DISPUTE_STATUSES] as string[];

/** Stripe Dispute object (charge.dispute.created / updated / closed / funds_withdrawn / funds_reinstated). */
export async function recordStripeDispute(d: { id: string; amount: number; reason?: string | null; status: string; payment_intent?: string | { id: string } | null; evidence_details?: { due_by?: number | null } | null }) {
  const pi = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id ?? null;
  const payment = pi ? await prisma.payment.findUnique({ where: { stripePaymentIntentId: pi } }) : null;
  const existing = await prisma.chargeDispute.findUnique({ where: { stripeDisputeId: d.id } });
  const now = clock.now();
  const data = {
    status: d.status,
    amountCents: d.amount,
    reason: d.reason ?? "general",
    evidenceDueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null,
    closedAt: disputeIsOpen(d.status) ? null : (existing?.closedAt ?? now),
  };
  if (!existing) {
    const held = payment?.assignmentId
      ? await prisma.payout.findMany({ where: { assignmentId: payment.assignmentId, status: { in: ["PENDING", "SCHEDULED", "ON_HOLD"] }, onHold: false }, select: { id: true } })
      : [];
    if (held.length) await prisma.payout.updateMany({ where: { id: { in: held.map((h) => h.id) } }, data: { onHold: true, holdReason: "Card dispute opened by the clinic" } });
    const row = await prisma.chargeDispute.create({
      data: { ...data, stripeDisputeId: d.id, stripePaymentIntent: pi, paymentId: payment?.id ?? null, clinicOrgId: payment?.clinicOrgId ?? null, assignmentId: payment?.assignmentId ?? null, heldPayoutIds: held.map((h) => h.id) },
    });
    const org = payment ? await prisma.clinicOrg.findUnique({ where: { id: payment.clinicOrgId }, select: { displayName: true } }) : null;
    await audit(prisma, SYSTEM, "chargeback.opened", "ChargeDispute", row.id, null, { stripeDisputeId: d.id, amount: d.amount, reason: d.reason, clinicOrgId: row.clinicOrgId });
    await notifyAdmins(prisma, {
      template: "chargeback_opened",
      title: `Card dispute: ${org?.displayName ?? "a clinic"} disputed ${usd(d.amount)}`,
      body: `Reason given: ${(d.reason ?? "general").replace(/_/g, " ")}.${data.evidenceDueBy ? ` Evidence is due by ${data.evidenceDueBy.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric" })}.` : ""} ${held.length ? `The provider's unsent pay for this booking is on hold. ` : ""}Review the evidence and submit it to Stripe.`,
      link: `/admin/payments/chargebacks/${row.id}`,
      ctaLabel: "Review the dispute",
      email: true,
      sms: true,
    });
    if (row.clinicOrgId) {
      await notifyClinic(prisma, row.clinicOrgId, {
        template: "chargeback_clinic",
        title: "Your bank told us you disputed a charge",
        body: `Your bank has opened a dispute on a ${usd(d.amount)} charge from ${brand().name}. While it's open, posting new shifts is paused (your existing bookings aren't affected). If this was a mistake, ask your bank to withdraw the dispute. If something went wrong with a shift, reply here or use "Report a problem" on the shift so we can sort it out directly.`,
        link: "/clinic/billing",
        email: true,
      });
    }
    return row;
  }
  const wasOpen = disputeIsOpen(existing.status);
  const row = await prisma.chargeDispute.update({ where: { id: existing.id }, data });
  if (wasOpen && !disputeIsOpen(d.status)) {
    await audit(prisma, SYSTEM, "chargeback.closed", "ChargeDispute", row.id, { status: existing.status }, { status: d.status });
    await notifyAdmins(prisma, {
      template: "chargeback_closed",
      title: `Card dispute ${d.status === "won" ? "won" : d.status === "lost" ? "lost" : "closed"}: ${usd(d.amount)}`,
      body: d.status === "won" ? "The bank decided in our favor; the funds are returned. Release the provider's held pay if it's still on hold." : d.status === "lost" ? "The bank decided for the clinic. Decide whether to recover the amount (Admin → Payments → manual charge) and whether to release the provider's held pay." : `Status: ${d.status.replace(/_/g, " ")}.`,
      link: `/admin/payments/chargebacks/${row.id}`,
      email: true,
    });
  }
  return row;
}

/** Posting is paused while a clinic has an open card dispute. */
export async function openChargebackFor(clinicOrgId: string) {
  return prisma.chargeDispute.findFirst({ where: { clinicOrgId, status: { in: OPEN } }, select: { id: true, amountCents: true } });
}

export async function listChargebacks(actor: Actor) {
  requireAdmin(actor);
  const rows = await prisma.chargeDispute.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const orgs = await prisma.clinicOrg.findMany({ where: { id: { in: rows.map((r) => r.clinicOrgId).filter((x): x is string => !!x) } }, select: { id: true, displayName: true } });
  const name = new Map(orgs.map((o) => [o.id, o.displayName]));
  return rows.map((r) => ({ ...r, clinicName: r.clinicOrgId ? (name.get(r.clinicOrgId) ?? "?") : "Unknown clinic", open: disputeIsOpen(r.status) }));
}

/** The evidence text for one dispute, built from the booking's own records (no patient details). */
export async function chargebackDetail(actor: Actor, id: string) {
  requireAdmin(actor);
  const cd = await prisma.chargeDispute.findUniqueOrThrow({ where: { id } });
  const s = await getSettings();
  const payment = cd.paymentId ? await prisma.payment.findUnique({ where: { id: cd.paymentId } }) : null;
  const org = cd.clinicOrgId ? await prisma.clinicOrg.findUnique({ where: { id: cd.clinicOrgId } }) : null;
  const a = cd.assignmentId
    ? await prisma.assignment.findUnique({ where: { id: cd.assignmentId }, include: { provider: true, timesheet: true, visitCount: true, disputes: true, shift: { include: { location: true } } } })
    : null;
  const sig = org ? await prisma.agreementSignature.findFirst({ where: { partyType: "CLINIC", partyId: org.id, status: "SIGNED" }, orderBy: { signedAt: "desc" } }) : null;
  const signer = sig ? await prisma.user.findUnique({ where: { id: sig.signerUserId }, select: { name: true } }) : null;
  const messagesCount = a ? await prisma.message.count({ where: { thread: { shiftId: a.shiftId, providerId: a.providerId } } }) : 0;
  const tz = a?.shift.location.timeZone ?? "America/New_York";
  const evidence = chargebackEvidence({
    brandName: brand().name,
    clinicName: org?.legalName ?? org?.displayName ?? "Clinic",
    clinicEmail: org?.billingEmail ?? null,
    disputeReason: cd.reason,
    amountCents: cd.amountCents,
    paymentType: payment?.type ?? "charge",
    agreement: sig ? { version: sig.version, signedAt: sig.signedAt, signerName: sig.typedSignature ?? signer?.name ?? null, ip: sig.signerIp } : null,
    shift: a
      ? {
          date: a.startsAt.toLocaleDateString("en-CA", { timeZone: tz }),
          hours: `${a.startsAt.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}–${a.endsAt.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`,
          location: `${a.shift.location.name}, ${a.shift.location.city} ${a.shift.location.state}`,
          providerName: a.provider.displayName,
          postedAt: a.shift.postedAt,
          confirmedAt: a.confirmedAt,
          status: a.status,
        }
      : null,
    timesheet: a?.timesheet ? { firstIn: a.timesheet.firstIn, lastOut: a.timesheet.lastOut, workedMinutes: a.timesheet.workedMinutes, signedOffBy: a.timesheet.approverName, signedOffAt: a.timesheet.approvedAt, method: a.timesheet.approvalMethod } : null,
    visits: a?.visitCount?.finalVisits ?? a?.visitCount?.providerVisits ?? null,
    cancellationPolicy: `Under the signed Clinic Agreement, the clinic may cancel a confirmed shift free of charge up to ${s["payments.clinicFreeCancelHours"]} hours before it starts; later cancellations forfeit the deposit. Problems with a shift are raised through the platform's dispute process within ${s["payments.disputeWindowHours"]} hours after it ends.`,
    messagesCount,
    platformDisputeOpened: !!a?.disputes.length,
  });
  return { dispute: cd, clinicName: org?.displayName ?? null, assignmentId: a?.id ?? null, shiftId: a?.shiftId ?? null, providerName: a?.provider.displayName ?? null, evidence, open: disputeIsOpen(cd.status) };
}

/** Send the evidence to Stripe. submit = final (no more changes); otherwise saved as a draft in Stripe. */
export async function submitChargebackEvidence(actor: Actor, id: string, opts: { submit: boolean; note?: string | null }) {
  requireAdmin(actor);
  const d = await chargebackDetail(actor, id);
  if (!d.open) throw new Error("This dispute is already closed.");
  const evidence = { ...d.evidence };
  if (opts.note?.trim()) evidence.uncategorized_text = `${evidence.uncategorized_text}\n\n${opts.note.trim()}`.slice(0, 20000);
  const r = await paymentsProvider().submitDisputeEvidence(d.dispute.stripeDisputeId, evidence, opts.submit);
  await prisma.chargeDispute.update({ where: { id }, data: { status: r.status, ...(opts.submit ? { evidenceSubmittedAt: clock.now(), evidenceSubmittedBy: actor.userId } : {}), adminNote: opts.note?.trim() || d.dispute.adminNote } });
  await audit(prisma, actor, opts.submit ? "chargeback.evidence_submitted" : "chargeback.evidence_saved", "ChargeDispute", id, null, { status: r.status });
  return r;
}

/** Release the provider pay held when the dispute opened (the provider did the work either way). */
export async function releaseChargebackHolds(actor: Actor, id: string) {
  requireAdmin(actor);
  const cd = await prisma.chargeDispute.findUniqueOrThrow({ where: { id } });
  const r = await prisma.payout.updateMany({ where: { id: { in: cd.heldPayoutIds }, onHold: true, holdReason: "Card dispute opened by the clinic" }, data: { onHold: false, holdReason: null } });
  await audit(prisma, actor, "chargeback.holds_released", "ChargeDispute", id, null, { released: r.count });
  return r.count;
}
