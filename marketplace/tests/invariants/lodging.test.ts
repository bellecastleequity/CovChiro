import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { FakePayments, paymentsProvider } from "@cm/integrations";
import { adminAssign, attendance, cancelAssignment, cancelShiftByClinic, createShift, getSettings, lodging, shiftBoard, markUnfilled, releaseDuePayouts } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const H = 3_600_000;
const fake = () => paymentsProvider() as FakePayments;
const TAMPA = { lat: 27.95, lng: -82.46, state: "FL" }; // ~2 h 15 min from the Orlando clinic: stays over

/** A lodging-allowed shift `hoursOut` from now (or a weekday `days` out). */
async function lodgingShift(o: { hoursOut?: number; days?: number; byClinic?: boolean } = {}) {
  const clinic = await makeClinic();
  let startsAt: Date, endsAt: Date;
  if (o.hoursOut) {
    startsAt = new Date(Math.ceil((Date.now() + o.hoursOut * H) / H) * H);
    endsAt = new Date(+startsAt + 8 * H);
  } else ({ startsAt, endsAt } = futureWeekday(o.days ?? 10));
  const { shiftId } = await createShift(
    clinic.actor,
    { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, lodgingAllowed: true, ...(o.byClinic ? { lodgingByClinic: true, lodgingStayKind: "HOTEL" as const, lodgingStayDetails: "Hilton Garden Inn, 2 nights booked" } : {}) },
    { post: true },
  );
  return { clinic, shiftId };
}

const far = () => makeProvider({ home: TAMPA, maxDriveMinutes: 90, willingOvernight: true });
const near = () => makeProvider();
const assignmentOf = (id: string) => prisma.assignment.findUniqueOrThrow({ where: { id } });
const lodgingRow = (assignmentId: string) => prisma.payout.findFirst({ where: { assignmentId, kind: "LODGING" } });
const refunded = async (clinicOrgId: string) => (await prisma.payment.aggregate({ where: { clinicOrgId, type: "REFUND", status: "SUCCEEDED" }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
const deposits = async (assignmentId: string) => (await prisma.payment.aggregate({ where: { assignmentId, type: "DEPOSIT", status: "SUCCEEDED" }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;

describe("lodging paid up front", () => {
  it("the deposit takes all of the lodging; the advance waits for reconfirmation and opens 48 hours before", async () => {
    const s = await getSettings();
    const { shiftId } = await lodgingShift({ days: 10 });
    const p = await far();
    const { assignmentId } = await adminAssign(admin, shiftId, p.id);
    const a = await assignmentOf(assignmentId);
    expect(a.lodgingEstimateCents).toBe(s["pricing.lodgingNightlyCents"]);
    expect(a.flags).toContain("LODGING_UPFRONT");
    const rest = a.clinicTotalCents - a.lodgingEstimateCents;
    expect(a.depositCents).toBe(Math.round((rest * s["payments.depositPercent"]) / 100) + a.lodgingEstimateCents);
    expect(await deposits(assignmentId)).toBe(a.depositCents);
    // Pay and lodging are separate rows.
    const shiftRow = await prisma.payout.findFirstOrThrow({ where: { assignmentId, kind: "SHIFT" } });
    expect(shiftRow.amountCents).toBe(a.providerTotalCents - a.lodgingEstimateCents);
    expect(await lodgingRow(assignmentId)).toMatchObject({ status: "PENDING", amountCents: a.lodgingEstimateCents, releaseAt: null });

    await attendance.reconfirmAttendance(null, assignmentId);
    const row = await lodgingRow(assignmentId);
    expect(row?.status).toBe("SCHEDULED");
    expect(+row!.releaseAt!).toBe(+a.startsAt - s["reconfirm.askBeforeHours"] * H);
  });

  it("booked inside 48 hours: sent at once; the provider dropping out takes it back and holds the lodging for the replacement", async () => {
    const { clinic, shiftId } = await lodgingShift({ hoursOut: 30 });
    const p = await far();
    const { assignmentId } = await adminAssign(admin, shiftId, p.id);
    const a = await assignmentOf(assignmentId);
    expect(await lodgingRow(assignmentId)).toMatchObject({ status: "PAID", amountCents: a.lodgingEstimateCents });

    const before = fake().reversals.length;
    await cancelAssignment(p.actor, assignmentId, "Car trouble", { by: "PROVIDER" });
    expect(fake().reversals.length).toBe(before + 1);
    expect(fake().reversals.at(-1)!.amountCents).toBe(a.lodgingEstimateCents);
    const back = await prisma.payout.findFirstOrThrow({ where: { providerId: p.id, kind: "ADJUSTMENT" } });
    expect(back).toMatchObject({ status: "PAID", amountCents: -a.lodgingEstimateCents });
    // The clinic got the deposit back except the lodging, which is held on the shift.
    expect(await refunded(clinic.org.id)).toBe(a.depositCents - a.lodgingEstimateCents);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).lodgingHeldCents).toBe(a.lodgingEstimateCents);
    // Never reversed twice.
    await lodging.reverseLodgingAdvance(assignmentId, a.lodgingEstimateCents, "again");
    expect(fake().reversals.length).toBe(before + 1);

    // A replacement who also stays over: the hold pays their lodging, the clinic isn't charged it again.
    const p2 = await far();
    const { assignmentId: second } = await adminAssign(admin, shiftId, p2.id);
    const b = await assignmentOf(second);
    expect(b.lodgingCreditCents).toBe(a.lodgingEstimateCents);
    expect(b.depositCents).toBe(Math.round(((b.clinicTotalCents - b.lodgingEstimateCents) * (await getSettings())["payments.depositPercent"]) / 100));
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).lodgingHeldCents).toBe(0);
    expect(await refunded(clinic.org.id)).toBe(a.depositCents - a.lodgingEstimateCents);
    // Their advance still goes out (inside 48 h).
    expect((await lodgingRow(second))?.status).toBe("PAID");
  });

  it("a replacement who lives nearby: the held lodging is refunded", async () => {
    const { clinic, shiftId } = await lodgingShift({ days: 10 });
    const p = await far();
    const { assignmentId } = await adminAssign(admin, shiftId, p.id);
    const a = await assignmentOf(assignmentId);
    await cancelAssignment(p.actor, assignmentId, "Can't make it", { by: "PROVIDER" });
    expect(await refunded(clinic.org.id)).toBe(a.depositCents - a.lodgingEstimateCents);
    const n = await near();
    const { assignmentId: second } = await adminAssign(admin, shiftId, n.id);
    expect((await assignmentOf(second)).lodgingEstimateCents).toBe(0);
    expect(await refunded(clinic.org.id)).toBe(a.depositCents);
    expect(await lodgingRow(second)).toBeNull();
  });

  it("nobody placed by the start: the hold is refunded", async () => {
    const { clinic, shiftId } = await lodgingShift({ days: 10 });
    const p = await far();
    const { assignmentId } = await adminAssign(admin, shiftId, p.id);
    const a = await assignmentOf(assignmentId);
    await cancelAssignment(p.actor, assignmentId, "Can't make it", { by: "PROVIDER" });
    await markUnfilled(new Date(+a.startsAt + H));
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).lodgingHeldCents).toBe(0);
    expect(await refunded(clinic.org.id)).toBe(a.depositCents);
  });

  it("the clinic cancelling early refunds all the lodging; late, the provider keeps a night", async () => {
    const early = await lodgingShift({ days: 10 });
    const p = await far();
    const { assignmentId } = await adminAssign(admin, early.shiftId, p.id);
    const a = await assignmentOf(assignmentId);
    await cancelShiftByClinic(early.clinic.actor, early.shiftId, "Closed that day");
    expect(await refunded(early.clinic.org.id)).toBe(a.depositCents);
    expect((await lodgingRow(assignmentId))?.status).toBe("CANCELLED");

    const late = await lodgingShift({ hoursOut: 30 });
    const p2 = await far();
    const { assignmentId: b } = await adminAssign(admin, late.shiftId, p2.id);
    const row = await assignmentOf(b);
    expect((await lodgingRow(b))?.status).toBe("PAID");
    const reversals = fake().reversals.length;
    await cancelShiftByClinic(late.clinic.actor, late.shiftId, "Closed that day");
    // One night = all of this booking's lodging: nothing reversed, the lodging isn't refunded.
    expect(fake().reversals.length).toBe(reversals);
    const lodgingRefunded = (await prisma.payment.findMany({ where: { assignmentId: b, type: "REFUND" } })).some((r) => r.description?.includes("lodging"));
    expect(lodgingRefunded).toBe(false);
    expect(row.lodgingEstimateCents).toBeGreaterThan(0);
  });

  it("the clinic books the stay itself: no lodging charged or paid, the far provider can still be matched", async () => {
    const { shiftId } = await lodgingShift({ days: 12, byClinic: true });
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(shift).toMatchObject({ lodgingByClinic: true, lodgingStayKind: "HOTEL", lodgingCapCentsPerNight: null });
    const p = await far();
    // The provider sees it before applying: Find shifts says the clinic books the stay.
    const board = await shiftBoard(p.actor);
    expect(board.find((b) => b.id === shiftId)?.stayByClinic).toBe("HOTEL");
    // A provider who lives nearby isn't told about a stay they don't need.
    const n = await near();
    expect((await shiftBoard(n.actor)).find((b) => b.id === shiftId)?.stayByClinic).toBeNull();
    const { assignmentId } = await adminAssign(admin, shiftId, p.id);
    const a = await assignmentOf(assignmentId);
    expect(a.lodgingEstimateCents).toBe(0);
    expect(a.mileageCents).toBeGreaterThan(0);
    expect(await lodgingRow(assignmentId)).toBeNull();
    // Confirmation tells them who books it and where it is.
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: p.user.id, template: "shift_confirmed_provider" }, orderBy: { createdAt: "desc" } });
    expect(note.body).toContain("books and pays for your stay (a hotel)");
    expect(note.body).toContain("as soon as they add where you're staying");
  });

  it("a failed deposit keeps the advance on hold until the clinic pays", async () => {
    const { shiftId } = await lodgingShift({ days: 10 });
    const p = await far();
    const { assignmentId } = await adminAssign(admin, shiftId, p.id);
    await lodging.holdLodgingForPayment(assignmentId, true);
    await attendance.reconfirmAttendance(null, assignmentId);
    expect(await lodgingRow(assignmentId)).toMatchObject({ status: "SCHEDULED", onHold: true });
    await lodging.holdLodgingForPayment(assignmentId, false);
    expect(await lodgingRow(assignmentId)).toMatchObject({ status: "SCHEDULED", onHold: false });
  });
});
