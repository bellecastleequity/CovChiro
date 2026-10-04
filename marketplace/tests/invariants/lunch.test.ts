import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { createShift, evaluateProviderForShift, quoteForClinic, shiftChanges } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

/** Unpaid lunch: priced on paid hours; a day past 9.5 h start to finish pays the extra as overtime. */

const HOUR = 3_600_000;

describe("Unpaid lunch on shifts", () => {
  it("an 8–5 day with an hour's lunch is priced as a plain full day; without lunch it's overtime", async () => {
    const clinic = await makeClinic();
    const { startsAt } = futureWeekday(20, 12, 9); // 9 hours start to finish
    const endsAt = new Date(+startsAt + 9 * HOUR);
    const base = { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt };
    const none = await quoteForClinic(clinic.actor, base);
    const lunch = await quoteForClinic(clinic.actor, { ...base, lunchMinutes: 60, lunchStartsAt: new Date(+startsAt + 4 * HOUR) });
    expect(none.overtimeHours).toBe(1);
    expect(lunch.overtimeHours).toBe(0);
    expect(lunch.tier).toBe("FULL_DAY");
    expect(lunch.coverageCents).toBeLessThan(none.coverageCents);

    // A 3-hour lunch on an 11-hour day: 1.5 h past the 9.5-hour limit is paid.
    const long = await quoteForClinic(clinic.actor, { ...base, endsAt: new Date(+startsAt + 11 * HOUR), lunchMinutes: 180, lunchStartsAt: new Date(+startsAt + 4 * HOUR) });
    expect(long.overtimeHours).toBe(1.5);
  });

  it("stores the lunch, uses paid hours for the provider's minimum hourly pay, and refuses a lunch outside the shift", async () => {
    const clinic = await makeClinic();
    const { startsAt } = futureWeekday(22, 12, 9);
    const endsAt = new Date(+startsAt + 9 * HOUR);
    const lunchStartsAt = new Date(+startsAt + 4 * HOUR);
    await expect(createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, lunchMinutes: 60, lunchStartsAt: new Date(+endsAt - 30 * 60_000) }, { post: true })).rejects.toThrow(/end before/);
    await expect(createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, lunchMinutes: 60 }, { post: true })).rejects.toThrow(/when lunch starts/);
    const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, lunchMinutes: 60, lunchStartsAt }, { post: true });
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift.lunchMinutes).toBe(60);
    expect(+shift.lunchStartsAt!).toBe(+lunchStartsAt);

    const provider = await makeProvider();
    const ev = await evaluateProviderForShift(prisma, provider.id, shiftId);
    expect(ev.shift.facts.pay?.billableHours).toBe(8); // 9 h minus the hour's lunch
  });

  it("a shift change can move the lunch with the hours, and must when the old lunch no longer fits", async () => {
    const clinic = await makeClinic();
    const { startsAt } = futureWeekday(24, 12, 9);
    const endsAt = new Date(+startsAt + 9 * HOUR);
    const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, lunchMinutes: 60, lunchStartsAt: new Date(+startsAt + 4 * HOUR) }, { post: true });
    // Ending at 11:00 leaves the 12:00 lunch outside the shift.
    await expect(shiftChanges.changeShift(clinic.actor, shiftId, { startsAt, endsAt: new Date(+startsAt + 3 * HOUR) })).rejects.toThrow(/lunch break/);
    const r = await shiftChanges.changeShift(clinic.actor, shiftId, { startsAt, endsAt: new Date(+startsAt + 3 * HOUR), lunchMinutes: 0 });
    expect(r.status).toBe("applied");
    const after = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(after.lunchMinutes).toBe(0);
    expect(after.lunchStartsAt).toBeNull();
    expect(after.durationTier).toBe("HALF_DAY");
  });
});
