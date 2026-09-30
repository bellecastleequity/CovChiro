import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { adminAssign, attendance, setClock } from "@cm/services";
import { makeClinic, makeProvider, makeShift } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const H = 3_600_000;

async function booked(days = 15) {
  const clinic = await makeClinic();
  const p = await makeProvider();
  const shift = await makeShift(clinic.location.id, { days });
  const { assignmentId } = await adminAssign({ ...admin }, shift.id, p.id);
  const at = (hoursBefore: number) => new Date(+shift.startsAt - hoursBefore * H);
  const sweep = async (hoursBefore: number) => {
    setClock(() => at(hoursBefore));
    return attendance.attendanceSweep(at(hoursBefore));
  };
  const row = () => prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  const notes = (userId: string, template: string) => prisma.notification.findMany({ where: { userId, template } });
  return { clinic, p, shift, assignmentId, sweep, row, notes };
}

afterEach(() => setClock(null));

describe("shift reconfirmation", () => {
  it("asks at 48h, reminds once 6h later, and a confirmed provider keeps the shift", async () => {
    const b = await booked();
    await b.sweep(49);
    expect((await b.row()).reconfirmRequestedAt).toBeNull();
    await b.sweep(47.5);
    await b.sweep(47); // next tick: no second ask
    const ask = await b.notes(b.p.userId, "reconfirm_ask");
    expect(ask).toHaveLength(1);
    expect(ask[0].link).toMatch(/^\/c\//);
    await b.sweep(44); // 3.5h after the ask: too early
    await b.sweep(41);
    await b.sweep(40);
    expect(await b.notes(b.p.userId, "reconfirm_reminder")).toHaveLength(1);
    const token = ask[0].link!.slice(3);
    expect(await attendance.assignmentIdFromToken(token)).toBe(b.assignmentId);
    await attendance.reconfirmAttendance(null, b.assignmentId);
    await b.sweep(23);
    expect((await b.row()).status).toBe("CONFIRMED");
  });

  it("missing the deadline releases the provider (late cancel), reopens the shift and tells the clinic", async () => {
    const b = await booked(16);
    await b.sweep(47);
    await b.sweep(23.5);
    const a = await b.row();
    expect(a.status).toBe("CANCELLED");
    expect(a.flags).toContain("RECONFIRM_MISSED");
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: b.shift.id } })).status).not.toBe("BOOKED");
    expect((await prisma.providerStats.findUniqueOrThrow({ where: { providerId: b.p.id } })).lateCancels).toBe(1);
    const clinicNote = await prisma.notification.findFirstOrThrow({ where: { userId: b.clinic.user.id, template: "backfill" } });
    expect(clinicNote.title).toMatch(/We've had a cancellation/);
    expect(clinicNote.body).toMatch(/didn't confirm/);
    expect(await b.notes(b.p.userId, "reconfirm_released")).toHaveLength(1);
    await b.sweep(23); // not twice
    expect(await b.notes(b.p.userId, "reconfirm_released")).toHaveLength(1);
    await expect(attendance.reconfirmAttendance(null, b.assignmentId)).rejects.toThrow(/released/);
  });

  it("two missed reconfirmations pause the provider", async () => {
    const clinic = await makeClinic();
    const p = await makeProvider();
    for (const days of [17, 24]) {
      const shift = await makeShift(clinic.location.id, { days });
      await adminAssign({ ...admin }, shift.id, p.id);
      const at = (h: number) => new Date(+shift.startsAt - h * H);
      setClock(() => at(47));
      await attendance.attendanceSweep(at(47));
      setClock(() => at(23));
      await attendance.attendanceSweep(at(23));
    }
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PAUSED");
    expect(await prisma.adminTask.count({ where: { kind: "RECONFIRM_MISSES", entityId: p.id } })).toBe(1);
  });

  it("a shift booked within 72h of the start isn't asked (the booking is the confirmation)", async () => {
    const b = await booked(18);
    await prisma.assignment.update({ where: { id: b.assignmentId }, data: { confirmedAt: new Date(+b.shift.startsAt - 60 * H) } });
    await b.sweep(47);
    await b.sweep(23);
    expect(await b.notes(b.p.userId, "reconfirm_ask")).toHaveLength(0);
    expect((await b.row()).status).toBe("CONFIRMED");
  });

  it("day of: 'On my way' prompt at 2h; no check-in by 30 min → admins, clinic and provider alerted once", async () => {
    const adminUser = await prisma.user.create({ data: { email: `adm-${Date.now()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
    const b = await booked(19);
    await prisma.assignment.update({ where: { id: b.assignmentId }, data: { reconfirmedAt: new Date() } });
    await b.sweep(1.5);
    expect(await b.notes(b.p.userId, "checkin_prompt")).toHaveLength(1);
    await b.sweep(1);
    expect((await b.row()).checkinAlertedAt).toBeNull();
    await b.sweep(0.4);
    await b.sweep(0.3);
    expect((await b.row()).checkinAlertedAt).not.toBeNull();
    expect(await b.notes(b.p.userId, "checkin_urgent")).toHaveLength(1);
    expect((await b.notes(adminUser.id, "checkin_missing_admin")).filter((n) => n.link === `/admin/shifts/${b.shift.id}`)).toHaveLength(1);
    expect(await b.notes(b.clinic.user.id, "checkin_missing_clinic")).toHaveLength(1);

    const c = await booked(20);
    await c.sweep(1.5);
    await attendance.markOnMyWay(null, c.assignmentId);
    await c.sweep(0.4);
    expect((await c.row()).checkinAlertedAt).toBeNull();
    expect(await c.notes(c.clinic.user.id, "provider_on_way")).toHaveLength(1);
  });

  it("the one-tap link can't be forged", async () => {
    const b = await booked(21);
    const good = attendance.attendanceToken(b.assignmentId);
    expect(attendance.assignmentIdFromToken(good)).toBe(b.assignmentId);
    expect(attendance.assignmentIdFromToken(`${b.assignmentId}.AAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(attendance.assignmentIdFromToken("junk")).toBeNull();
  });
});
