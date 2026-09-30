import { describe, expect, it } from "vitest";
import {
  assertTransition, canTransition, cancellationOutcome, screenMessage, scanContactInfo, looksLikePhi, isPayable, summarizePayouts,
  netTransfer, releaseAt, nextReverifyAt, expiryReminderDue, DomainError,
} from "../src";
import { d, S } from "./fixtures";

describe("state machines", () => {
  it("allows spec transitions and rejects others", () => {
    expect(canTransition("Shift", "DRAFT", "OPEN")).toBe(true);
    expect(canTransition("Shift", "CONFIRMED", "OPEN")).toBe(true); // backfill
    expect(canTransition("Shift", "COMPLETED", "OPEN")).toBe(false);
    expect(canTransition("Application", "SELECTED", "WITHDRAWN")).toBe(false);
    expect(canTransition("Assignment", "CONFIRMED", "LICENSE_LAPSED")).toBe(true);
    expect(canTransition("Payout", "PAID", "SCHEDULED")).toBe(false);
    expect(() => assertTransition("Offer", "ACCEPTED", "DECLINED")).toThrow(DomainError);
  });
});

describe("cancellation matrix", () => {
  const start = d("2026-10-14T13:00:00Z");
  it("clinic ≥48h → refund; <48h → forfeit + doctor share", () => {
    expect(cancellationOutcome({ by: "CLINIC", now: d("2026-10-10T13:00:00Z"), startsAt: start, depositPaidCents: 5000 }, S)).toMatchObject({ refundDepositCents: 5000, providerCompensationCents: 0 });
    expect(cancellationOutcome({ by: "CLINIC", now: d("2026-10-13T13:00:00Z"), startsAt: start, depositPaidCents: 5000 }, S)).toMatchObject({
      refundDepositCents: 0, forfeitedDepositCents: 5000, providerCompensationCents: 2500,
    });
  });
  it("provider late cancel / no-show / platform", () => {
    expect(cancellationOutcome({ by: "PROVIDER", now: d("2026-10-12T13:00:00Z"), startsAt: start, depositPaidCents: 5000 }, S)).toMatchObject({ refundDepositCents: 5000, countsAsLateCancel: true, backfill: true });
    expect(cancellationOutcome({ by: "PROVIDER", now: d("2026-10-01T13:00:00Z"), startsAt: start, depositPaidCents: 5000 }, S).countsAsLateCancel).toBe(false);
    expect(cancellationOutcome({ by: "PROVIDER", noShow: true, now: start, startsAt: start, depositPaidCents: 5000 }, S).countsAsNoShow).toBe(true);
    expect(cancellationOutcome({ by: "PLATFORM", now: start, startsAt: start, depositPaidCents: 5000 }, S)).toMatchObject({ refundDepositCents: 5000, countsAsLateCancel: false });
  });
});

describe("message screening", () => {
  it.each([
    "call me at 407-555-1234",
    "my cell is (407) 555 1234",
    "4075551234",
    "4 0 7 5 5 5 1 2 3 4",
    "4-0-7-5-5-5-1-2-3-4",
    "407.555.1234",
    "+1 407 555 1234",
    "555-1234",
    "four zero seven five five five one two three four",
    "four oh seven, five five five, one two three four",
    "4o7 555 l234",
    "four 0 seven 555 twelve 34",
    "407 double five 5 1234",
    "email jane.doe@gmail.com",
    "jane dot doe at gmail dot com",
    "find me on gmail, janedoe",
    "see www.mysite.com",
    "mysite dot com",
    "text me at the number on my card",
    "follow me @drjane_dc",
    "I'm on Instagram",
    "venmo me",
  ])("blocks contact info: %s", (msg) => {
    expect(screenMessage(msg).blocked).toBe(true);
    expect(scanContactInfo(msg).redacted).toContain("[contact removed]");
  });
  it.each([
    "we could just work directly and skip the fees",
    "Want to book you directly next month?",
    "we'd pay you cash",
    "let's take this off the app",
    "what's your personal email?",
    "Would you consider joining our team full-time?",
    "we have a full time position open",
  ])("blocks off-platform dealing: %s", (msg) => {
    expect(screenMessage(msg)).toMatchObject({ blocked: true, reasons: expect.arrayContaining(["off-platform"]) });
  });
  it.each([
    "See you Tuesday at 8:30, parking is behind the building.",
    "Shift is 10/12/2026 from 8:00 to 5:00, about 40-50 patients.",
    "Suite 200, 1234 Main St, Orlando FL 32801",
    "The rate was $1,250.00 for the day",
    "We see about 35 patients; I've done 1200 adjustments this year",
    "Thanks! See you on the 14th.",
    "Can you message me here if you're running late?",
    "One of our tables is broken, we have two others",
  ])("leaves ordinary messages alone: %s", (msg) => {
    expect(screenMessage(msg).blocked).toBe(false);
  });
  it("warns on likely PHI", () => {
    expect(looksLikePhi("Patient John Smith needs follow up")).toBe(true);
    expect(looksLikePhi("MRN: 123456")).toBe(true);
    expect(looksLikePhi("DOB 01/02/1980")).toBe(true);
    expect(looksLikePhi("We see about 40 patients a day")).toBe(false);
  });
});

describe("payouts", () => {
  const now = d("2026-10-20T00:00:00Z");
  it("payable only after release with no hold/dispute", () => {
    const p = { kind: "SHIFT" as const, status: "SCHEDULED" as const, amountCents: 40000, releaseAt: d("2026-10-19"), paidAt: null, onHold: false };
    expect(isPayable(p, now, false)).toBe(true);
    expect(isPayable(p, now, true)).toBe(false);
    expect(isPayable({ ...p, onHold: true }, now, false)).toBe(false);
    expect(isPayable({ ...p, releaseAt: d("2026-10-21") }, now, false)).toBe(false);
    expect(releaseAt(d("2026-10-14T23:00:00Z"), 48)).toEqual(d("2026-10-16T23:00:00Z"));
  });
  it("summarizes the ledger", () => {
    const s = summarizePayouts(
      [
        { kind: "SHIFT", status: "PAID", amountCents: 100, releaseAt: null, paidAt: d("2026-03-01"), onHold: false },
        { kind: "SHIFT", status: "PAID", amountCents: 50, releaseAt: null, paidAt: d("2025-03-01"), onHold: false },
        { kind: "SHIFT", status: "SCHEDULED", amountCents: 200, releaseAt: d("2026-10-19"), paidAt: null, onHold: false },
        { kind: "SHIFT", status: "SCHEDULED", amountCents: 300, releaseAt: d("2026-10-25"), paidAt: null, onHold: false },
        { kind: "SHIFT", status: "PENDING", amountCents: 400, releaseAt: null, paidAt: null, onHold: false },
        { kind: "LODGING", status: "ON_HOLD", amountCents: 500, releaseAt: d("2026-10-19"), paidAt: null, onHold: true },
      ],
      now,
    );
    expect(s).toEqual({ upcomingCents: 400, scheduledCents: 300, readyCents: 200, onHoldCents: 500, processingCents: 0, paidCents: 150, paidYtdCents: 100 });
  });
  it("nets adjustments into one transfer", () => {
    expect(netTransfer([{ id: "a", amountCents: 40000 }, { id: "b", amountCents: -5000 }])).toEqual({ ids: ["a", "b"], amountCents: 35000 });
    expect(netTransfer([{ id: "b", amountCents: -5000 }])).toBeNull();
  });
});

describe("credentials", () => {
  it("next reverify is the earlier of expiry−30d or +90d", () => {
    expect(nextReverifyAt(d("2026-01-01"), d("2030-01-01"))).toEqual(d("2026-04-01"));
    expect(nextReverifyAt(d("2026-01-01"), d("2026-02-15"))).toEqual(d("2026-01-16"));
    expect(expiryReminderDue(d("2026-11-29T12:00:00Z"), d("2026-10-30T13:00:00Z"))).toBe(30);
  });
});
