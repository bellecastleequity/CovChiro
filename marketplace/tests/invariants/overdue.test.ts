import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { adminAssign, overdue, setClock } from "@cm/services";
import { charge } from "../../packages/services/src/payments";
import { makeClinic, makeProvider, makeShift, uid } from "../factories";

/**
 * Overdue clinic payments (owner decision Oct 2026): a failed charge is told to the clinic, retried,
 * and 48 hours after it first failed the clinic's future bookings are charged in full at
 * confirmation until an admin restores the deposit. The fake card declines amounts ending in 13 cents.
 */
const H = 3_600_000;
const admin = { userId: null, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
afterEach(() => setClock(null));

const failedSince = (id: string, hours: number) => prisma.payment.update({ where: { id }, data: { firstFailedAt: new Date(Date.now() - hours * H) } });
const notes = (userId: string, template: string) => prisma.notification.count({ where: { userId, template } });

describe("overdue clinic payments", () => {
  it("tells the clinic, retries, then charges future bookings in full; an admin restores the deposit", async () => {
    const c = await makeClinic();
    const p = (await charge(null, c.org.id, "BALANCE", 10013, `test-balance-${uid()}`, "Coverage balance · test"))!;
    expect(p.status).toBe("FAILED");
    expect(p.firstFailedAt).not.toBeNull();
    expect(await notes(c.user.id, "payment_failed")).toBe(1);

    // Too early for anything.
    expect(await overdue.overduePaymentsSweep()).toMatchObject({ retried: 0, flagged: 0 });
    // A day later: one automatic retry (still declined), not yet pay-in-full.
    await failedSince(p.id, 25);
    expect(await overdue.overduePaymentsSweep()).toMatchObject({ retried: 1, flagged: 0 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).retryCount).toBe(1);
    // 48 hours after it first failed: pay-in-full.
    await failedSince(p.id, 49);
    expect(await overdue.overduePaymentsSweep()).toMatchObject({ retried: 0, flagged: 1 });
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } })).payInFull).toBe(true);
    expect(await notes(c.user.id, "pay_in_full_on")).toBe(1);
    expect(await notes(c.user.id, "payment_failed")).toBe(1);

    // The next booking takes the whole amount at confirmation.
    const shift = await makeShift(c.location.id, { days: 20 });
    const { assignmentId } = await adminAssign({ ...admin }, shift.id, (await makeProvider()).id);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { payments: true } });
    expect(a.depositCents).toBe(a.clinicTotalCents);
    expect(a.payments.find((x) => x.type === "DEPOSIT")?.amountCents).toBe(a.clinicTotalCents);

    // Only an admin turns it off; the old unpaid charge then doesn't switch it straight back on.
    await expect(overdue.setPayInFull({ userId: null, role: "SYSTEM" }, c.org.id, false, "x")).rejects.toThrow(/Only an admin/);
    await overdue.setPayInFull(admin, c.org.id, false, "Paid by check Oct 12");
    expect(await overdue.overduePaymentsSweep()).toMatchObject({ flagged: 0 });
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } })).payInFull).toBe(false);
    expect(await notes(c.user.id, "pay_in_full_off")).toBe(1);
    const shift2 = await makeShift(c.location.id, { days: 27 });
    const second = await adminAssign({ ...admin }, shift2.id, (await makeProvider()).id);
    const b = await prisma.assignment.findUniqueOrThrow({ where: { id: second.assignmentId } });
    expect(b.depositCents).toBeLessThan(b.clinicTotalCents);
  });

  it("the clinic's Pay now charges the card again and clears it from Billing", async () => {
    const c = await makeClinic();
    const p = (await charge(null, c.org.id, "VOLUME", 4013, `test-volume-${uid()}`, "Extra visits · test"))!;
    expect((await overdue.overdueForClinic(c.org.id)).unpaid.map((x) => x.id)).toEqual([p.id]);
    // The clinic updates its card (the fake card now accepts this amount).
    await prisma.payment.update({ where: { id: p.id }, data: { amountCents: 4000 } });
    expect((await overdue.retryPayment(c.actor, p.id)).status).toBe("SUCCEEDED");
    expect((await overdue.overdueForClinic(c.org.id)).unpaid).toEqual([]);
    expect(await notes(c.user.id, "payment_received")).toBe(1);
    // Another clinic can't pay (or see) it.
    const other = await makeClinic();
    await expect(overdue.retryPayment(other.actor, p.id)).rejects.toThrow(/not found/i);
  });

  it("failsafe: never chases an old failed charge or one an admin excluded, and never charges a booking twice", async () => {
    const c = await makeClinic();
    // An old test charge from months ago, picked up by the pay-in-full update with a fresh clock.
    const old = (await charge(null, c.org.id, "BALANCE", 13, `test-old-${uid()}`, "Old test charge"))!;
    await prisma.payment.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 90 * 24 * H), firstFailedAt: new Date(Date.now() - 49 * H), failureNotifiedAt: null } });
    const before = await notes(c.user.id, "payment_failed");
    await overdue.overduePaymentsSweep();
    const o = await prisma.payment.findUniqueOrThrow({ where: { id: old.id } });
    expect(o.retryCount).toBe(0);
    expect(o.failureNotifiedAt).toBeNull();
    expect(await notes(c.user.id, "payment_failed")).toBe(before);
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } })).payInFull).toBe(false);
    // Admins still see it, marked as not chased.
    expect((await overdue.overdueForClinic(c.org.id)).unpaid.find((x) => x.id === old.id)?.autoChased).toBe(false);

    // Excluding a recent one: off the clinic's list, never retried or flagged, can't be charged until included again.
    const recent = (await charge(null, c.org.id, "VOLUME", 2013, `test-recent-${uid()}`, "Extra visits · test"))!;
    await expect(overdue.excludeFromCollection(c.actor, recent.id, "x")).rejects.toThrow();
    await expect(overdue.excludeFromCollection(admin, recent.id, " ")).rejects.toThrow(/note/);
    await overdue.excludeFromCollection(admin, recent.id, "Settled by phone");
    await failedSince(recent.id, 49);
    await overdue.overduePaymentsSweep();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: recent.id } })).retryCount).toBe(0);
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } })).payInFull).toBe(false);
    const due = await overdue.overdueForClinic(c.org.id);
    expect(due.unpaid.map((x) => x.id)).not.toContain(recent.id);
    expect(due.excluded.map((x) => x.id)).toContain(recent.id);
    await expect(overdue.retryPayment(admin, recent.id)).rejects.toThrow(/excluded/);
    await overdue.includeInCollection(admin, recent.id);
    expect((await overdue.overdueForClinic(c.org.id)).unpaid.map((x) => x.id)).toContain(recent.id);

    // A failed charge whose booking already paid the same amount another way is excluded, not charged again.
    const shift = await makeShift(c.location.id, { days: 22 });
    const { assignmentId } = await adminAssign({ ...admin }, shift.id, (await makeProvider()).id);
    const dup = (await charge(assignmentId, c.org.id, "BALANCE", 5013, `test-dup-${uid()}`, "Balance · test"))!;
    const { id: _id, idempotencyKey: _k, ...rest } = await prisma.payment.findUniqueOrThrow({ where: { id: dup.id } });
    await prisma.payment.create({ data: { ...rest, idempotencyKey: `test-dup-paid-${uid()}`, stripePaymentIntentId: `pi_fake_dup_${uid()}`, status: "SUCCEEDED", firstFailedAt: null, failureNotifiedAt: null } as never });
    await failedSince(dup.id, 25);
    await expect(overdue.retryPayment(c.actor, dup.id)).rejects.toThrow(/already has a matching paid charge/);
    const d = await prisma.payment.findUniqueOrThrow({ where: { id: dup.id } });
    expect(d.retryCount).toBe(0);
    expect(d.collectionExcludedNote).toMatch(/Already paid/);
  });
});
