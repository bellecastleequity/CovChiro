import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { US_STATES } from "@cm/core";
import { admin, createShift, invalidateSettings, markets, postShift, quoteForClinic, supply } from "@cm/services";
import { futureWeekday, insertAssignment, makeClinic, makeProvider, uid } from "../factories";

/**
 * Open states (owner decision Oct 2026): every state opens automatically (admin switch kept),
 * priced by the default national card until it has its own, and a clinic can post only when a
 * doctor can take the shift. New Mexico stands in for a newly opened state; every other state is
 * kept closed here so the shared test database isn't changed for later files.
 */
const set = async (key: string, value: unknown) => {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  invalidateSettings();
};
const NM = { lat: 35.09, lng: -106.64, state: "NM" };
const adminActor = async () => {
  const u = await prisma.user.create({ data: { email: `adm-${uid()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN" } });
  return { userId: u.id, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
};

beforeAll(async () => {
  await set("market.closedStates", Object.keys(US_STATES).filter((s) => s !== "NM"));
  await set("market.requireAvailableProvider", true);
});
afterAll(async () => {
  await prisma.professionStateConfig.updateMany({ where: { state: "NM" }, data: { enabled: false } });
  await prisma.stateConfig.update({ where: { state: "NM" }, data: { enabled: false } });
  await prisma.setting.deleteMany({ where: { key: { in: ["market.closedStates", "market.requireAvailableProvider"] } } });
  invalidateSettings();
});

describe("open states, gated by available doctors", () => {
  let clinic: Awaited<ReturnType<typeof makeClinic>>;
  let draftId: string;
  const day = futureWeekday(12, 15);

  it("opens a state that isn't closed, with the default national rate card", async () => {
    const r = await markets.openAllMarkets();
    expect(r.states).toEqual(["NM"]);
    expect(r.pairs).toContain("DC:NM");
    const st = await prisma.stateConfig.findUniqueOrThrow({ where: { state: "NM" } });
    expect(st.enabled).toBe(true);
    expect(st.legalReviewNotes).toMatch(/Opened automatically/);
    expect((await prisma.professionStateConfig.findUniqueOrThrow({ where: { professionCode_state: { professionCode: "DC", state: "NM" } } })).enabled).toBe(true);
    // Run again: nothing more to open.
    expect((await markets.openAllMarkets()).states).toEqual([]);

    clinic = await makeClinic({ state: "NM", address: `${uid()} Central Ave` });
    expect(clinic.location.rateRegionId).toBeNull();
    const q = await quoteForClinic(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt: day.startsAt, endsAt: day.endsAt });
    const flSmaller = await prisma.rateRegion.findUniqueOrThrow({ where: { name: "FL-Smaller cities" }, include: { rateCards: { where: { professionCode: "DC", durationTier: "FULL_DAY", volumeTier: "BUSY", effectiveTo: null } } } });
    expect(q.coverageCents).toBe(flSmaller.rateCards[0].clinicPriceCents);
    expect(q.supply).toMatchObject({ ok: false, available: 0, gap: "NONE_NEARBY" });
  });

  it("refuses to post with no doctor nearby: saved as a draft waiting for one, logged as demand", async () => {
    const err = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt: day.startsAt, endsAt: day.endsAt }, { post: true }).catch((e) => e);
    expect(err.code).toBe("NO_PROVIDER_AVAILABLE");
    expect(err.message).toMatch(/no doctors near you/i);
    draftId = err.details.shiftIds[0];
    const draft = await prisma.shift.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.waitingForProviderSince).not.toBeNull();
    const demand = await prisma.postingDemand.findFirstOrThrow({ where: { shiftId: draftId } });
    expect(demand).toMatchObject({ state: "NM", gap: "NONE_NEARBY", available: 0, postedAt: null });
    // Posting the draft directly is refused the same way.
    await expect(postShift(clinic.actor, draftId)).rejects.toMatchObject({ code: "NO_PROVIDER_AVAILABLE" });
    expect((await supply.demandSummary()).some((d) => d.state === "NM" && d.clinics >= 1)).toBe(true);
  });

  it("tells the clinic once a doctor can take it, and the clinic posts in one tap", async () => {
    expect((await supply.waitingDraftSweep()).notified).toBe(0);
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "NM" }], home: NM });
    const r1 = await supply.waitingDraftSweep();
    expect(r1.notified).toBeGreaterThanOrEqual(1);
    const note = await prisma.notification.findFirst({ where: { userId: clinic.user.id, template: "doctor_available" } });
    expect(note?.link).toBe(`/clinic/shifts/${draftId}`);
    // Once only while the doctor stays available.
    await supply.waitingDraftSweep();
    expect(await prisma.notification.count({ where: { userId: clinic.user.id, template: "doctor_available" } })).toBe(1);
    const q = await quoteForClinic(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt: day.startsAt, endsAt: day.endsAt });
    expect(q.supply).toMatchObject({ ok: true, available: 1 });

    await postShift(clinic.actor, draftId);
    const posted = await prisma.shift.findUniqueOrThrow({ where: { id: draftId } });
    expect(posted.status).not.toBe("DRAFT");
    expect(posted.waitingForProviderSince).toBeNull();
    expect((await prisma.postingDemand.findFirstOrThrow({ where: { shiftId: draftId } })).postedAt).not.toBeNull();

    // Fully booked: the only doctor is confirmed elsewhere at that time.
    await insertAssignment(draftId, p.id);
    const err = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt: day.startsAt, endsAt: day.endsAt }, { post: true }).catch((e) => e);
    expect(err.code).toBe("NO_PROVIDER_AVAILABLE");
    expect(err.message).toMatch(/booked/i);
    expect((await prisma.postingDemand.findFirstOrThrow({ where: { shiftId: err.details.shiftIds[0] } })).gap).toBe("BOOKED");
    // A different day is fine.
    const other = futureWeekday(19, 15);
    const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt: other.startsAt, endsAt: other.endsAt }, { post: true });
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).status).not.toBe("DRAFT");
  });

  it("an admin's switch-off is remembered, so the automatic opening never undoes it", async () => {
    const a = await adminActor();
    await admin.updateStateConfig(a, "NM", { enabled: false });
    invalidateSettings();
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "market.closedStates" } })).value).toContain("NM");
    expect((await markets.openAllMarkets()).states).toEqual([]);
    expect((await prisma.stateConfig.findUniqueOrThrow({ where: { state: "NM" } })).enabled).toBe(false);
    // Switching it back on (priced by the national card) takes it off the list.
    await admin.updateStateConfig(a, "NM", { enabled: true });
    invalidateSettings();
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "market.closedStates" } })).value).not.toContain("NM");
  });
});
