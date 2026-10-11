import { describe, expect, it } from "vitest";
import { addMonths, lockedClinicPriceCents, partnerDiscountCents, partnerTermAt } from "../src/partner";

const P = (o: Partial<Parameters<typeof partnerTermAt>[0]> = {}) => ({ status: "ACTIVE" as const, startsAt: new Date("2026-01-31T15:00:00Z"), endedAt: null, termMonths: 12, discountPercent: 5, ...o });

describe("partner clinics", () => {
  it("adds months clamped to the month's end", () => {
    expect(addMonths(new Date("2026-01-31T15:00:00Z"), 1).toISOString()).toBe("2026-02-28T15:00:00.000Z");
    expect(addMonths(new Date("2026-01-31T15:00:00Z"), 12).toISOString()).toBe("2027-01-31T15:00:00.000Z");
  });

  it("knows which term a date falls in, renewing until ended", () => {
    expect(partnerTermAt(P(), new Date("2026-01-30T00:00:00Z"))).toBeNull();
    const t1 = partnerTermAt(P(), new Date("2026-06-01T00:00:00Z"))!;
    expect(t1.termNumber).toBe(1);
    expect(t1.termStart.toISOString()).toBe("2026-01-31T15:00:00.000Z");
    const t2 = partnerTermAt(P(), new Date("2027-03-01T00:00:00Z"))!;
    expect(t2.termNumber).toBe(2);
    expect(t2.termStart.toISOString()).toBe("2027-01-31T15:00:00.000Z");
    expect(partnerTermAt(P({ status: "OFFERED", startsAt: null }), new Date("2026-06-01T00:00:00Z"))).toBeNull();
    // Ended: in force before the end, not after.
    const ended = P({ status: "ENDED", endedAt: new Date("2026-07-01T00:00:00Z") });
    expect(partnerTermAt(ended, new Date("2026-06-30T00:00:00Z"))).not.toBeNull();
    expect(partnerTermAt(ended, new Date("2026-07-01T00:00:00Z"))).toBeNull();
    expect(partnerTermAt(P({ status: "WITHDRAWN" }), new Date("2026-06-01T00:00:00Z"))).toBeNull();
  });

  it("takes the discount from margin only, sharing the cap with any promo", () => {
    const q = { clinicPriceCents: 39_000, providerPayCents: 33_000 }; // $60 margin
    expect(partnerDiscountCents(q, 5, 0, 100)).toBe(1_950);
    // Cap: 50% of margin = $30; a $20 promo leaves $10 for the partner discount.
    expect(partnerDiscountCents(q, 5, 2_000, 50)).toBe(1_000);
    // No margin left: no discount; never negative.
    expect(partnerDiscountCents({ clinicPriceCents: 30_000, providerPayCents: 30_000 }, 5, 0, 100)).toBe(0);
    expect(partnerDiscountCents(q, 5, 9_000, 100)).toBe(0);
  });

  it("locks the clinic price at the term's card but never below today's provider pay", () => {
    expect(lockedClinicPriceCents({ clinicPriceCents: 42_000, providerPayCents: 34_000 }, { clinicPriceCents: 39_000 })).toBe(39_000);
    // Prices went down: the clinic gets today's lower price.
    expect(lockedClinicPriceCents({ clinicPriceCents: 37_000, providerPayCents: 31_000 }, { clinicPriceCents: 39_000 })).toBe(37_000);
    // Provider pay rose above the locked price: the clinic pays at least provider pay (our margin absorbs it).
    expect(lockedClinicPriceCents({ clinicPriceCents: 45_000, providerPayCents: 40_000 }, { clinicPriceCents: 39_000 })).toBe(40_000);
    expect(lockedClinicPriceCents({ clinicPriceCents: 42_000, providerPayCents: 34_000 }, null)).toBe(42_000);
  });
});
