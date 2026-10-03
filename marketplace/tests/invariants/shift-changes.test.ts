import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, createShift, selectApplicant, shiftChanges } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const HOUR = 3_600_000;

async function setup(confirm: boolean) {
  const clinic = await makeClinic();
  const provider = await makeProvider();
  const { startsAt, endsAt } = futureWeekday(21);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
  await applyToShift(provider.actor, shiftId, { commit: true });
  if (confirm) await selectApplicant(clinic.actor, shiftId, provider.id);
  return { clinic, provider, shiftId, startsAt, endsAt };
}

const live = (shiftId: string) => prisma.assignment.findFirst({ where: { shiftId, status: "CONFIRMED" } });

describe("Changing a posted shift", () => {
  it("not yet filled: applies right away, re-priced, and applicants are told", async () => {
    const { clinic, provider, shiftId, startsAt, endsAt } = await setup(false);
    const before = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    const r = await shiftChanges.changeShift(clinic.actor, shiftId, { startsAt, endsAt: new Date(+endsAt - 5 * HOUR) });
    expect(r.status).toBe("applied");
    const after = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(+after.endsAt).toBe(+endsAt - 5 * HOUR);
    expect(after.clinicPriceCents).toBeLessThan(before.clinicPriceCents); // half day costs less
    expect(after.status).toBe("OPEN");
    expect(await prisma.notification.count({ where: { userId: provider.userId, template: "shift_details_changed" } })).toBe(1);
    expect(await prisma.application.count({ where: { shiftId, providerId: provider.id, status: "ACTIVE" } })).toBe(1);
  });

  it("confirmed: waits for the provider; accepting updates the booking, pay and price", async () => {
    const { clinic, provider, shiftId, startsAt, endsAt } = await setup(true);
    const a0 = (await live(shiftId))!;
    const preview = await shiftChanges.previewShiftChange(clinic.actor, shiftId, { startsAt, endsAt: new Date(+endsAt - 5 * HOUR) });
    expect(preview.providerName).toBe(provider.displayName);
    expect(preview.after.priceCents).toBeLessThan(preview.before.priceCents);
    expect(JSON.stringify(preview)).not.toContain(String(a0.providerTotalCents)); // clinic never sees provider pay

    const r = await shiftChanges.changeShift(clinic.actor, shiftId, { startsAt, endsAt: new Date(+endsAt - 5 * HOUR), message: "Closing early that day" });
    expect(r.status).toBe("pending");
    // Nothing changes until the provider answers.
    expect(+(await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).endsAt).toBe(+endsAt);
    expect(await prisma.notification.count({ where: { userId: provider.userId, template: "shift_change_request" } })).toBe(1);
    await expect(shiftChanges.changeShift(clinic.actor, shiftId, { startsAt, endsAt: new Date(+endsAt - 3 * HOUR) })).rejects.toThrow(/already waiting/);

    await shiftChanges.respondToShiftChange(provider.actor, (r as { changeId: string }).changeId, true);
    const a1 = (await live(shiftId))!;
    expect(a1.id).toBe(a0.id);
    expect(+a1.endsAt).toBe(+endsAt - 5 * HOUR);
    expect(a1.clinicTotalCents).toBeLessThan(a0.clinicTotalCents);
    expect(a1.providerTotalCents).toBeLessThan(a0.providerTotalCents);
    const payout = await prisma.payout.findFirstOrThrow({ where: { assignmentId: a1.id, kind: "SHIFT" } });
    expect(payout.amountCents).toBe(a1.providerTotalCents);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).status).toBe("CONFIRMED");
  });

  it("declined: change applied, provider released with no penalty, deposit refunded, shift reopens", async () => {
    const { clinic, provider, shiftId, startsAt, endsAt } = await setup(true);
    const a0 = (await live(shiftId))!;
    const deposit = await prisma.payment.findFirstOrThrow({ where: { assignmentId: a0.id, type: "DEPOSIT", status: "SUCCEEDED" } });
    const r = (await shiftChanges.changeShift(clinic.actor, shiftId, { startsAt: new Date(+startsAt + HOUR), endsAt: new Date(+endsAt + HOUR) })) as { changeId: string };
    await shiftChanges.respondToShiftChange(provider.actor, r.changeId, false);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: a0.id } });
    expect(a.status).toBe("CANCELLED");
    expect(a.cancelledBy).toBe("CLINIC");
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.status).toBe("OPEN");
    expect(+shift.startsAt).toBe(+startsAt + HOUR);
    const stats = await prisma.providerStats.findUnique({ where: { providerId: provider.id } });
    expect(stats?.lateCancels ?? 0).toBe(0);
    const refunds = await prisma.payment.findMany({ where: { assignmentId: a0.id, type: "REFUND" } });
    expect(refunds.reduce((x, p) => x + p.amountCents, 0)).toBe(deposit.amountCents);
    expect((await prisma.shiftChange.findUniqueOrThrow({ where: { id: r.changeId } })).status).toBe("DECLINED");
  });

  it("no answer by the deadline counts as a decline; a withdrawn change can't be answered", async () => {
    const { clinic, provider, shiftId, startsAt, endsAt } = await setup(true);
    const r = (await shiftChanges.changeShift(clinic.actor, shiftId, { startsAt, endsAt: new Date(+endsAt - HOUR) })) as { changeId: string };
    await shiftChanges.withdrawShiftChange(clinic.actor, r.changeId);
    await expect(shiftChanges.respondToShiftChange(provider.actor, r.changeId, true)).rejects.toThrow(/withdrew/);
    expect((await live(shiftId))?.providerId).toBe(provider.id);

    const r2 = (await shiftChanges.changeShift(clinic.actor, shiftId, { startsAt, endsAt: new Date(+endsAt - HOUR) })) as { changeId: string };
    await prisma.shiftChange.update({ where: { id: r2.changeId }, data: { respondBy: new Date(Date.now() - 1000) } });
    await shiftChanges.expireShiftChanges();
    expect((await prisma.shiftChange.findUniqueOrThrow({ where: { id: r2.changeId } })).status).toBe("EXPIRED");
    expect(await live(shiftId)).toBeNull();
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).status).toBe("OPEN");
  });

  it("too close to the start: confirmed shifts can't be changed", async () => {
    const { clinic, shiftId } = await setup(true);
    const soon = new Date(Date.now() + 3 * HOUR);
    await expect(shiftChanges.changeShift(clinic.actor, shiftId, { startsAt: soon, endsAt: new Date(+soon + 8 * HOUR) })).rejects.toThrow(/hours before they start/);
  });

  it("emergency cover in progress can't be changed (it carries a rescue bonus)", async () => {
    const { clinic, shiftId, startsAt, endsAt } = await setup(false);
    await prisma.shift.update({ where: { id: shiftId }, data: { emergencyAt: new Date() } });
    await expect(shiftChanges.changeShift(clinic.actor, shiftId, { startsAt, endsAt: new Date(+endsAt - HOUR) })).rejects.toThrow(/urgently finding cover/);
    expect(shiftChanges.canChange(await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } }))).toBe(false);
  });

  it("another clinic can't change it, and an unchanged form is refused", async () => {
    const { shiftId, startsAt, endsAt, clinic } = await setup(false);
    const other = await makeClinic();
    await expect(shiftChanges.changeShift(other.actor, shiftId, { startsAt, endsAt })).rejects.toThrow(/not found/i);
    await expect(shiftChanges.changeShift(clinic.actor, shiftId, { startsAt, endsAt })).rejects.toThrow(/Nothing has changed/);
  });
});
