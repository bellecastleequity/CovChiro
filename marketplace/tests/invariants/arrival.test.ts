import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, attendance, createShift, selectApplicant, setClock, timeclock } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

afterEach(() => setClock(null));

async function booked(days: number) {
  const clinic = await makeClinic();
  const provider = await makeProvider();
  const { startsAt, endsAt } = futureWeekday(days);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
  await applyToShift(provider.actor, shiftId, { commit: true });
  const { assignmentId } = await selectApplicant(clinic.actor, shiftId, provider.id);
  return { clinic, provider, assignmentId, startsAt };
}

describe("On my way arrival time", () => {
  it("starts the arrival time at On my way, refreshes at most every 2 minutes, texts the clinic once near, and stops at clock-in", async () => {
    const { clinic, provider, assignmentId, startsAt } = await booked(43);
    const loc = clinic.location;
    const t0 = new Date(+startsAt - 40 * 60_000);
    setClock(() => t0);
    // ~14 miles north of the clinic.
    const msg = await attendance.markOnMyWay(provider.actor, assignmentId, { lat: loc.lat! + 0.2, lng: loc.lng! });
    expect(msg).toMatch(/arriving around/);
    const a1 = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a1.onMyWayAt).not.toBeNull();
    expect(a1.etaAt).not.toBeNull();
    expect(+a1.etaAt! - +t0).toBeGreaterThan(15 * 60_000);
    expect(a1.etaMiles).toBeGreaterThan(10);
    const onWay = await prisma.notification.findFirstOrThrow({ where: { userId: clinic.user.id, template: "provider_on_way" } });
    expect(onWay.title).toMatch(/arriving around/);

    // Within 2 minutes: no new lookup.
    setClock(() => new Date(+t0 + 60_000));
    const same = await attendance.reportPosition(provider.actor, assignmentId, { lat: loc.lat! + 0.1, lng: loc.lng! });
    expect(same.sharing).toBe(true);
    expect(same.miles).toBe(a1.etaMiles);

    // Later, at the door: the clinic is texted once.
    setClock(() => new Date(+t0 + 25 * 60_000));
    const near = await attendance.reportPosition(provider.actor, assignmentId, { lat: loc.lat! + 0.001, lng: loc.lng! });
    expect(near.miles).toBe(0);
    setClock(() => new Date(+t0 + 28 * 60_000));
    await attendance.reportPosition(provider.actor, assignmentId, { lat: loc.lat!, lng: loc.lng! });
    const almost = await prisma.notification.findMany({ where: { userId: clinic.user.id, template: "provider_almost_there" } });
    expect(almost).toHaveLength(1);
    expect(almost[0].title).toMatch(/arriving now/);

    // Clock-in ends sharing.
    setClock(() => new Date(+startsAt - 5 * 60_000));
    await timeclock.punch(provider.actor, assignmentId, "IN");
    expect((await attendance.reportPosition(provider.actor, assignmentId, { lat: loc.lat!, lng: loc.lng! })).sharing).toBe(false);
  });

  it("works without a position, only for the booked provider, and never stores the position", async () => {
    const { provider, assignmentId, startsAt } = await booked(44);
    setClock(() => new Date(+startsAt - 30 * 60_000));
    expect(await attendance.markOnMyWay(provider.actor, assignmentId, null)).toMatch(/let the clinic know/);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).etaAt).toBeNull();
    const other = await makeProvider();
    await expect(attendance.reportPosition(other.actor, assignmentId, { lat: 28.5, lng: -81.4 })).rejects.toThrow(/not found/i);
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name::text FROM information_schema.columns WHERE table_name = 'Assignment'`);
    expect(cols.map((c) => c.column_name).filter((c) => /lat|lng/i.test(c))).toEqual([]);
  });
});
