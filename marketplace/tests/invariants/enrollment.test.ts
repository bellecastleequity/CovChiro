import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { admin as adminSvc, badgesFor, enrollment, upsertLicense } from "@cm/services";
import { enablePair, makeProvider } from "../factories";

/** Nationwide enrollment: Trailblazer places in states that aren't open, and the opening announcement. */

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const FAR = new Date(Date.now() + 400 * 86_400_000);
const wyLicense = (actor: { providerId?: string | null }) =>
  upsertLicense(actor as never, { professionCode: "DC", state: "WY", licenseNumber: `WY-${Math.random().toString(36).slice(2, 8)}`, expiresAt: FAR });

describe("Trailblazer places", () => {
  it("first N to submit a license in an unopened state hold the places; a rejection moves the next one up; the badge shows once verified", async () => {
    await prisma.setting.upsert({ where: { key: "enrollment.trailblazerSpots" }, create: { key: "enrollment.trailblazerSpots", value: 2 }, update: { value: 2 } });
    const { invalidateSettings } = await import("@cm/services");
    invalidateSettings();
    await prisma.trailblazerSpot.deleteMany({ where: { state: "WY" } });
    const [a, b, c] = [await makeProvider(), await makeProvider(), await makeProvider()];
    const la = await wyLicense(a.actor);
    await wyLicense(b.actor);
    const lc = await wyLicense(c.actor);

    const sa = await enrollment.enrollmentStatus(a.id);
    expect(sa.inOpenMarket).toBe(true); // the factory gives them a Florida license too
    const waitingC = (await enrollment.enrollmentStatus(c.id)).waiting.find((w) => w.state === "WY")!;
    expect(waitingC).toMatchObject({ place: 3, trailblazer: false, spots: 2, spotsLeft: 0 });

    // Not verified yet: no badge.
    expect((await badgesFor([a.id])).get(a.id)!.some((x) => x.key === "trailblazer")).toBe(false);
    await adminSvc.reviewLicense(admin, la.id, { approve: true });
    const badge = (await badgesFor([a.id])).get(a.id)!.find((x) => x.key === "trailblazer");
    expect(badge?.description).toMatch(/first 2 providers to join in Wyoming/);

    // A's license is rejected later: C moves up into the top places.
    await adminSvc.reviewLicense(admin, la.id, { approve: false, reason: "test" });
    expect((await enrollment.enrollmentStatus(c.id)).waiting.find((w) => w.state === "WY")).toMatchObject({ place: 2, trailblazer: true });
    await adminSvc.reviewLicense(admin, lc.id, { approve: true });
    expect((await badgesFor([c.id])).get(c.id)!.some((x) => x.key === "trailblazer")).toBe(true);

    // The admin queue lists open-market licenses first.
    const q = await adminSvc.verificationQueue(admin);
    const firstClosed = q.licenses.findIndex((l) => !l.marketOpen);
    expect(firstClosed === -1 || q.licenses.slice(firstClosed).every((l) => !l.marketOpen)).toBe(true);
    await prisma.setting.deleteMany({ where: { key: "enrollment.trailblazerSpots" } });
    invalidateSettings();
  });

  it("no places in an open state; enrolled providers are told once when their state opens (existing markets are never announced)", async () => {
    const p = await makeProvider();
    const fl = await prisma.license.findFirstOrThrow({ where: { providerId: p.id, state: "FL" } });
    await upsertLicense(p.actor as never, { professionCode: "DC", state: "FL", licenseNumber: fl.licenseNumber, expiresAt: FAR });
    expect(await prisma.trailblazerSpot.count({ where: { providerId: p.id, state: "FL" } })).toBe(0);

    await prisma.setting.deleteMany({ where: { key: "enrollment.announcedPairs" } });
    expect((await enrollment.announceOpenings()).sent).toBe(0); // first run only records what's already open
    await wyLicense(p.actor);
    expect((await enrollment.announceOpenings()).sent).toBe(0);

    await enablePair("DC", "WY");
    expect((await enrollment.announceOpenings()).sent).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { userId: p.userId, template: "market_opened" } })).toBe(1);
    expect((await enrollment.announceOpenings()).sent).toBe(0);
    await prisma.professionStateConfig.update({ where: { professionCode_state: { professionCode: "DC", state: "WY" } }, data: { enabled: false } });
  });
});
