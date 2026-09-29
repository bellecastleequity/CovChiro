import { describe, expect, it } from "vitest";
import {
  applicablePremiums, clinicTotalCents, clinicView, depositCents, providerTotalCents, providerView, durationTier, federalHolidays,
  isFederalHoliday, mileageCents, tierFor, platformMarginCents, quoteBase, travelEstimate, travelRange, formatCents,
} from "../src";
import { d, S } from "./fixtures";

const FL_CENTRAL = { clinicPriceCents: 57500, providerPayCents: 40000 };
const HALF = { clinicPriceCents: 32500, providerPayCents: 22000 };
const TZ = "America/New_York";
const weekday = { startsAt: d("2026-10-14T13:00:00Z"), endsAt: d("2026-10-14T21:00:00Z") }; // Wed 8h
const early = d("2026-09-01T12:00:00Z");

describe("duration tiers", () => {
  it("classifies half/full/overtime", () => {
    expect(durationTier(3.5)).toEqual({ tier: "HALF_DAY", overtimeHours: 0 });
    expect(durationTier(4)).toEqual({ tier: "FULL_DAY", overtimeHours: 0 });
    expect(durationTier(8)).toEqual({ tier: "FULL_DAY", overtimeHours: 0 });
    expect(durationTier(10.5)).toEqual({ tier: "FULL_DAY", overtimeHours: 2.5 });
    expect(() => durationTier(0)).toThrow();
  });
});

describe("quoteBase", () => {
  it("weekday full day, no premiums", () => {
    const q = quoteBase(weekday, "TIERED", FL_CENTRAL, { pricedAt: early, timeZone: TZ, boosted: false }, S);
    expect(q).toMatchObject({ pricingModel: "TIERED", tier: "FULL_DAY", premiums: [], clinicPriceCents: 57500, providerPayCents: 40000, marginCents: 17500 });
  });

  it("overtime adds per-hour to both sides", () => {
    const q = quoteBase({ startsAt: weekday.startsAt, endsAt: d("2026-10-14T23:00:00Z") }, "TIERED", FL_CENTRAL, { pricedAt: early, timeZone: TZ, boosted: false }, S);
    expect(q.overtimeHours).toBe(2);
    expect(q.clinicPriceCents).toBe(57500 + 2 * S["pricing.overtimeClinicCentsPerHour"]);
    expect(q.providerPayCents).toBe(40000 + 2 * S["pricing.overtimeProviderCentsPerHour"]);
  });

  it("half day", () => {
    const q = quoteBase({ startsAt: weekday.startsAt, endsAt: d("2026-10-14T16:00:00Z") }, "TIERED", HALF, { pricedAt: early, timeZone: TZ, boosted: false }, S);
    expect(q.tier).toBe("HALF_DAY");
    expect(q.clinicPriceCents).toBe(32500);
  });

  it("every premium combination multiplies both sides", () => {
    const combos = [
      { name: "none", start: "2026-10-14T13:00:00Z", pricedAt: early, boosted: false, kinds: [] },
      { name: "urgent", start: "2026-10-14T13:00:00Z", pricedAt: d("2026-10-13T13:00:00Z"), boosted: false, kinds: ["URGENT"] },
      { name: "weekend", start: "2026-10-17T13:00:00Z", pricedAt: early, boosted: false, kinds: ["WEEKEND"] },
      { name: "holiday (Thanksgiving)", start: "2026-11-26T14:00:00Z", pricedAt: early, boosted: false, kinds: ["HOLIDAY"] },
      { name: "boost", start: "2026-10-14T13:00:00Z", pricedAt: early, boosted: true, kinds: ["BOOST"] },
      { name: "all", start: "2026-07-04T13:00:00Z", pricedAt: d("2026-07-03T13:00:00Z"), boosted: true, kinds: ["URGENT", "WEEKEND", "HOLIDAY", "BOOST"] },
    ];
    for (const c of combos) {
      const startsAt = d(c.start);
      const endsAt = new Date(+startsAt + 8 * 3600000);
      const q = quoteBase({ startsAt, endsAt }, "TIERED", FL_CENTRAL, { pricedAt: c.pricedAt, timeZone: TZ, boosted: c.boosted }, S);
      expect(q.premiums.map((p) => p.kind), c.name).toEqual(c.kinds);
      const pct: Record<string, number> = {
        URGENT: S["pricing.premiumUrgentPercent"], WEEKEND: S["pricing.premiumWeekendPercent"], HOLIDAY: S["pricing.premiumHolidayPercent"], BOOST: S["pricing.boostPercent"],
      };
      const mult = c.kinds.reduce((m, k) => m * (1 + pct[k] / 100), 1);
      expect(q.clinicPriceCents, c.name).toBe(Math.round(57500 * mult));
      expect(q.providerPayCents, c.name).toBe(Math.round(40000 * mult));
    }
  });

  it("weekend is judged in the location's time zone", () => {
    // Fri 2026-10-16 10pm Eastern = Sat 02:00Z
    const p = applicablePremiums({ startsAt: d("2026-10-17T02:00:00Z"), pricedAt: early, timeZone: TZ, boosted: false }, S);
    expect(p.map((x) => x.kind)).toEqual([]);
  });
});

describe("hourly professions", () => {
  const LMT = { clinicPriceCents: 9000, providerPayCents: 6000, minHours: 2 };
  it("bills max(hours, minHours) × hourly rate on both sides", () => {
    const q = quoteBase({ startsAt: weekday.startsAt, endsAt: d("2026-10-14T14:30:00Z") }, "HOURLY", LMT, { pricedAt: early, timeZone: TZ, boosted: false }, S);
    expect(q).toMatchObject({ tier: "HOURLY", billableHours: 2, clinicPriceCents: 18000, providerPayCents: 12000, marginCents: 6000, overtimeHours: 0 });
    const q2 = quoteBase(weekday, "HOURLY", LMT, { pricedAt: early, timeZone: TZ, boosted: false }, S);
    expect(q2).toMatchObject({ billableHours: 8, clinicPriceCents: 72000, providerPayCents: 48000 });
  });
  it("falls back to the settings minimum and applies premiums", () => {
    const q = quoteBase({ startsAt: d("2026-10-17T13:00:00Z"), endsAt: d("2026-10-17T14:00:00Z") }, "HOURLY", { clinicPriceCents: 9000, providerPayCents: 6000 }, { pricedAt: early, timeZone: TZ, boosted: false }, S);
    expect(q.billableHours).toBe(S["pricing.hourlyMinHours"]);
    expect(q.clinicPriceCents).toBe(Math.round(18000 * 1.1));
    expect(tierFor("HOURLY", 3)).toBe("HOURLY");
    expect(tierFor("TIERED", 3)).toBe("HALF_DAY");
  });
  it("per-profession premium overrides", () => {
    const s2 = { ...S, "pricing.premiumOverridesByProfession": { LMT: { weekend: 5 } } };
    const p = applicablePremiums({ startsAt: d("2026-10-17T13:00:00Z"), pricedAt: early, timeZone: TZ, boosted: false, professionCode: "LMT" }, s2);
    expect(p).toEqual([{ kind: "WEEKEND", percent: 5 }]);
  });
});

describe("holidays", () => {
  it("computes 2026 federal holidays incl. observed", () => {
    const h = federalHolidays(2026);
    for (const x of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-04", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]) {
      expect(h.has(x), x).toBe(true);
    }
    expect(isFederalHoliday("2026-10-14")).toBe(false);
  });
});

describe("travel", () => {
  it("mileage one-way vs round-trip", () => {
    expect(mileageCents(50, S)).toBe(1000);
    expect(mileageCents(50, { ...S, "pricing.mileageRoundTrip": true })).toBe(2000);
  });
  it("lodging only when allowed and over the trigger", () => {
    const shift = { lodgingAllowed: true, lodgingCapCentsPerNight: 15000 };
    expect(travelEstimate({ minutes: 150, miles: 140 }, shift, S)).toEqual({ mileageCents: 2800, lodgingEstimateCents: 15000, totalCents: 17800, nights: 1 });
    expect(travelEstimate({ minutes: 60, miles: 50 }, shift, S).nights).toBe(0);
    expect(travelEstimate({ minutes: 150, miles: 140 }, { lodgingAllowed: false, lodgingCapCentsPerNight: null }, S).nights).toBe(0);
    expect(travelEstimate({ minutes: 60, miles: 50 }, { ...shift, consecutiveDays: 3 }, S).nights).toBe(2);
    expect(travelRange([300, 1200, 800])).toEqual({ minCents: 300, maxCents: 1200 });
    expect(travelRange([])).toBeNull();
  });
});

describe("display separation", () => {
  const b = { clinicPriceCents: 57500, providerPayCents: 40000, promoDiscountCents: 5000, mileageCents: 1200, lodgingCents: 0 };
  it("clinic view never exposes doctor pay", () => {
    const v = clinicView(b);
    expect(JSON.stringify(v)).not.toContain("40000");
    expect(Object.keys(v)).not.toContain("payCents");
    expect(v.totalCents).toBe(53700);
  });
  it("doctor view never exposes clinic price, discount or margin", () => {
    const v = providerView(b);
    expect(JSON.stringify(v)).not.toMatch(/57500|5000\b/);
    expect(Object.keys(v)).toEqual(["payCents", "mileageCents", "lodgingCents", "totalCents"]);
    expect(v.totalCents).toBe(41200);
  });
  it("totals, margin, deposit", () => {
    expect(clinicTotalCents(b)).toBe(53700);
    expect(providerTotalCents(b)).toBe(41200);
    expect(platformMarginCents(b)).toBe(12500);
    expect(depositCents(53700, 10)).toBe(5370);
    expect(formatCents(57500)).toBe("$575");
    expect(formatCents(5370)).toBe("$53.70");
  });
});
