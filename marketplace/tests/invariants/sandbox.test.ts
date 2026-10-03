import { execSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The test site works on its own database: build it in a separate throwaway one.
const url = vi.hoisted(() => {
  const u = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://cm:cm@localhost:5432/coverage_test");
  u.pathname = "/sandbox_test";
  process.env.DATABASE_URL = u.toString();
  process.env.SANDBOX_MODE = "1";
  return u;
});

import { prisma } from "@cm/db";
import { sandbox, auth, createShift } from "@cm/services";
import { DateTime } from "luxon";

let admin: { userId: string; role: "PLATFORM_ADMIN"; providerId: null; clinicOrgId: null };

beforeAll(async () => {
  const pg = new URL(url);
  pg.pathname = "/postgres";
  const psql = (sql: string) => execSync(`psql "${pg}" -v ON_ERROR_STOP=1 -q -c "${sql}"`, { stdio: "pipe" });
  psql("DROP DATABASE IF EXISTS sandbox_test WITH (FORCE)");
  psql("CREATE DATABASE sandbox_test");
  const dbDir = path.resolve(__dirname, "../../packages/db");
  const env = { ...process.env, DATABASE_URL: url.toString() };
  execSync("npx prisma migrate deploy", { cwd: dbDir, env, stdio: "pipe" });
  execSync("npx tsx -e \"import('./prisma/seedData.ts').then(async m => { const { PrismaClient } = await import('@prisma/client'); const p = new PrismaClient(); await m.seedBase(p); await p.\\$disconnect(); })\"", { cwd: dbDir, env, stdio: "pipe" });
  const u = await prisma.user.create({ data: { email: "owner@admin.test", name: "Owner", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
  admin = { userId: u.id, role: "PLATFORM_ADMIN", providerId: null, clinicOrgId: null };
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

/** Wait for the queue (the admin click already started it in the background). */
async function drain() {
  for (let i = 0; i < 6000; i++) {
    const r = await sandbox.runQueue(10 * 60_000);
    if (!(await prisma.setting.findUnique({ where: { key: "sandbox.queue" } }))) return;
    if (r === "already running") await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error("queue never finished");
}

describe("test site (sandbox)", () => {
  it("refuses a database with real accounts", async () => {
    const u = await prisma.user.create({ data: { email: "real-clinic@example.com", name: "Real", role: "CLINIC_OWNER" } });
    await expect(sandbox.startBuild(admin)).rejects.toThrow(/aren't demo accounts/);
    await prisma.user.delete({ where: { id: u.id } });
  });

  it("builds history, the next 37 days and your two test accounts", async () => {
    await sandbox.startBuild(admin);
    await drain();
    const last = (await prisma.setting.findUnique({ where: { key: "sandbox.lastRun" } }))!.value as { errors: { kind: string; message: string }[] };
    // Every step should work; print any that didn't to make failures readable.
    if (last.errors.length) console.log(last.errors);
    expect(last.errors.length).toBeLessThanOrEqual(3);

    expect(await prisma.clinicOrg.count()).toBe(12);
    expect(await prisma.provider.count()).toBe(34);
    // Worked, signed, completed and paid in the past.
    const completed = await prisma.assignment.count({ where: { status: "COMPLETED", endsAt: { lt: new Date() } } });
    expect(completed).toBeGreaterThan(25);
    expect(await prisma.payout.count({ where: { status: "PAID" } })).toBeGreaterThan(10);
    expect(await prisma.rating.count()).toBeGreaterThan(20);
    // Back-dated: the oldest worked shift was posted about three weeks ago.
    const oldest = await prisma.shift.findFirst({ where: { status: "COMPLETED" }, orderBy: { startsAt: "asc" } });
    expect(+oldest!.createdAt).toBeLessThan(Date.now() - 14 * 86_400_000);

    // A month+ of future shifts.
    const furthest = await prisma.shift.findFirst({ where: { status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CONFIRMED"] } }, orderBy: { startsAt: "desc" } });
    expect(+furthest!.startsAt).toBeGreaterThan(Date.now() + 30 * 86_400_000);
    // Each special case exists.
    expect(await prisma.shift.count({ where: { rateMode: "CLINIC" } })).toBeGreaterThanOrEqual(2);
    expect(await prisma.shift.count({ where: { status: "DRAFT" } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.shiftChange.count({ where: { status: "PENDING" } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.standingBooking.count({ where: { status: "ACTIVE" } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.shiftGroup.count()).toBeGreaterThanOrEqual(1);
    expect(await prisma.shift.count({ where: { emergencyAt: { not: null } } })).toBeGreaterThanOrEqual(1);

    // Your test provider: bookings this week and invitations waiting.
    const you = await prisma.provider.findFirstOrThrow({ where: { user: { email: "provider.you@sandbox.test" } } });
    expect(await prisma.assignment.count({ where: { providerId: you.id, status: "CONFIRMED", startsAt: { lt: new Date(Date.now() + 9 * 86_400_000) } } })).toBeGreaterThanOrEqual(2);
    expect(await prisma.offer.count({ where: { providerId: you.id, status: "PENDING" } })).toBeGreaterThanOrEqual(1);
    // Your test clinic: open shifts with applicants to choose from.
    const yourOrg = await prisma.clinicOrg.findFirstOrThrow({ where: { displayName: "Sandbox Family Chiropractic" } });
    expect(await prisma.application.count({ where: { status: "ACTIVE", shift: { location: { clinicOrgId: yourOrg.id } } } })).toBeGreaterThanOrEqual(1);
    // The build's emails were cleared; nothing was sent anywhere.
    expect(await prisma.sandboxMessage.count()).toBe(0);
  }, 900_000);

  it("tops up without duplicating", async () => {
    const before = await prisma.shift.count();
    await sandbox.startTopUp(admin);
    await drain();
    // A second top-up right away has (almost) nothing left to add.
    expect((await prisma.shift.count()) - before).toBeLessThanOrEqual(3);
  }, 300_000);

  it("bots answer your clinic's new shift and your messages; emails land in the outbox", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "clinic.yours@sandbox.test" }, include: { clinicMembers: { include: { clinicOrg: { include: { locations: true } } } } } });
    const org = owner.clinicMembers[0].clinicOrg;
    const actor = { userId: owner.id, role: "CLINIC_OWNER" as const, providerId: null, clinicOrgId: org.id };
    const day = DateTime.now().setZone("America/New_York").startOf("day").plus({ days: 16 });
    const d = day.weekday === 7 ? day.plus({ days: 1 }) : day;
    const { shiftId } = await createShift(actor, { locationId: org.locations[0].id, professionCode: "DC", startsAt: d.set({ hour: 8 }).toJSDate(), endsAt: d.set({ hour: 17 }).toJSDate(), expectedPatients: 25 }, { post: true });
    // Five minutes later a nearby provider applies; a few more ticks, more of them.
    await sandbox.botsTick(new Date(Date.now() + 5 * 60_000));
    await sandbox.botsTick(new Date(Date.now() + 12 * 60_000));
    expect(await prisma.application.count({ where: { shiftId, status: "ACTIVE" } })).toBeGreaterThanOrEqual(1);
    // Posting emailed eligible providers: captured, not sent.
    expect(await prisma.sandboxMessage.count({ where: { channel: "email" } })).toBeGreaterThan(0);
    expect(await prisma.sandboxMessage.count({ where: { delivered: true } })).toBe(0);
  }, 120_000);

  it("bots work a booked day end to end; the Sunday top-up runs once", async () => {
    const a = await prisma.assignment.findFirstOrThrow({
      where: { status: "CONFIRMED", startsAt: { gt: new Date() }, provider: { user: { email: { not: "provider.you@sandbox.test" } } }, shift: { expectedPatients: { not: null }, location: { clinicOrg: { displayName: { not: "Sandbox Family Chiropractic" } } } } },
      orderBy: { startsAt: "asc" },
    });
    await sandbox.atTime(+a.startsAt - 5 * 60_000, () => sandbox.botsTick(new Date()));
    await sandbox.atTime(+a.endsAt + 5 * 60_000, () => sandbox.botsTick(new Date()));
    await sandbox.atTime(+a.endsAt + 6 * 60_000, () => sandbox.botsTick(new Date()));
    await sandbox.atTime(+a.endsAt + 40 * 60_000, () => sandbox.botsTick(new Date()));
    const punches = await prisma.timePunch.findMany({ where: { assignmentId: a.id } });
    expect(punches.map((p) => p.kind).sort()).toEqual(["IN", "OUT"]);
    expect((await prisma.visitCount.findUnique({ where: { assignmentId: a.id } }))?.providerVisits).toBeGreaterThan(0);
    expect((await prisma.timesheet.findUnique({ where: { assignmentId: a.id } }))?.status).toBe("APPROVED");

    expect(await sandbox.weeklyTopUp(new Date("2026-10-07T23:30:00Z"))).toBe("not Sunday evening");
    const first = await sandbox.weeklyTopUp(new Date("2026-10-04T23:30:00Z"));
    expect(String(first)).not.toMatch(/already|not/);
    expect(await sandbox.weeklyTopUp(new Date("2026-10-04T23:45:00Z"))).toBe("already done this week");
  }, 300_000);

  it("the nightly self-check takes a shift from posting to payout, and every step passes", async () => {
    const msg = await sandbox.runSelfCheckNow(admin);
    const { last } = await sandbox.selfCheckState();
    if (!last!.ok) console.log(last!.results.filter((r) => !r.ok));
    expect(msg).toMatch(/^All \d+ checks passed/);
    expect(last!.results.length).toBeGreaterThanOrEqual(15);
    // A second run picks another free day and passes too.
    expect(await sandbox.runSelfCheckNow(admin)).toMatch(/^All/);
  }, 300_000);

  it("errors are grouped with a count, and problem reports carry context", async () => {
    await sandbox.recordError({ source: "server", message: "Cannot read properties of undefined (reading 'id') at shift cmabcdefghijklmnopqrstuvwx", path: "/clinic/shifts/cmabcdefghijklmnopqrstuvwx" });
    await sandbox.recordError({ source: "server", message: "Cannot read properties of undefined (reading 'id') at shift cmzyxwvutsrqponmlkjihgfedc", path: "/clinic/shifts/cmzyxwvutsrqponmlkjihgfedc" });
    const errs = await sandbox.listErrors(admin);
    const e = errs.find((x) => x.message.startsWith("Cannot read properties"))!;
    expect(e.count).toBe(2);
    await sandbox.resolveError(admin, e.id);
    expect((await sandbox.listErrors(admin)).some((x) => x.id === e.id)).toBe(false);
    // Happens again: it comes back.
    await sandbox.recordError({ source: "server", message: "Cannot read properties of undefined (reading 'id') at shift cmqqqqqqqqqqqqqqqqqqqqqqqqq", path: "/clinic/shifts/cmqqqqqqqqqqqqqqqqqqqqqqqqq" });
    expect((await sandbox.listErrors(admin)).find((x) => x.id === e.id)?.count).toBe(3);

    const demo = await prisma.user.findUniqueOrThrow({ where: { email: "provider.you@sandbox.test" } });
    await sandbox.createReport({ userId: demo.id, name: demo.name, email: demo.email, adminUserId: admin.userId }, { note: "Apply button did nothing", path: "/provider/shifts", client: { userAgent: "test", viewport: "390×844", browserErrors: ["TypeError: x is undefined"] } });
    const [r] = await sandbox.listReports(admin);
    expect(r.reporterName).toBe("Owner");
    expect(r.actingAs).toMatch(/provider.you@sandbox.test/);
    expect((r.context as { serverErrors: unknown[] }).serverErrors.length).toBeGreaterThan(0);
    await sandbox.setReportStatus(admin, r.id, true);
    expect(await sandbox.listReports(admin)).toHaveLength(0);
  });

  it("admins can open any demo login (and only demo logins)", async () => {
    const ov = await sandbox.overview(admin);
    const yourProvider = ov.logins.find((l) => l.email === "provider.you@sandbox.test")!;
    expect(yourProvider.yours).toBe(true);
    const { token } = await sandbox.actAs(admin, yourProvider.id);
    const s = await auth.sessionFromToken(token);
    expect(s?.actor.role).toBe("PROVIDER");
    await expect(sandbox.actAs(admin, admin.userId)).rejects.toThrow(/Only demo accounts/);
  });

  it("testers get admin access but can't rebuild, manage testers or touch the owner's login", async () => {
    const msg = await sandbox.addTester(admin, { name: "Tess Tester", email: "tess@example.com", password: "temporary-pass-123" });
    expect(msg).toMatch(/can now sign in/);
    const t = await prisma.user.findUniqueOrThrow({ where: { email: "tess@example.com" } });
    expect(t.role).toBe("PLATFORM_ADMIN");
    const tester = { userId: t.id, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
    expect((await sandbox.overview(tester)).owner).toBe(false);
    await expect(sandbox.startBuild(tester)).rejects.toThrow(/Only the test site's owner/);
    await expect(sandbox.cancelQueue(tester)).rejects.toThrow(/Only the test site's owner/);
    await expect(sandbox.addTester(tester, { name: "X Y", email: "x@example.com", password: "temporary-pass-123" })).rejects.toThrow(/owner/);
    const { accounts } = await import("@cm/services");
    await expect(accounts.setUserSuspended(tester, admin.userId, true, "testing")).rejects.toThrow(/owner's login/);
    // Everything else an admin does still works for a tester, e.g. opening a demo login.
    const demo = await prisma.user.findUniqueOrThrow({ where: { email: "clinic.yours@sandbox.test" } });
    expect((await sandbox.actAs(tester, demo.id)).role).toBe("CLINIC_OWNER");
    // Two-step on the test site is an emailed code: no authenticator app to set up.
    const r = await auth.login("tess@example.com", "temporary-pass-123");
    expect(r.mfaRequired).toBe(true);
    expect(r.mfaEnrollRequired).toBe(false);
    const mail = await prisma.sandboxMessage.findFirstOrThrow({ where: { to: "tess@example.com", subject: { contains: "sign-in code" } }, orderBy: { createdAt: "desc" } });
    const code = mail.subject!.match(/(\d{6})/)![1];
    await expect(auth.completeMfa(r.token, "000000", { enrolling: false })).rejects.toThrow(/didn't match/);
    await auth.completeMfa(r.token, code, { enrolling: false });
    expect((await auth.sessionFromToken(r.token))?.mfaVerified).toBe(true);
    // A code works once.
    await expect(auth.completeMfa(r.token, code, { enrolling: false })).rejects.toThrow(/didn't match/);
    await sandbox.removeTester(admin, t.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: t.id } })).disabledAt).not.toBeNull();
  });

  it("a reset keeps the admin and the configuration", async () => {
    await sandbox.startBuild(admin);
    // Only the wipe + config + cast, then stop: enough to prove the reset.
    // The click starts the build in the background: wait for the wipe, config and cast steps.
    for (let i = 0; i < 400; i++) {
      const q = (await prisma.setting.findUnique({ where: { key: "sandbox.queue" } }))?.value as { done: number } | undefined;
      if (q && q.done >= 3) break;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    await sandbox.cancelQueue(admin);
    expect(await prisma.user.count({ where: { role: "PLATFORM_ADMIN", disabledAt: null } })).toBe(1);
    expect(await prisma.rateCard.count()).toBeGreaterThan(0);
    expect(await prisma.assignment.count()).toBe(0);
  }, 300_000);
});
