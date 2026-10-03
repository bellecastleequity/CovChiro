import { describe, expect, it } from "vitest";
import { CLINIC_RATE_RELEASE_RANGE, clinicRateAllowed, clinicRatePrice, clinicRateReleaseAt, clinicRateTerms } from "../src/clinicRate";

const market = { clinicPriceCents: 62500, providerPayCents: 50000 };

describe("clinic-set rate (beta)", () => {
  it("floor is the minimum percent of market, rounded up to the dollar", () => {
    const r = clinicRatePrice(market, 40000, 80);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.floorCents).toBe(50000);
      expect(r.reason).toMatch(/at least \$500/);
    }
    expect(clinicRatePrice({ clinicPriceCents: 62550, providerPayCents: 50000 }, 0, 80)).toMatchObject({ floorCents: 50100 });
  });

  it("splits the clinic's price in the same proportion as the market rate", () => {
    const r = clinicRatePrice(market, 55000, 80);
    expect(r).toMatchObject({ ok: true, clinicPriceCents: 55000, providerPayCents: 44000, platformCents: 11000, floorCents: 50000 });
  });

  it("must be below market and in whole dollars", () => {
    expect(clinicRatePrice(market, 62500, 80)).toMatchObject({ ok: false });
    expect(clinicRatePrice(market, 70000, 80)).toMatchObject({ ok: false });
    expect(clinicRatePrice(market, 55050, 80)).toMatchObject({ ok: false });
    expect(clinicRatePrice(market, 50000, 80)).toMatchObject({ ok: true, clinicPriceCents: 50000 });
  });

  it("only allowed when the shift starts after the release window", () => {
    const now = new Date("2026-10-06T14:00:00Z");
    const start = (h: number) => new Date(+now + h * 3_600_000);
    expect(clinicRateAllowed(now, start(72), 72)).toBe(false);
    expect(clinicRateAllowed(now, start(73), 72)).toBe(true);
    expect(clinicRateAllowed(now, start(100), 168)).toBe(false);
    expect(+clinicRateReleaseAt(start(100), 72)).toBe(+start(28));
  });

  it("release hours are clamped to 72-168", () => {
    expect(CLINIC_RATE_RELEASE_RANGE).toEqual({ min: 72, max: 168 });
    const s = new Date("2026-11-10T13:00:00Z");
    expect(+clinicRateReleaseAt(s, 24)).toBe(+s - 72 * 3_600_000);
    expect(+clinicRateReleaseAt(s, 500)).toBe(+s - 168 * 3_600_000);
  });

  it("terms text names the price, floor, release time and choice", () => {
    const t = clinicRateTerms({
      brandName: "CoverageOnCall", clinicPriceCents: 55000, marketPriceCents: 62500, floorPercent: 80, release: true,
      releaseAt: new Date("2026-11-07T13:00:00Z"), releaseHours: 72, timeZone: "America/New_York", message: "Holiday season: we may release earlier.",
    });
    expect(t).toContain("$550.00");
    expect(t).toContain("$625.00");
    expect(t).toContain("Sat, Nov 7, 2026, 8:00 AM");
    expect(t).toContain("72 hours");
    expect(t).toContain("Holiday season");
    expect(t).toMatch(/released to CoverageOnCall at market rates/);
    const hold = clinicRateTerms({ brandName: "CoverageOnCall", clinicPriceCents: 55000, marketPriceCents: 62500, floorPercent: 80, release: false, releaseAt: null, releaseHours: 72, timeZone: "America/New_York", message: "" });
    expect(hold).toMatch(/will not be released/);
    expect(hold).toMatch(/may go unfilled/);
  });
});
