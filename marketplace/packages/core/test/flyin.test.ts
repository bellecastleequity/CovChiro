import { describe, expect, it } from "vitest";
import {
  clinicTotalCents,
  evaluateEligibility,
  flyInAirfareCents,
  flyInAirfareKept,
  flyInNightlyCents,
  flyInPostingProblem,
  isFlyInPair,
  providerTotalCents,
} from "../src";
import { d, lic, OPTS, pair, policy, provider, S, shift } from "./fixtures";

const NOW = d("2026-09-20T12:00:00Z");
const viShift = (over = {}) =>
  shift({ state: "VI", flyIn: { airfareCents: 45_000, nightlyCents: 17_500, until: d("2026-10-04T13:00:00Z") }, ...over });
const flyer = (over = {}) =>
  provider({ licenses: [lic("DC", "FL"), lic("DC", "VI")], malpractice: [policy(["DC"], { coveredStates: ["FL", "VI"] })], flyInStates: ["VI"], ...over });
const opts = { ...OPTS, now: NOW };

describe("fly-in coverage", () => {
  it("skips the drive limit for a provider who flies to that state, on a fly-in shift, before the cut-off", () => {
    const far = pair({ driveMinutes: null });
    expect(isFlyInPair(flyer(), viShift(), null, opts)).toBe(true);
    expect(evaluateEligibility(flyer(), viShift(), far, opts)).toMatchObject({ eligible: true, flyIn: true });
    // Not on their fly-in list, shift not fly-in, or too late to book flights → F7 as before.
    for (const [p, sh, o] of [
      [flyer({ flyInStates: [] }), viShift(), opts],
      [flyer(), viShift({ flyIn: null }), opts],
      [flyer(), viShift(), { ...OPTS, now: d("2026-10-05T00:00:00Z") }],
    ] as const) {
      const r = evaluateEligibility(p, sh, far, o);
      expect(r.eligible).toBe(false);
      expect(r.failures.map((f) => f.filter)).toContain("F7");
      expect(r.flyIn).toBeFalsy();
    }
  });

  it("never touches credentials: license and malpractice for the destination are still required", () => {
    const noLicense = evaluateEligibility(flyer({ licenses: [lic("DC", "FL")] }), viShift(), pair({ driveMinutes: null }), opts);
    expect(noLicense.failures.map((f) => f.filter)).toEqual(["F1"]);
    const noCover = evaluateEligibility(flyer({ malpractice: [policy(["DC"], { coveredStates: ["FL"] })] }), viShift(), pair({ driveMinutes: null }), opts);
    expect(noCover.failures.map((f) => f.filter)).toEqual(["F2"]);
  });

  it("a provider within driving range is a normal drive booking, not a fly-in", () => {
    expect(isFlyInPair(flyer(), viShift(), 30, opts)).toBe(false);
    expect(evaluateEligibility(flyer(), viShift(), pair({ driveMinutes: 30 }), opts).flyIn).toBeFalsy();
  });

  it("blackouts are checked against the clinic hours only (they travel the day before)", () => {
    const evening = { start: +d("2026-10-14T22:00:00Z"), end: +d("2026-10-15T02:00:00Z") };
    expect(evaluateEligibility(flyer({ blackouts: [evening] }), viShift(), pair({ driveMinutes: null }), opts).eligible).toBe(true);
  });

  it("allowances come from settings by destination", () => {
    expect(flyInAirfareCents("VI", S)).toBe(45_000);
    expect(flyInAirfareCents("GU", S)).toBe(S["flyIn.defaultAirfareDollars"] * 100);
    expect(flyInNightlyCents("VI", S)).toBe(17_500);
    expect(flyInNightlyCents("PR", S)).toBe(S["pricing.lodgingNightlyCents"]);
  });

  it("posting: enough consecutive days and enough notice", () => {
    const day = (iso: string) => ({ startsAt: d(`${iso}T13:00:00Z`), endsAt: d(`${iso}T21:00:00Z`) });
    expect(flyInPostingProblem([day("2026-10-14"), day("2026-10-15")], NOW, S)).toBeNull();
    expect(flyInPostingProblem([day("2026-10-14")], NOW, S)).toMatch(/2 consecutive days/);
    expect(flyInPostingProblem([day("2026-10-14"), day("2026-10-16")], NOW, S)).toMatch(/consecutive/);
    expect(flyInPostingProblem([day("2026-09-25"), day("2026-09-26")], NOW, S)).toMatch(/10 days/);
  });

  it("airfare is in both totals", () => {
    const b = { clinicPriceCents: 60_000, providerPayCents: 45_000, promoDiscountCents: 0, mileageCents: 0, lodgingCents: 17_500, airfareCents: 45_000 };
    expect(clinicTotalCents(b)).toBe(122_500);
    expect(providerTotalCents(b)).toBe(107_500);
  });

  it("cancellation: the clinic pays the airfare once flights are booked; a provider cancel or an early clinic cancel refunds it", () => {
    const confirmedAt = d("2026-09-20T12:00:00Z");
    const base = { confirmedAt, otherDaysRemain: false };
    expect(flyInAirfareKept({ ...base, by: "CLINIC", now: d("2026-09-20T20:00:00Z") }, S)).toBe(false);
    expect(flyInAirfareKept({ ...base, by: "CLINIC", now: d("2026-09-22T12:00:00Z") }, S)).toBe(true);
    expect(flyInAirfareKept({ ...base, by: "PROVIDER", now: d("2026-10-13T12:00:00Z") }, S)).toBe(false);
    // The provider still flies for the other days, so the airfare stays paid whoever cancelled this one.
    expect(flyInAirfareKept({ ...base, by: "PROVIDER", now: d("2026-10-13T12:00:00Z"), otherDaysRemain: true }, S)).toBe(true);
  });
});
