import { beforeAll, describe, expect, it } from "vitest";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { adminAssign, applyToShift, getEligibleProviders, inviteProviders, nightlyCredentialSweep, notifyEligibleProvidersOfShift, preShiftChecks, shiftBoard, SYSTEM } from "@cm/services";
import { enablePair, ensureRateCards, expectDbReject, futureWeekday, insertAssignment, makeClinic, makeProvider, makeShift } from "../factories";

/**
 * SPEC §20.1 + Addendum 01 §13.2. For every case the provider must be
 * excluded from the board, candidate list, notifications, offers and
 * applications — and a direct INSERT must fail at the database trigger.
 */

type P = Awaited<ReturnType<typeof makeProvider>>;
type C = Awaited<ReturnType<typeof makeClinic>>;
const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

async function assertExcludedEverywhere(p: P, clinic: C, shiftId: string, dbPattern = /INV-1|INV-3|INV-6|INV-8|SCOPE/) {
  // 1. shift board
  const board = await shiftBoard(p.actor);
  expect(board.map((b) => b.id)).not.toContain(shiftId);
  // 2. candidate list / match engine
  const set = await getEligibleProviders(prisma, shiftId);
  expect(set.eligible.map((e) => e.providerId)).not.toContain(p.id);
  // 3. notifications
  await notifyEligibleProvidersOfShift(shiftId, "posted");
  expect(await prisma.notification.count({ where: { userId: p.userId, link: { contains: shiftId } } })).toBe(0);
  // 4. offers (service + trigger)
  await expect(inviteProviders(clinic.actor, shiftId, [p.id])).rejects.toBeInstanceOf(DomainError);
  await expectDbReject(prisma.offer.create({ data: { shiftId, providerId: p.id, source: "ADMIN", expiresAt: new Date(Date.now() + 3_600_000) } }), dbPattern);
  // 5. applications (service + trigger)
  await expect(applyToShift(p.actor, shiftId, { commit: true })).rejects.toBeInstanceOf(DomainError);
  await expectDbReject(prisma.application.create({ data: { shiftId, providerId: p.id, scoreAtApply: 0 } }), dbPattern);
  // 6. admin manual assign + direct INSERT into Assignment
  await expect(adminAssign({ ...admin }, shiftId, p.id)).rejects.toBeInstanceOf(DomainError);
  await expectDbReject(insertAssignment(shiftId, p.id), dbPattern);
}

let fl: C;
beforeAll(async () => {
  fl = await makeClinic({ state: "FL" });
  await enablePair("LMT");
  await enablePair("LAC");
  await ensureRateCards("LMT", "FL", true);
  await ensureRateCards("LAC", "FL");
});

describe("SPEC §20.1 licensure invariant suite", () => {
  it("baseline: FL-licensed DC provider is eligible everywhere", async () => {
    const p = await makeProvider();
    const shift = await makeShift(fl.location.id);
    expect((await shiftBoard(p.actor)).map((b) => b.id)).toContain(shift.id);
    expect((await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId)).toContain(p.id);
  });

  it("1. licensed only in a different state", async () => {
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "GA" }] });
    await assertExcludedEverywhere(p, fl, (await makeShift(fl.location.id)).id);
  });

  it("2. lives in the shift's state (5 minutes away) but licensed only elsewhere", async () => {
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "GA" }], home: { lat: 28.545, lng: -81.38, state: "FL" } });
    await assertExcludedEverywhere(p, fl, (await makeShift(fl.location.id)).id);
  });

  it("3. license in the right state but PENDING_VERIFICATION", async () => {
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "FL", status: "PENDING_VERIFICATION" }] });
    await assertExcludedEverywhere(p, fl, (await makeShift(fl.location.id)).id);
  });

  it("4. VERIFIED license expiring before shift end (including mid-shift)", async () => {
    const shift = await makeShift(fl.location.id);
    const midShift = new Date(+shift.startsAt + 3 * 3_600_000);
    for (const expiresAt of [new Date(+shift.startsAt - 86_400_000), midShift]) {
      const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "FL", expiresAt }] });
      await assertExcludedEverywhere(p, fl, shift.id);
    }
  });

  it.each(["SUSPENDED", "REVOKED", "REJECTED", "EXPIRED"] as const)("5. %s license", async (status) => {
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "FL", status }] });
    await assertExcludedEverywhere(p, fl, (await makeShift(fl.location.id)).id);
  });

  it("6. multi-day group where the license expires before the last day", async () => {
    const day1 = await makeShift(fl.location.id, { days: 20 });
    const day3 = await makeShift(fl.location.id, { days: 27 }); // next Wednesday (the helper snaps to Wednesdays)
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "FL", expiresAt: new Date(+day1.endsAt + 86_400_000) }] });
    expect((await getEligibleProviders(prisma, day1.id)).eligible.map((e) => e.providerId)).toContain(p.id);
    await assertExcludedEverywhere(p, fl, day3.id);
  });

  it("7. license lapses after confirmation → nightly sweep and 24h pre-check flag it and start backfill", async () => {
    const p = await makeProvider();
    const shift = await makeShift(fl.location.id, { days: 12 });
    const { assignmentId } = await adminAssign({ ...admin }, shift.id, p.id);
    // Lapse: board suspends the license.
    await prisma.license.updateMany({ where: { providerId: p.id }, data: { status: "SUSPENDED" } });
    const r = await nightlyCredentialSweep();
    expect(r.lapsed).toBeGreaterThanOrEqual(1);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe("LICENSE_LAPSED");
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe("OPEN"); // backfill
    expect(await prisma.adminTask.count({ where: { kind: "LICENSE_LAPSED", entityId: assignmentId } })).toBe(1);

    // 24h pre-check path: a second provider whose license expires the night before.
    const p2 = await makeProvider();
    const soon = await makeShift(fl.location.id, { days: 0 });
    // Move the shift to ~20h from now.
    const start = new Date(Date.now() + 20 * 3_600_000);
    await prisma.shift.update({ where: { id: soon.id }, data: { startsAt: start, endsAt: new Date(+start + 8 * 3_600_000) } });
    const a2 = await adminAssign({ ...admin }, soon.id, p2.id);
    await prisma.malpracticePolicy.updateMany({ where: { providerId: p2.id }, data: { status: "EXPIRED" } });
    const pre = await preShiftChecks();
    expect(pre.lapsed).toBeGreaterThanOrEqual(1);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: a2.assignmentId } })).status).toBe("LICENSE_LAPSED");
  });

  it("8. admin manual assign of an ineligible provider → LICENSE_STATE_MISMATCH", async () => {
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "GA" }] });
    const shift = await makeShift(fl.location.id);
    await expect(adminAssign({ ...admin }, shift.id, p.id)).rejects.toMatchObject({ code: "LICENSE_STATE_MISMATCH" });
  });

  it("9. changing a location's state without re-geocoding is blocked", async () => {
    const c = await makeClinic({ state: "FL" });
    await expectDbReject(prisma.clinicLocation.update({ where: { id: c.location.id }, data: { state: "GA" } }), /INV-1/);
    await expectDbReject(prisma.clinicLocation.update({ where: { id: c.location.id }, data: { lat: 33.7, lng: -84.3 } }), /INV-1/);
    // With an active shift, even a re-geocode can't move it to another state.
    await makeShift(c.location.id);
    await expectDbReject(prisma.clinicLocation.update({ where: { id: c.location.id }, data: { state: "GA", geocodedAt: new Date() } }), /INV-1/);
    // A shift's state can't be edited to differ from its location.
    const s = await makeShift(c.location.id);
    await expectDbReject(prisma.shift.update({ where: { id: s.id }, data: { state: "GA" } }), /INV-1/);
  });

  it("INV-6: shifts can't be posted in a disabled state", async () => {
    const al = await makeClinic({ state: "AL" });
    await expectDbReject(makeShift(al.location.id, { status: "OPEN" }), /INV-6/);
    const draft = await makeShift(al.location.id, { status: "DRAFT" });
    await expectDbReject(prisma.shift.update({ where: { id: draft.id }, data: { status: "OPEN" } }), /INV-6/);
  });
});

describe("Addendum 01 §13.2 — profession + state", () => {
  it("1. DC license in FL → excluded from an LMT shift in FL", async () => {
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "FL" }], professions: [{ code: "DC" }, { code: "LMT" }], malpractice: [{ covered: ["DC", "LMT"] }] });
    await assertExcludedEverywhere(p, fl, (await makeShift(fl.location.id, { professionCode: "LMT" })).id);
  });

  it("2. LMT license in FL → excluded from a DC shift in FL", async () => {
    const p = await makeProvider({ licenses: [{ professionCode: "LMT", state: "FL" }], professions: [{ code: "DC" }, { code: "LMT" }], malpractice: [{ covered: ["DC", "LMT"] }] });
    await assertExcludedEverywhere(p, fl, (await makeShift(fl.location.id)).id);
  });

  it("3. DC-GA + LMT-FL → only DC-GA and LMT-FL", async () => {
    await enablePair("DC", "GA");
    await enablePair("LMT", "GA");
    await ensureRateCards("DC", "GA");
    const ga = await makeClinic({ state: "GA" });
    const p = await makeProvider({
      licenses: [
        { professionCode: "DC", state: "GA" },
        { professionCode: "LMT", state: "FL" },
      ],
      malpractice: [{ covered: ["DC", "LMT"] }],
      home: { lat: 31.0, lng: -83.0, state: "GA" },
      willingOvernight: true,
      maxDriveMinutes: 600,
    });
    const dcGA = await makeShift(ga.location.id, { professionCode: "DC", lodgingAllowed: true });
    const lmtFL = await makeShift(fl.location.id, { professionCode: "LMT", lodgingAllowed: true });
    const eligDcGa = await getEligibleProviders(prisma, dcGA.id);
    const eligLmtFl = await getEligibleProviders(prisma, lmtFL.id);
    expect(eligDcGa.eligible.map((e) => e.providerId)).toContain(p.id);
    expect(eligLmtFl.eligible.map((e) => e.providerId)).toContain(p.id);
    await assertExcludedEverywhere(p, fl, (await makeShift(fl.location.id, { professionCode: "DC", lodgingAllowed: true })).id);
    await assertExcludedEverywhere(p, ga, (await makeShift(ga.location.id, { professionCode: "LMT", lodgingAllowed: true })).id);
  });

  it("4. dual DC + LAc in FL: eligible for both, but never overlapping (INV-2 across professions)", async () => {
    const p = await makeProvider({
      licenses: [
        { professionCode: "DC", state: "FL" },
        { professionCode: "LAC", state: "FL" },
      ],
    });
    const dc = await makeShift(fl.location.id, { professionCode: "DC", days: 30 });
    const lac = await makeShift(fl.location.id, { professionCode: "LAC", days: 30 });
    expect((await getEligibleProviders(prisma, dc.id)).eligible.map((e) => e.providerId)).toContain(p.id);
    expect((await getEligibleProviders(prisma, lac.id)).eligible.map((e) => e.providerId)).toContain(p.id);
    await insertAssignment(dc.id, p.id);
    await prisma.shift.update({ where: { id: dc.id }, data: { status: "CONFIRMED" } });
    expect((await getEligibleProviders(prisma, lac.id)).eligible.map((e) => e.providerId)).not.toContain(p.id);
    await expectDbReject(insertAssignment(lac.id, p.id), /no_provider_overlap|exclusion|conflicting key/i);
  });

  it("5. PTA shift without supervision attestation can't be posted; direct assignment fails (INV-8)", async () => {
    await enablePair("PTA", "FL", { supervisionRequired: true, supervising: ["PT"] });
    const p = await makeProvider({ licenses: [{ professionCode: "PTA", state: "FL" }] });
    await expectDbReject(makeShift(fl.location.id, { professionCode: "PTA" }), /INV-8/);
    const draft = await makeShift(fl.location.id, { professionCode: "PTA", status: "DRAFT" });
    await expectDbReject(prisma.shift.update({ where: { id: draft.id }, data: { status: "OPEN" } }), /INV-8/);
    await expectDbReject(insertAssignment(draft.id, p.id), /INV-8/);
    // With a valid attestation it posts and the provider qualifies.
    const ok = await makeShift(fl.location.id, {
      professionCode: "PTA",
      attestation: { supervisorName: "Dana Lee", supervisorProfessionCode: "PT", supervisorLicenseNumber: "PT12345", onSiteEntireShift: true },
    });
    expect((await getEligibleProviders(prisma, ok.id)).eligible.map((e) => e.providerId)).toContain(p.id);
  });

  it("6. PTA attestation naming a supervising OT is rejected", async () => {
    await enablePair("PTA", "FL", { supervisionRequired: true, supervising: ["PT"] });
    await expectDbReject(
      makeShift(fl.location.id, {
        professionCode: "PTA",
        attestation: { supervisorName: "Omar Ortiz", supervisorProfessionCode: "OT", supervisorLicenseNumber: "OT999", onSiteEntireShift: true },
      }),
      /INV-8/,
    );
  });

  it("7. profession disabled in an enabled state → can't post; direct insert fails", async () => {
    const p = await makeProvider({ licenses: [{ professionCode: "OT", state: "FL" }] });
    await expectDbReject(makeShift(fl.location.id, { professionCode: "OT" }), /INV-6/);
    const draft = await makeShift(fl.location.id, { professionCode: "OT", status: "DRAFT" });
    await expectDbReject(insertAssignment(draft.id, p.id), /INV-6/);
  });

  it("8. malpractice policy doesn't list the shift's profession", async () => {
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "FL" }], malpractice: [{ covered: ["LMT"] }] });
    await assertExcludedEverywhere(p, fl, (await makeShift(fl.location.id)).id);
  });

  it("9. malpractice below the profession-state minimum", async () => {
    const p = await makeProvider({ malpractice: [{ covered: ["DC"], perOccurrenceCents: 50_000_000 }] });
    await assertExcludedEverywhere(p, fl, (await makeShift(fl.location.id)).id);
  });

  it("10. shift requiring Dry Needling with no allowing SkillStateRule can't be posted", async () => {
    const dn = await prisma.skill.findFirstOrThrow({ where: { name: "Dry Needling", professionCode: "DC" } });
    await expectDbReject(makeShift(fl.location.id, { requiredSkillIds: [dn.id] }), /SCOPE/);
  });

  it("11. required certification-based skill with an expired certification → excluded", async () => {
    const dn = await prisma.skill.findFirstOrThrow({ where: { name: "Dry Needling", professionCode: "DC" } });
    await prisma.skillStateRule.upsert({
      where: { skillId_professionCode_state: { skillId: dn.id, professionCode: "DC", state: "FL" } },
      create: { skillId: dn.id, professionCode: "DC", state: "FL", allowed: true },
      update: { allowed: true },
    });
    const shift = await makeShift(fl.location.id, { requiredSkillIds: [dn.id] });
    const expired = await makeProvider({ skills: [{ skillId: dn.id, certificationStatus: "VERIFIED", certificationExpiresAt: new Date("2025-01-01") }] });
    await assertExcludedEverywhere(expired, fl, shift.id);
    const certified = await makeProvider({ skills: [{ skillId: dn.id, certificationStatus: "VERIFIED", certificationExpiresAt: new Date("2031-01-01") }] });
    expect((await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId)).toContain(certified.id);
    await prisma.skillStateRule.delete({ where: { skillId_professionCode_state: { skillId: dn.id, professionCode: "DC", state: "FL" } } });
  });

  it("disabling a pair blocks new postings but not the rest of the state", async () => {
    await enablePair("LAC");
    await prisma.professionStateConfig.update({ where: { professionCode_state: { professionCode: "LAC", state: "FL" } }, data: { enabled: false } });
    await expectDbReject(makeShift(fl.location.id, { professionCode: "LAC" }), /INV-6/);
    await makeShift(fl.location.id, { professionCode: "DC" });
    await enablePair("LAC");
  });

  it("PSC enable checklist is enforced by the database", async () => {
    await expectDbReject(
      prisma.professionStateConfig.upsert({
        where: { professionCode_state: { professionCode: "ATC", state: "FL" } },
        create: { professionCode: "ATC", state: "FL", enabled: true },
        update: { enabled: true, legalReviewComplete: false },
      }),
      /psc_enable_checklist/,
    );
    await expectDbReject(
      prisma.professionStateConfig.create({
        data: { professionCode: "ATC", state: "TX", enabled: true, legalReviewComplete: true, boardLookupUrl: "x", supervisionRequired: false, malpracticeMinOccurrenceCents: 1, malpracticeMinAggregateCents: 1 },
      }),
      /INV-6/,
    );
  });
});

describe("posting service mirrors the DB rules", () => {
  it("refuses PTA without attestation and out-of-scope skills with clear codes", async () => {
    const { createShift } = await import("@cm/services");
    await enablePair("PTA", "FL", { supervisionRequired: true, supervising: ["PT"] });
    await ensureRateCards("PTA", "FL");
    const { startsAt, endsAt } = futureWeekday(15);
    await expect(createShift(fl.actor, { locationId: fl.location.id, professionCode: "PTA", startsAt, endsAt }, { post: true })).rejects.toMatchObject({ code: "SUPERVISION_NOT_ATTESTED" });
    const dn = await prisma.skill.findFirstOrThrow({ where: { name: "Dry Needling", professionCode: "DC" } });
    await expect(createShift(fl.actor, { locationId: fl.location.id, professionCode: "DC", startsAt, endsAt, requiredSkillIds: [dn.id] }, { post: true })).rejects.toMatchObject({ code: "SKILL_NOT_IN_SCOPE" });
    await expect(createShift(fl.actor, { locationId: fl.location.id, professionCode: "OT", startsAt, endsAt }, { post: true })).rejects.toBeInstanceOf(DomainError);
    void SYSTEM;
  });
});
