import { describe, expect, it } from "vitest";
import { acceptProviderEmail, costPer, demandLevel, marketReadiness, providerFunnelStage, recruitmentPriority, supplyStatus } from "../src";

const who = { firstName: "Ana", lastName: "Rivera", website: "https://baysidechiro.com" };

describe("which email may be used to recruit a provider", () => {
  it("an address in the provider's own name is fine (their own practice domain)", () => {
    expect(acceptProviderEmail({ ...who, email: "arivera@baysidechiro.com", practiceRole: "ASSOCIATE", providersAtPractice: 4 })).toEqual({ ok: true, reason: "attributed" });
    expect(acceptProviderEmail({ ...who, email: "dr.rivera@baysidechiro.com", practiceRole: "UNKNOWN", providersAtPractice: 2 }).ok).toBe(true);
  });
  it("a solo practice's own front-desk mailbox reaches the owner", () => {
    expect(acceptProviderEmail({ ...who, email: "info@baysidechiro.com", practiceRole: "OWNER", providersAtPractice: 1 })).toEqual({ ok: true, reason: "solo_practice" });
  });
  it("never a shared inbox at a group practice (that reaches the employer, not the provider)", () => {
    expect(acceptProviderEmail({ ...who, email: "info@baysidechiro.com", practiceRole: "ASSOCIATE", providersAtPractice: 3 })).toEqual({ ok: false, reason: "shared_practice_inbox" });
    expect(acceptProviderEmail({ ...who, email: "office@baysidechiro.com", practiceRole: "OWNER", providersAtPractice: 3 }).ok).toBe(false);
  });
  it("never personal free-mail, junk or another person's address", () => {
    expect(acceptProviderEmail({ ...who, email: "ana.rivera@gmail.com", practiceRole: "OWNER", providersAtPractice: 1 })).toEqual({ ok: false, reason: "personal_freemail" });
    expect(acceptProviderEmail({ ...who, email: "noreply@baysidechiro.com", practiceRole: "OWNER", providersAtPractice: 1 }).ok).toBe(false);
    expect(acceptProviderEmail({ ...who, email: "not an email", practiceRole: "OWNER", providersAtPractice: 1 }).ok).toBe(false);
    expect(acceptProviderEmail({ ...who, email: "jsmith@baysidechiro.com", practiceRole: "ASSOCIATE", providersAtPractice: 3 }).ok).toBe(false);
  });
});

describe("provider funnel position", () => {
  it("registered people move on by credentials and shifts, never back", () => {
    expect(providerFunnelStage({ prospectStage: "CONTACTED" })).toBe("CONTACTED");
    expect(providerFunnelStage({ prospectStage: "CONTACTED", registered: true })).toBe("CREDENTIALING");
    expect(providerFunnelStage({ registered: true, coverageReady: true })).toBe("COVERAGE_READY");
    expect(providerFunnelStage({ registered: true, coverageReady: true, completedShifts: 1 })).toBe("FIRST_SHIFT");
    expect(providerFunnelStage({ registered: true, coverageReady: true, completedShifts: 3 })).toBe("REPEAT_PROVIDER");
  });
});

describe("market supply status", () => {
  const base = { target: 10, upcomingRequests: 0, filled30: 0, unfilled30: 0 };
  it("from coverage-ready providers against the market's target", () => {
    expect(supplyStatus({ ...base, ready: 2 })).toBe("CRITICAL");
    expect(supplyStatus({ ...base, ready: 5 })).toBe("LOW");
    expect(supplyStatus({ ...base, ready: 8 })).toBe("BUILDING");
    expect(supplyStatus({ ...base, ready: 12 })).toBe("HEALTHY");
    expect(supplyStatus({ ...base, ready: 16, filled30: 10, unfilled30: 0 })).toBe("LIQUID");
  });
  it("shifts that go unfilled, or demand far above supply, make it worse", () => {
    expect(supplyStatus({ ...base, ready: 12, filled30: 2, unfilled30: 3 })).toBe("CRITICAL");
    expect(supplyStatus({ ...base, ready: 12, filled30: 9, unfilled30: 1 })).toBe("HEALTHY");
    expect(supplyStatus({ ...base, ready: 12, upcomingRequests: 30 })).toBe("BUILDING");
  });
  it("priority and demand labels", () => {
    expect(recruitmentPriority("CRITICAL")).toBe("CRITICAL");
    expect(recruitmentPriority("LOW")).toBe("HIGH");
    expect(recruitmentPriority("LIQUID")).toBe("LOW");
    expect(demandLevel({ upcomingRequests: 6, clinics: 0 })).toBe("High");
    expect(demandLevel({ upcomingRequests: 0, clinics: 4 })).toBe("Medium");
    expect(demandLevel({ upcomingRequests: 0, clinics: 0 })).toBe("Low");
  });
});

describe("market readiness", () => {
  const m = { paused: false, ready: 0, target: 5, supply: "CRITICAL" as const, completed30: 0 };
  it("planned → building supply → ready for demand → active → liquid", () => {
    expect(marketReadiness({ ...m, targetStatus: "OFF" })).toBe("PLANNED");
    expect(marketReadiness({ ...m, targetStatus: "PRELAUNCH", ready: 2 })).toBe("BUILDING_SUPPLY");
    expect(marketReadiness({ ...m, targetStatus: "PRELAUNCH", ready: 6, supply: "HEALTHY" })).toBe("READY_FOR_DEMAND");
    expect(marketReadiness({ ...m, targetStatus: "LIVE", ready: 6, supply: "HEALTHY", completed30: 3 })).toBe("ACTIVE");
    expect(marketReadiness({ ...m, targetStatus: "LIVE", ready: 9, supply: "LIQUID", completed30: 12 })).toBe("LIQUID");
    expect(marketReadiness({ ...m, targetStatus: "LIVE", paused: true, ready: 9 })).toBe("PAUSED");
  });
  it("cost per outcome", () => {
    expect(costPer(1000, 4)).toBe(250);
    expect(costPer(1000, 0)).toBeNull();
  });
});
