import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { FakePayments, paymentsProvider } from "@cm/integrations";
import {
  addAdjustment,
  adminCharge,
  applyToShift,
  autoCompleteDue,
  createShift,
  issuePayment,
  openDispute,
  releaseDuePayouts,
  resolveDispute,
  resumePartialTransfers,
  selectApplicant,
  startDueShifts,
} from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const fake = () => paymentsProvider() as FakePayments;

async function completedShift(days: number, opts: { dispute?: { refundCents: number } } = {}) {
  const clinic = await makeClinic();
  const provider = await makeProvider();
  const { startsAt, endsAt } = futureWeekday(days);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
  await applyToShift(provider.actor, shiftId, { commit: true });
  const { assignmentId } = await selectApplicant(clinic.actor, shiftId, provider.id);
  const end = new Date(Date.now() - 3 * 3_600_000);
  const start = new Date(+end - 8 * 3_600_000);
  await prisma.$executeRaw`ALTER TABLE "Shift" DISABLE TRIGGER shift_state_sync`;
  await prisma.shift.update({ where: { id: shiftId }, data: { startsAt: start, endsAt: end } });
  await prisma.$executeRaw`ALTER TABLE "Shift" ENABLE TRIGGER shift_state_sync`;
  await prisma.assignment.updateMany({ where: { shiftId }, data: { startsAt: start, endsAt: end } });
  await startDueShifts();
  if (opts.dispute) {
    await openDispute(clinic.actor, assignmentId, "Left early");
    const d = await prisma.dispute.findFirstOrThrow({ where: { assignmentId } });
    await resolveDispute(admin, d.id, { resolution: "Partial refund", refundCents: opts.dispute.refundCents, payoutAdjustmentCents: -opts.dispute.refundCents });
  } else {
    await autoCompleteDue();
  }
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { payments: true } });
  expect(a.status).toBe("COMPLETED");
  return { provider, assignment: a };
}

async function legsOf(transferId: string) {
  const legs = await prisma.payoutTransferLeg.findMany({ where: { transferId }, orderBy: { amountCents: "asc" } });
  const payments = await prisma.payment.findMany({ where: { id: { in: legs.map((l) => l.paymentId).filter((x): x is string => !!x) } } });
  return legs.map((l) => ({ ...l, payment: payments.find((p) => p.id === l.paymentId) ?? null }));
}

describe("provider pay is linked to the clinic's charges (Stripe source_transaction)", () => {
  it("a shift's pay goes out as legs tied to its deposit and balance charges", async () => {
    const { assignment } = await completedShift(35);
    await prisma.payout.updateMany({ where: { assignmentId: assignment.id }, data: { releaseAt: new Date(Date.now() - 1000) } });
    await releaseDuePayouts();
    const payout = await prisma.payout.findFirstOrThrow({ where: { assignmentId: assignment.id }, include: { transfer: true } });
    expect(payout.status).toBe("PAID");
    const transfer = payout.transfer!;
    expect(transfer).toMatchObject({ status: "PAID", amountCents: assignment.providerTotalCents });

    const legs = await legsOf(transfer.id);
    expect(legs.reduce((a, l) => a + l.amountCents, 0)).toBe(assignment.providerTotalCents);
    expect(legs.every((l) => l.status === "PAID" && l.paymentId && l.stripeTransferId)).toBe(true);
    const deposit = assignment.payments.find((p) => p.type === "DEPOSIT")!;
    const balance = assignment.payments.find((p) => p.type === "BALANCE")!;
    expect(new Set(legs.map((l) => l.paymentId))).toEqual(new Set([deposit.id, balance.id]));
    // The deposit is used up first (oldest charge), the rest comes from the balance.
    expect(legs.find((l) => l.paymentId === deposit.id)!.amountCents).toBe(deposit.amountCents);

    // Stripe saw each leg with its charge as the source.
    const sent = fake().transfers.filter((t) => t.idempotencyKey.startsWith(transfer.idempotencyKey));
    expect(new Set(sent.map((t) => t.sourcePaymentIntentId))).toEqual(new Set([deposit.stripePaymentIntentId, balance.stripePaymentIntentId]));

    // Charges remember what was already sent from them.
    const after = await prisma.payment.findMany({ where: { id: { in: [deposit.id, balance.id] } } });
    expect(after.reduce((a, p) => a + p.transferredCents, 0)).toBe(assignment.providerTotalCents);
    for (const p of after) expect(p.transferredCents).toBeLessThanOrEqual(p.amountCents);
  });

  it("refunds shrink what a charge can fund; a bonus goes out unlinked; a partial failure resumes only the unpaid leg", async () => {
    const { provider, assignment } = await completedShift(42, { dispute: { refundCents: 5000 } });
    await addAdjustment(admin, { providerId: provider.id, amountCents: 10000, description: "Thank-you bonus" });
    const owed = assignment.providerTotalCents - 5000 + 10000;

    // The unlinked leg (no clinic charge behind the bonus) fails; the linked legs go through.
    fake().failTransferIf = (i) => i.sourcePaymentIntentId === null;
    let r;
    try {
      r = await issuePayment(admin, provider.id, { early: true });
    } finally {
      fake().failTransferIf = null;
    }
    expect(r).toMatchObject({ status: "PARTIAL", amountCents: owed });
    const transfer = await prisma.payoutTransfer.findUniqueOrThrow({ where: { id: r!.transferId } });
    expect(transfer.status).toBe("PROCESSING");
    expect(await prisma.payout.count({ where: { transferId: transfer.id, status: "PAID" } })).toBe(0);
    // Reserved rows can't be issued again while it's in flight.
    expect(await issuePayment(admin, provider.id, { early: true })).toBeNull();

    let legs = await legsOf(transfer.id);
    expect(legs.reduce((a, l) => a + l.amountCents, 0)).toBe(owed);
    const unlinked = legs.filter((l) => !l.paymentId);
    expect(unlinked).toHaveLength(1);
    // The −$50 adjustment nets against the unlinked bonus first.
    expect(unlinked[0]).toMatchObject({ status: "FAILED", amountCents: 5000 });
    const refunds = await prisma.payment.findMany({ where: { assignmentId: assignment.id, type: "REFUND" } });
    for (const l of legs.filter((x) => x.paymentId)) {
      expect(l.status).toBe("PAID");
      const refunded = refunds.filter((x) => x.description?.includes(l.paymentId!)).reduce((a, x) => a + x.amountCents, 0);
      expect(l.amountCents).toBeLessThanOrEqual(l.payment!.amountCents - refunded);
    }
    const callsBefore = fake().transferCalls.filter((k) => k.startsWith(transfer.idempotencyKey)).length;

    // The payout job finishes it, sending only the missing leg.
    await resumePartialTransfers(0);
    const done = await prisma.payoutTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
    expect(done.status).toBe("PAID");
    expect(fake().transferCalls.filter((k) => k.startsWith(transfer.idempotencyKey)).length).toBe(callsBefore + 1);
    legs = await legsOf(transfer.id);
    expect(legs.every((l) => l.status === "PAID")).toBe(true);
    expect(await prisma.payout.count({ where: { providerId: provider.id, status: { not: "PAID" } } })).toBe(0);
    // Nothing left: no double payment.
    expect(await issuePayment(admin, provider.id, { early: true })).toBeNull();
  });

  it("a transfer that fails outright releases the rows to try again", async () => {
    const { provider, assignment } = await completedShift(49);
    fake().failNextTransfers = 1;
    const r = await issuePayment(admin, provider.id, { early: true });
    expect(r).toMatchObject({ status: "FAILED" });
    expect(await prisma.payout.count({ where: { assignmentId: assignment.id, status: "FAILED", transferId: null } })).toBe(1);
    expect(await prisma.payment.aggregate({ where: { assignmentId: assignment.id }, _sum: { transferredCents: true } })).toMatchObject({ _sum: { transferredCents: 0 } });
    const again = await issuePayment(admin, provider.id, { early: true });
    expect(again).toMatchObject({ status: "PAID", amountCents: assignment.providerTotalCents });
  });
});

describe("admin manual charge", () => {
  it("refuses amounts under Stripe's 50¢ minimum before contacting Stripe", async () => {
    const clinic = await makeClinic();
    const before = await prisma.payment.count({ where: { clinicOrgId: clinic.org.id } });
    await expect(adminCharge(admin, clinic.org.id, "ADJUSTMENT", 2, "test")).rejects.toThrow(/\$0\.50/);
    expect(await prisma.payment.count({ where: { clinicOrgId: clinic.org.id } })).toBe(before);
    const ok = await adminCharge(admin, clinic.org.id, "ADJUSTMENT", 50, "test");
    expect(ok?.status).toBe("SUCCEEDED");
  });
});
