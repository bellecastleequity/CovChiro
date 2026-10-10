import { describe, expect, it } from "vitest";
import { caslBlock, countryOf, jurisdictionOf, marketRecommendation, priorityRank, resolvePriority, sideSplit } from "../src";

describe("geographic acquisition priorities", () => {
  it("knows the country and jurisdiction of a region code", () => {
    expect(countryOf("FL")).toBe("US");
    expect(countryOf("ON")).toBe("CA");
    expect(countryOf("CA")).toBe("US"); // California, not Canada
    expect(jurisdictionOf("PR")).toBe("US_TERRITORY");
    expect(jurisdictionOf("VI")).toBe("US_TERRITORY");
    expect(jurisdictionOf("QC")).toBe("CANADA");
    expect(jurisdictionOf("GA")).toBe("US_STATE");
  });

  it("defaults: Florida demand first, every other market supply first", () => {
    const defaults = { FL: "DEMAND" as const };
    expect(resolvePriority({ state: "FL", overrides: defaults })).toEqual({ primary: "DEMAND", source: "state" });
    for (const st of ["GA", "TX", "PR", "VI", "ON", "BC"]) expect(resolvePriority({ state: st, overrides: defaults }).primary).toBe("SUPPLY");
  });

  it("market overrides beat state, state beats country, country beats the default", () => {
    const overrides = { FL: "DEMAND" as const, "country:CA": "DEMAND" as const, GA: "DEMAND" as const };
    expect(resolvePriority({ state: "FL", marketOverride: "SUPPLY", overrides })).toEqual({ primary: "SUPPLY", source: "market" });
    expect(resolvePriority({ state: "ON", overrides })).toEqual({ primary: "DEMAND", source: "country" });
    expect(resolvePriority({ state: "ON", overrides: { ...overrides, ON: "SUPPLY" } })).toEqual({ primary: "SUPPLY", source: "state" });
    expect(resolvePriority({ state: "TX", overrides })).toEqual({ primary: "SUPPLY", source: "default" });
    // A recommendation is only used when the admin allows it and set nothing for that market.
    const rec = { side: "SUPPLY" as const, kind: "IMBALANCE" as const };
    expect(resolvePriority({ state: "FL", overrides, recommendation: rec, followRecommendations: false }).primary).toBe("DEMAND");
    expect(resolvePriority({ state: "FL", overrides, recommendation: rec, followRecommendations: true })).toEqual({ primary: "SUPPLY", source: "recommendation" });
    expect(resolvePriority({ state: "FL", marketOverride: "DEMAND", overrides, recommendation: rec, followRecommendations: true }).source).toBe("market");
  });

  it("splits effort with the primary side ahead, never starving the other side", () => {
    expect(sideSplit(10, "DEMAND", 70)).toEqual({ DEMAND: 7, SUPPLY: 3 });
    expect(sideSplit(10, "SUPPLY", 70)).toEqual({ SUPPLY: 7, DEMAND: 3 });
    expect(sideSplit(2, "SUPPLY", 95)).toEqual({ SUPPLY: 1, DEMAND: 1 });
    expect(sideSplit(1, "DEMAND", 70)).toEqual({ DEMAND: 1, SUPPLY: 0 });
    expect(sideSplit(0, "DEMAND", 70)).toEqual({ DEMAND: 0, SUPPLY: 0 });
    // Ordering: work the side a market prioritizes first.
    expect(priorityRank("DEMAND", "DEMAND")).toBeLessThan(priorityRank("DEMAND", "SUPPLY"));
  });
});

describe("market imbalance recommendations", () => {
  const base = { primary: "SUPPLY" as const, readyProviders: 0, targetProviders: 3, activeClinics: 0, upcomingRequests: 0, upcomingOpen: 0, unfilled30: 0 };
  it("unmet demand → recruit providers, even in a demand-first market", () => {
    const r = marketRecommendation({ ...base, primary: "DEMAND", readyProviders: 1, activeClinics: 4, upcomingRequests: 6, upcomingOpen: 5, unfilled30: 2 });
    expect(r).toMatchObject({ side: "SUPPLY", kind: "IMBALANCE", differsFromPriority: true });
  });
  it("plenty of providers, few clinics → recruit clinics, even in a supply-first market", () => {
    const r = marketRecommendation({ ...base, readyProviders: 9, activeClinics: 0 });
    expect(r).toMatchObject({ side: "DEMAND", kind: "IMBALANCE", differsFromPriority: true });
    expect(marketRecommendation({ ...base, readyProviders: 9, activeClinics: 1, upcomingRequests: 1 }).side).toBe("DEMAND");
  });
  it("otherwise follows the configured priority", () => {
    expect(marketRecommendation({ ...base })).toMatchObject({ side: "SUPPLY", kind: "PRIORITY", differsFromPriority: false });
    expect(marketRecommendation({ ...base, primary: "DEMAND" })).toMatchObject({ side: "DEMAND", kind: "PRIORITY" });
  });
});

describe("Canadian anti-spam (CASL) gate", () => {
  it("blocks commercial email to Canada without a recorded consent basis or with Canada outreach off", () => {
    expect(caslBlock({ state: "FL", purpose: "COMMERCIAL", consentBasis: null, canadaOutreach: false })).toBeNull();
    expect(caslBlock({ state: "ON", purpose: "COMMERCIAL", consentBasis: "CONSPICUOUS_PUBLICATION", canadaOutreach: false })).toBe("canada_outreach_off");
    expect(caslBlock({ state: "ON", purpose: "COMMERCIAL", consentBasis: null, canadaOutreach: true })).toBe("casl_consent_missing");
    expect(caslBlock({ state: "ON", purpose: "COMMERCIAL", consentBasis: "maybe", canadaOutreach: true })).toBe("casl_consent_missing");
    expect(caslBlock({ state: "ON", purpose: "COMMERCIAL", consentBasis: "EXPRESS", canadaOutreach: true })).toBeNull();
    // Replies and account notices aren't commercial messages.
    expect(caslBlock({ state: "ON", purpose: "CONVERSATIONAL", consentBasis: null, canadaOutreach: false })).toBeNull();
  });
});
