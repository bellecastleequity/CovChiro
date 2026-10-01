import { brand, type SettingsMap } from "@cm/config";

/**
 * The published FAQ. One source for the public /faq page and for the growth
 * conversation agent's approved knowledge, so the AI can only repeat what the
 * site already says. Values that are settings are read live.
 */
export function siteFaq(s: SettingsMap): [string, string][] {
  const b = brand();
  return [
    ["How do you verify providers?", "Every license is checked against the state board for that profession and state, and re-verified on a schedule. Malpractice certificates and NPI numbers are verified too. Providers can only see and apply to shifts where their license qualifies through the end of the shift."],
    ["Can a provider licensed in another state cover my clinic?", "No. A provider needs a verified license for your profession in your clinic's state. Where they live doesn't matter."],
    ["Who sets the price?", `${b.name} sets prices by region and shift length so they're consistent and fair. Mileage is passed through to the provider at cost.`],
    ["What if I need to cancel?", `Cancel ${s["payments.clinicFreeCancelHours"]} or more hours before the shift for a full deposit refund. Later cancellations forfeit the deposit, part of which compensates the provider.`],
    ["What if the provider cancels?", "You're refunded in full and we immediately reopen the shift to other eligible providers."],
    ["Do you handle patient records?", "No. The platform never collects patient information. Please don't include patient details in messages or notes."],
    ["How do providers get paid?", `Through Stripe, directly to their bank, about ${s["payments.payoutHoldHours"]} hours after the shift completes.`],
  ];
}
