import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { adminAssign, digests } from "@cm/services";
import { makeClinic, makeProvider, makeShift } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const NY = "America/New_York";

async function booked(days = 15) {
  const clinic = await makeClinic({ state: "FL" });
  const p = await makeProvider();
  const shift = await makeShift(clinic.location.id, { days });
  await adminAssign({ ...admin }, shift.id, p.id);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
  const mails = () => devOutbox.filter((m) => m.to === user.email && /booking/i.test(m.subject ?? ""));
  return { p, shift, clinic, mails, local: DateTime.fromJSDate(shift.startsAt, { zone: NY }) };
}

describe("provider booking emails", () => {
  it("daily: sent once at 5:30 local on the day, with directions; not before, not hours late", async () => {
    const { mails, local, clinic, shift } = await booked();
    const at = (h: number, m: number) => local.set({ hour: h, minute: m }).toJSDate();
    await digests.sendBookingDigests(at(5, 25));
    expect(mails()).toHaveLength(0);
    await digests.sendBookingDigests(at(5, 30));
    await digests.sendBookingDigests(at(5, 35)); // next tick: already sent
    expect(mails()).toHaveLength(1);
    const body = mails()[0].body;
    expect(mails()[0].subject).toMatch(/^Today: 1 booking/);
    expect(body).toContain("https://www.google.com/maps/dir/?api=1&destination=");
    expect(body).toContain(encodeURIComponent(clinic.location.addressLine1));
    const t = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: clinic.location.timeZone, hour: "numeric", minute: "2-digit" });
    expect(body).toContain(`${t(shift.startsAt)}–${t(shift.endsAt)}`);
    // Too late to be a morning email.
    const late = await booked(22);
    await digests.sendBookingDigests(late.local.set({ hour: 9, minute: 0 }).toJSDate());
    expect(late.mails()).toHaveLength(0);
  });

  it("no bookings that day → no daily email", async () => {
    const { mails, local } = await booked();
    await digests.sendBookingDigests(local.minus({ days: 1 }).set({ hour: 5, minute: 31 }).toJSDate());
    expect(mails()).toHaveLength(0);
  });

  it("weekly: Sunday evening covers the coming Monday–Sunday only", async () => {
    const { mails, local } = await booked(29);
    const sundayBefore = local.startOf("week").minus({ days: 1 }).set({ hour: 19, minute: 2 });
    await digests.sendBookingDigests(sundayBefore.minus({ weeks: 1 }).toJSDate()); // two weeks out: nothing
    expect(mails()).toHaveLength(0);
    await digests.sendBookingDigests(sundayBefore.toJSDate());
    await digests.sendBookingDigests(sundayBefore.plus({ minutes: 5 }).toJSDate());
    expect(mails()).toHaveLength(1);
    expect(mails()[0].subject).toMatch(/^Your week ahead: 1 booking/);
    expect(mails()[0].body).toContain(local.toJSDate().toLocaleDateString("en-US", { timeZone: NY, weekday: "long", month: "short", day: "numeric" }));
  });

  it("cancelled bookings are left out", async () => {
    const { mails, local, shift } = await booked(36);
    await prisma.assignment.updateMany({ where: { shiftId: shift.id }, data: { status: "CANCELLED" } });
    await digests.sendBookingDigests(local.set({ hour: 5, minute: 40 }).toJSDate());
    expect(mails()).toHaveLength(0);
  });
});
