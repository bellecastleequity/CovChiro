import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { concentration } from "@cm/services";
import { insertAssignment, makeClinic, makeProvider, makeShift } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const DAY = 86_400_000;

/** A booked shift for this provider `daysAgo` days back (inserted ahead, then moved into the past). */
async function pastShift(locationId: string, providerId: string, daysAgo: number, k: number) {
  const sh = await makeShift(locationId, { days: 60 + k * 7 });
  const a = await insertAssignment(sh.id, providerId);
  const startsAt = new Date(Date.now() - daysAgo * DAY);
  startsAt.setUTCHours(13, 0, 0, 0);
  const endsAt = new Date(+startsAt + 8 * 3_600_000);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Assignment" DISABLE TRIGGER USER`);
  try {
    await prisma.shift.update({ where: { id: sh.id }, data: { startsAt, endsAt, status: "COMPLETED" } });
    await prisma.assignment.update({ where: { id: a.id }, data: { startsAt, endsAt, status: "COMPLETED" } });
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Assignment" ENABLE TRIGGER USER`);
  }
}

describe("shift concentration", () => {
  it("shows a market's top providers and shares, and flags providers working 5+ days a week", async () => {
    const clinic = await makeClinic();
    const busy = await makeProvider();
    const other = await makeProvider();
    // Busy: 21 days in the last 4 weeks (5.25 a week). Other: 2 shifts.
    for (let i = 0; i < 21; i++) await pastShift(clinic.location.id, busy.id, 1 + i, i);
    await pastShift(clinic.location.id, other.id, 2, 30);
    await pastShift(clinic.location.id, other.id, 3, 31);

    const r = await concentration.shiftConcentration(admin);
    const heavy = r.heavy.find((h) => h.providerId === busy.id);
    expect(heavy?.daysPerWeek).toBeGreaterThanOrEqual(5);
    expect(r.heavy.some((h) => h.providerId === other.id)).toBe(false);
    const market = r.markets.find((m) => m.top.some((t) => t.providerId === busy.id))!;
    expect(market.top[0].providerId).toBe(busy.id);
    expect(market.top1Share).toBeGreaterThan(0.5);
    expect(r.spreadWork.percent).toBe(0); // off by default
  });
});
