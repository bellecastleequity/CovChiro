import { describe, expect, it } from "vitest";
import { evaluateEligibility, evaluateGroupEligibility, hasQualifyingLicense, licensedStates, assertEligible, DomainError } from "../src";
import { d, doctor, OPTS, pair, shift } from "./fixtures";

const codes = (r: ReturnType<typeof evaluateEligibility>) => r.failures.map((f) => f.code);

describe("INV-1 licensure", () => {
  it("baseline doctor is eligible", () => {
    expect(evaluateEligibility(doctor(), shift(), pair(), OPTS)).toEqual({ eligible: true, failures: [] });
  });

  it("1. licensed only in a different state → LICENSE_STATE_MISMATCH", () => {
    const r = evaluateEligibility(doctor({ licenses: [{ state: "GA", status: "VERIFIED", expiresAt: d("2030-01-01") }] }), shift(), pair(), OPTS);
    expect(r.eligible).toBe(false);
    expect(r.failures[0]).toMatchObject({ filter: "F1", code: "LICENSE_STATE_MISMATCH" });
  });

  it("2. living nearby does not matter — only licenses count", () => {
    // 5-minute drive, GA license only
    const r = evaluateEligibility(doctor({ licenses: [{ state: "GA", status: "VERIFIED", expiresAt: d("2030-01-01") }] }), shift(), pair({ driveMinutes: 5 }), OPTS);
    expect(codes(r)).toContain("LICENSE_STATE_MISMATCH");
  });

  it("3. PENDING_VERIFICATION license does not count", () => {
    const r = evaluateEligibility(doctor({ licenses: [{ state: "FL", status: "PENDING_VERIFICATION", expiresAt: d("2030-01-01") }] }), shift(), pair(), OPTS);
    expect(codes(r)).toContain("LICENSE_STATE_MISMATCH");
  });

  it("4. license expiring before shift end (incl. mid-shift) → LICENSE_EXPIRES_BEFORE_SHIFT", () => {
    const s = shift();
    for (const exp of [d("2026-10-01"), d("2026-10-14T17:00:00Z"), s.endsAt]) {
      const r = evaluateEligibility(doctor({ licenses: [{ state: "FL", status: "VERIFIED", expiresAt: exp }] }), s, pair(), OPTS);
      expect(r.failures[0]).toMatchObject({ filter: "F1", code: "LICENSE_EXPIRES_BEFORE_SHIFT" });
    }
  });

  it.each(["SUSPENDED", "REVOKED", "REJECTED", "EXPIRED"] as const)("5. %s license does not count", (status) => {
    const r = evaluateEligibility(doctor({ licenses: [{ state: "FL", status, expiresAt: d("2030-01-01") }] }), shift(), pair(), OPTS);
    expect(r.eligible).toBe(false);
    expect(r.failures[0].filter).toBe("F1");
  });

  it("6. multi-day group fails if license expires before the last day", () => {
    const days = [0, 1, 2].map((i) =>
      shift({ id: `s${i}`, startsAt: new Date(+d("2026-10-14T13:00:00Z") + i * 86400000), endsAt: new Date(+d("2026-10-14T21:00:00Z") + i * 86400000) }),
    );
    const doc = doctor({ licenses: [{ state: "FL", status: "VERIFIED", expiresAt: d("2026-10-15T23:00:00Z") }] });
    const r = evaluateGroupEligibility(doc, days, () => pair(), OPTS);
    expect(r.eligible).toBe(false);
    expect(r.failures.filter((f) => f.filter === "F1")).toHaveLength(1);
  });

  it("F1 is never relaxed by the distance boost", () => {
    const r = evaluateEligibility(
      doctor({ willingOvernight: true, licenses: [{ state: "GA", status: "VERIFIED", expiresAt: d("2030-01-01") }] }),
      shift({ lodgingAllowed: true }),
      pair(),
      { ...OPTS, distanceMultiplier: 10 },
    );
    expect(codes(r)).toContain("LICENSE_STATE_MISMATCH");
  });

  it("assertEligible throws the F1 code", () => {
    const r = evaluateEligibility(doctor({ licenses: [] }), shift(), pair(), OPTS);
    expect(() => assertEligible(r)).toThrowError(DomainError);
    try { assertEligible(r); } catch (e) { expect((e as DomainError).code).toBe("LICENSE_STATE_MISMATCH"); }
  });

  it("licensedStates lists only verified, unexpired states", () => {
    const states = licensedStates(
      [
        { state: "GA", status: "VERIFIED", expiresAt: d("2030-01-01") },
        { state: "FL", status: "VERIFIED", expiresAt: d("2030-01-01") },
        { state: "AL", status: "PENDING_VERIFICATION", expiresAt: d("2030-01-01") },
        { state: "TX", status: "VERIFIED", expiresAt: d("2020-01-01") },
      ],
      d("2026-09-29"),
    );
    expect(states).toEqual(["FL", "GA"]);
    expect(hasQualifyingLicense([], "FL", d("2026-01-01"))).toBe(false);
  });
});

describe("INV-3 malpractice", () => {
  it("requires a verified, unexpired policy meeting minimum limits", () => {
    const s = shift();
    expect(codes(evaluateEligibility(doctor({ malpractice: [] }), s, pair(), OPTS))).toContain("MALPRACTICE_INVALID");
    expect(
      codes(evaluateEligibility(doctor({ malpractice: [{ status: "VERIFIED", expiresAt: d("2026-10-14T15:00:00Z"), perOccurrenceCents: 1e8, aggregateCents: 3e8 }] }), s, pair(), OPTS)),
    ).toContain("MALPRACTICE_INVALID");
    expect(
      codes(evaluateEligibility(doctor({ malpractice: [{ status: "VERIFIED", expiresAt: d("2030-01-01"), perOccurrenceCents: 5e7, aggregateCents: 3e8 }] }), s, pair(), OPTS)),
    ).toContain("MALPRACTICE_INVALID");
    expect(
      codes(evaluateEligibility(doctor({ malpractice: [{ status: "PENDING_VERIFICATION", expiresAt: d("2030-01-01"), perOccurrenceCents: 1e8, aggregateCents: 3e8 }] }), s, pair(), OPTS)),
    ).toContain("MALPRACTICE_INVALID");
  });

  it("credentialsOnly skips operational filters", () => {
    const r = evaluateEligibility(doctor({ status: "PAUSED" }), shift(), pair({ blocked: true }), { ...OPTS, credentialsOnly: true });
    expect(r.eligible).toBe(true);
  });
});

describe("other hard filters", () => {
  it("F3 status/profile/payouts", () => {
    expect(codes(evaluateEligibility(doctor({ status: "ONBOARDING" }), shift(), pair(), OPTS))).toContain("DOCTOR_NOT_ACTIVE");
    expect(codes(evaluateEligibility(doctor({ payoutsEnabled: false }), shift(), pair(), OPTS))).toContain("DOCTOR_NOT_ACTIVE");
  });

  it("F4 availability window includes travel buffer", () => {
    // Available 9–17 local exactly; buffer (30 drive + 30) pushes outside
    const rules = [3].map((weekday) => ({ weekday, startMin: 9 * 60, endMin: 17 * 60, timeZone: "America/New_York" }));
    expect(codes(evaluateEligibility(doctor({ availabilityRules: rules }), shift(), pair(), OPTS))).toContain("OUTSIDE_AVAILABILITY");
    const wide = [3].map((weekday) => ({ weekday, startMin: 7 * 60, endMin: 19 * 60, timeZone: "America/New_York" }));
    expect(evaluateEligibility(doctor({ availabilityRules: wide }), shift(), pair(), OPTS).eligible).toBe(true);
  });

  it("F4 open dates add availability; blackouts remove it", () => {
    const s = shift();
    const open = { start: +s.startsAt - 5 * 3600000, end: +s.endsAt + 5 * 3600000 };
    expect(evaluateEligibility(doctor({ availabilityRules: [], openDates: [open] }), s, pair(), OPTS).eligible).toBe(true);
    expect(codes(evaluateEligibility(doctor({ blackouts: [{ start: +s.startsAt + 3600000, end: +s.startsAt + 7200000 }] }), s, pair(), OPTS))).toContain(
      "OUTSIDE_AVAILABILITY",
    );
  });

  it("F5 overlapping buffered assignment", () => {
    const s = shift();
    expect(codes(evaluateEligibility(doctor({ busy: [{ start: +s.endsAt + 10 * 60000, end: +s.endsAt + 5 * 3600000 }] }), s, pair(), OPTS))).toContain("SCHEDULE_CONFLICT");
    expect(evaluateEligibility(doctor({ busy: [{ start: +s.endsAt + 3 * 3600000, end: +s.endsAt + 5 * 3600000 }] }), s, pair(), OPTS).eligible).toBe(true);
  });

  it("F6 required techniques", () => {
    expect(codes(evaluateEligibility(doctor(), shift({ requiredTechniqueIds: ["gonstead"] }), pair(), OPTS))).toContain("MISSING_REQUIRED_TECHNIQUE");
    expect(evaluateEligibility(doctor(), shift({ requiredTechniqueIds: ["activator"] }), pair(), OPTS).eligible).toBe(true);
  });

  it("F7 distance, with overnight exception", () => {
    expect(codes(evaluateEligibility(doctor(), shift(), pair({ driveMinutes: 120 }), OPTS))).toContain("TOO_FAR");
    expect(codes(evaluateEligibility(doctor(), shift(), pair({ driveMinutes: null }), OPTS))).toContain("TOO_FAR");
    const wide = [3].map((weekday) => ({ weekday, startMin: 0, endMin: 1440, timeZone: "America/New_York" }));
    expect(
      evaluateEligibility(doctor({ willingOvernight: true, availabilityRules: wide }), shift({ lodgingAllowed: true }), pair({ driveMinutes: 200 }), OPTS).eligible,
    ).toBe(true);
  });

  it("F8 travel budget, F9 blocks, F10 declined", () => {
    expect(codes(evaluateEligibility(doctor(), shift({ maxTravelBudgetCents: 100 }), pair(), OPTS))).toContain("OVER_TRAVEL_BUDGET");
    expect(codes(evaluateEligibility(doctor(), shift(), pair({ blocked: true }), OPTS))).toContain("BLOCKED");
    expect(codes(evaluateEligibility(doctor(), shift(), pair({ previouslyDeclined: true }), OPTS))).toContain("PREVIOUSLY_DECLINED");
  });
});
