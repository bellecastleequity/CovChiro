import { describe, expect, it } from "vitest";
import { welcomeBaseCents, welcomeCounts, welcomeDiscount, welcomeStage } from "../src/welcome";

describe("Welcome Discount: 15% off a clinic's first 3 completed bookings", () => {
  it("is 15% of the base coverage rate, to the cent ($575 → $488.75)", () => {
    const d = welcomeDiscount({ baseCents: 57_500, percent: 15, clinicPriceCents: 57_500, providerPayCents: 40_000, maxShareOfMarginPercent: 100, minContributionCents: 0 });
    expect(d).toBe(8_625);
    expect(57_500 - d).toBe(48_875);
  });

  it("never touches overtime, premiums or travel: only the card's base rate counts", () => {
    // Full-day card $575 with overtime and a rush premium on top: the discount is still on $575.
    expect(welcomeBaseCents({ pricingModel: "TIERED", cardClinicCents: 57_500, billableHours: 10, clinicPriceCents: 71_000 })).toBe(57_500);
    // Hourly professions: the hourly card × the billable hours, never more than the quoted price.
    expect(welcomeBaseCents({ pricingModel: "HOURLY", cardClinicCents: 9_000, billableHours: 6, clinicPriceCents: 60_000 })).toBe(54_000);
    expect(welcomeBaseCents({ pricingModel: "TIERED", cardClinicCents: 57_500, billableHours: 8, clinicPriceCents: 50_000 })).toBe(50_000);
  });

  it("comes out of the platform margin only, and respects the margin safeguards", () => {
    // Margin $175: a 50% cap allows $87.50, so the full $86.25 fits.
    expect(welcomeDiscount({ baseCents: 57_500, percent: 15, clinicPriceCents: 57_500, providerPayCents: 40_000, maxShareOfMarginPercent: 50, minContributionCents: 0 })).toBe(8_625);
    // A minimum contribution of $100 per booking leaves $75 for the discount.
    expect(welcomeDiscount({ baseCents: 57_500, percent: 15, clinicPriceCents: 57_500, providerPayCents: 40_000, maxShareOfMarginPercent: 100, minContributionCents: 10_000 })).toBe(7_500);
    // No margin: no discount (provider pay is never reduced).
    expect(welcomeDiscount({ baseCents: 40_000, percent: 15, clinicPriceCents: 40_000, providerPayCents: 40_000, maxShareOfMarginPercent: 100, minContributionCents: 0 })).toBe(0);
  });

  it("counts available, reserved and used bookings; history before the offer counts toward the three", () => {
    expect(welcomeCounts({ total: 3, priorCompleted: 0, reserved: 0, redeemed: 0, pending: 0 })).toEqual({ total: 3, used: 0, reserved: 0, pending: 0, available: 3, remaining: 3 });
    expect(welcomeCounts({ total: 3, priorCompleted: 0, reserved: 1, redeemed: 1, pending: 1 })).toEqual({ total: 3, used: 1, reserved: 1, pending: 1, available: 0, remaining: 2 });
    // An established clinic with 2 completed bookings before the offer has 1 left.
    expect(welcomeCounts({ total: 3, priorCompleted: 2, reserved: 0, redeemed: 0, pending: 0 })).toMatchObject({ used: 2, available: 1, remaining: 1 });
    expect(welcomeCounts({ total: 3, priorCompleted: 5, reserved: 0, redeemed: 0, pending: 0 })).toMatchObject({ used: 3, available: 0, remaining: 0 });
  });

  it("picks the dashboard message from what's been used (3 → 2 → 1 → 0, never a date)", () => {
    expect(welcomeStage({ total: 3, used: 0 })).toBe("NEW");
    expect(welcomeStage({ total: 3, used: 1 })).toBe("TWO_LEFT");
    expect(welcomeStage({ total: 3, used: 2 })).toBe("ONE_LEFT");
    expect(welcomeStage({ total: 3, used: 3 })).toBe("DONE");
  });
});
