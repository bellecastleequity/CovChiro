/**
 * Card disputes (chargebacks): a clinic disputes a charge with its bank instead of using the platform's
 * dispute process. Stripe takes the money back plus a fee until the dispute is decided; we answer with
 * the booking's records. Pure rules here; services/chargebacks.ts does the rest.
 */

/** Stripe dispute statuses that are still open (the clinic's posting is paused while one is). */
export const OPEN_DISPUTE_STATUSES = ["warning_needs_response", "warning_under_review", "needs_response", "under_review"] as const;

export function disputeIsOpen(status: string) {
  return (OPEN_DISPUTE_STATUSES as readonly string[]).includes(status);
}

export interface ChargebackFacts {
  brandName: string;
  clinicName: string;
  clinicEmail: string | null;
  disputeReason: string;
  amountCents: number;
  paymentType: string;
  agreement: { version: number | null; signedAt: Date | null; signerName: string | null; ip: string | null } | null;
  shift: {
    date: string;
    hours: string;
    location: string;
    providerName: string;
    postedAt: Date | null;
    confirmedAt: Date | null;
    status: string;
  } | null;
  timesheet: { firstIn: Date | null; lastOut: Date | null; workedMinutes: number | null; signedOffBy: string | null; signedOffAt: Date | null; method: string | null } | null;
  visits: number | null;
  cancellationPolicy: string;
  messagesCount: number;
  platformDisputeOpened: boolean;
}

const when = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "not recorded");
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Text evidence for Stripe (fields of Stripe's dispute evidence object), from the booking's own records. */
export function chargebackEvidence(f: ChargebackFacts): Record<string, string> {
  const lines: string[] = [
    `${f.clinicName} booked temporary clinical coverage through ${f.brandName}, an online marketplace, and authorized charges to the payment method it saved on file.`,
  ];
  if (f.agreement?.signedAt) {
    lines.push(`Authorization: ${f.agreement.signerName ?? "the clinic"} signed the ${f.brandName} Clinic Agreement (version ${f.agreement.version ?? "?"}) electronically on ${when(f.agreement.signedAt)}${f.agreement.ip ? ` from IP ${f.agreement.ip}` : ""}, which authorizes the deposit and balance charges for booked shifts.`);
  }
  if (f.shift) {
    lines.push(`Service: ${f.shift.date}, ${f.shift.hours} at ${f.shift.location}, covered by ${f.shift.providerName}. Posted ${when(f.shift.postedAt)}, provider confirmed ${when(f.shift.confirmedAt)}. Booking status: ${f.shift.status.toLowerCase()}.`);
  }
  if (f.timesheet) {
    lines.push(
      `Time records: clocked in ${when(f.timesheet.firstIn)}, out ${when(f.timesheet.lastOut)}${f.timesheet.workedMinutes != null ? `, ${Math.round((f.timesheet.workedMinutes / 60) * 100) / 100} hours worked` : ""}.${f.timesheet.signedOffAt ? ` The clinic's timesheet was approved${f.timesheet.signedOffBy ? ` by ${f.timesheet.signedOffBy}` : ""} on ${when(f.timesheet.signedOffAt)} (${(f.timesheet.method ?? "").toLowerCase().replace(/_/g, " ")}).` : ""}`,
    );
  }
  if (f.visits != null) lines.push(`Patient visits reported for the shift: ${f.visits} (a count only; no patient information is collected).`);
  lines.push(f.platformDisputeOpened ? "The clinic also raised the issue through our platform's dispute process." : `The clinic did not raise any problem through ${f.brandName}'s own dispute process, which its agreement requires before disputing a charge with its bank.`);
  if (f.messagesCount) lines.push(`${f.messagesCount} messages were exchanged with the provider about this booking on the platform.`);
  lines.push(`Disputed: ${usd(f.amountCents)} (${f.paymentType.toLowerCase()} charge), reason given: ${f.disputeReason.replace(/_/g, " ")}.`);
  return {
    product_description: `Temporary clinical coverage shift booked through ${f.brandName}${f.shift ? ` (${f.shift.date}, ${f.shift.location})` : ""}.`,
    customer_name: f.clinicName,
    ...(f.clinicEmail ? { customer_email_address: f.clinicEmail } : {}),
    ...(f.shift ? { service_date: f.shift.date } : {}),
    cancellation_policy_disclosure: f.cancellationPolicy,
    uncategorized_text: lines.join("\n\n").slice(0, 20000),
  };
}
