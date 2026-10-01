import { describe, expect, it } from "vitest";
import {
  credentialState, expiryReminderDue, followupAnchor, followupDue, followupDueDay, followupKind, providerStage, resolveAcquisitionSource,
  type CredentialRow, type StageInput,
} from "../src";

const d = (s: string) => new Date(s);
const now = d("2026-10-01T12:00:00Z");
const row = (status: CredentialRow["status"], expires: string, created = "2026-09-01T00:00:00Z"): CredentialRow => ({ status, expiresAt: d(expires), createdAt: d(created) });

describe("credentialState", () => {
  it("no rows = not provided; pending = verification pending", () => {
    expect(credentialState([], now)).toBe("not_provided");
    expect(credentialState([row("PENDING_VERIFICATION", "2027-10-01")], now)).toBe("pending");
  });
  it("any verified, unexpired row wins over a newer pending or rejected one", () => {
    expect(credentialState([row("VERIFIED", "2027-01-01", "2026-01-01"), row("REJECTED", "2027-06-01", "2026-09-20")], now)).toBe("verified");
  });
  it("verified but past expiry reads as expired (before the nightly sweep runs)", () => {
    expect(credentialState([row("VERIFIED", "2026-09-30")], now)).toBe("expired");
    expect(credentialState([row("EXPIRED", "2026-09-30")], now)).toBe("expired");
  });
  it("rejected, suspended and revoked need correction; newest row decides", () => {
    expect(credentialState([row("REJECTED", "2027-01-01")], now)).toBe("rejected");
    expect(credentialState([row("REVOKED", "2027-01-01")], now)).toBe("rejected");
    expect(credentialState([row("REJECTED", "2027-01-01", "2026-08-01"), row("PENDING_VERIFICATION", "2027-01-01", "2026-09-01")], now)).toBe("pending");
  });
});

describe("providerStage", () => {
  const base: StageInput = { preLicensure: true, graduationDate: d("2026-12-15"), license: "not_provided", malpractice: "not_provided", coverageReady: false, hasWorked: false, now };
  it("student before graduation with no license = Registered / New Graduate", () => {
    expect(providerStage(base)).toBe("registered");
  });
  it("after graduation, or not a student, or a lapsed license = Pending License", () => {
    expect(providerStage({ ...base, graduationDate: d("2026-05-01") })).toBe("pending_license");
    expect(providerStage({ ...base, preLicensure: false })).toBe("pending_license");
    expect(providerStage({ ...base, license: "expired" })).toBe("pending_license");
    expect(providerStage({ ...base, license: "rejected" })).toBe("pending_license");
  });
  it("license in, malpractice missing = Licensed / Pending Malpractice", () => {
    expect(providerStage({ ...base, license: "pending" })).toBe("pending_malpractice");
    expect(providerStage({ ...base, license: "verified", malpractice: "rejected" })).toBe("pending_malpractice");
  });
  it("both in but not ready = Credential Verification Pending (even if both verified but other steps open)", () => {
    expect(providerStage({ ...base, license: "pending", malpractice: "pending" })).toBe("verification_pending");
    expect(providerStage({ ...base, license: "verified", malpractice: "verified" })).toBe("verification_pending");
  });
  it("coverage-ready and active come only from coverageReady (matching), never from the student fields", () => {
    expect(providerStage({ ...base, coverageReady: true })).toBe("coverage_ready");
    expect(providerStage({ ...base, coverageReady: true, hasWorked: true })).toBe("active");
  });
});

describe("followupKind — never asks for something already done", () => {
  it("license first", () => {
    expect(followupKind("not_provided", "not_provided")).toBe("license_missing");
    expect(followupKind("rejected", "pending")).toBe("license_rejected");
    expect(followupKind("expired", "verified")).toBe("license_expired");
  });
  it("license pending or verified: only malpractice nudges", () => {
    expect(followupKind("pending", "not_provided")).toBe("malpractice_missing");
    expect(followupKind("verified", "not_provided")).toBe("malpractice_missing");
    expect(followupKind("verified", "rejected")).toBe("malpractice_rejected");
    expect(followupKind("pending", "expired")).toBe("malpractice_expired");
  });
  it("everything submitted or done: nothing", () => {
    expect(followupKind("pending", "pending")).toBeNull();
    expect(followupKind("verified", "pending")).toBeNull();
    expect(followupKind("verified", "verified")).toBeNull();
  });
});

describe("follow-up cadence", () => {
  const days = [30, 60, 90];
  it("30/60/90 then every 60", () => {
    expect([0, 1, 2, 3, 4].map((s) => followupDueDay(s, days, 60))).toEqual([30, 60, 90, 150, 210]);
  });
  const anchor = d("2026-06-01T12:00:00Z");
  const at = (day: number) => new Date(+anchor + day * 86_400_000);
  const base = { step: 0, anchor, lastSentAt: null, followupDays: days, repeatDays: 60, minGapDays: 14 };
  it("not before day 30; due on day 30", () => {
    expect(followupDue({ ...base, now: at(29) })).toEqual({ due: false });
    expect(followupDue({ ...base, now: at(30) })).toEqual({ due: true, nextStep: 1 });
  });
  it("after downtime: one catch-up, missed steps skipped", () => {
    expect(followupDue({ ...base, now: at(100) })).toEqual({ due: true, nextStep: 3 });
  });
  it("respects the minimum gap", () => {
    expect(followupDue({ ...base, step: 1, now: at(60), lastSentAt: at(55) })).toEqual({ due: false });
    expect(followupDue({ ...base, step: 1, now: at(70), lastSentAt: at(55) })).toEqual({ due: true, nextStep: 2 });
  });
  it("anchor is graduation, or signup if later", () => {
    expect(followupAnchor(d("2026-12-01"), d("2026-10-01"))).toEqual(d("2026-12-01"));
    expect(followupAnchor(d("2020-05-01"), d("2026-10-01"))).toEqual(d("2026-10-01"));
    expect(followupAnchor(null, d("2026-10-01"))).toEqual(d("2026-10-01"));
  });
});

describe("renewal reminder points are configurable", () => {
  it("adds 14 days when configured", () => {
    const exp = d("2026-10-15T12:00:00Z");
    expect(expiryReminderDue(exp, now)).toBeNull();
    expect(expiryReminderDue(exp, now, [60, 30, 14, 7])).toBe(14);
  });
});

describe("acquisition source", () => {
  it("campaign link > utm > selected > direct", () => {
    expect(resolveAcquisitionSource({ campaignKind: "SCHOOL", utmSource: "facebook" })).toBe("school");
    expect(resolveAcquisitionSource({ campaignKind: "EVENT" })).toBe("event");
    expect(resolveAcquisitionSource({ utmSource: "IG", selected: "google" })).toBe("instagram");
    expect(resolveAcquisitionSource({ selected: "clinic_referral" })).toBe("clinic_referral");
    expect(resolveAcquisitionSource({ selected: "nonsense" })).toBe("direct");
  });
});
