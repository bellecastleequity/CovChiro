import { describe, expect, it } from "vitest";
import { normalizeReferralCode, qualifiesAt, referralCodeFor, referralDecision, referrerDisplayName, type ReferralCheck } from "../src/referrals";

const base = (): ReferralCheck => ({
  referrer: { userId: "a", phone: "(407) 555-0100", disabled: false, suspended: false },
  referee: { userId: "b", phone: "407-555-0199", disabled: false, suspended: false, flaggedAsSpam: false },
  qualifyingShiftDisputed: false,
});

describe("referral codes", () => {
  it("builds a readable code from the last name", () => {
    const c = referralCodeFor("Dr. Jane Smith", () => 0);
    expect(c).toBe("SMITHAAA");
    expect(referralCodeFor("José O'Neil-Ramírez, DC", () => 0)).toMatch(/^RAMIREZ[A-Z2-9]{3}$/);
    expect(referralCodeFor("", () => 0)).toBe("FRIENDAAA");
  });
  it("normalizes what people type", () => {
    expect(normalizeReferralCode(" smith-7k2 ")).toBe("SMITH7K2");
    expect(normalizeReferralCode("ab")).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });
  it("shows only first name and last initial", () => {
    expect(referrerDisplayName("Jane Smith")).toBe("Jane S.");
    expect(referrerDisplayName("Dr. Jane Smith")).toBe("Dr. Jane S.");
    expect(referrerDisplayName("Cher")).toBe("Cher");
  });
});

describe("referralDecision", () => {
  it("pays clean referrals automatically", () => {
    expect(referralDecision(base())).toEqual({ decision: "ok", reasons: [] });
  });
  it("rejects self-referrals and banned accounts", () => {
    const self = base();
    self.referee.userId = "a";
    expect(referralDecision(self).decision).toBe("reject");
    const banned = base();
    banned.referee.disabled = true;
    expect(referralDecision(banned).decision).toBe("reject");
  });
  it("flags shared phones, suspensions, spam-flagged signups and disputed shifts", () => {
    const c = base();
    c.referee.phone = "+1 407 555 0100";
    c.referee.flaggedAsSpam = true;
    c.qualifyingShiftDisputed = true;
    const r = referralDecision(c);
    expect(r.decision).toBe("flag");
    expect(r.reasons).toEqual(["same phone number", "signup was flagged as possible spam", "the first shift had a dispute"]);
  });
  it("waits the hold after the shift", () => {
    expect(qualifiesAt(new Date("2026-03-01T17:00:00Z"), 3).toISOString()).toBe("2026-03-04T17:00:00.000Z");
  });
});
