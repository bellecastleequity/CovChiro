import { DomainError } from "@cm/core";
import { prisma, type PaymentType } from "@cm/db";
import { paymentsProvider } from "@cm/integrations";
import { audit, getSettings, SYSTEM, type Actor } from "./context";
import { notifyAdmins, notifyClinic } from "./notify";

/**
 * Clinic-side money (SPEC §9.2). Amounts are always computed server-side
 * from the assignment snapshot — never from client input (INV-5/INV-7).
 * Each charge has a deterministic idempotency key so retries can't double
 * charge.
 */

async function charge(assignmentId: string | null, clinicOrgId: string, type: PaymentType, amountCents: number, key: string, description: string) {
  if (amountCents <= 0) return null;
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey: key } });
  if (existing && (existing.status === "SUCCEEDED" || existing.status === "PROCESSING")) return existing;
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinicOrgId } });
  const payment =
    existing ??
    (await prisma.payment.create({ data: { clinicOrgId, assignmentId, type, amountCents, idempotencyKey: key, description, status: "PENDING" } }));
  if (!org.stripeCustomerId || !org.hasPaymentMethod) {
    return prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: "No payment method on file" } });
  }
  const res = await paymentsProvider().chargeOffSession({
    customerId: org.stripeCustomerId,
    amountCents,
    idempotencyKey: `${key}-${payment.id}`,
    description,
    metadata: { paymentId: payment.id, clinicOrgId, ...(assignmentId ? { assignmentId } : {}), type },
  });
  const status = res.status === "succeeded" ? "SUCCEEDED" : res.status === "processing" ? "PROCESSING" : "FAILED";
  return prisma.payment.update({
    where: { id: payment.id },
    data: { status, stripePaymentIntentId: res.id || null, failureReason: res.failureReason ?? (res.status === "requires_action" ? "Card requires authentication" : null) },
  });
}

export async function chargeDeposit(assignmentId: string) {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: true } } } });
  const orgId = a.shift.location.clinicOrgId;
  const p = await charge(assignmentId, orgId, "DEPOSIT", a.depositCents, `deposit-${assignmentId}`, `Deposit · coverage ${a.startsAt.toISOString().slice(0, 10)}`);
  if (p?.status === "FAILED") {
    const s = await getSettings();
    const urgent = +a.startsAt - Date.now() < 48 * 3_600_000;
    const hours = urgent ? s["payments.paymentFixWindowUrgentHours"] : s["payments.paymentFixWindowHours"];
    await prisma.assignment.update({ where: { id: assignmentId }, data: { flags: { set: [...new Set([...a.flags, "PAYMENT_FAILED"])] } } });
    await notifyClinic(prisma, orgId, {
      template: "deposit_failed",
      title: "Action needed: your deposit didn't go through",
      body: `We couldn't charge the deposit for your confirmed coverage. Please update your payment method within ${hours} hour(s) to keep the booking.`,
      link: "/clinic/billing",
      ctaLabel: "Update payment method",
      sms: true,
    });
  }
  return p;
}

/** Balance at completion = clinic total − what has already been collected. */
export async function chargeBalance(assignmentId: string) {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: true } }, payments: true } });
  const collected = a.payments.filter((p) => p.status === "SUCCEEDED" && (p.type === "DEPOSIT" || p.type === "BALANCE")).reduce((x, p) => x + p.amountCents, 0);
  const due = a.clinicTotalCents - collected;
  return charge(assignmentId, a.shift.location.clinicOrgId, "BALANCE", due, `balance-${assignmentId}`, `Coverage balance · ${a.startsAt.toISOString().slice(0, 10)}`);
}

export async function chargeLodging(assignmentId: string, receiptId: string, amountCents: number) {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: true } } } });
  return charge(assignmentId, a.shift.location.clinicOrgId, "LODGING", amountCents, `lodging-${receiptId}`, "Lodging reimbursement (pass-through)");
}

/** Refund up to `amountCents` of an assignment's successful payments (most recent first). */
export async function refundAssignment(actor: Actor, assignmentId: string, amountCents: number, reason: string) {
  let remaining = amountCents;
  const payments = await prisma.payment.findMany({
    where: { assignmentId, status: "SUCCEEDED", type: { in: ["DEPOSIT", "BALANCE", "LODGING"] } },
    orderBy: { createdAt: "desc" },
  });
  for (const p of payments) {
    if (remaining <= 0) break;
    const refunded = await prisma.payment.aggregate({ where: { assignmentId, type: "REFUND", description: { contains: p.id } }, _sum: { amountCents: true } });
    const available = p.amountCents - (refunded._sum.amountCents ?? 0);
    const amt = Math.min(available, remaining);
    if (amt <= 0 || !p.stripePaymentIntentId) continue;
    const key = `refund-${p.id}-${amt}-${reason.slice(0, 20).replace(/\W/g, "")}`;
    if (await prisma.payment.findUnique({ where: { idempotencyKey: key } })) {
      remaining -= amt;
      continue;
    }
    const r = await paymentsProvider().refund({ paymentIntentId: p.stripePaymentIntentId, amountCents: amt, idempotencyKey: key });
    await prisma.payment.create({
      data: {
        clinicOrgId: p.clinicOrgId,
        assignmentId,
        type: "REFUND",
        amountCents: amt,
        stripeRefundId: r.id,
        idempotencyKey: key,
        status: "SUCCEEDED",
        description: `Refund of ${p.id}: ${reason}`,
        createdById: actor.userId,
      },
    });
    remaining -= amt;
  }
  await audit(prisma, actor, "payment.refund", "Assignment", assignmentId, null, { requested: amountCents, refunded: amountCents - remaining, reason });
  return amountCents - remaining;
}

export async function depositPaidCents(assignmentId: string): Promise<number> {
  const agg = await prisma.payment.aggregate({ where: { assignmentId, type: "DEPOSIT", status: "SUCCEEDED" }, _sum: { amountCents: true } });
  return agg._sum.amountCents ?? 0;
}

/** Stripe's minimum charge in USD. */
export const MIN_CHARGE_CENTS = 50;

/** Admin-only manual charges (conversion fee is ATTORNEY REVIEW → behind a feature flag). */
export async function adminCharge(actor: Actor, clinicOrgId: string, type: "CONVERSION_FEE" | "ADJUSTMENT" | "CANCELLATION_FEE", amountCents: number, description: string) {
  const s = await getSettings();
  if (type === "CONVERSION_FEE" && !s["features.conversionFeeEnabled"]) throw new DomainError("FORBIDDEN", "Conversion fees are disabled until attorney review is complete.");
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new DomainError("VALIDATION", "Enter a positive amount.");
  if (amountCents < MIN_CHARGE_CENTS) throw new DomainError("VALIDATION", `The smallest card charge Stripe allows is $${(MIN_CHARGE_CENTS / 100).toFixed(2)}.`);
  const p = await charge(null, clinicOrgId, type, amountCents, `${type.toLowerCase()}-${clinicOrgId}-${Date.now()}`, description);
  await audit(prisma, actor, "payment.admin_charge", "ClinicOrg", clinicOrgId, null, { type, amountCents, description, status: p?.status });
  return p;
}

/** A clinic-accepted placement (direct hire) fee, charged to the card on file. */
export async function chargePlacementFee(clinicOrgId: string, hireRequestId: string, amountCents: number, attempt: number, description: string) {
  return charge(null, clinicOrgId, "CONVERSION_FEE", amountCents, `placement-${hireRequestId}-${attempt}`, description);
}

// ---------------- Stripe webhooks (the only other source of payment truth) ----------------

export async function handleStripeEvent(rawBody: string, signature: string | null) {
  const event = paymentsProvider().parseWebhook(rawBody, signature);
  const obj = event.data.object as unknown as Record<string, any>;
  switch (event.type) {
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.processing": {
      const status = event.type === "payment_intent.succeeded" ? "SUCCEEDED" : event.type === "payment_intent.processing" ? "PROCESSING" : "FAILED";
      const payment = await prisma.payment.findUnique({ where: { stripePaymentIntentId: obj.id } });
      if (payment && payment.status !== "REFUNDED") {
        await prisma.payment.update({ where: { id: payment.id }, data: { status, failureReason: obj.last_payment_error?.message ?? null } });
        if (status === "FAILED" && payment.type === "DEPOSIT" && payment.assignmentId) await chargeDepositFailedFollowUp(payment.assignmentId);
      }
      break;
    }
    case "account.updated": {
      await prisma.provider.updateMany({ where: { stripeAccountId: obj.id }, data: { stripePayoutsEnabled: !!obj.payouts_enabled } });
      break;
    }
    case "checkout.session.completed": {
      if (obj.mode === "setup" && obj.metadata?.clinicOrgId) {
        await prisma.clinicOrg.update({ where: { id: obj.metadata.clinicOrgId }, data: { hasPaymentMethod: true, paymentMethodLabel: "Saved payment method" } });
        await activateClinicIfReady(obj.metadata.clinicOrgId);
      }
      break;
    }
    case "transfer.reversed": {
      const t = await prisma.payoutTransfer.findUnique({ where: { stripeTransferId: obj.id } });
      if (t) {
        await prisma.payoutTransfer.update({ where: { id: t.id }, data: { status: "REVERSED", failureReason: "Reversed in Stripe" } });
        await notifyAdmins(prisma, { template: "transfer_reversed", title: "A provider transfer was reversed", body: `Transfer ${obj.id} was reversed in Stripe. Review it in Admin → Provider pay.`, link: "/admin/payouts", email: true });
      }
      break;
    }
    default:
      break;
  }
  await audit(prisma, SYSTEM, `stripe.${event.type}`, "StripeEvent", event.id);
  return { received: true };
}

async function chargeDepositFailedFollowUp(assignmentId: string) {
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (a && !a.flags.includes("PAYMENT_FAILED")) {
    await prisma.assignment.update({ where: { id: assignmentId }, data: { flags: { push: "PAYMENT_FAILED" } } });
  }
}

/** Clinic becomes ACTIVE once it has a payment method, a signed agreement and a location. */
export async function activateClinicIfReady(clinicOrgId: string) {
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinicOrgId }, include: { locations: { where: { active: true } } } });
  if (org.status === "ONBOARDING" && org.hasPaymentMethod && org.agreementSignedAt && org.locations.length) {
    await prisma.clinicOrg.update({ where: { id: clinicOrgId }, data: { status: "ACTIVE" } });
    await audit(prisma, SYSTEM, "clinic.activated", "ClinicOrg", clinicOrgId, { status: "ONBOARDING" }, { status: "ACTIVE" });
  }
}
