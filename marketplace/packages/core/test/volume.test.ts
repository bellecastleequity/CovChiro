import { describe, expect, it } from "vitest";
import { defaultSettings } from "@cm/config";
import { countOutcome, parseVolumeTerms, reconcileWithTerms, volumeCeilings, volumeTermsFor, medianVisits, reconcileVolume, tierForVisits, underDeclareWarning, validateVolumeCards, volumeOverage, type VolumeCard } from "../src/volume";

// Owner-approved FL smaller-cities full day: LIGHT ≤12, BUSY ≤30; +$10 / +$8 per visit past the declared ceiling + 5.
const FULL: VolumeCard[] = [
  { tier: "LIGHT", visitCeiling: 12, clinicPriceCents: 45000, providerPayCents: 39000, overageClinicCentsPerVisit: 1000, overageProviderCentsPerVisit: 800 },
  { tier: "BUSY", visitCeiling: 30, clinicPriceCents: 57500, providerPayCents: 46500, overageClinicCentsPerVisit: 1000, overageProviderCentsPerVisit: 800 },
];
const card = (t: VolumeCard["tier"]) => FULL.find((c) => c.tier === t)!;

describe("volume tiers", () => {
  it("picks the smallest tier that holds the expected visits; above every ceiling is the top tier", () => {
    expect(tierForVisits(0, FULL)).toBe("LIGHT");
    expect(tierForVisits(12, FULL)).toBe("LIGHT");
    expect(tierForVisits(13, FULL)).toBe("BUSY");
    expect(tierForVisits(30, FULL)).toBe("BUSY");
    expect(tierForVisits(31, FULL)).toBe("BUSY");
    expect(tierForVisits(80, FULL)).toBe("BUSY");
  });

  it("validates a complete, increasing set of cards", () => {
    expect(validateVolumeCards(FULL)).toBeNull();
    expect(validateVolumeCards(FULL.slice(0, 1))).toMatch(/Busy/);
    expect(validateVolumeCards([FULL[0], { ...FULL[1], visitCeiling: 10 }])).toMatch(/ceiling/i);
    expect(validateVolumeCards([FULL[0], { ...FULL[1], clinicPriceCents: 40000 }])).toMatch(/price/i);
    expect(validateVolumeCards([{ ...FULL[0], providerPayCents: 50000 }, FULL[1]])).toMatch(/pay/i);
  });
});

describe("overage past the declared tier (grace of 5)", () => {
  const ov = (ceiling: number, visits: number) => volumeOverage({ declaredCeiling: ceiling, finalVisits: visits, graceVisits: 5, clinicPerVisit: 1000, providerPerVisit: 800 });
  it("is free up to ceiling + grace, then charges every visit beyond it", () => {
    expect(ov(12, 9)).toEqual({ overageVisits: 0, clinicCents: 0, providerCents: 0 });
    expect(ov(12, 17)).toEqual({ overageVisits: 0, clinicCents: 0, providerCents: 0 });
    expect(ov(12, 20)).toEqual({ overageVisits: 3, clinicCents: 3000, providerCents: 2400 });
    expect(ov(30, 45)).toEqual({ overageVisits: 10, clinicCents: 10000, providerCents: 8000 });
  });
});

describe("reconcile (price never goes below what was declared)", () => {
  const base = (t: VolumeCard["tier"], mult = 1) => ({ clinicPriceCents: Math.round(card(t).clinicPriceCents * mult), providerPayCents: Math.round(card(t).providerPayCents * mult) });
  const rec = (t: VolumeCard["tier"], visits: number | null, mult = 1) =>
    reconcileVolume({ declaredTier: t, declaredCard: card(t), quoted: base(t, mult), finalVisits: visits, graceVisits: 5 });

  it.each([
    ["LIGHT", 9, 45000, 39000, 0],
    ["LIGHT", 16, 45000, 39000, 0],
    ["LIGHT", 20, 48000, 41400, 3],
    ["BUSY", 9, 57500, 46500, 0],
    ["BUSY", 35, 57500, 46500, 0],
    ["BUSY", 45, 67500, 54500, 10],
  ] as const)("declared %s, %i visits → clinic %i, provider %i", (t, visits, clinic, provider, extra) => {
    const r = rec(t, visits);
    expect(r).toMatchObject({ clinicFinalCents: clinic, providerFinalCents: provider, overageVisits: extra, finalTier: t });
  });

  it("premiums raise the tier base but never the per-visit overage", () => {
    const r = rec("LIGHT", 20, 1.25);
    expect(r.clinicFinalCents).toBe(56250 + 3000);
    expect(r.providerFinalCents).toBe(48750 + 2400);
  });

  it("no count = the declared tier, no overage", () => {
    expect(rec("BUSY", null)).toMatchObject({ clinicFinalCents: 57500, providerFinalCents: 46500, overageVisits: 0, finalVisits: null });
  });
});

describe("count outcomes", () => {
  it("agree, split within tolerance (rounded down), dispute beyond it", () => {
    expect(countOutcome(22, null, 2)).toEqual({ kind: "PROVIDER", finalVisits: 22 });
    expect(countOutcome(22, 22, 2)).toEqual({ kind: "AGREED", finalVisits: 22 });
    expect(countOutcome(22, 21, 2)).toEqual({ kind: "SPLIT", finalVisits: 21 });
    expect(countOutcome(22, 20, 2)).toEqual({ kind: "SPLIT", finalVisits: 21 });
    expect(countOutcome(20, 22, 2)).toEqual({ kind: "SPLIT", finalVisits: 21 });
    expect(countOutcome(30, 20, 2)).toEqual({ kind: "DISPUTED", finalVisits: 20 });
  });
});

describe("posting helpers", () => {
  it("median of recent counts", () => {
    expect(medianVisits([])).toBeNull();
    expect(medianVisits([18])).toBe(18);
    expect(medianVisits([10, 30, 18])).toBe(18);
    expect(medianVisits([10, 20, 30, 40])).toBe(25);
  });
  it("warns (never blocks) when every recent day beat the declared tier", () => {
    expect(underDeclareWarning(10, 12, [21, 19, 23], 3)).toMatch(/averaged 21 visits/);
    expect(underDeclareWarning(10, 12, [21, 9, 23], 3)).toBeNull();
    expect(underDeclareWarning(10, 12, [21, 19], 3)).toBeNull();
  });
});

describe("volume settings", () => {
  const S = defaultSettings();
  it("owner defaults: Light 12 / Busy 30 full day, 6 / 15 half day, grace 5, $10 / $8", () => {
    expect(volumeCeilings(S, "FULL_DAY")).toEqual({ LIGHT: 12, BUSY: 30 });
    expect(volumeCeilings(S, "HALF_DAY")).toEqual({ LIGHT: 6, BUSY: 15 });
    expect(volumeTermsFor(S, "FULL_DAY", "LIGHT")).toEqual({ ceiling: 12, grace: 5, overageClinicCents: 1000, overageProviderCents: 800 });
  });
  it("keeps Busy above Light and provider per-visit at or below the clinic's", () => {
    const odd = { ...S, "pricing.volumeBusyVisitsFullDay": 10, "pricing.volumeOverageProviderCents": 5000 };
    expect(volumeCeilings(odd, "FULL_DAY").BUSY).toBe(13);
    expect(volumeTermsFor(odd, "FULL_DAY", "BUSY").overageProviderCents).toBe(1000);
  });
  it("reconciles from the terms stored on the shift", () => {
    const terms = parseVolumeTerms(JSON.parse(JSON.stringify(volumeTermsFor(S, "FULL_DAY", "BUSY"))))!;
    expect(reconcileWithTerms("BUSY", terms, { clinicPriceCents: 57500, providerPayCents: 46500 }, 45)).toMatchObject({ clinicFinalCents: 67500, providerFinalCents: 54500, overageVisits: 10 });
    expect(parseVolumeTerms({ ceiling: 1 })).toBeNull();
  });
});
