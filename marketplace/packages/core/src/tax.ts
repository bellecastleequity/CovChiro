/**
 * Provider tax info (W-9 details) lives with Stripe, never with us: Stripe Connect collects the legal
 * name, address and SSN or EIN and files/delivers 1099s. We only read whether it's complete.
 */

export type TaxEntity = "INDIVIDUAL" | "COMPANY";
/** COMPLETE = full SSN/EIN on file with Stripe; LAST4 = only the last 4 of the SSN so far; MISSING; UNKNOWN = Stripe didn't say. */
export type TaxInfoStatus = "COMPLETE" | "LAST4" | "MISSING" | "UNKNOWN";

export interface StripeTaxFacts {
  businessType: string | null;
  detailsSubmitted: boolean;
  individual?: { idNumberProvided?: boolean | null; ssnLast4Provided?: boolean | null } | null;
  company?: { taxIdProvided?: boolean | null } | null;
  /** requirements.currently_due + past_due + eventually_due */
  due: string[];
}

const TAX_FIELD = /(^|\.)(id_number|ssn_last_4|tax_id)$/;

export function taxInfoStatus(a: StripeTaxFacts): TaxInfoStatus {
  const taxDue = a.due.some((r) => TAX_FIELD.test(r));
  if (a.businessType === "company") {
    const has = a.company?.taxIdProvided;
    if (has === true) return taxDue ? "MISSING" : "COMPLETE";
    if (has === false) return "MISSING";
    return a.detailsSubmitted && !taxDue ? "UNKNOWN" : "MISSING";
  }
  const ind = a.individual;
  if (ind?.idNumberProvided) return "COMPLETE";
  if (ind?.ssnLast4Provided) return "LAST4";
  if (ind && (ind.idNumberProvided === false || ind.ssnLast4Provided === false)) return "MISSING";
  return a.detailsSubmitted && !taxDue ? "UNKNOWN" : "MISSING";
}

export interface PaidPayout {
  kind: "SHIFT" | "VOLUME" | "LODGING" | "LATE_CANCEL" | "ADJUSTMENT";
  amountCents: number;
  /** Mileage + lodging + airfare inside a SHIFT payout (flat allowances, no receipts). */
  travelCents: number;
}

/**
 * One provider's year for the 1099 review: everything paid, the travel allowances inside it and other
 * amounts, and whether the total reaches the threshold. What's reportable is the accountant's call;
 * the flag is deliberately on the full total so nobody is missed.
 */
export function form1099Summary(rows: PaidPayout[], thresholdCents: number) {
  const totalCents = rows.reduce((t, r) => t + r.amountCents, 0);
  const travelCents = rows.reduce((t, r) => t + (r.kind === "SHIFT" ? Math.min(r.travelCents, r.amountCents) : r.kind === "LODGING" ? r.amountCents : 0), 0);
  const adjustmentsCents = rows.filter((r) => r.kind === "ADJUSTMENT").reduce((t, r) => t + r.amountCents, 0);
  return { totalCents, travelCents, adjustmentsCents, workCents: totalCents - travelCents - adjustmentsCents, overThreshold: totalCents >= thresholdCents };
}
