import { describe, expect, it } from "vitest";
import { depositPercentFor, overduePaymentAction, OVERDUE_PAYMENT_TYPES } from "../src";

const H = 3_600_000;
const now = new Date("2026-10-12T12:00:00Z");
const base = { status: "FAILED" as const, retryCount: 0, now, retryAfterHours: [24], payInFullAfterHours: 48, clearedAt: null, alreadyFlagged: false, enabled: true };

describe("overdue clinic payments", () => {
  it("does nothing for paid or pending charges", () => {
    expect(overduePaymentAction({ ...base, status: "SUCCEEDED", firstFailedAt: new Date(+now - 100 * H) })).toEqual({ retry: false, flag: false });
    expect(overduePaymentAction({ ...base, status: "PROCESSING", firstFailedAt: new Date(+now - 100 * H) })).toEqual({ retry: false, flag: false });
  });
  it("retries the card once the retry time comes, once per retry step", () => {
    expect(overduePaymentAction({ ...base, firstFailedAt: new Date(+now - 2 * H) }).retry).toBe(false);
    expect(overduePaymentAction({ ...base, firstFailedAt: new Date(+now - 25 * H) }).retry).toBe(true);
    expect(overduePaymentAction({ ...base, firstFailedAt: new Date(+now - 25 * H), retryCount: 1 }).retry).toBe(false);
  });
  it("switches the clinic to pay-in-full once a charge is 48 hours overdue", () => {
    expect(overduePaymentAction({ ...base, firstFailedAt: new Date(+now - 47 * H), retryCount: 1 }).flag).toBe(false);
    expect(overduePaymentAction({ ...base, firstFailedAt: new Date(+now - 48 * H), retryCount: 1 }).flag).toBe(true);
  });
  it("never flags twice, when switched off, or for a charge from before the admin restored the deposit", () => {
    const old = { ...base, firstFailedAt: new Date(+now - 72 * H), retryCount: 1 };
    expect(overduePaymentAction({ ...old, alreadyFlagged: true }).flag).toBe(false);
    expect(overduePaymentAction({ ...old, enabled: false }).flag).toBe(false);
    expect(overduePaymentAction({ ...old, clearedAt: new Date(+now - 1 * H) }).flag).toBe(false);
    expect(overduePaymentAction({ ...old, clearedAt: new Date(+now - 80 * H) }).flag).toBe(true);
  });
  it("counts every kind of clinic charge, never refunds", () => {
    for (const t of ["DEPOSIT", "BALANCE", "VOLUME", "LODGING", "CANCELLATION_FEE", "CONVERSION_FEE", "ADJUSTMENT"]) expect(OVERDUE_PAYMENT_TYPES).toContain(t);
    expect(OVERDUE_PAYMENT_TYPES).not.toContain("REFUND");
  });
});

describe("deposit at confirmation", () => {
  it("is the normal percentage, or everything for a pay-in-full clinic", () => {
    expect(depositPercentFor(10, false)).toBe(10);
    expect(depositPercentFor(10, true)).toBe(100);
  });
});
