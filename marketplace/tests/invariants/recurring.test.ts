import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { adminAssign, recurring } from "@cm/services";
import { makeClinic, makeProvider, makeShift } from "../factories";

const ADMIN = { userId: null, role: "PLATFORM_ADMIN" as const };
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const H = 3_600_000;

describe("recurring open postings", () => {
  it("posts each matching day ahead as an open shift, never inside the lead time, and is idempotent", async () => {
    const clinic = await makeClinic();
    const r = await recurring.createRecurring(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "13:00", endTime: "17:00", startsOn: isoIn(0), expectedPatients: 12, notes: "PI afternoons" });
    const shifts = await prisma.shift.findMany({ where: { recurringPostingId: r.id }, orderBy: { startsAt: "asc" } });
    expect(r.posted).toBe(shifts.length);
    expect(shifts.length).toBeGreaterThanOrEqual(16); // ~3 weeks minus the first 3 days
    expect(shifts.every((s) => +s.startsAt >= Date.now() + 72 * H - 60_000)).toBe(true);
    expect(shifts.every((s) => ["OPEN", "FAVORITES_ONLY"].includes(s.status) && s.expectedPatients === 12 && s.notes === "PI afternoons" && s.clinicPriceCents > 0)).toBe(true);
    expect(new Set(shifts.map((s) => s.startsAt.toISOString().slice(0, 10))).size).toBe(shifts.length);
    expect((await recurring.generateRecurring(r.id)).posted).toBe(0);
    expect(await recurring.recurringSweep()).toBe(0);
  });

  it("invites whoever covered the series last when a new day is posted", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const r = await recurring.createRecurring(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", weekdays: [1, 2, 3, 4, 5], startTime: "13:00", endTime: "17:00", startsOn: isoIn(0), endsOn: isoIn(8) });
    const first = await prisma.shift.findFirstOrThrow({ where: { recurringPostingId: r.id }, orderBy: { startsAt: "asc" } });
    const { assignmentId } = await adminAssign(ADMIN, first.id, provider.id);
    await prisma.assignment.update({ where: { id: assignmentId }, data: { status: "COMPLETED", completedAt: new Date() } });
    // Extending the end date posts the new days; each gets an invitation to that provider.
    const u = await recurring.updateRecurring(clinic.actor, r.id, { weekdays: [1, 2, 3, 4, 5], startTime: "13:00", endTime: "17:00", startsOn: isoIn(0), endsOn: isoIn(20) });
    expect(u.posted).toBeGreaterThan(0);
    expect(u.invited).toBe(u.posted);
    const offers = await prisma.offer.findMany({ where: { providerId: provider.id, shift: { recurringPostingId: r.id } } });
    expect(offers.length).toBe(u.posted);
    expect(offers.every((o) => o.source === "CLINIC_PICK" && o.status === "PENDING")).toBe(true);
  });

  it("editing takes down open days that no longer fit; ending keeps booked days and takes down the rest", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    await makeShift(clinic.location.id, { days: 60 });
    const r = await recurring.createRecurring(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", weekdays: [2, 4], startTime: "13:00", endTime: "17:00", startsOn: isoIn(0) });
    const before = await prisma.shift.count({ where: { recurringPostingId: r.id, status: { not: "CANCELLED" } } });
    const u = await recurring.updateRecurring(clinic.actor, r.id, { weekdays: [4], startTime: "13:00", endTime: "17:00", startsOn: isoIn(0) });
    expect(u.takenDown).toBeGreaterThan(0);
    const live = await prisma.shift.findMany({ where: { recurringPostingId: r.id, status: { not: "CANCELLED" } }, include: { location: true } });
    expect(live.length).toBe(before - u.takenDown);
    const wd = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
    expect(live.every((s) => wd(s.startsAt, s.location.timeZone) === "Thu")).toBe(true);

    const booked = live[0];
    await adminAssign(ADMIN, booked.id, provider.id);
    const e = await recurring.endRecurring(clinic.actor, r.id, true);
    expect(e.takenDown).toBe(live.length - 1);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: booked.id } })).status).toBe("CONFIRMED");
    expect(await prisma.shift.count({ where: { recurringPostingId: r.id, status: { not: "CANCELLED" } } })).toBe(1);
    expect((await recurring.generateRecurring(r.id)).posted).toBe(0);
  });

  it("pauses and tells the clinic when it can't post (agreement not signed), then catches up", async () => {
    const clinic = await makeClinic();
    const signed = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinic.org.id } });
    const r = await recurring.createRecurring(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", weekdays: [3], startTime: "09:00", endTime: "13:00", startsOn: isoIn(0), endsOn: isoIn(1) });
    await prisma.clinicOrg.update({ where: { id: clinic.org.id }, data: { agreementSignedAt: null } });
    await recurring.updateRecurring(clinic.actor, r.id, { weekdays: [3], startTime: "09:00", endTime: "13:00", startsOn: isoIn(0), endsOn: isoIn(20) });
    const row = await prisma.recurringPosting.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.lastError).toMatch(/Agreement/);
    expect(await prisma.shift.count({ where: { recurringPostingId: r.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { template: "recurring_paused" } })).toBeGreaterThan(0);
    await prisma.clinicOrg.update({ where: { id: clinic.org.id }, data: { agreementSignedAt: signed.agreementSignedAt } });
    expect((await recurring.generateRecurring(r.id)).posted).toBeGreaterThan(0);
    expect((await prisma.recurringPosting.findUniqueOrThrow({ where: { id: r.id } })).lastError).toBeNull();
  });

  it("only the clinic's own postings", async () => {
    const a = await makeClinic();
    const b = await makeClinic();
    const r = await recurring.createRecurring(a.actor, { locationId: a.location.id, professionCode: "DC", weekdays: [1], startTime: "13:00", endTime: "17:00", startsOn: isoIn(0), endsOn: isoIn(2) });
    await expect(recurring.endRecurring(b.actor, r.id, true)).rejects.toThrow(/not found/);
    await expect(recurring.createRecurring(a.actor, { locationId: b.location.id, professionCode: "DC", weekdays: [1], startTime: "13:00", endTime: "17:00", startsOn: isoIn(0) })).rejects.toThrow(/not found/);
  });
});
