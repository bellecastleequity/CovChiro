import { describe, expect, it } from "vitest";
import { assertPromoUsable, normalizeCode, personalCode, promoDiscountCents, promoLabel, promoRejection, type PromoFacts } from "../src";
import { d } from "./fixtures";

const base: PromoFacts = {
  code: "SPRING", kind: "PERCENT", value: 10, active: true, startsAt: null, expiresAt: d("2026-12-31"), maxUses: null, usedCount: 0,
  maxUsesPerClinic: null, firstShiftOnly: false, assignedEmail: null, landingEnabled: false, isPersonalCopy: false,
};
const ctx = { now: d("2026-10-01"), clinicEmails: ["owner@clinic.com"], clinicPriorConfirmedShifts: 0, clinicUsesOfCode: 0 };

describe("promo validation", () => {
  it("accepts a valid code", () => expect(promoRejection(base, ctx)).toBeNull());
  it("rejects inactive / not started / expired / used up", () => {
    expect(promoRejection({ ...base, active: false }, ctx)).toMatch(/no longer active/);
    expect(promoRejection({ ...base, startsAt: d("2026-11-01") }, ctx)).toMatch(/isn't active yet/);
    expect(promoRejection({ ...base, expiresAt: d("2026-09-30") }, ctx)).toMatch(/expired/);
    expect(promoRejection({ ...base, maxUses: 5, usedCount: 5 }, ctx)).toMatch(/fully redeemed/);
    expect(promoRejection({ ...base, maxUsesPerClinic: 1 }, { ...ctx, clinicUsesOfCode: 1 })).toMatch(/already used/);
  });
  it("first-shift-only codes", () => {
    expect(promoRejection({ ...base, firstShiftOnly: true }, { ...ctx, clinicPriorConfirmedShifts: 1 })).toMatch(/first/);
  });
  it("email-bound personal codes", () => {
    expect(promoRejection({ ...base, assignedEmail: "OWNER@clinic.com", isPersonalCopy: true }, ctx)).toBeNull();
    expect(promoRejection({ ...base, assignedEmail: "x@y.com" }, ctx)).toMatch(/different email/);
  });
  it("campaign library codes can't be redeemed directly while their landing page is on", () => {
    expect(promoRejection({ ...base, landingEnabled: true }, ctx)).toMatch(/landing page/);
    expect(promoRejection({ ...base, landingEnabled: true, isPersonalCopy: true }, ctx)).toBeNull();
    expect(() => assertPromoUsable({ ...base, active: false }, ctx)).toThrow();
  });
});

describe("promo discount never touches doctor pay", () => {
  const q = { clinicPriceCents: 57500, doctorPayCents: 40000 };
  it("percent and fixed", () => {
    expect(promoDiscountCents({ kind: "PERCENT", value: 10 }, q, 100)).toBe(5750);
    expect(promoDiscountCents({ kind: "FIXED", value: 5000 }, q, 100)).toBe(5000);
  });
  it("capped at the margin share", () => {
    expect(promoDiscountCents({ kind: "PERCENT", value: 50 }, q, 100)).toBe(17500);
    expect(promoDiscountCents({ kind: "FIXED", value: 100000 }, q, 50)).toBe(8750);
    expect(promoDiscountCents({ kind: "FIXED", value: 100 }, { clinicPriceCents: 100, doctorPayCents: 200 }, 100)).toBe(0);
  });
  it("labels and codes", () => {
    expect(promoLabel({ kind: "PERCENT", value: 15 })).toBe("15% off");
    expect(promoLabel({ kind: "FIXED", value: 5000 })).toBe("$50 off");
    expect(normalizeCode(" spring 26 ")).toBe("SPRING26");
    expect(personalCode("spring!", () => 0)).toBe("SPRING-AAAA");
  });
});
