import { beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { prisma, type LicenseStatus } from "@cm/db";
import { evaluateProviderForShift, evaluateProviderForShifts, getEligibleProviders } from "@cm/services";
import { enablePair, futureWeekday, insertAssignment, makeClinic, makeProvider, makeShift } from "../factories";

/**
 * SPEC §20.1 #10 / Addendum 01 §13.2 #12: the set-based query
 * (getEligibleProviders) and the single check (assertProviderEligibleForShift,
 * via evaluateProviderForShift) agree on every provider × shift pair of
 * randomized datasets — random professions, states, statuses, expiries,
 * malpractice coverage/limits, homes and drive limits. ≥ 1,000 cases.
 */

const PROFS = ["DC", "LMT", "LAC"] as const;
const STATES = ["FL", "GA"] as const;
const STATUSES: LicenseStatus[] = ["VERIFIED", "VERIFIED", "VERIFIED", "VERIFIED", "VERIFIED", "PENDING_VERIFICATION", "EXPIRED", "SUSPENDED"];

const licenseArb = fc.record({
  professionCode: fc.constantFrom(...PROFS),
  state: fc.constantFrom(...STATES),
  status: fc.constantFrom(...STATUSES),
  // Some expire before, during, or after the shift window (days 10–40 from now).
  expiresInDays: fc.constantFrom(5, 15, 25, 400, 400, 400),
});

const providerArb = fc.record({
  licenses: fc.uniqueArray(licenseArb, { minLength: 1, maxLength: 4, selector: (l) => `${l.professionCode}:${l.state}` }),
  covered: fc.constantFrom<string[]>(["DC", "LMT", "LAC"], ["DC", "LMT", "LAC"], ["DC"], ["LMT", "LAC"], []),
  malpracticeStatus: fc.constantFrom<LicenseStatus>("VERIFIED", "VERIFIED", "VERIFIED", "PENDING_VERIFICATION", "EXPIRED"),
  perOccurrence: fc.constantFrom(50_000_000, 100_000_000, 200_000_000, 200_000_000),
  homeState: fc.constantFrom(...STATES),
  jitterLat: fc.double({ min: -0.8, max: 0.8, noNaN: true }),
  jitterLng: fc.double({ min: -0.8, max: 0.8, noNaN: true }),
  maxDriveMinutes: fc.constantFrom(30, 60, 90, 180, 180),
  willingOvernight: fc.boolean(),
  active: fc.constantFrom(true, true, true, false),
});

const shiftArb = fc.record({
  state: fc.constantFrom(...STATES),
  professionCode: fc.constantFrom(...PROFS),
  days: fc.integer({ min: 10, max: 40 }),
  lodgingAllowed: fc.boolean(),
});

const datasetArb = fc.record({
  providers: fc.array(providerArb, { minLength: 30, maxLength: 30 }),
  shifts: fc.array(shiftArb, { minLength: 18, maxLength: 18 }),
});

const CENTER = { FL: { lat: 28.54, lng: -81.38 }, GA: { lat: 33.75, lng: -84.39 } };

let clinics: Record<string, Awaited<ReturnType<typeof makeClinic>>>;
beforeAll(async () => {
  await enablePair("DC", "GA");
  await enablePair("LMT", "FL");
  await enablePair("LMT", "GA");
  await enablePair("LAC", "FL", { minOcc: 150_000_000 }); // stricter minimum in one pair
  // LAC stays disabled in GA → F0 must fail consistently.
  await prisma.professionStateConfig.deleteMany({ where: { professionCode: "LAC", state: "GA" } });
  clinics = { FL: await makeClinic({ state: "FL" }), GA: await makeClinic({ state: "GA" }) };
});

describe("eligibility: set-based query ≡ single check", () => {
  it("agrees on ≥1,000 generated provider × shift cases", async () => {
    let cases = 0;
    let eligibleCount = 0;
    await fc.assert(
      fc.asyncProperty(datasetArb, async (ds) => {
        const providers = [];
        for (const p of ds.providers) {
          const c = CENTER[p.homeState];
          providers.push(
            await makeProvider({
              licenses: p.licenses.map((l) => ({ professionCode: l.professionCode, state: l.state, status: l.status, expiresAt: new Date(Date.now() + l.expiresInDays * 86_400_000) })),
              professions: PROFS.map((code) => ({ code, status: p.active ? "ACTIVE" : "ONBOARDING" })),
              malpractice: p.covered.length ? [{ covered: [...p.covered], status: p.malpracticeStatus, perOccurrenceCents: p.perOccurrence }] : null,
              home: { lat: c.lat + p.jitterLat, lng: c.lng + p.jitterLng, state: p.homeState },
              maxDriveMinutes: p.maxDriveMinutes,
              willingOvernight: p.willingOvernight,
            }),
          );
        }
        const ids = new Set(providers.map((p) => p.id));
        for (const s of ds.shifts) {
          const loc = clinics[s.state].location;
          const shift = await makeShift(loc.id, { professionCode: s.professionCode, days: s.days, lodgingAllowed: s.lodgingAllowed, status: "DRAFT" });
          const set = new Set((await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId).filter((id) => ids.has(id)));
          for (const p of providers) {
            const single = (await evaluateProviderForShift(prisma, p.id, shift.id)).result.eligible;
            expect(single, `provider ${p.id} shift ${shift.id}`).toBe(set.has(p.id));
            cases++;
            if (single) eligibleCount++;
          }
          await prisma.shift.delete({ where: { id: shift.id } });
        }
      }),
      { numRuns: 2, seed: 20260929 },
    );
    expect(cases).toBeGreaterThanOrEqual(1000);
    // The generator must actually produce both outcomes, or the test proves nothing.
    expect(eligibleCount).toBeGreaterThan(0);
    expect(eligibleCount).toBeLessThan(cases);
    console.log(`property test: ${cases} cases, ${eligibleCount} eligible`);
  });
});

describe("eligibility: provider board batch ≡ single check", () => {
  it("evaluateProviderForShifts gives the same result and reasons as evaluateProviderForShift for every shift", async () => {
    const [ds] = fc.sample(datasetArb, { seed: 20261003, numRuns: 1 });
    const providers = [];
    for (const p of ds.providers) {
      const c = CENTER[p.homeState];
      providers.push(
        await makeProvider({
          licenses: p.licenses.map((l) => ({ professionCode: l.professionCode, state: l.state, status: l.status, expiresAt: new Date(Date.now() + l.expiresInDays * 86_400_000) })),
          professions: PROFS.map((code) => ({ code, status: p.active ? "ACTIVE" : "ONBOARDING" })),
          malpractice: p.covered.length ? [{ covered: [...p.covered], status: p.malpracticeStatus, perOccurrenceCents: p.perOccurrence }] : null,
          home: { lat: c.lat + p.jitterLat, lng: c.lng + p.jitterLng, state: p.homeState },
          maxDriveMinutes: p.maxDriveMinutes,
          willingOvernight: p.willingOvernight,
        }),
      );
    }
    const shifts = [];
    for (const s of ds.shifts) shifts.push(await makeShift(clinics[s.state].location.id, { professionCode: s.professionCode, days: s.days, lodgingAllowed: s.lodgingAllowed, status: "DRAFT" }));
    // A booked provider: their own shift must not count as busy, a second shift at the same time must.
    let booked: { providerId: string; shiftId: string; twinId: string } | null = null;
    for (const sh of shifts) {
      for (const p of providers) {
        if ((await evaluateProviderForShift(prisma, p.id, sh.id)).result.eligible) {
          await insertAssignment(sh.id, p.id);
          const twin = await makeShift(sh.locationId, { professionCode: sh.professionCode, days: ds.shifts[shifts.indexOf(sh)].days, status: "DRAFT" });
          booked = { providerId: p.id, shiftId: sh.id, twinId: twin.id };
          shifts.push(twin);
          break;
        }
      }
      if (booked) break;
    }
    expect(booked).not.toBeNull();
    const ids = shifts.map((sh) => sh.id);
    let cases = 0;
    let eligible = 0;
    for (const p of providers) {
      const batch = await evaluateProviderForShifts(prisma, p.id, ids);
      for (const id of ids) {
        const single = await evaluateProviderForShift(prisma, p.id, id);
        const b = batch.get(id)!;
        expect(b.result.eligible, `provider ${p.id} shift ${id}`).toBe(single.result.eligible);
        expect(b.result.failures.map((f) => f.code)).toEqual(single.result.failures.map((f) => f.code));
        expect(b.pair).toEqual(single.pair);
        cases++;
        if (single.result.eligible) eligible++;
      }
    }
    const own = (await evaluateProviderForShifts(prisma, booked!.providerId, [booked!.shiftId, booked!.twinId]));
    expect(own.get(booked!.shiftId)!.result.eligible).toBe(true);
    expect(own.get(booked!.twinId)!.result.eligible).toBe(false);
    expect(eligible).toBeGreaterThan(0);
    expect(eligible).toBeLessThan(cases);
    await prisma.assignment.deleteMany({ where: { shiftId: { in: ids } } });
    await prisma.shift.deleteMany({ where: { id: { in: ids } } });
  });
});

void futureWeekday;
