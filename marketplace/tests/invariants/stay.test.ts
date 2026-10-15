import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { adminAssign, cancelAssignment, createShift, getSettings, stay } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const H = 3_600_000;
const TAMPA = { lat: 27.95, lng: -82.46, state: "FL" }; // stays over at the Orlando clinic

async function booked() {
  const clinic = await makeClinic();
  const { startsAt, endsAt } = futureWeekday(12);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, lodgingAllowed: true, lodgingByClinic: true, lodgingStayKind: "HOTEL" }, { post: true });
  const p = await makeProvider({ home: TAMPA, maxDriveMinutes: 90, willingOvernight: true });
  const { assignmentId } = await adminAssign(admin, shiftId, p.id);
  return { clinic, shiftId, p, assignmentId, startsAt };
}

const input = (o: Partial<stay.StayInput> = {}): stay.StayInput => ({
  kind: "HOTEL", place: "Hampton Inn", address: "100 Main St, Orlando, FL 32801", checkIn: "", checkOut: "", confirmation: "HX123", bookedUnder: "", access: "Lockbox 4321", notes: "", ...o,
});
const view = async (assignmentId: string) => {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: true } } } });
  return stay.providerStay(a, await getSettings());
};
const notes = (userId: string, template: string) => prisma.notification.findMany({ where: { userId, template } });
const clinicNotes = async (orgId: string, template: string) => {
  const members = await prisma.clinicMember.findMany({ where: { clinicOrgId: orgId }, select: { userId: true } });
  return prisma.notification.findMany({ where: { userId: { in: members.map((m) => m.userId) }, template } });
};

describe("clinic-booked stay details", () => {
  it("tells the clinic the legal name to book under, shares details with the provider, access only from 48 h, Got it", async () => {
    const { clinic, shiftId, p, assignmentId, startsAt } = await booked();
    const legal = (await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).legalName;
    const asked = await clinicNotes(clinic.org.id, "stay_details_needed");
    expect(asked.at(-1)?.body).toContain(legal);
    expect((await view(assignmentId))?.status).toBe("WAITING");

    const ci = new Date(+startsAt - 18 * H).toISOString().slice(0, 16);
    await stay.saveStayDetails(clinic.actor, shiftId, input({ bookedUnder: legal, checkIn: ci }));
    const v = await view(assignmentId);
    expect(v).toMatchObject({ status: "READY", place: "Hampton Inn", bookedUnder: legal, confirmation: "HX123", access: null });
    expect(v?.accessLater).not.toBeNull();
    expect(v?.mapUrl).toContain("google.com/maps");
    expect((await notes(p.user.id, "stay_details")).length).toBe(1);

    await stay.ackStay(p.actor, assignmentId);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).stayAckAt).not.toBeNull();
    // A change clears "Got it" so they look again.
    await stay.saveStayDetails(clinic.actor, shiftId, input({ bookedUnder: legal, checkIn: ci, place: "Hilton" }));
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).stayAckAt).toBeNull();
    const cv = await stay.clinicStayView(clinic.actor, shiftId);
    expect(cv.live).toMatchObject({ legalName: legal, needsStay: true, missing: [], stale: false });
  });

  it("a replacement doesn't see the old provider's stay until the clinic moves it; the old one stops seeing it", async () => {
    const { clinic, shiftId, p, assignmentId } = await booked();
    await stay.saveStayDetails(clinic.actor, shiftId, input({ bookedUnder: "Old Name", checkIn: "2030-01-01T15:00" }));
    await prisma.shift.update({ where: { id: shiftId }, data: { stayFileKey: `clinics/${clinic.org.id}/stays/${shiftId}/x.pdf` } });
    await cancelAssignment(p.actor, assignmentId, "Can't make it", { by: "PROVIDER" });
    expect(await view(assignmentId)).toBeNull();
    const p2 = await makeProvider({ home: TAMPA, maxDriveMinutes: 90, willingOvernight: true });
    const { assignmentId: second } = await adminAssign(admin, shiftId, p2.id);
    expect((await view(second))?.status).toBe("UPDATING");
    expect((await view(second))?.place).toBeNull();
    expect(await stay.canViewStayFile(p2.actor, `clinics/${clinic.org.id}/stays/${shiftId}/x.pdf`)).toBe(false);
    expect((await clinicNotes(clinic.org.id, "stay_update_for_replacement")).length).toBe(1);
    const cv = await stay.clinicStayView(clinic.actor, shiftId);
    expect(cv.live?.stale).toBe(true);
    await stay.saveStayDetails(clinic.actor, shiftId, input({ bookedUnder: "New Name", checkIn: "2030-01-01T15:00" }));
    expect((await view(second))?.status).toBe("READY");
    expect(await stay.canViewStayFile(p2.actor, `clinics/${clinic.org.id}/stays/${shiftId}/x.pdf`)).toBe(true);
  });

  it("reminds the clinic at 72 and 48 hours, alerts admins at 24, once each; nudges the provider to tap Got it", async () => {
    const { clinic, shiftId, p, assignmentId, startsAt } = await booked();
    await stay.staySweep(new Date(+startsAt - 70 * H));
    await stay.staySweep(new Date(+startsAt - 69 * H));
    expect((await clinicNotes(clinic.org.id, "stay_details_reminder")).length).toBe(1);
    await stay.staySweep(new Date(+startsAt - 40 * H));
    expect((await clinicNotes(clinic.org.id, "stay_details_reminder")).length).toBe(2);
    // Other bookings may be swept too; check this booking's own once-only record.
    await stay.staySweep(new Date(+startsAt - 20 * H));
    expect(await prisma.digestSend.findUnique({ where: { key: `stay:${shiftId}:${p.id}:admin` } })).not.toBeNull();
    await stay.staySweep(new Date(+startsAt - 19 * H));
    expect(await prisma.digestSend.count({ where: { key: { startsWith: `stay:${shiftId}:${p.id}:` } } })).toBe(3);
    // Complete now: the provider is nudged once to tap Got it.
    const legal = (await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).legalName;
    await stay.saveStayDetails(clinic.actor, shiftId, input({ bookedUnder: legal, checkIn: "2030-01-01T15:00" }));
    await stay.staySweep(new Date(+startsAt - 18 * H));
    await stay.staySweep(new Date(+startsAt - 17 * H));
    expect((await notes(p.user.id, "stay_ack_nudge")).length).toBe(1);
    expect(assignmentId).toBeTruthy();
  });

  it("warns (but saves) when the stay dates don't line up with the shift", async () => {
    const { clinic, shiftId, startsAt } = await booked();
    const tz = (await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } })).location.timeZone;
    const { DateTime } = await import("luxon");
    const local = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm");
    const good = await stay.saveStayDetails(clinic.actor, shiftId, input({ checkIn: local(new Date(+startsAt - 17 * H)), checkOut: local(new Date(+startsAt + 2 * H)) }));
    expect(good.warnings).toEqual([]);
    const late = await stay.saveStayDetails(clinic.actor, shiftId, input({ checkIn: local(new Date(+startsAt + 24 * H)), checkOut: local(new Date(+startsAt + 48 * H)) }));
    expect(late.warnings.length).toBe(2);
    expect(late.warnings[0]).toMatch(/after the shift starts/);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).stayCheckIn).not.toBeNull();
    expect((await stay.clinicStayView(clinic.actor, shiftId)).dateWarnings.length).toBe(2);
  });

  it("a two-day booking is one trip: one provider, stay saved once for both days, one notice, one Got it", async () => {
    const clinic = await makeClinic();
    const first = futureWeekday(16);
    const days = [0, 1].map((i) => ({ locationId: clinic.location.id, professionCode: "DC", startsAt: new Date(+first.startsAt + i * 86_400_000), endsAt: new Date(+first.endsAt + i * 86_400_000), lodgingAllowed: true, lodgingByClinic: true, lodgingStayKind: "HOTEL" as const, sameProvider: false }));
    const { bookings } = await import("@cm/services");
    const { groupId, shiftIds } = await bookings.createMultiDay(clinic.actor, days, { post: true });
    // Booking the stay yourself means one provider for every day, even if "same provider" wasn't ticked.
    expect((await prisma.shiftGroup.findUniqueOrThrow({ where: { id: groupId! } })).sameProviderRequired).toBe(true);
    const p = await makeProvider({ home: TAMPA, maxDriveMinutes: 90, willingOvernight: true });
    const ids: string[] = [];
    for (const id of shiftIds) ids.push((await adminAssign(admin, id, p.id)).assignmentId);
    expect((await clinicNotes(clinic.org.id, "stay_details_needed")).length).toBe(1);
    await stay.saveStayDetails(clinic.actor, shiftIds[0], input({ bookedUnder: "Jane", checkIn: "2030-01-01T15:00" }));
    expect((await view(ids[1]))).toMatchObject({ status: "READY", place: "Hampton Inn" });
    expect((await notes(p.user.id, "stay_details")).length).toBe(1);
    await stay.ackStay(p.actor, ids[0]);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: ids[1] } })).stayAckAt).not.toBeNull();
  });
});
