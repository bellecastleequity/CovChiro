import { describe, expect, it } from "vitest";
import { form1099Summary, taxInfoStatus } from "../src";

describe("tax info status (read from Stripe, never stored)", () => {
  const base = { businessType: "individual", detailsSubmitted: true, due: [] as string[] };
  it("individuals: full SSN, last 4 only, missing, unknown", () => {
    expect(taxInfoStatus({ ...base, individual: { idNumberProvided: true, ssnLast4Provided: true } })).toBe("COMPLETE");
    expect(taxInfoStatus({ ...base, individual: { idNumberProvided: false, ssnLast4Provided: true } })).toBe("LAST4");
    expect(taxInfoStatus({ ...base, individual: { idNumberProvided: false, ssnLast4Provided: false } })).toBe("MISSING");
    expect(taxInfoStatus({ ...base, individual: null })).toBe("UNKNOWN");
    expect(taxInfoStatus({ ...base, individual: null, due: ["individual.id_number"] })).toBe("MISSING");
    expect(taxInfoStatus({ ...base, detailsSubmitted: false, individual: null })).toBe("MISSING");
  });
  it("companies: EIN on file unless Stripe still asks for it", () => {
    expect(taxInfoStatus({ ...base, businessType: "company", company: { taxIdProvided: true } })).toBe("COMPLETE");
    expect(taxInfoStatus({ ...base, businessType: "company", company: { taxIdProvided: true }, due: ["company.tax_id"] })).toBe("MISSING");
    expect(taxInfoStatus({ ...base, businessType: "company", company: { taxIdProvided: false } })).toBe("MISSING");
  });
});

describe("1099 year summary", () => {
  it("totals what was paid, separates travel allowances and adjustments, flags the threshold on the full total", () => {
    const s = form1099Summary(
      [
        { kind: "SHIFT", amountCents: 50_000, travelCents: 12_000 },
        { kind: "SHIFT", amountCents: 40_000, travelCents: 0 },
        { kind: "LATE_CANCEL", amountCents: 10_000, travelCents: 0 },
        { kind: "ADJUSTMENT", amountCents: 2_000, travelCents: 0 },
      ],
      100_000,
    );
    expect(s).toEqual({ totalCents: 102_000, travelCents: 12_000, adjustmentsCents: 2_000, workCents: 88_000, overThreshold: true });
    expect(form1099Summary([{ kind: "SHIFT", amountCents: 99_999, travelCents: 0 }], 100_000).overThreshold).toBe(false);
  });
});
