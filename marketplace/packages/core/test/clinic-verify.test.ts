import { describe, expect, it } from "vitest";
import {
  autoApprovable,
  openChecks,
  overrideCheck,
  clinicCleared,
  clinicVerifyDeadline,
  evaluateEligibility,
  isNpi,
  namesMatch,
  sameLicenseNumber,
  verificationChecks,
  verificationInputProblems,
  verifyReminderDue,
  type StateOwnershipRule,
  type VerificationFacts,
  type VerificationInput,
} from "../src";
import { d, OPTS, pair, provider, S, shift } from "./fixtures";

const FL: StateOwnershipRule = S["clinicVerify.stateRules"].FL;
const NOW = d("2026-10-10T12:00:00Z");

const input = (over: Partial<VerificationInput> = {}): VerificationInput => ({
  entityName: "Sunshine Chiropractic LLC",
  entityState: "FL",
  entityNumber: "L21000123456",
  orgNpi: "1234567893",
  owners: [{ name: "Jane Q. Doe", percent: 100, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: "CH 12345" }],
  facilityLicenseNumber: null,
  facilityExemptionNumber: null,
  documentKeys: [],
  attestName: "Jane Doe",
  ...over,
});

const facts = (over: Partial<VerificationFacts> = {}): VerificationFacts => ({
  rule: FL,
  locationState: "FL",
  locationZip: "32801",
  orgNpi: { found: true, name: "SUNSHINE CHIROPRACTIC LLC", state: "FL", zip: "328011234", authorizedOfficial: "JANE DOE" },
  owners: [{ license: "NPPES", nameMatches: true }],
  linkedToBlocked: false,
  ...over,
});

describe("clinic verification", () => {
  it("cleared = verified and not lapsed, or still inside a grace period; rejected never; off = everyone", () => {
    const later = d("2027-01-01");
    expect(clinicCleared({ status: "VERIFIED", verifiedUntil: later, graceUntil: null }, NOW)).toBe(true);
    expect(clinicCleared({ status: "VERIFIED", verifiedUntil: d("2026-10-01"), graceUntil: null }, NOW)).toBe(false);
    expect(clinicCleared({ status: "NOT_STARTED", verifiedUntil: null, graceUntil: later }, NOW)).toBe(true);
    expect(clinicCleared({ status: "PENDING", verifiedUntil: null, graceUntil: null }, NOW)).toBe(false);
    expect(clinicCleared({ status: "REJECTED", verifiedUntil: later, graceUntil: later }, NOW)).toBe(false);
    expect(clinicCleared({ status: "PENDING", verifiedUntil: null, graceUntil: null }, NOW, false)).toBe(true);
  });

  it("deadline and reminders count down to the later of grace / renewal", () => {
    const f = { status: "NOT_STARTED" as const, verifiedUntil: null, graceUntil: d("2026-10-20T12:00:00Z") };
    expect(clinicVerifyDeadline(f, NOW)).toEqual(f.graceUntil);
    expect(verifyReminderDue(f.graceUntil, NOW, [14, 7, 2])).toBe(0); // 10 days left: the 14-day reminder
    expect(verifyReminderDue(f.graceUntil, d("2026-10-19T12:00:00Z"), [14, 7, 2])).toBe(2);
    expect(verifyReminderDue(f.graceUntil, d("2026-09-01"), [14, 7, 2])).toBeNull();
    expect(clinicVerifyDeadline({ ...f, graceUntil: d("2026-09-01") }, NOW)).toBeNull();
  });

  it("F13 hides an uncleared clinic's shifts from everyone; credential-only checks ignore it", () => {
    const r = evaluateEligibility(provider(), shift({ clinicCleared: false }), pair(), OPTS);
    expect(r.failures.map((f) => f.filter)).toEqual(["F13"]);
    expect(evaluateEligibility(provider(), shift({ clinicCleared: false }), pair(), { ...OPTS, credentialsOnly: true }).eligible).toBe(true);
    expect(evaluateEligibility(provider(), shift({ clinicCleared: true }), pair(), OPTS).eligible).toBe(true);
  });

  it("names, NPIs and license numbers compare the way people write them", () => {
    expect(namesMatch("Dr. Jane Q. Doe, D.C.", "JANE DOE")).toBe(true);
    expect(namesMatch("J Doe", "Jane Doe")).toBe(true);
    expect(namesMatch("Jane Doe", "John Doe")).toBe(false);
    expect(namesMatch("Jane Doe", "Jane Smith")).toBe(false);
    expect(isNpi("1234567893")).toBe(true);
    expect(isNpi("1234567890")).toBe(false);
    expect(sameLicenseNumber("CH 12345", "CH0012345")).toBe(true);
    expect(sameLicenseNumber("CH12345", "CH12346")).toBe(false);
  });

  it("form: shares add to 100, licensed owners give their license, non-practitioner owners in FL need the AHCA license + upload", () => {
    expect(verificationInputProblems(input(), FL)).toEqual([]);
    expect(verificationInputProblems(input({ owners: [{ name: "Jane Doe", percent: 60, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: "CH1" }] }), FL).join(" ")).toMatch(/100%/);
    const lay = input({ owners: [{ name: "Jane Doe", percent: 51, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: "CH1" }, { name: "Max Investor", percent: 49, licensed: false }] });
    expect(verificationInputProblems(lay, FL).join(" ")).toMatch(/AHCA.*number.*Upload/s);
    expect(verificationInputProblems({ ...lay, facilityLicenseNumber: "HCC1234", documentKeys: ["clinics/x/a.pdf"] }, FL)).toEqual([]);
    expect(verificationInputProblems(input({ owners: [{ name: "Jane Doe", percent: 100, licensed: true }] }), FL).join(" ")).toMatch(/license/);
    expect(verificationInputProblems(input({ attestName: "" }), FL).join(" ")).toMatch(/sign/);
  });

  it("a clean practitioner-owned clinic is approved automatically", () => {
    const checks = verificationChecks(input(), facts());
    expect(autoApprovable(checks)).toEqual({ approve: true, reasons: [] });
    expect(checks.find((c) => c.key === "entity")?.outcome).toBe("REVIEW"); // spot-check only, never blocks
  });

  it("anything a person must look at goes to review", () => {
    const cases: [Partial<VerificationInput>, Partial<VerificationFacts>, RegExp][] = [
      [{}, { rule: null }, /rule/],
      [{ owners: [{ name: "Jane Doe", percent: 51, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: "CH1" }, { name: "Max Investor", percent: 49, licensed: false }], facilityLicenseNumber: "HCC1" }, { owners: [{ license: "NPPES", nameMatches: true }, { license: null, nameMatches: false }] }, /AHCA/],
      [{}, { owners: [{ license: "NOT_FOUND", nameMatches: false }] }, /wasn't found/],
      [{}, { owners: [{ license: "NPPES", nameMatches: false }] }, /different name/],
      [{}, { owners: [{ license: "PLATFORM", nameMatches: true, boardInactive: true }] }, /not active/],
      [{ orgNpi: null }, {}, /No organization NPI/],
      [{}, { orgNpi: { found: false, name: "", state: null, zip: null, authorizedOfficial: null } }, /isn't an active/],
      [{}, { orgNpi: { found: true, name: "X", state: "FL", zip: "33101", authorizedOfficial: "JANE DOE" } }, /ZIP/],
      [{}, { orgNpi: { found: true, name: "X", state: "FL", zip: "32801", authorizedOfficial: "BOB ROSS" } }, /BOB ROSS/],
      [{}, { registryDown: true }, /couldn't be reached/],
      [{}, { linkedToBlocked: true }, /banned/],
    ];
    for (const [i, f, why] of cases) {
      const r = autoApprovable(verificationChecks(input(i), facts(f)));
      expect(r.approve).toBe(false);
      expect(r.reasons.join(" ")).toMatch(why);
    }
  });

  it("a state whose rule says non-practitioners can't own fails that check (a person still decides)", () => {
    const rule: StateOwnershipRule = { entityRegistry: "NJ Business Records", entityLookupUrl: "https://example.test", nonPractitionerOwners: "NOT_ALLOWED" };
    const checks = verificationChecks(input({ entityState: "NJ", owners: [{ name: "Max Investor", percent: 100, licensed: false }] }), facts({ rule, locationState: "NJ", owners: [{ license: null, nameMatches: false }] }));
    expect(checks.find((c) => c.key === "ownership")?.outcome).toBe("FAIL");
  });

  it("documents can come later by email (a person then reviews), and an admin can mark single items OK", () => {
    const lay = input({ owners: [{ name: "Jane Doe", percent: 51, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: "CH1" }, { name: "Max Investor", percent: 49, licensed: false }], facilityLicenseNumber: "HCC1" });
    expect(verificationInputProblems(lay, FL).join(" ")).toMatch(/email the documents/);
    expect(verificationInputProblems({ ...lay, documentsLater: true }, FL)).toEqual([]);
    const checks = verificationChecks({ ...input(), documentsLater: true }, facts({ owners: [{ license: "NOT_FOUND", nameMatches: false }] }));
    expect(openChecks(checks).map((c) => c.key)).toEqual(["owner_0", "documents"]);
    const at = d("2026-10-10T15:00:00Z");
    let next = overrideCheck(checks, "owner_0", "Owner", "Checked on the FL board site", at);
    expect(next.find((c) => c.key === "owner_0")).toMatchObject({ outcome: "PASS", override: { from: "REVIEW", by: "Owner", note: "Checked on the FL board site" } });
    expect(autoApprovable(next).approve).toBe(false);
    next = overrideCheck(next, "documents", "Owner", "Received by email", at);
    expect(autoApprovable(next).approve).toBe(true);
    expect(() => overrideCheck(next, "nope", "Owner", "x", at)).toThrow();
  });
});
