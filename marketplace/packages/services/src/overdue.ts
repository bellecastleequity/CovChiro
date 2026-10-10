import { DomainError, overduePaymentAction, OVERDUE_PAYMENT_TYPES } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, requireClinic, SYSTEM, type Actor } from "./context";
import { notifyAdmins, notifyClinic } from "./notify";

/**
 * Overdue clinic payments (owner decision Oct 2026). A failed clinic charge is told to the clinic at
 * once (Pay now on Billing), retried at payments.retryAfterHours, and when anything is still unpaid
 * payments.payInFullAfterHours after it first failed, the clinic is switched to pay-in-full: future
 * bookings are charged in full at confirmation (confirm.ts) until an admin restores the deposit.
 * Clinic Agreement v6 section 3 carries the clause. Rules: core/overdue.ts.
 */

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const TYPES = [...OVERDUE_PAYMENT_TYPES];

/** A deposit only counts while its booking still stands (a released booking owes nothing). */
async function stillOwed(p: { type: string; assignmentId: string | null }) {
  if (p.type !== "DEPOSIT" || !p.assignmentId) return true;
  const a = await prisma.assignment.findUnique({ where: { id: p.assignmentId }, select: { status: true } });
  return !!a && a.status !== "CANCELLED";
}

/** Tell the clinic once that a charge didn't go through (deposits have their own notice in chargeDeposit). */
export async function tellClinicChargeFailed(paymentId: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.failureNotifiedAt || p.status !== "FAILED") return;
  const claimed = await prisma.payment.updateMany({ where: { id: p.id, failureNotifiedAt: null }, data: { failureNotifiedAt: clock.now() } });
  if (!claimed.count) return;
  const s = await getSettings();
  await notifyClinic(prisma, p.clinicOrgId, {
    template: "payment_failed",
    title: `Payment of ${money(p.amountCents)} didn't go through`,
    body: `We couldn't charge your card on file for ${p.description ?? "your booking"}. Please update your card or tap Pay now on Billing.${s["payments.payInFullEnabled"] ? ` If it's still unpaid after ${s["payments.payInFullAfterHours"]} hours, future bookings are charged in full when a provider is confirmed.` : ""}`,
    link: "/clinic/billing#overdue",
    ctaLabel: "Pay now",
    email: true,
    sms: true,
  });
}

/** Clinic "Pay now" (or an admin's "Retry charge"): one more attempt on the card now on file. */
export async function retryPayment(actor: Actor, paymentId: string) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw new DomainError("NOT_FOUND", "Payment not found");
  if (actor.role !== "PLATFORM_ADMIN" && requireClinic(actor) !== p.clinicOrgId) throw new DomainError("NOT_FOUND", "Payment not found");
  if (p.status !== "FAILED") throw new DomainError("VALIDATION", p.status === "SUCCEEDED" ? "This payment is already paid." : "This payment is already being processed.");
  return attempt(p.id);
}

async function attempt(paymentId: string) {
  const p = await prisma.payment.update({ where: { id: paymentId }, data: { retryCount: { increment: 1 } } });
  const { charge } = await import("./payments");
  const r = await charge(p.assignmentId, p.clinicOrgId, p.type, p.amountCents, p.idempotencyKey, p.description ?? "Payment");
  if (r?.status === "SUCCEEDED") {
    await notifyClinic(prisma, p.clinicOrgId, { template: "payment_received", title: `Payment of ${money(p.amountCents)} received`, body: `Thank you: ${p.description ?? "your payment"} is paid.`, link: "/clinic/billing" });
  }
  return { status: r?.status ?? p.status, failureReason: r?.failureReason ?? null };
}

/** Hourly: retry failed clinic charges when due, and switch clinics with a charge overdue past the limit to pay-in-full. */
export async function overduePaymentsSweep() {
  const s = await getSettings();
  const now = clock.now();
  const failed = await prisma.payment.findMany({
    where: { status: "FAILED", type: { in: TYPES }, firstFailedAt: { not: null } },
    include: { clinicOrg: { select: { id: true, displayName: true, payInFull: true, payInFullClearedAt: true } } },
    orderBy: { firstFailedAt: "asc" },
    take: 500,
  });
  let retried = 0;
  let flagged = 0;
  let told = 0;
  const flaggedNow = new Set<string>();
  for (const p of failed) {
    if (!(await stillOwed(p))) continue;
    // Failures from before this update (or a missed notice): tell the clinic now.
    if (!p.failureNotifiedAt && p.type !== "DEPOSIT") {
      await tellClinicChargeFailed(p.id);
      told++;
    }
    const act = overduePaymentAction({
      status: p.status,
      firstFailedAt: p.firstFailedAt,
      retryCount: p.retryCount,
      now,
      retryAfterHours: s["payments.retryAfterHours"],
      payInFullAfterHours: s["payments.payInFullAfterHours"],
      clearedAt: p.clinicOrg.payInFullClearedAt,
      alreadyFlagged: p.clinicOrg.payInFull || flaggedNow.has(p.clinicOrgId),
      enabled: s["payments.payInFullEnabled"],
    });
    if (act.retry) {
      retried++;
      const r = await attempt(p.id).catch(() => null);
      if (r?.status === "SUCCEEDED" || r?.status === "PROCESSING") continue;
    }
    if (act.flag) {
      flagged++;
      flaggedNow.add(p.clinicOrgId);
      await setPayInFull(SYSTEM, p.clinicOrgId, true, `${p.description ?? p.type} (${money(p.amountCents)}) unpaid for ${s["payments.payInFullAfterHours"]}+ hours`);
    }
  }
  return { checked: failed.length, told, retried, flagged };
}

/** Turn pay-in-full on (sweep, or an admin) or off (admin only: restores the normal deposit). */
export async function setPayInFull(actor: Actor, clinicOrgId: string, on: boolean, reason: string) {
  if (actor.role !== "SYSTEM") requireAdmin(actor);
  if (!on && actor.role === "SYSTEM") throw new DomainError("FORBIDDEN", "Only an admin restores the normal deposit.");
  const before = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinicOrgId }, select: { payInFull: true, displayName: true } });
  if (before.payInFull === on) return;
  const now = clock.now();
  await prisma.clinicOrg.update({
    where: { id: clinicOrgId },
    data: on ? { payInFull: true, payInFullSince: now, payInFullReason: reason.trim() || "Set by an admin" } : { payInFull: false, payInFullClearedAt: now, payInFullClearedById: actor.userId, payInFullReason: null },
  });
  await audit(prisma, actor, on ? "clinic.pay_in_full_on" : "clinic.pay_in_full_off", "ClinicOrg", clinicOrgId, { payInFull: before.payInFull }, { payInFull: on, reason });
  const s = await getSettings();
  if (on) {
    await notifyClinic(prisma, clinicOrgId, {
      template: "pay_in_full_on",
      title: "Future bookings are now charged in full at confirmation",
      body: `A payment on your account is more than ${s["payments.payInFullAfterHours"]} hours overdue, so from now on each booking is charged in full when a provider is confirmed, instead of the ${s["payments.depositPercent"]}% deposit. Please pay what's outstanding on Billing; once your account is up to date, contact us to return to the normal deposit.`,
      link: "/clinic/billing#overdue",
      ctaLabel: "Open billing",
      email: true,
      sms: true,
    });
    await notifyAdmins(prisma, {
      template: "billing_pay_in_full",
      title: `${before.displayName} now pays in full at confirmation`,
      body: reason,
      link: `/admin/clinics/${clinicOrgId}#payment-terms`,
      ctaLabel: "Open the clinic",
    }).catch(() => undefined);
  } else {
    await notifyClinic(prisma, clinicOrgId, {
      template: "pay_in_full_off",
      title: "Your normal deposit is back",
      body: `Thank you. Future bookings are charged the usual ${s["payments.depositPercent"]}% deposit at confirmation again, with the balance after the shift.`,
      link: "/clinic/billing",
      email: true,
    });
  }
}

/** Clinic billing page + admin clinic page: what's unpaid and the clinic's payment terms. */
export async function overdueForClinic(clinicOrgId: string) {
  const [org, rows] = await Promise.all([
    prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinicOrgId }, select: { payInFull: true, payInFullSince: true, payInFullReason: true, payInFullClearedAt: true } }),
    prisma.payment.findMany({ where: { clinicOrgId, status: "FAILED", type: { in: TYPES } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const unpaid = [];
  for (const p of rows) if (await stillOwed(p)) unpaid.push({ id: p.id, type: p.type, amountCents: p.amountCents, description: p.description, failureReason: p.failureReason, firstFailedAt: p.firstFailedAt ?? p.createdAt, retryCount: p.retryCount });
  return { ...org, unpaid, unpaidCents: unpaid.reduce((t, p) => t + p.amountCents, 0) };
}
