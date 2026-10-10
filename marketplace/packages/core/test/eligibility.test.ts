import { describe, expect, it } from "vitest";
import {
  assertEligible, DomainError, evaluateEligibility, evaluateGroupEligibility, hasQualifyingLicense, licensedPairs, skillScopeProblem,
  supervisionProblem, parseAttestation,
} from "../src";
import { config, d, FAR, lic, OPTS, pair, policy, provider, shift } from "./fixtures";

const codes = (r: ReturnType<typeof evaluateEligibility>) => r.failures.map((f) => f.code);
const ok = (p = provider(), s = shift(), pr = pair()) => evaluateEligibility(p, s, pr, OPTS).eligible;

// Everything a dual-profession provider needs to pass operational filters
const multi = (licenses: ReturnType<typeof lic>[], codes: string[]) =>
  provider({ licenses, professions: codes.map((c) => ({ professionCode: c, status: "ACTIVE" as const })), malpractice: [policy(codes)] });

describe("INV-1 licensure (SPEC §20.1)", () => {
  it("baseline provider is eligible", () => {
    expect(evaluateEligibility(provider(), shift(), pair(), OPTS)).toEqual({ eligible: true, failures: [] });
  });

  it("1. licensed only in a different state → LICENSE_STATE_MISMATCH", () => {
    const r = evaluateEligibility(provider({ licenses: [lic("DC", "GA")] }), shift(), pair(), OPTS);
    expect(r.failures[0]).toMatchObject({ filter: "F1", code: "LICENSE_STATE_MISMATCH" });
  });

  it("2. living nearby does not matter — only licenses count", () => {
    const r = evaluateEligibility(provider({ licenses: [lic("DC", "GA")] }), shift(), pair({ driveMinutes: 5 }), OPTS);
    expect(codes(r)).toContain("LICENSE_STATE_MISMATCH");
  });

  it("3. PENDING_VERIFICATION license does not count", () => {
    expect(codes(evaluateEligibility(provider({ licenses: [lic("DC", "FL", "PENDING_VERIFICATION")] }), shift(), pair(), OPTS))).toContain("LICENSE_STATE_MISMATCH");
  });

  it("4. license expiring before shift end (incl. mid-shift) → LICENSE_EXPIRES_BEFORE_SHIFT", () => {
    const s = shift();
    for (const exp of [d("2026-10-01"), d("2026-10-14T17:00:00Z"), s.endsAt]) {
      const r = evaluateEligibility(provider({ licenses: [lic("DC", "FL", "VERIFIED", exp)] }), s, pair(), OPTS);
      expect(r.failures[0]).toMatchObject({ filter: "F1", code: "LICENSE_EXPIRES_BEFORE_SHIFT" });
    }
  });

  it.each(["SUSPENDED", "REVOKED", "REJECTED", "EXPIRED"] as const)("5. %s license does not count", (status) => {
    const r = evaluateEligibility(provider({ licenses: [lic("DC", "FL", status)] }), shift(), pair(), OPTS);
    expect(r.failures[0].filter).toBe("F1");
  });

  it("6. multi-day group fails if license expires before the last day", () => {
    const days = [0, 1, 2].map((i) =>
      shift({ id: `s${i}`, startsAt: new Date(+d("2026-10-14T13:00:00Z") + i * 86400000), endsAt: new Date(+d("2026-10-14T21:00:00Z") + i * 86400000) }),
    );
    const r = evaluateGroupEligibility(provider({ licenses: [lic("DC", "FL", "VERIFIED", d("2026-10-15T23:00:00Z"))] }), days, () => pair(), OPTS);
    expect(r.failures.filter((f) => f.filter === "F1")).toHaveLength(1);
  });

  it("F1 is never relaxed by the distance boost", () => {
    const r = evaluateEligibility(provider({ willingOvernight: true, licenses: [lic("DC", "GA")] }), shift({ lodgingAllowed: true }), pair(), {
      ...OPTS,
      distanceMultiplier: 10,
    });
    expect(codes(r)).toContain("LICENSE_STATE_MISMATCH");
  });

  it("assertEligible throws the F1 code", () => {
    const r = evaluateEligibility(provider({ licenses: [] }), shift(), pair(), OPTS);
    expect(() => assertEligible(r)).toThrowError(DomainError);
    try {
      assertEligible(r);
    } catch (e) {
      expect((e as DomainError).code).toBe("LICENSE_STATE_MISMATCH");
    }
  });
});

describe("Addendum 01 §13.2 — profession + state", () => {
  const lmtFL = shift({ professionCode: "LMT" });
  const dcFL = shift({ professionCode: "DC" });
  const dcGA = shift({ professionCode: "DC", state: "GA" });
  const lmtGA = shift({ professionCode: "LMT", state: "GA" });

  it("1. DC license in FL → excluded from an LMT shift in FL", () => {
    const p = multi([lic("DC", "FL")], ["DC", "LMT"]);
    expect(codes(evaluateEligibility(p, lmtFL, pair(), OPTS))).toContain("LICENSE_PROFESSION_MISMATCH");
  });

  it("2. LMT license in FL → excluded from a DC shift in FL", () => {
    const p = multi([lic("LMT", "FL")], ["DC", "LMT"]);
    expect(codes(evaluateEligibility(p, dcFL, pair(), OPTS))).toContain("LICENSE_PROFESSION_MISMATCH");
  });

  it("3. DC-GA + LMT-FL → eligible only for DC-GA and LMT-FL", () => {
    const p = multi([lic("DC", "GA"), lic("LMT", "FL")], ["DC", "LMT"]);
    expect(ok(p, dcGA)).toBe(true);
    expect(ok(p, lmtFL)).toBe(true);
    expect(ok(p, dcFL)).toBe(false);
    expect(ok(p, lmtGA)).toBe(false);
  });

  it("4. dual DC + LAc in FL eligible for both, but not for overlapping shifts in either", () => {
    const p = multi([lic("DC", "FL"), lic("LAC", "FL")], ["DC", "LAC"]);
    const lac = shift({ professionCode: "LAC" });
    expect(ok(p, dcFL)).toBe(true);
    expect(ok(p, lac)).toBe(true);
    const busy = { ...p, busy: [{ start: +dcFL.startsAt, end: +dcFL.endsAt }] };
    expect(codes(evaluateEligibility(busy, lac, pair(), OPTS))).toContain("SCHEDULE_CONFLICT");
  });

  const ptaCfg = config({ supervisionRequired: true, supervisingProfessionCodes: ["PT"] });
  const pta = multi([lic("PTA", "FL")], ["PTA"]);
  const attest = { supervisorName: "Dana Lee", supervisorProfessionCode: "PT", supervisorLicenseNumber: "PT12345", onSiteEntireShift: true };

  it("5. PTA shift with no supervision attestation → SUPERVISION_NOT_ATTESTED", () => {
    const r = evaluateEligibility(pta, shift({ professionCode: "PTA", config: ptaCfg }), pair(), OPTS);
    expect(codes(r)).toEqual(["SUPERVISION_NOT_ATTESTED"]);
    expect(ok(pta, shift({ professionCode: "PTA", config: ptaCfg, supervisionAttestation: attest }))).toBe(true);
  });

  it("6. PTA attestation naming a supervising OT (not PT) is rejected", () => {
    const s = shift({ professionCode: "PTA", config: ptaCfg, supervisionAttestation: { ...attest, supervisorProfessionCode: "OT" } });
    expect(codes(evaluateEligibility(pta, s, pair(), OPTS))).toContain("SUPERVISION_NOT_ATTESTED");
    expect(supervisionProblem({ ...attest, onSiteEntireShift: false }, ["PT"])).toMatch(/on site/);
    expect(parseAttestation({ supervisorName: " A B ", supervisorProfessionCode: "pt", supervisorLicenseNumber: "1", onSiteEntireShift: true })).toMatchObject({
      supervisorName: "A B",
      supervisorProfessionCode: "PT",
    });
  });

  it("7. profession disabled in an enabled state → PROFESSION_NOT_ENABLED", () => {
    const p = multi([lic("LMT", "FL")], ["LMT"]);
    expect(codes(evaluateEligibility(p, shift({ professionCode: "LMT", config: config({ enabled: false }) }), pair(), OPTS))).toContain("PROFESSION_NOT_ENABLED");
    expect(codes(evaluateEligibility(provider(), shift({ config: config({ stateEnabled: false }) }), pair(), OPTS))).toContain("PROFESSION_NOT_ENABLED");
  });

  it("8. malpractice policy not listing the shift's profession → excluded", () => {
    const p = provider({ malpractice: [policy(["LMT"])] });
    expect(codes(evaluateEligibility(p, dcFL, pair(), OPTS))).toContain("MALPRACTICE_INVALID");
  });

  it("9. malpractice below the profession-state minimum → excluded", () => {
    const s = shift({ config: config({ malpracticeMinOccurrenceCents: 200_000_000 }) });
    expect(codes(evaluateEligibility(provider(), s, pair(), OPTS))).toContain("MALPRACTICE_INVALID");
    expect(codes(evaluateEligibility(provider({ malpractice: [policy(["DC"], { status: "PENDING_VERIFICATION" })] }), dcFL, pair(), OPTS))).toContain(
      "MALPRACTICE_INVALID",
    );
  });

  it("10. scope-sensitive skill without an allowing rule is out of scope", () => {
    const dryNeedling = { id: "dn", requiresCertification: true, scopeSensitive: true, allowedInScope: false };
    expect(skillScopeProblem([dryNeedling])).toMatch(/scope of practice/);
    expect(skillScopeProblem([{ ...dryNeedling, allowedInScope: true }])).toBeNull();
    // Even a certified provider can't match a shift requiring an out-of-scope skill
    const p = provider({ skills: [{ skillId: "dn", certificationStatus: "VERIFIED", certificationExpiresAt: FAR }] });
    expect(codes(evaluateEligibility(p, shift({ requiredSkillIds: ["dn"], skills: [dryNeedling] }), pair(), OPTS))).toContain("MISSING_REQUIRED_SKILL");
  });

  it("11. required certification-based skill with expired certification → excluded", () => {
    const dn = { id: "dn", requiresCertification: true, scopeSensitive: true, allowedInScope: true };
    const s = shift({ requiredSkillIds: ["dn"], skills: [dn] });
    const expired = provider({ skills: [{ skillId: "dn", certificationStatus: "VERIFIED", certificationExpiresAt: d("2026-01-01") }] });
    const pending = provider({ skills: [{ skillId: "dn", certificationStatus: "PENDING_VERIFICATION", certificationExpiresAt: FAR }] });
    const good = provider({ skills: [{ skillId: "dn", certificationStatus: "VERIFIED", certificationExpiresAt: FAR }] });
    expect(codes(evaluateEligibility(expired, s, pair(), OPTS))).toContain("MISSING_REQUIRED_SKILL");
    expect(codes(evaluateEligibility(pending, s, pair(), OPTS))).toContain("MISSING_REQUIRED_SKILL");
    expect(ok(good, s)).toBe(true);
  });

  it("F3 is per profession: ACTIVE for DC while LMT still onboarding", () => {
    const p = provider({
      licenses: [lic("DC", "FL"), lic("LMT", "FL")],
      malpractice: [policy(["DC", "LMT"])],
      professions: [
        { professionCode: "DC", status: "ACTIVE" },
        { professionCode: "LMT", status: "ONBOARDING" },
      ],
    });
    expect(ok(p, dcFL)).toBe(true);
    expect(codes(evaluateEligibility(p, lmtFL, pair(), OPTS))).toContain("PROVIDER_NOT_ACTIVE");
  });

  it("licensedPairs groups verified, unexpired licenses by profession", () => {
    expect(
      licensedPairs([lic("DC", "GA"), lic("DC", "FL"), lic("LMT", "FL"), lic("LMT", "AL", "PENDING_VERIFICATION"), lic("DC", "TX", "VERIFIED", d("2020-01-01"))], d("2026-09-29")),
    ).toEqual({ DC: ["FL", "GA"], LMT: ["FL"] });
    expect(hasQualifyingLicense([lic("DC", "FL")], "LMT", "FL", d("2026-01-01"))).toBe(false);
  });

  it("a national registry credential counts only where the state accepts one for that profession", () => {
    const sono = (over: Parameters<typeof config>[0] = {}) => shift({ professionCode: "SONO", config: config(over) });
    const p = provider({ licenses: [lic("SONO", "US")], professions: [{ professionCode: "SONO", status: "ACTIVE" }], malpractice: [{ ...provider().malpractice[0], coveredProfessionCodes: ["SONO"] }] });
    expect(ok(p, sono({ nationalCredentialAccepted: true }))).toBe(true);
    expect(codes(evaluateEligibility(p, sono(), pair(), OPTS))).toContain("LICENSE_STATE_MISMATCH");
    // Wrong profession, not verified, or expiring mid-shift never qualifies.
    expect(hasQualifyingLicense([lic("DC", "US")], "SONO", "FL", d("2026-10-14"), true)).toBe(false);
    expect(hasQualifyingLicense([lic("SONO", "US", "PENDING_VERIFICATION")], "SONO", "FL", d("2026-10-14"), true)).toBe(false);
    const expiring = provider({ ...p, licenses: [lic("SONO", "US", "VERIFIED", d("2026-10-14T15:00:00Z"))] });
    expect(codes(evaluateEligibility(expiring, sono({ nationalCredentialAccepted: true }), pair(), OPTS))).toContain("LICENSE_EXPIRES_BEFORE_SHIFT");
    // A state license still works where national credentials are also accepted.
    expect(hasQualifyingLicense([lic("SONO", "FL")], "SONO", "FL", d("2026-10-14"), true)).toBe(true);
    expect(licensedPairs([lic("SONO", "US"), lic("DC", "GA")], d("2026-09-29"), { SONO: ["FL", "TX"] })).toEqual({ SONO: ["FL", "TX"], DC: ["GA"] });
    expect(licensedPairs([lic("SONO", "US")], d("2026-09-29"))).toEqual({});
  });
});

describe("other hard filters", () => {
  it("credentialsOnly skips operational filters", () => {
    expect(evaluateEligibility(provider({ status: "PAUSED" }), shift(), pair({ blocked: true }), { ...OPTS, credentialsOnly: true }).eligible).toBe(true);
  });

  it("F11 clinic's minimum experience: years practicing the shift's profession", () => {
    const years = (n: number | null) => provider({ professions: [{ professionCode: "DC", status: "ACTIVE", yearsInPractice: n }] });
    expect(ok(years(null), shift())).toBe(true); // no minimum = anyone
    expect(codes(evaluateEligibility(years(3), shift({ minYearsExperience: 5 }), pair(), OPTS))).toEqual(["INSUFFICIENT_EXPERIENCE"]);
    expect(codes(evaluateEligibility(years(null), shift({ minYearsExperience: 2 }), pair(), OPTS))).toEqual(["INSUFFICIENT_EXPERIENCE"]);
    expect(ok(years(5), shift({ minYearsExperience: 5 }))).toBe(true);
    // A credentials-only check (nightly sweep) never looks at preferences.
    expect(evaluateEligibility(years(0), shift({ minYearsExperience: 10 }), pair(), { ...OPTS, credentialsOnly: true }).eligible).toBe(true);
  });

  it("F12 provider minimum pay: base pay only, mileage only when opted in, per duration", () => {
    const floor = (over: Partial<{ minHalfDayCents: number | null; minFullDayCents: number | null; minHourlyCents: number | null; includeMileage: boolean }> = {}) =>
      provider({ payFloors: [{ professionCode: "DC", minHalfDayCents: null, minFullDayCents: 45000, minHourlyCents: null, includeMileage: false, ...over }] });
    const light = shift({ pay: { durationTier: "FULL_DAY", providerPayCents: 39000, billableHours: 8 } });
    expect(codes(evaluateEligibility(floor(), light, pair(), OPTS))).toEqual(["BELOW_PAY_FLOOR"]);
    // A rush/boost that lifts pay over the floor makes them eligible.
    expect(ok(floor(), shift({ pay: { durationTier: "FULL_DAY", providerPayCents: 48750, billableHours: 8 } }))).toBe(true);
    // Mileage counts only when they asked for it.
    expect(ok(floor({ includeMileage: true }), light, pair({ mileageCents: 6000 }))).toBe(true);
    expect(ok(floor(), light, pair({ mileageCents: 6000 }))).toBe(false);
    // No floor for this duration / profession / no pay facts = pass.
    expect(ok(floor(), shift({ pay: { durationTier: "HALF_DAY", providerPayCents: 100, billableHours: 3 } }))).toBe(true);
    expect(ok(provider(), light)).toBe(true);
    expect(ok(floor(), shift())).toBe(true);
    // Hourly compares the hourly rate.
    const hourly = provider({ payFloors: [{ professionCode: "DC", minHalfDayCents: null, minFullDayCents: null, minHourlyCents: 6000, includeMileage: false }] });
    expect(ok(hourly, shift({ pay: { durationTier: "HOURLY", providerPayCents: 20000, billableHours: 4 } }))).toBe(false);
    expect(ok(hourly, shift({ pay: { durationTier: "HOURLY", providerPayCents: 24000, billableHours: 4 } }))).toBe(true);
    // Credentials-only checks never look at it.
    expect(evaluateEligibility(floor(), light, pair(), { ...OPTS, credentialsOnly: true }).eligible).toBe(true);
  });

  it("F7 lodging: overnight-willing providers can come from further, up to the lodging maximum", () => {
    const far = provider({ willingOvernight: true, maxDriveMinutes: 90, availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 0, endMin: 1440, timeZone: "America/New_York" })) });
    const lodging = shift({ lodgingAllowed: true });
    const opts = { ...OPTS, lodgingMaxDriveMinutes: 240 };
    expect(evaluateEligibility(far, lodging, pair({ driveMinutes: 200 }), opts).eligible).toBe(true);
    expect(codes(evaluateEligibility(far, lodging, pair({ driveMinutes: 260 }), opts))).toEqual(["TOO_FAR"]);
    // Lodging off: only within their own drive limit.
    expect(codes(evaluateEligibility(far, shift({ lodgingAllowed: false }), pair({ driveMinutes: 200 }), opts))).toEqual(["TOO_FAR"]);
    expect(evaluateEligibility(far, shift({ lodgingAllowed: false }), pair({ driveMinutes: 60 }), opts).eligible).toBe(true);
  });

  it("F3 a provider must have signed the current agreement — even if otherwise active", () => {
    expect(codes(evaluateEligibility(provider({ agreementCurrent: false }), shift(), pair(), OPTS))).toEqual(["AGREEMENT_NOT_SIGNED"]);
    // Nightly credential sweeps don't touch it (they only re-check licenses/malpractice of booked shifts).
    expect(evaluateEligibility(provider({ agreementCurrent: false }), shift(), pair(), { ...OPTS, credentialsOnly: true }).eligible).toBe(true);
  });

  it("F3 status / payouts", () => {
    expect(codes(evaluateEligibility(provider({ status: "ONBOARDING" }), shift(), pair(), OPTS))).toContain("PROVIDER_NOT_ACTIVE");
    expect(codes(evaluateEligibility(provider({ payoutsEnabled: false }), shift(), pair(), OPTS))).toContain("PROVIDER_NOT_ACTIVE");
  });

  it("F7 emergency radius widens every provider's drive limit, never credentials", () => {
    const far = pair({ driveMinutes: 120 });
    const p = provider({ maxDriveMinutes: 90, willingOvernight: false });
    expect(codes(evaluateEligibility(p, shift(), far, OPTS))).toContain("TOO_FAR");
    expect(codes(evaluateEligibility(p, shift(), far, { ...OPTS, distanceMultiplier: 1.5 }))).toContain("TOO_FAR"); // boost: overnight-willing only
    expect(codes(evaluateEligibility(p, shift(), far, { ...OPTS, distanceMultiplierAll: 1.5 }))).not.toContain("TOO_FAR");
    expect(codes(evaluateEligibility(p, shift(), pair({ driveMinutes: 140 }), { ...OPTS, distanceMultiplierAll: 1.5 }))).toContain("TOO_FAR");
    const unlicensed = provider({ maxDriveMinutes: 90, licenses: [] });
    expect(codes(evaluateEligibility(unlicensed, shift(), far, { ...OPTS, distanceMultiplierAll: 1.5 }))).toContain("LICENSE_STATE_MISMATCH");
  });

  it("F4 checks the shift's own hours against availability (travel time doesn't count against them)", () => {
    const s = shift();
    const local = (d: Date) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(d); const g = (k: string) => p.find((x) => x.type === k)!.value; return { min: +g("hour") * 60 + +g("minute"), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")) }; };
    const a = local(s.startsAt), b = local(s.endsAt);
    // Exactly the shift's hours: fits, even with a long drive.
    const exact = [{ weekday: a.weekday, startMin: a.min, endMin: b.min, timeZone: "America/New_York" }];
    expect(ok(provider({ availabilityRules: exact }), s)).toBe(true);
    expect(codes(evaluateEligibility(provider({ availabilityRules: exact }), s, pair({ driveMinutes: 80 }), OPTS))).not.toContain("OUTSIDE_AVAILABILITY");
    // Ends an hour early: outside, and the reason names the day and both windows.
    const short = [{ weekday: a.weekday, startMin: a.min, endMin: b.min - 60, timeZone: "America/New_York" }];
    const r = evaluateEligibility(provider({ availabilityRules: short }), s, pair(), OPTS);
    expect(codes(r)).toContain("OUTSIDE_AVAILABILITY");
    expect(JSON.stringify(r)).toMatch(/outside the provider's \w+day hours/);
    // No hours that day at all.
    const otherDay = [{ weekday: (a.weekday + 1) % 7, startMin: 0, endMin: 1440, timeZone: "America/New_York" }];
    expect(JSON.stringify(evaluateEligibility(provider({ availabilityRules: otherDay }), s, pair(), OPTS))).toMatch(/Not available on \w+days/);
  });

  it("F4 open dates add availability; blackouts remove it", () => {
    const s = shift();
    const open = { start: +s.startsAt - 5 * 3600000, end: +s.endsAt + 5 * 3600000 };
    expect(ok(provider({ availabilityRules: [], openDates: [open] }), s)).toBe(true);
    expect(codes(evaluateEligibility(provider({ blackouts: [{ start: +s.startsAt + 3600000, end: +s.startsAt + 7200000 }] }), s, pair(), OPTS))).toContain(
      "OUTSIDE_AVAILABILITY",
    );
  });

  it("F5 overlapping buffered assignment", () => {
    const s = shift();
    expect(codes(evaluateEligibility(provider({ busy: [{ start: +s.endsAt + 10 * 60000, end: +s.endsAt + 5 * 3600000 }] }), s, pair(), OPTS))).toContain(
      "SCHEDULE_CONFLICT",
    );
    expect(ok(provider({ busy: [{ start: +s.endsAt + 3 * 3600000, end: +s.endsAt + 5 * 3600000 }] }), s)).toBe(true);
  });

  it("F6 required skills", () => {
    expect(codes(evaluateEligibility(provider(), shift({ requiredSkillIds: ["gonstead"] }), pair(), OPTS))).toContain("MISSING_REQUIRED_SKILL");
    expect(ok(provider(), shift({ requiredSkillIds: ["activator"] }))).toBe(true);
  });

  it("F7 distance, with overnight exception", () => {
    expect(codes(evaluateEligibility(provider(), shift(), pair({ driveMinutes: 120 }), OPTS))).toContain("TOO_FAR");
    expect(codes(evaluateEligibility(provider(), shift(), pair({ driveMinutes: null }), OPTS))).toContain("TOO_FAR");
    const wide = [{ weekday: 3, startMin: 0, endMin: 1440, timeZone: "America/New_York" }];
    expect(evaluateEligibility(provider({ willingOvernight: true, availabilityRules: wide }), shift({ lodgingAllowed: true }), pair({ driveMinutes: 200 }), OPTS).eligible).toBe(
      true,
    );
  });

  it("F8 travel budget, F9 blocks, F10 declined", () => {
    expect(codes(evaluateEligibility(provider(), shift({ maxTravelBudgetCents: 100 }), pair(), OPTS))).toContain("OVER_TRAVEL_BUDGET");
    expect(codes(evaluateEligibility(provider(), shift(), pair({ blocked: true }), OPTS))).toContain("BLOCKED");
    expect(codes(evaluateEligibility(provider(), shift(), pair({ previouslyDeclined: true }), OPTS))).toContain("PREVIOUSLY_DECLINED");
  });
});

describe("taking a break", () => {
  it("no shifts starting during the break; shifts before it and after the resume date are fine", () => {
    const s = shift();
    const from = +s.startsAt - 86_400_000;
    expect(ok(provider({ onBreak: { from, until: null } }), s)).toBe(false);
    expect(codes(evaluateEligibility(provider({ onBreak: { from, until: null } }), s, pair(), OPTS))).toContain("OUTSIDE_AVAILABILITY");
    expect(ok(provider({ onBreak: { from: +s.startsAt + 3_600_000, until: null } }), s)).toBe(true); // break starts after this shift
    expect(ok(provider({ onBreak: { from, until: +s.startsAt } }), s)).toBe(true); // back by then
    expect(ok(provider({ onBreak: { from, until: +s.startsAt + 1 } }), s)).toBe(false);
  });
});

describe("F14 own clinic (clinic owners who also take shifts)", () => {
  it("never matches a provider to shifts at a clinic they own; other clinics are fine", () => {
    const s = shift({ clinicOrgId: "org-mine" });
    const r = evaluateEligibility(provider({ ownClinicOrgIds: ["org-mine"] }), s, pair(), OPTS);
    expect(r.eligible).toBe(false);
    expect(codes(r)).toContain("OWN_CLINIC");
    expect(ok(provider({ ownClinicOrgIds: ["org-mine"] }), shift({ clinicOrgId: "org-other" }))).toBe(true);
    expect(ok(provider(), s)).toBe(true);
  });
  it("is not a credential problem: a booking made before is never released by credential checks", () => {
    const s = shift({ clinicOrgId: "org-mine" });
    expect(evaluateEligibility(provider({ ownClinicOrgIds: ["org-mine"] }), s, pair(), { ...OPTS, credentialsOnly: true }).eligible).toBe(true);
  });
});
