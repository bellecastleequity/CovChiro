import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, createShift, selectApplicant, setClock, timeclock } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const HOUR = 3_600_000;
type Clinic = Awaited<ReturnType<typeof makeClinic>>;
type Provider = Awaited<ReturnType<typeof makeProvider>>;

async function booked(days: number): Promise<{ clinic: Clinic; provider: Provider; assignmentId: string; startsAt: Date; endsAt: Date }> {
  const clinic = await makeClinic();
  const provider = await makeProvider();
  const { startsAt, endsAt } = futureWeekday(days);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
  await applyToShift(provider.actor, shiftId, { commit: true });
  const { assignmentId } = await selectApplicant(clinic.actor, shiftId, provider.id);
  return { clinic, provider, assignmentId, startsAt, endsAt };
}
const at = (d: Date, mins: number) => () => new Date(+d + mins * 60_000);

afterEach(() => setClock(null));

describe("time clock", () => {
  it("in → lunch → back → out submits the timesheet; the clinic signs off by email link", async () => {
    const { clinic, provider, assignmentId, startsAt, endsAt } = await booked(40);
    await expect(timeclock.punch(clinic.actor, assignmentId, "IN")).rejects.toThrow(/not found/i);

    setClock(at(startsAt, -90));
    await expect(timeclock.punch(provider.actor, assignmentId, "IN")).rejects.toThrow(/minutes before/);
    setClock(at(startsAt, -5));
    const loc = clinic.location;
    const r = await timeclock.punch(provider.actor, assignmentId, "IN", { lat: loc.lat, lng: loc.lng, accuracyM: 12 });
    expect(r.distanceMiles).toBe(0);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).arrivedAt).toBeTruthy();
    await expect(timeclock.punch(provider.actor, assignmentId, "BREAK_END")).rejects.toThrow(/fit/);
    setClock(at(startsAt, 240));
    await timeclock.punch(provider.actor, assignmentId, "BREAK_START");
    setClock(at(startsAt, 270));
    await expect(timeclock.punch(provider.actor, assignmentId, "OUT")).rejects.toThrow(/End your lunch/);
    await timeclock.punch(provider.actor, assignmentId, "BREAK_END");
    setClock(at(endsAt, 2));
    await timeclock.punch(provider.actor, assignmentId, "OUT");

    const t = await prisma.timesheet.findUniqueOrThrow({ where: { assignmentId } });
    const span = (+endsAt - +startsAt) / 60_000;
    expect(t).toMatchObject({ status: "SUBMITTED", breakMinutes: 30, workedMinutes: span + 7 - 30, flags: [] });
    expect(await prisma.notification.count({ where: { template: "timesheet_submitted", user: { clinicMembers: { some: { clinicOrgId: clinic.org.id } } } } })).toBe(1);

    const token = timeclock.timesheetToken(assignmentId);
    await expect(timeclock.approveByToken(`${assignmentId}.forged`, { approverName: "Pat Lee" })).rejects.toThrow(/isn't valid/);
    await expect(timeclock.approveByToken(token, { approverName: "P" })).rejects.toThrow(/full name/);
    await timeclock.approveByToken(token, { approverName: "Pat Lee", approverTitle: "Office manager", ip: "203.0.113.1" });
    expect(await prisma.timesheet.findUniqueOrThrow({ where: { assignmentId } })).toMatchObject({ status: "APPROVED", approvalMethod: "EMAIL_LINK", approverName: "Pat Lee", approverIp: "203.0.113.1" });
    await expect(timeclock.punch(provider.actor, assignmentId, "IN")).rejects.toThrow(/signed off/);
  });

  it("flags far-away and hand-entered punches; a manager can sign on the provider's phone", async () => {
    const { clinic, provider, assignmentId, startsAt, endsAt } = await booked(41);
    setClock(at(startsAt, 20));
    await timeclock.punch(provider.actor, assignmentId, "IN", { lat: clinic.location.lat + 0.05, lng: clinic.location.lng });
    setClock(at(endsAt, 30));
    await timeclock.addMissedPunch(provider.actor, assignmentId, "OUT", new Date(+endsAt), "Forgot to tap out at 5");
    const t = await prisma.timesheet.findUniqueOrThrow({ where: { assignmentId } });
    expect(t.status).toBe("SUBMITTED");
    expect(t.flags).toEqual(expect.arrayContaining(["punched in 20 min late", "times added by hand"]));
    expect(t.flags.some((f) => /mi from the clinic/.test(f))).toBe(true);

    await expect(timeclock.approveOnsite(provider.actor, assignmentId, { approverName: "Dr. Owner" })).rejects.toThrow(/sign in the box/);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    await timeclock.approveOnsite(provider.actor, assignmentId, { approverName: "Dr. Owner", signature: png });
    expect(await prisma.timesheet.findUniqueOrThrow({ where: { assignmentId } })).toMatchObject({ status: "APPROVED", approvalMethod: "ONSITE", signature: png });
    expect(await prisma.notification.count({ where: { template: "timesheet_signed_onsite" } })).toBeGreaterThan(0);
  });

  it("“Something's wrong” opens a dispute and stops auto-approval", async () => {
    const { clinic, provider, assignmentId, startsAt, endsAt } = await booked(42);
    setClock(at(startsAt, 0));
    await timeclock.punch(provider.actor, assignmentId, "IN");
    // Real time must be inside the dispute window (openDispute uses the wall clock): move the shift.
    setClock(at(endsAt, 0));
    await timeclock.punch(provider.actor, assignmentId, "OUT");
    setClock(null);
    await prisma.assignment.update({ where: { id: assignmentId }, data: { status: "IN_PROGRESS", endsAt: new Date(Date.now() - HOUR), startsAt: new Date(Date.now() - 9 * HOUR) } }).catch(() => undefined);
    await timeclock.reportAsClinic(clinic.actor, assignmentId, "Provider left around 3pm");
    const t = await prisma.timesheet.findUniqueOrThrow({ where: { assignmentId } });
    expect(t.status).toBe("DISPUTED");
    expect(await prisma.dispute.count({ where: { assignmentId, status: "OPEN" } })).toBe(1);
    await timeclock.timeclockSweep(new Date(Date.now() + 100 * HOUR));
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { assignmentId } })).status).toBe("DISPUTED");
  });

  it("sweep closes a forgotten punch-out, reminds once, then auto-approves", async () => {
    const { provider, assignmentId, startsAt, endsAt } = await booked(43);
    setClock(at(startsAt, 0));
    await timeclock.punch(provider.actor, assignmentId, "IN");
    setClock(at(startsAt, 200));
    await timeclock.punch(provider.actor, assignmentId, "BREAK_START");
    setClock(null);
    await prisma.assignment.update({ where: { id: assignmentId }, data: { status: "IN_PROGRESS" } }).catch(() => undefined);

    const after = (h: number) => new Date(+endsAt + h * HOUR);
    await timeclock.timeclockSweep(after(4));
    let t = await prisma.timesheet.findUniqueOrThrow({ where: { assignmentId } });
    expect(t.status).toBe("SUBMITTED");
    expect(t.flags).toContain("no punch-out: closed at the scheduled end");
    expect(await prisma.timePunch.count({ where: { assignmentId, source: "AUTO" } })).toBe(2);

    await timeclock.timeclockSweep(after(30));
    await timeclock.timeclockSweep(after(31));
    t = await prisma.timesheet.findUniqueOrThrow({ where: { assignmentId } });
    expect(t.remindedAt).toBeTruthy();
    await timeclock.timeclockSweep(after(60));
    expect(await prisma.timesheet.findUniqueOrThrow({ where: { assignmentId } })).toMatchObject({ status: "APPROVED", approvalMethod: "AUTO" });
  });
});
