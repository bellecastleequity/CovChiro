import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { adminAssign, bookings, feedback, setBlock, setFavorite } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const ADMIN = { userId: null, role: "PLATFORM_ADMIN" as const };
const actorOf = async (providerId: string) => {
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  return { userId: p.userId, role: "PROVIDER" as const, providerId, clinicOrgId: null };
};

async function booking(n: number, firstDay = 30) {
  const clinic = await makeClinic();
  const first = futureWeekday(firstDay);
  const days = Array.from({ length: n }, (_, i) => {
    const shift = i * 7 * 86_400_000; // a week apart, same weekday
    return { locationId: clinic.location.id, professionCode: "DC", startsAt: new Date(+first.startsAt + shift), endsAt: new Date(+first.endsAt + shift) };
  });
  const r = await bookings.createMultiDay(clinic.actor, days, { post: true });
  return { clinic, ...r };
}

describe("multi-day bookings", () => {
  it("creates one shift per day in a group; each day is priced and posted on its own", async () => {
    const { groupId, shiftIds } = await booking(3);
    expect(groupId).toBeTruthy();
    const shifts = await prisma.shift.findMany({ where: { id: { in: shiftIds } } });
    expect(shifts).toHaveLength(3);
    expect(shifts.every((s) => s.shiftGroupId === groupId && s.clinicPriceCents > 0 && s.status !== "DRAFT")).toBe(true);
  });

  it("rejects overlapping days before creating anything", async () => {
    const clinic = await makeClinic();
    const { startsAt, endsAt } = futureWeekday(40);
    const day = { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt };
    const before = await prisma.shiftGroup.count();
    await expect(bookings.createMultiDay(clinic.actor, [day, { ...day }], { post: true })).rejects.toThrow(/overlap/);
    expect(await prisma.shiftGroup.count()).toBe(before);
  });

  it("apply to all days → confirm for all days → one 'fully covered' summary for the clinic", async () => {
    const { clinic, shiftIds } = await booking(3, 50);
    const p = await makeProvider();
    const r = await bookings.applyToAllDays(await actorOf(p.id), shiftIds[0], { note: null, commit: true });
    expect(r.applied).toBe(3);
    const c = await bookings.confirmForAllDays(clinic.actor, shiftIds[1], p.id);
    expect(c.confirmed).toBe(3);
    const covered = await prisma.notification.findMany({ where: { userId: clinic.user.id, template: "booking_covered" } });
    expect(covered).toHaveLength(1);
    expect(covered[0].title).toMatch(/3-day booking is fully covered/);
  });

  it("cancel 'this and all my remaining days' releases each day and sends the clinic one email", async () => {
    const { clinic, shiftIds } = await booking(3, 70);
    const p = await makeProvider();
    const ids = [];
    for (const s of shiftIds) ids.push((await adminAssign(ADMIN, s, p.id)).assignmentId);
    const r = await bookings.cancelBookingDays(await actorOf(p.id), ids[1], "Family emergency", "remaining");
    expect(r.cancelled).toBe(2);
    const statuses = await prisma.assignment.findMany({ where: { id: { in: ids } }, orderBy: { startsAt: "asc" }, select: { status: true } });
    expect(statuses.map((x) => x.status)).toEqual(["CONFIRMED", "CANCELLED", "CANCELLED"]);
    const reopened = await prisma.shift.findMany({ where: { id: { in: shiftIds.slice(1) } } });
    expect(reopened.every((s) => s.status !== "CONFIRMED")).toBe(true);
    const notes = await prisma.notification.findMany({ where: { userId: clinic.user.id, template: "booking_cancelled_days" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/cancellation for 2 days/);
  });

  it("cancel 'just this day' leaves the other days booked", async () => {
    const { shiftIds } = await booking(2, 90);
    const p = await makeProvider();
    const ids = [];
    for (const s of shiftIds) ids.push((await adminAssign(ADMIN, s, p.id)).assignmentId);
    await bookings.cancelBookingDays(await actorOf(p.id), ids[0], "Conflict", "day");
    const rows = await prisma.assignment.findMany({ where: { id: { in: ids } }, orderBy: { startsAt: "asc" }, select: { status: true } });
    expect(rows.map((x) => x.status)).toEqual(["CANCELLED", "CONFIRMED"]);
  });
});

describe("clinic ↔ provider relationships", () => {
  it("favorite and block are mutually exclusive", async () => {
    const { clinic, shiftIds } = await booking(2, 130);
    const p = await makeProvider();
    const { assignmentId } = await adminAssign(ADMIN, shiftIds[0], p.id);
    await prisma.assignment.update({ where: { id: assignmentId }, data: { status: "COMPLETED", completedAt: new Date() } });
    await setFavorite(clinic.actor, p.id, true);
    await setBlock(clinic.actor, p.id, true, "Not a fit");
    const q = { fromType: "CLINIC" as const, fromId: clinic.org.id, toType: "PROVIDER" as const, toId: p.id };
    expect(await prisma.favorite.count({ where: q })).toBe(0);
    expect(await prisma.block.count({ where: q })).toBe(1);
    await setFavorite(clinic.actor, p.id, true);
    expect(await prisma.block.count({ where: q })).toBe(0);
    expect(await prisma.favorite.count({ where: q })).toBe(1);
  });

  it("private feedback is visible only to the provider it's about", async () => {
    const { shiftIds, clinic } = await booking(2, 110);
    const [p, other] = [await makeProvider(), await makeProvider()];
    const { assignmentId } = await adminAssign(ADMIN, shiftIds[0], p.id);
    await prisma.assignment.update({ where: { id: assignmentId }, data: { status: "COMPLETED", completedAt: new Date() } });
    await feedback.submitFeedback(clinic.actor, assignmentId, "Great with patients. Could arrive 10 minutes earlier. Call me at 555-123-4567");
    const mine = await feedback.myFeedback(await actorOf(p.id));
    expect(mine).toHaveLength(1);
    expect(mine[0].body).not.toMatch(/555-123-4567/);
    expect(await feedback.myFeedback(await actorOf(other.id))).toHaveLength(0);
  });
});
