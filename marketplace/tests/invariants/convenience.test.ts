import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { FakePush, pushSender, vapidAuthHeader, vapidKeysValid } from "@cm/integrations";
import { applyToShift, autoCompleteDue, bookings, calendar, createShift, notify, push, selectApplicant, startDueShifts, statements, trust } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

type Clinic = Awaited<ReturnType<typeof makeClinic>>;
type Provider = Awaited<ReturnType<typeof makeProvider>>;

async function workedShift(clinic: Clinic, provider: Provider, days: number) {
  const { startsAt, endsAt } = futureWeekday(days);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
  await applyToShift(provider.actor, shiftId, { commit: true });
  const { assignmentId } = await selectApplicant(clinic.actor, shiftId, provider.id);
  const end = new Date(Date.now() - 3 * 3_600_000);
  const start = new Date(+end - 8 * 3_600_000);
  await prisma.$executeRaw`ALTER TABLE "Shift" DISABLE TRIGGER shift_state_sync`;
  await prisma.shift.update({ where: { id: shiftId }, data: { startsAt: start, endsAt: end } });
  await prisma.$executeRaw`ALTER TABLE "Shift" ENABLE TRIGGER shift_state_sync`;
  await prisma.assignment.updateMany({ where: { shiftId }, data: { startsAt: start, endsAt: end } });
  await startDueShifts();
  await autoCompleteDue();
  return { shiftId, assignmentId };
}

describe("phone notifications (web push)", () => {
  it("makes VAPID keys once, signs the header, pushes on notify and forgets dead devices", async () => {
    const keys = await push.vapidKeys();
    expect(vapidKeysValid(keys)).toBe(true);
    expect(await push.pushPublicKey()).toBe(keys.publicKey);
    const h = vapidAuthHeader("https://fcm.googleapis.com/fcm/send/abc", keys, "mailto:test@example.com");
    expect(h).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);

    const p = await makeProvider();
    await push.subscribe(p.userId, { endpoint: "https://push.example/dev1", keys: { p256dh: "x", auth: "y" } });
    await push.subscribe(p.userId, { endpoint: "https://push.example/dev2", keys: { p256dh: "x", auth: "y" } });
    await expect(push.subscribe(p.userId, { endpoint: "http://insecure", keys: { p256dh: "x", auth: "y" } })).rejects.toThrow();
    const fake = pushSender() as FakePush;
    fake.gone.add("https://push.example/dev2");
    await notify(prisma, p.userId, { template: "test", title: "New offer", body: "Tap to see it", link: "/provider/offers", email: false });
    expect(fake.sent).toContain("https://push.example/dev1");
    expect(await push.deviceCount(p.userId)).toBe(1);
    expect(await push.latestForUser(p.userId)).toMatchObject({ title: "New offer", link: "/provider/offers" });
  });
});

describe("calendar feeds", () => {
  it("providers and clinics get their own shifts; reset breaks the old link", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const { startsAt, endsAt } = futureWeekday(50);
    const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });

    const clinicToken = await calendar.calendarToken(clinic.user.id);
    let ics = (await calendar.feedForToken(`${clinicToken}.ics`))!;
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain(`UID:shift-${shiftId}@`);
    expect(ics).toContain("Coverage requested (not filled yet)");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);

    await applyToShift(provider.actor, shiftId, { commit: true });
    const { assignmentId } = await selectApplicant(clinic.actor, shiftId, provider.id);
    ics = (await calendar.feedForToken(clinicToken))!;
    expect(ics).toContain(`Coverage: ${provider.displayName}`);
    const provIcs = (await calendar.feedForToken(await calendar.calendarToken(provider.userId)))!;
    expect(provIcs).toContain(`UID:assignment-${assignmentId}@`);
    expect(provIcs).toContain(clinic.org.displayName);

    // Another clinic's feed never shows it.
    const other = await makeClinic();
    expect(await calendar.feedForToken(await calendar.calendarToken(other.user.id))).not.toContain(shiftId);

    const fresh = await calendar.resetCalendarToken(clinic.user.id);
    expect(fresh).not.toBe(clinicToken);
    expect(await calendar.feedForToken(clinicToken)).toBeNull();
    expect(await calendar.feedForToken("not-a-token")).toBeNull();
  });
});

describe("book again, trust panel and statements", () => {
  it("re-posts the same hours on a new date and invites the same provider", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const { assignmentId } = await workedShift(clinic, provider, 51);

    const t = await trust.providerTrust(provider.id, "DC", "FL");
    expect(t.license?.current).toBe(true);
    expect(t.malpractice?.current).toBe(true);
    expect(t.completedShifts).toBeGreaterThanOrEqual(1);

    const date = futureWeekday(55).startsAt.toISOString().slice(0, 10);
    const r = await bookings.bookAgain(clinic.actor, assignmentId, date);
    expect(r.invited).toBe(true);
    const s = await prisma.shift.findUniqueOrThrow({ where: { id: r.shiftId }, include: { offers: true } });
    expect(s.status).not.toBe("DRAFT");
    expect(s.offers.map((o) => o.providerId)).toEqual([provider.id]);
    expect(+s.endsAt - +s.startsAt).toBe(8 * 3_600_000);
    await expect(bookings.bookAgain((await makeClinic()).actor, assignmentId, date)).rejects.toThrow(/not found/i);
  });

  it("clinic monthly statement and provider year-end summary come from the ledgers", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const { assignmentId } = await workedShift(clinic, provider, 52);
    const month = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
    const st = await statements.clinicStatement(clinic.actor, month);
    const paid = await prisma.payment.aggregate({ where: { assignmentId, status: "SUCCEEDED", type: { not: "REFUND" } }, _sum: { amountCents: true } });
    expect(st.charges).toBe(paid._sum.amountCents);
    expect(st.lines.map((l) => l.type)).toEqual(expect.arrayContaining(["DEPOSIT", "BALANCE"]));
    expect(await statements.clinicStatementMonths(clinic.actor)).toContain(month);

    await prisma.payout.updateMany({ where: { assignmentId }, data: { status: "PAID", paidAt: new Date() } }).catch(() => undefined);
    const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 4));
    const ps = await statements.providerAnnualStatement(provider.actor, year);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(ps.total).toBe(a.providerTotalCents);
    expect(ps.byMonth.reduce((x, m) => x + m.cents, 0)).toBe(ps.total);
  });
});
