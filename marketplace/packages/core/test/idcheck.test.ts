import { describe, expect, it } from "vitest";
import { canStartIdCheck, idDueAt, idNeededBeforeAccepting, idOutcome } from "../src";

const rules = { enabled: true, acceptWithinHours: 48, deadlineHours: 24, maxAttempts: 2 };
const start = new Date("2026-11-10T14:00:00Z");
const hoursBefore = (h: number) => new Date(+start - h * 3_600_000);

describe("when the ID check is needed", () => {
  it("before accepting only for shifts within the window, and never once verified or switched off", () => {
    expect(idNeededBeforeAccepting(rules, "NONE", start, hoursBefore(47))).toBe(true);
    expect(idNeededBeforeAccepting(rules, "PENDING", start, hoursBefore(49))).toBe(false);
    expect(idNeededBeforeAccepting(rules, "VERIFIED", start, hoursBefore(1))).toBe(false);
    expect(idNeededBeforeAccepting({ ...rules, enabled: false }, "NONE", start, hoursBefore(1))).toBe(false);
  });
  it("a later booking gets a deadline 24 hours before the start", () => {
    expect(idDueAt(rules, "NONE", start, hoursBefore(100))?.toISOString()).toBe(hoursBefore(24).toISOString());
    expect(idDueAt(rules, "VERIFIED", start, hoursBefore(100))).toBeNull();
    expect(idDueAt(rules, "NONE", start, hoursBefore(10))).toBeNull();
    expect(idDueAt({ ...rules, enabled: false }, "NONE", start, hoursBefore(100))).toBeNull();
  });
});

describe("Stripe result → our status", () => {
  const base = { legalName: "Dr. Jane A. Smith", attempts: 1, maxAttempts: 2 };
  it("verified with a matching name passes; a different name goes to a person", () => {
    expect(idOutcome({ ...base, sessionStatus: "verified", idFirstName: "JANE", idLastName: "SMITH" }).status).toBe("VERIFIED");
    expect(idOutcome({ ...base, sessionStatus: "verified", idFirstName: "J", idLastName: "Smith" }).status).toBe("VERIFIED");
    const r = idOutcome({ ...base, sessionStatus: "verified", idFirstName: "Janet", idLastName: "Jones" });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.note).not.toMatch(/Janet|Jones/);
  });
  it("a failed try can be retried until the cap, then a person decides", () => {
    expect(idOutcome({ ...base, sessionStatus: "requires_input", errorCode: "selfie_face_mismatch" })).toMatchObject({ status: "FAILED", note: expect.stringMatching(/selfie/) });
    expect(idOutcome({ ...base, attempts: 2, sessionStatus: "requires_input", errorCode: "document_expired" })).toMatchObject({ status: "NEEDS_REVIEW", note: expect.stringMatching(/2 tries.*expired/) });
    expect(idOutcome({ ...base, sessionStatus: "requires_input" }).status).toBe("PENDING");
    expect(idOutcome({ ...base, sessionStatus: "processing" }).status).toBe("PROCESSING");
    expect(idOutcome({ ...base, sessionStatus: "canceled" }).status).toBe("NONE");
  });
  it("tries are capped", () => {
    expect(canStartIdCheck("NONE", 0, 2)).toBe(true);
    expect(canStartIdCheck("FAILED", 1, 2)).toBe(true);
    expect(canStartIdCheck("FAILED", 2, 2)).toBe(false);
    expect(canStartIdCheck("NEEDS_REVIEW", 0, 2)).toBe(false);
    expect(canStartIdCheck("VERIFIED", 0, 2)).toBe(false);
  });
});
