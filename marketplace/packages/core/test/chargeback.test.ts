import { describe, expect, it } from "vitest";
import { chargebackEvidence, disputeIsOpen } from "../src";

describe("chargebacks", () => {
  it("open statuses pause posting; won/lost don't", () => {
    expect(disputeIsOpen("needs_response")).toBe(true);
    expect(disputeIsOpen("warning_under_review")).toBe(true);
    expect(disputeIsOpen("won")).toBe(false);
    expect(disputeIsOpen("lost")).toBe(false);
  });
  it("evidence is built from the booking's records, with no patient details", () => {
    const e = chargebackEvidence({
      brandName: "CoverageOnCall",
      clinicName: "Bayside Chiropractic",
      clinicEmail: "office@bayside.dev",
      disputeReason: "product_not_received",
      amountCents: 31250,
      paymentType: "DEPOSIT",
      agreement: { version: 5, signedAt: new Date("2026-09-01T14:00:00Z"), signerName: "Pat Lee", ip: "203.0.113.9" },
      shift: { date: "2026-10-14", hours: "8:00 AM–5:00 PM", location: "Bayside Chiropractic, Tampa FL", providerName: "Dr. Sam Diaz", postedAt: new Date("2026-10-01T12:00:00Z"), confirmedAt: new Date("2026-10-02T12:00:00Z"), status: "COMPLETED" },
      timesheet: { firstIn: new Date("2026-10-14T12:01:00Z"), lastOut: new Date("2026-10-14T21:05:00Z"), workedMinutes: 484, signedOffBy: "Pat Lee", signedOffAt: new Date("2026-10-14T21:30:00Z"), method: "EMAIL_LINK" },
      visits: 22,
      cancellationPolicy: "Free cancellation up to 48 hours before the shift.",
      messagesCount: 3,
      platformDisputeOpened: false,
    });
    expect(e).toMatchObject({ customer_name: "Bayside Chiropractic", customer_email_address: "office@bayside.dev", service_date: "2026-10-14" });
    expect(e.uncategorized_text).toMatch(/signed the CoverageOnCall Clinic Agreement \(version 5\)/);
    expect(e.uncategorized_text).toMatch(/8.07 hours worked/);
    expect(e.uncategorized_text).toMatch(/did not raise any problem/);
  });
});
