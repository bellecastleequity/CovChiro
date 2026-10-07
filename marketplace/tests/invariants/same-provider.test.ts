import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, bookings, dispatch, getEligibleProviders, inviteProviders, sameProvider } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

async function booking(firstDay: number, n = 3, same?: boolean) {
  const clinic = await makeClinic();
  const first = futureWeekday(firstDay);
  const days = Array.from({ length: n }, (_, i) => ({ locationId: clinic.location.id, professionCode: "DC", startsAt: new Date(+first.startsAt + i * 86_400_000), endsAt: new Date(+first.endsAt + i * 86_400_000), ...(same === undefined ? {} : { sameProvider: same }) }));
  const r = await bookings.createMultiDay(clinic.actor, days, { post: true });
  return { clinic, ...r };
}

describe("same provider for all days", () => {
  it("is on by default; providers apply for every day or none; the clinic confirms all days at once", async () => {
    const { clinic, groupId, shiftIds } = await booking(200);
    expect((await prisma.shiftGroup.findUniqueOrThrow({ where: { id: groupId! } })).sameProviderRequired).toBe(true);
    const p = await makeProvider();
    await expect(applyToShift(p.actor, shiftIds[1], { note: null, commit: true })).rejects.toThrow(/one provider for every day/);
    expect((await bookings.applyToAllDays(p.actor, shiftIds[0], { note: null, commit: true })).applied).toBe(3);
    const cov = await sameProvider.groupCoverage(groupId!);
    expect(cov.fullApplicants).toContain(p.id);
    expect(cov.allDays).toBeLessThanOrEqual(cov.anyDay);
    // Picking them on any one day confirms every day.
    await bookings.confirmForAllDays(clinic.actor, shiftIds[2], p.id);
    expect(await prisma.assignment.count({ where: { providerId: p.id, shiftId: { in: shiftIds }, status: "CONFIRMED" } })).toBe(3);
    expect(await sameProvider.lockedGroupId(prisma, shiftIds[0])).toBeNull();
  });

  it("a provider who can't take one of the days can't apply; Smart Dispatch waits; invitations ask for the whole booking", async () => {
    const { clinic, groupId, shiftIds } = await booking(210);
    const busy = await makeProvider();
    const day2 = await prisma.shift.findUniqueOrThrow({ where: { id: shiftIds[1] } });
    await prisma.availabilityBlackout.create({ data: { providerId: busy.id, startsAt: new Date(+day2.startsAt - 3_600_000), endsAt: new Date(+day2.endsAt + 3_600_000) } });
    await expect(bookings.applyToAllDays(busy.actor, shiftIds[0], { note: null, commit: true })).rejects.toThrow(/can't take 1 of them/);
    expect(await prisma.application.count({ where: { providerId: busy.id, status: "ACTIVE" } })).toBe(0);
    expect((await dispatch.startDispatch(shiftIds[0], "URGENT_POST")).state).toMatch(/same provider/);
    const free = await makeProvider();
    expect((await getEligibleProviders(prisma, shiftIds[0])).eligible.map((e) => e.providerId)).toContain(free.id);
    const r = await inviteProviders(clinic.actor, shiftIds[0], [free.id, busy.id]);
    expect(r).toMatchObject({ allDays: true, invited: 1, skipped: 1 });
    expect(await prisma.offer.count({ where: { shiftId: { in: shiftIds } } })).toBe(0);
    void groupId;
  });

  it("at the deadline: confirms a full applicant; otherwise asks the clinic, then splits after the wait", async () => {
    {
      const a = await booking(220);
      const p = await makeProvider();
      await bookings.applyToAllDays(p.actor, a.shiftIds[0], { note: null, commit: true });
      await prisma.shift.updateMany({ where: { id: { in: a.shiftIds } }, data: { selectionDeadline: new Date(Date.now() - 60_000) } });
      await dispatch.runSelectionDeadlines();
      expect(await prisma.assignment.count({ where: { providerId: p.id, shiftId: { in: a.shiftIds }, status: "CONFIRMED" } })).toBe(3);

      const b = await booking(230);
      await prisma.shift.updateMany({ where: { id: { in: b.shiftIds } }, data: { selectionDeadline: new Date(Date.now() - 60_000) } });
      await dispatch.runSelectionDeadlines();
      const asked = await prisma.shiftGroup.findUniqueOrThrow({ where: { id: b.groupId! } });
      expect(asked.splitAskedAt).not.toBeNull();
      expect(asked.splitAt).toBeNull();
      expect(await prisma.notification.count({ where: { userId: b.clinic.user.id, template: "booking_split_ask" } })).toBe(1);
      expect(await prisma.dispatch.count({ where: { shiftId: { in: b.shiftIds } } })).toBe(0);
      // After the wait it's split, and the days are then filled one by one.
      await dispatch.runSelectionDeadlines(new Date(Date.now() + 5 * 3_600_000));
      const split = await prisma.shiftGroup.findUniqueOrThrow({ where: { id: b.groupId! } });
      expect(split).toMatchObject({ splitBy: "auto" });
      expect(await sameProvider.lockedGroupId(prisma, b.shiftIds[0])).toBeNull();
    }
  });

  it("the clinic can turn it off when posting, or split later", async () => {
    const off = await booking(240, 2, false);
    expect(await sameProvider.lockedGroupId(prisma, off.shiftIds[0])).toBeNull();
    const on = await booking(250, 2);
    expect(await sameProvider.splitGroup(on.clinic.actor, on.groupId!, "clinic")).toBe(true);
    const p = await makeProvider();
    expect((await applyToShift(p.actor, on.shiftIds[1], { note: null, commit: true })).applicationId).toBeTruthy();
  });
});
