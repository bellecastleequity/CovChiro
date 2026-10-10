import { describe, expect, it } from "vitest";
import {
  activationDue, contactDecision, escalationTopic, leadScore, nurtureDue, outreachStepDue, providerGrowthState, prospectStageFromAccount,
  renderTemplate, ruleSegment, validateAiCopy, wantsOptOut, type ContactContext, type GrowthCadence,
} from "../src";
import { config, d, FAR } from "./fixtures";

const NOW = d("2026-10-01T15:00:00Z");
const MINS = config();
const lic = (status: "VERIFIED" | "PENDING_VERIFICATION" | "REJECTED" | "EXPIRED", state = "FL", expiresAt = FAR) => ({ professionCode: "DC", state, status, expiresAt });
const mal = (status: "VERIFIED" | "PENDING_VERIFICATION" | "REJECTED", expiresAt = FAR) => ({
  status, expiresAt, perOccurrenceCents: 100_000_000, aggregateCents: 300_000_000, coveredProfessionCodes: ["DC"],
});
const base = { professionCode: "DC", state: "FL", mins: MINS, graduationDate: null as Date | null, isStudent: false, shiftsCompleted: 0, now: NOW };

describe("provider growth state (spec §22–24)", () => {
  it("student before graduation: STUDENT, no credential reminders", () => {
    expect(providerGrowthState({ ...base, licenses: [], malpractice: [], isStudent: true, graduationDate: d("2027-05-01") })).toMatchObject({ stage: "STUDENT", message: "none", coverageReady: false });
  });
  it("graduated without a license: PENDING_LICENSE, ask about the license", () => {
    expect(providerGrowthState({ ...base, licenses: [], malpractice: [], isStudent: true, graduationDate: d("2026-05-01") })).toMatchObject({ stage: "PENDING_LICENSE", message: "license" });
  });
  it("license uploaded (pending verification): stop license reminders", () => {
    expect(providerGrowthState({ ...base, licenses: [lic("PENDING_VERIFICATION")], malpractice: [] })).toMatchObject({ stage: "CREDENTIAL_REVIEW", message: "under_review" });
  });
  it("license verified, malpractice missing: ask for malpractice", () => {
    expect(providerGrowthState({ ...base, licenses: [lic("VERIFIED")], malpractice: [] })).toMatchObject({ stage: "PENDING_MALPRACTICE", message: "malpractice" });
  });
  it("both uploaded / verification pending: under review", () => {
    expect(providerGrowthState({ ...base, licenses: [lic("VERIFIED")], malpractice: [mal("PENDING_VERIFICATION")] })).toMatchObject({ stage: "CREDENTIAL_REVIEW", message: "under_review" });
  });
  it("both verified: coverage ready, credential reminders stop", () => {
    expect(providerGrowthState({ ...base, licenses: [lic("VERIFIED")], malpractice: [mal("VERIFIED")] })).toMatchObject({ stage: "COVERAGE_READY", message: "none", coverageReady: true });
    expect(providerGrowthState({ ...base, licenses: [lic("VERIFIED")], malpractice: [mal("VERIFIED")], shiftsCompleted: 1 }).stage).toBe("FIRST_SHIFT");
    expect(providerGrowthState({ ...base, licenses: [lic("VERIFIED")], malpractice: [mal("VERIFIED")], shiftsCompleted: 3 }).stage).toBe("REPEAT_PROVIDER");
  });
  it("a license in another state never counts toward the launch state (INV-1 rules reused)", () => {
    expect(providerGrowthState({ ...base, licenses: [lic("VERIFIED", "GA")], malpractice: [mal("VERIFIED")] })).toMatchObject({ coverageReady: false, message: "license" });
  });
  it("an expired verified license asks for the license again", () => {
    expect(providerGrowthState({ ...base, licenses: [lic("VERIFIED", "FL", d("2026-09-01"))], malpractice: [mal("VERIFIED")] })).toMatchObject({ coverageReady: false, message: "license" });
  });
  it("rejected license: ask again", () => {
    expect(providerGrowthState({ ...base, licenses: [lic("REJECTED")], malpractice: [] }).message).toBe("license");
  });
});

const CAD: GrowthCadence = { nurtureOffsetDays: [30, 60, 90], nurtureRepeatDays: 60, nurtureMax: 10, activationRepeatDays: 30, activationMax: 4 };

describe("credential nurture schedule (spec §23)", () => {
  const grad = d("2026-07-01T12:00:00Z");
  const p = (over: Partial<Parameters<typeof nurtureDue>[0]> = {}) => ({ graduationDate: grad, createdAt: d("2026-03-01"), nurtureCount: 0, lastNurtureAt: null, ...over });
  it("first reminder 30 days after graduation", () => {
    expect(nurtureDue(p(), "license", CAD, d("2026-07-30T00:00:00Z"))).toBe(false);
    expect(nurtureDue(p(), "license", CAD, d("2026-08-01T00:00:00Z"))).toBe(true);
  });
  it("then 60 and 90 days, then every 60 days", () => {
    expect(nurtureDue(p({ nurtureCount: 1, lastNurtureAt: d("2026-08-01") }), "license", CAD, d("2026-08-29"))).toBe(false);
    expect(nurtureDue(p({ nurtureCount: 1, lastNurtureAt: d("2026-08-01") }), "license", CAD, d("2026-09-01"))).toBe(true);
    expect(nurtureDue(p({ nurtureCount: 3, lastNurtureAt: d("2026-10-01") }), "license", CAD, d("2026-11-28"))).toBe(false);
    expect(nurtureDue(p({ nurtureCount: 3, lastNurtureAt: d("2026-10-01") }), "license", CAD, d("2026-11-30"))).toBe(true);
  });
  it("never while under review, ready, or a student; never past the cap", () => {
    for (const m of ["under_review", "none"] as const) expect(nurtureDue(p(), m, CAD, NOW)).toBe(false);
    expect(nurtureDue(p({ nurtureCount: 10 }), "license", CAD, d("2030-01-01"))).toBe(false);
  });
  it("catching up after downtime never sends two close together", () => {
    expect(nurtureDue(p({ nurtureCount: 1, lastNurtureAt: d("2026-09-20") }), "license", CAD, d("2026-10-01"))).toBe(false);
  });
  it("falls back to the registration date without a graduation date", () => {
    expect(nurtureDue(p({ graduationDate: null, createdAt: d("2026-08-15") }), "malpractice", CAD, d("2026-09-15"))).toBe(true);
  });
});

describe("activation (spec §25)", () => {
  const a = (over: Partial<Parameters<typeof activationDue>[0]> = {}) => ({ coverageReady: true, activationCount: 0, lastActivationAt: null, hasAvailability: false, lastShiftAt: null, availabilityUpdatedAt: null, ...over });
  it("first message when coverage-ready", () => expect(activationDue(a(), CAD, NOW)).toBe("ready"));
  it("not before coverage-ready", () => expect(activationDue(a({ coverageReady: false }), CAD, NOW)).toBeNull());
  it("re-engage only when availability is missing or stale and idle, on the repeat interval", () => {
    expect(activationDue(a({ activationCount: 1, lastActivationAt: d("2026-09-20") }), CAD, NOW)).toBeNull();
    expect(activationDue(a({ activationCount: 1, lastActivationAt: d("2026-08-01") }), CAD, NOW)).toBe("reactivate");
    expect(activationDue(a({ activationCount: 1, lastActivationAt: d("2026-08-01"), hasAvailability: true, availabilityUpdatedAt: d("2026-09-01") }), CAD, NOW)).toBeNull();
    expect(activationDue(a({ activationCount: 4, lastActivationAt: d("2026-01-01") }), CAD, NOW)).toBeNull();
  });
});

describe("clinic prospect stage", () => {
  const f = { hasAccount: false, hasDraft: false, posted: 0, booked: 0, completed: 0, lastBookingAt: null as Date | null, hasEmail: true, emailBounced: false, doNotContact: false };
  it("pre-account stages come from outreach; email makes it contactable", () => {
    expect(prospectStageFromAccount("PROSPECT", f, NOW)).toBe("CONTACTABLE");
    expect(prospectStageFromAccount("PROSPECT", { ...f, hasEmail: false }, NOW)).toBe("PROSPECT");
    expect(prospectStageFromAccount("ENGAGED", f, NOW)).toBe("ENGAGED");
  });
  it("account-driven stages follow real bookings", () => {
    expect(prospectStageFromAccount("CONTACTABLE", { ...f, hasAccount: true }, NOW)).toBe("ACCOUNT_CREATED");
    expect(prospectStageFromAccount("CONTACTABLE", { ...f, hasAccount: true, hasDraft: true }, NOW)).toBe("COVERAGE_REQUESTED");
    expect(prospectStageFromAccount("CONTACTABLE", { ...f, hasAccount: true, booked: 1, lastBookingAt: NOW }, NOW)).toBe("FIRST_SHIFT_BOOKED");
    expect(prospectStageFromAccount("CONTACTABLE", { ...f, hasAccount: true, booked: 1, completed: 1, lastBookingAt: NOW }, NOW)).toBe("FIRST_SHIFT_COMPLETED");
    expect(prospectStageFromAccount("CONTACTABLE", { ...f, hasAccount: true, booked: 2, completed: 2, lastBookingAt: NOW }, NOW)).toBe("REPEAT_CLINIC");
    expect(prospectStageFromAccount("REPEAT_CLINIC", { ...f, hasAccount: true, booked: 2, completed: 2, lastBookingAt: d("2025-06-01") }, NOW)).toBe("DORMANT");
  });
  it("opt-outs are sticky", () => {
    expect(prospectStageFromAccount("CONTACTABLE", { ...f, doNotContact: true }, NOW)).toBe("DO_NOT_CONTACT");
    expect(prospectStageFromAccount("NOT_INTERESTED", { ...f, hasAccount: true }, NOW)).toBe("NOT_INTERESTED");
  });
});

describe("lead score (spec §16)", () => {
  it("weights meaningful actions, decays old ones, ignores unknown kinds", () => {
    expect(leadScore([], { locationsCount: null, providerCount: null }, { booked: 0 }, NOW)).toEqual({ score: 0, category: "COLD" });
    expect(leadScore([{ kind: "calculator_used", at: NOW }], { locationsCount: null, providerCount: null }, { booked: 0 }, NOW).category).toBe("WARM");
    const hot = [{ kind: "coverage_dates_entered", at: NOW }, { kind: "contact_requested", at: NOW }, { kind: "email_open", at: NOW }];
    expect(leadScore(hot, { locationsCount: 3, providerCount: null }, { booked: 0 }, NOW)).toEqual({ score: 60, category: "HIGH_INTENT" });
    expect(leadScore([{ kind: "contact_requested", at: d("2026-08-15") }], { locationsCount: null, providerCount: null }, { booked: 0 }, NOW).score).toBe(15);
    expect(leadScore([{ kind: "contact_requested", at: d("2026-05-01") }], { locationsCount: null, providerCount: null }, { booked: 0 }, NOW).score).toBe(0);
  });
  it("customers are categorised by bookings", () => {
    expect(leadScore([], { locationsCount: null, providerCount: null }, { booked: 1 }, NOW).category).toBe("ACTIVE_CUSTOMER");
    expect(leadScore([], { locationsCount: null, providerCount: null }, { booked: 2 }, NOW).category).toBe("REPEAT_CUSTOMER");
  });
});

describe("rule segments (spec §5)", () => {
  it("uses listed facts only; null when unknown", () => {
    expect(ruleSegment({ ownership: "franchise" })).toBe("franchise");
    expect(ruleSegment({ locationsCount: 2 })).toBe("multi_location");
    expect(ruleSegment({ providerCount: 3 })).toBe("multi_dc");
    expect(ruleSegment({ providerCount: 1 })).toBe("solo");
    expect(ruleSegment({ multidisciplinary: true, providerCount: 1 })).toBe("multidisciplinary");
    expect(ruleSegment({})).toBeNull();
  });
});

describe("outreach step timing", () => {
  it("step 0 immediately, later steps after their gap from the last contact", () => {
    expect(outreachStepDue(0, null, [0, 5, 12], NOW)).toBe(true);
    expect(outreachStepDue(1, d("2026-09-28T15:00:00Z"), [0, 5, 12], NOW)).toBe(false);
    expect(outreachStepDue(1, d("2026-09-26T15:00:00Z"), [0, 5, 12], NOW)).toBe(true);
    expect(outreachStepDue(3, d("2026-01-01"), [0, 5, 12], NOW)).toBe(false);
  });
});

describe("contact decision (spec §11): software, not AI, decides", () => {
  const ctx = (over: Partial<ContactContext> = {}): ContactContext => ({
    channel: "EMAIL", purpose: "COMMERCIAL", automated: true, pausedOutbound: false, doNotContact: false, address: "dr@clinic.com",
    emailStatus: "UNKNOWN", suppression: null, smsConsent: false, postalAddress: "1 Main St, Orlando, FL", lastAutomatedAt: null,
    commercialLast7Days: 0, commercialToday: 0, localMinutes: 12 * 60,
    limits: { minHoursBetweenAutomated: 20, maxCommercialPerWeek: 2, dailyOutreachCap: 40, smsQuietStartMin: 20 * 60, smsQuietEndMin: 9 * 60 },
    now: NOW, ...over,
  });
  it("allows a clean commercial email", () => expect(contactDecision(ctx())).toEqual({ ok: true, reason: null, transient: false }));
  it.each([
    [{ pausedOutbound: true }, "automation_paused", true],
    [{ audienceOff: true }, "audience_marketing_off", true],
    [{ doNotContact: true }, "do_not_contact", false],
    [{ jurisdictionBlock: "casl_consent_missing" }, "casl_consent_missing", false],
    [{ address: "" }, "no_address", false],
    [{ emailStatus: "BOUNCED" }, "email_bounced", false],
    [{ emailStatus: "UNSUBSCRIBED" }, "unsubscribed", false],
    [{ suppression: "UNSUBSCRIBE" }, "suppressed_unsubscribe", false],
    [{ postalAddress: "" }, "postal_address_missing", true],
    [{ lastAutomatedAt: d("2026-10-01T05:00:00Z") }, "frequency_min_interval", true],
    [{ commercialLast7Days: 2 }, "frequency_weekly_cap", true],
    [{ commercialToday: 40 }, "daily_outreach_cap", true],
  ] as const)("blocks %o → %s", (over, reason, transient) => {
    expect(contactDecision(ctx(over as Partial<ContactContext>))).toEqual({ ok: false, reason, transient });
  });
  it("a person's own message skips pause and caps, never suppression", () => {
    expect(contactDecision(ctx({ automated: false, pausedOutbound: true, commercialToday: 99, lastAutomatedAt: NOW })).ok).toBe(true);
    expect(contactDecision(ctx({ automated: false, suppression: "UNSUBSCRIBE" })).ok).toBe(false);
  });
  it("relationship email skips marketing caps; transactional survives unsubscribe but not bounce", () => {
    expect(contactDecision(ctx({ purpose: "RELATIONSHIP", postalAddress: "", commercialToday: 99 })).ok).toBe(true);
    expect(contactDecision(ctx({ purpose: "TRANSACTIONAL", emailStatus: "UNSUBSCRIBED" })).ok).toBe(true);
    expect(contactDecision(ctx({ purpose: "TRANSACTIONAL", emailStatus: "BOUNCED" })).ok).toBe(false);
  });
  it("SMS needs consent, never commercial, respects quiet hours", () => {
    const sms = { channel: "SMS" as const, purpose: "RELATIONSHIP" as const, address: "+14075550100", smsConsent: true };
    expect(contactDecision(ctx(sms)).ok).toBe(true);
    expect(contactDecision(ctx({ ...sms, smsConsent: false })).reason).toBe("no_sms_consent");
    expect(contactDecision(ctx({ ...sms, purpose: "COMMERCIAL" })).reason).toBe("sms_commercial_disabled");
    expect(contactDecision(ctx({ ...sms, localMinutes: 21 * 60 }))).toEqual({ ok: false, reason: "sms_quiet_hours", transient: true });
    expect(contactDecision(ctx({ ...sms, localMinutes: 8 * 60 })).reason).toBe("sms_quiet_hours");
  });
});

describe("templates and AI copy guardrails (spec §34)", () => {
  it("substitutes allowed variables only and strips the rest", () => {
    expect(renderTemplate("Hi {{first_name}} {{secret}}!", { first_name: "Ana", secret: "x" }, ["first_name"])).toBe("Hi Ana !");
  });
  const approved = "Hi Dr. Lee,\n\nSee the calculator: https://x.com/tools/cost-of-closing?c=1\n\nThanks";
  it("accepts a light personalization that keeps links", () => {
    expect(validateAiCopy(approved, "Hi Dr. Lee,\n\nFor a Tampa office like yours, the calculator may help: https://x.com/tools/cost-of-closing?c=1\n\nThanks", "Keeping your office open")).toBeNull();
  });
  it.each([
    ["Hi,\n\nThanks for reading, it is short now but fine enough length wise ok ok ok ok", "dropped_link"],
    [approved + " https://evil.example", "added_link"],
    [approved + " call 407-555-0100", "added_phone"],
    [approved + " write to me@x.com", "added_email"],
    [approved + " Save $5,000 a week", "added_dollar_amount"],
    [approved + " Guaranteed results.", "prohibited_claim"],
    [approved + " Increase your revenue fast.", "prohibited_claim"],
  ])("rejects %j → %s", (body, reason) => expect(validateAiCopy(approved, body, "Subject")).toBe(reason));
  it("rejects a blank or huge subject", () => expect(validateAiCopy(approved, approved, "")).toBe("bad_subject"));
});

describe("reply keywords", () => {
  it("opt-out words always win", () => {
    expect(wantsOptOut("Please remove me from your list")).toBe(true);
    expect(wantsOptOut("UNSUBSCRIBE")).toBe(true);
    expect(wantsOptOut("Sounds interesting, what do you charge?")).toBe(false);
  });
  it("legal, payment, safety and clinical-scope topics escalate", () => {
    expect(escalationTopic("my attorney will review the contract")).toBe("legal");
    expect(escalationTopic("I want a refund for last week")).toBe("payment_dispute");
    expect(escalationTopic("the provider was harassing staff")).toBe("safety");
    expect(escalationTopic("can a DC prescribe this?")).toBe("clinical_scope");
    expect(escalationTopic("how much is a full day?")).toBeNull();
  });
});
