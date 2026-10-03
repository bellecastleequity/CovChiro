import type { SettingsMap } from "@cm/config";

/**
 * The Clinic Platform Agreement and the Provider Independent Contractor
 * Agreement, prefilled with the party's details and the live Settings.
 * The exact text a person signs is stored with their signature (and hashed),
 * so later edits here or in Settings never change a signed copy. Any change
 * to the wording must bump AGREEMENT_VERSION.
 *
 * ATTORNEY REVIEW: this is a working draft for counsel to approve.
 */

export type AgreementKind = "CLINIC" | "PROVIDER";

export interface AgreementParty {
  /** Clinic legal entity name, or the provider's legal name. */
  legalName: string;
  address?: string | null;
  signerName: string;
  signerEmail: string;
  signerTitle?: string | null;
}

export interface AgreementDoc {
  kind: AgreementKind;
  version: number;
  title: string;
  /** Who the agreement is between, as shown at the top. */
  parties: { label: string; lines: string[] }[];
  sections: { heading: string; paragraphs: string[] }[];
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const hrs = (h: number) => `${h} hour${h === 1 ? "" : "s"}`;

export function renderAgreement(kind: AgreementKind, version: number, brandName: string, party: AgreementParty, s: SettingsMap, effectiveDate: string): AgreementDoc {
  const co = s["agreements.companyLegalName"];
  const coLines = [`${co} (“${brandName}”, “we”, “us”)`, ...(s["agreements.companyAddress"] ? [s["agreements.companyAddress"]] : [])];
  const nc = s["agreements.nonCircumventionMonths"];
  const ld = usd(s["agreements.liquidatedDamagesCents"]);
  const law = s["agreements.governingState"];
  const common = commonSections(brandName, co, law);

  if (kind === "CLINIC") {
    return {
      kind,
      version,
      title: `${brandName} Clinic Platform Agreement`,
      parties: [
        { label: "Company", lines: coLines },
        { label: "Clinic", lines: [`${party.legalName} (“Clinic”, “you”)`, ...(party.address ? [party.address] : []), `Signing for the Clinic: ${party.signerName}${party.signerTitle ? `, ${party.signerTitle}` : ""} (${party.signerEmail})`] },
      ],
      sections: [
        {
          heading: "1. What this agreement covers",
          paragraphs: [
            `This agreement is effective ${effectiveDate} and governs the Clinic's use of ${brandName} to find, book and pay licensed healthcare providers (“Providers”) for temporary coverage (“Shifts”) at the Clinic's locations. By signing, the person above confirms they are authorized to bind the Clinic.`,
            `${brandName} is a technology marketplace. We are not a healthcare provider, do not practice medicine or any licensed profession, and do not direct Providers' clinical judgment. Providers are independent contractors; they are not employees of ${brandName} or of the Clinic.`,
          ],
        },
        {
          heading: "2. Clinic responsibilities",
          paragraphs: [
            "Post accurate Shift details: location, dates, times, profession, required techniques, expected patient load and anything a Provider needs to know to work safely.",
            "Provide a safe workplace, the equipment and access described in the Shift, and an on-site point of contact. The Clinic remains responsible for its premises, staff, patient records, billing and compliance with the laws that apply to it.",
            "Where a profession requires supervision (for example PTA or OTA), provide the supervision the Clinic attested to when posting, for the whole Shift.",
            "Keep the Clinic's own professional and general liability insurance in force.",
            `Never enter patient information (PHI) into ${brandName}. The Clinic remains the HIPAA covered entity for its patients; ${brandName} does not receive, store or process PHI.`,
          ],
        },
        {
          heading: "3. Prices and payment",
          paragraphs: [
            "Each Shift's price comes from our rate engine and is shown before you post. It may include weekend, holiday, urgency or overtime premiums, which are shown as separate lines. Mileage and any approved lodging are added at confirmation.",
            `When a Provider is confirmed, a deposit of ${s["payments.depositPercent"]}% of the Shift price is charged to the Clinic's card or account on file. The balance, mileage and any approved lodging are charged when the Shift is completed. The Clinic authorizes these charges.`,
            `If the Clinic believes a Shift was not performed as booked, it may open a dispute within ${hrs(s["payments.disputeWindowHours"])} after the Shift ends. Promotional discounts come out of ${brandName}'s margin and never reduce the Provider's pay.`,
            `Where a Shift is priced by expected patient visits (a Light or Busy day), the Clinic chooses the tier by entering the expected visits when posting. Final visit counts may affect the final booking price: after the Shift the Provider reports the number of visits (numbers only, never patient details), and each visit beyond the booked tier's limit plus ${s["pricing.volumeGraceVisits"]} grace visits is billed at the per-visit price shown when posting (currently $${(s["pricing.volumeOverageClinicCents"] / 100).toFixed(2)}). The price never goes below the tier booked. The Clinic may confirm the count or report a different one within ${hrs(s["pricing.volumeDisputeHours"])} after the booking completes (or after the count is sent, if later); after that the count stands and the Clinic authorizes ${brandName} to charge the extra-visit amount to its card or account on file. If the two counts differ by more than ${s["pricing.countTolerance"]} visits, the lower count is billed until ${brandName} reviews and sets the final count.`,
            `Clinic-set rate (when offered): ${brandName} may let a Clinic post a single Shift at its own rate below the market price, down to a minimum percentage of that Shift's market price shown when posting. Such a Shift is not filled automatically; Providers may apply at that rate and the Clinic chooses whom to confirm. If the Clinic elects release, a Shift with no confirmed Provider is released to ${brandName} at market rates at the release time shown when posting and is then priced at that time (including any short-notice premium) and filled the usual way. The release window is set at ${brandName}'s discretion between 72 and 168 hours before the Shift starts and may change with volume and season; the release time shown and recorded when the Clinic posts a Shift is the one that applies to it. If the Clinic does not elect release, the Shift may go unfilled. ${brandName} may change or end clinic-set rates at any time; Shifts already posted keep the terms accepted when they were posted.`,
          ],
        },
        {
          heading: "4. Cancellations, no-shows and emergency cover",
          paragraphs: [
            `The Clinic may cancel a confirmed Shift free of charge up to ${hrs(s["payments.clinicFreeCancelHours"])} before it starts; the deposit is refunded. Later cancellations forfeit the deposit, part of which compensates the Provider.`,
            `If a Provider cancels or does not show up, the Clinic is not charged for that Provider. Where the change happens within ${hrs(s["emergency.triggerWithinHours"])} of the start, ${brandName} runs emergency cover to find a replacement at the same price to the Clinic. We cannot guarantee a replacement.`,
          ],
        },
        {
          heading: "5. Multi-day and ongoing work",
          paragraphs: [
            "Bookings of several days are treated as separate Shifts for coverage, pricing and cancellation.",
            `If the Clinic wants to work with a Provider on an ongoing basis, it must set that up as a standing booking through ${brandName}, or hire the Provider through a placement (section 6). Standing bookings are billed per Shift at the platform price and can be ended by either side as described in the platform.`,
          ],
        },
        {
          heading: "6. Non-circumvention",
          paragraphs: [
            `${brandName} invests in finding, verifying and introducing Providers. While this agreement is in effect and for ${nc} months after the last Shift the Clinic booked with a Provider through ${brandName} (the “Protected Period”), the Clinic will not, directly or through any affiliate, owner, manager, staffing agency or other third party: (a) hire, employ, contract with, schedule or pay that Provider for services except through ${brandName}; (b) solicit or encourage that Provider to work for the Clinic outside ${brandName}; or (c) ask for or share personal contact details to arrange work outside ${brandName}.`,
            `Hiring a Provider directly. If the Clinic wants to hire or contract a Provider outside shift coverage, it must use “Request to hire” on ${brandName}. We will arrange it and quote a one-time placement fee; once the Clinic accepts the placement terms and pays, that Provider is released from this section for the Clinic and is no longer offered the Clinic's shifts.`,
            `This does not apply to a Provider who worked for the Clinic before being introduced through ${brandName}, if the Clinic tells us in writing within 30 days of first booking them.`,
            `Messages on ${brandName} are screened automatically, including with automated and AI tools, to keep contact details and off-platform arrangements out of the platform. Messages that break these rules are not delivered and may be reviewed by our staff.`,
            `Each breach is a material breach of this agreement. Because the harm to ${brandName} is hard to calculate, the Clinic agrees to pay ${ld} per Provider engaged in breach as liquidated damages — a reasonable estimate of our loss, not a penalty — plus any platform fees that would have been owed, and ${brandName} may suspend or close the Clinic's account.`,
          ],
        },
        {
          heading: "7. Ratings, feedback and preferences",
          paragraphs: [
            "The Clinic may rate Providers, leave private feedback that only the Provider sees, mark favorites and block Providers from future bookings. Ratings must be honest and based on the Shift. Blocking a Provider does not cancel Shifts already confirmed.",
          ],
        },
        ...common,
      ],
    };
  }

  return {
    kind,
    version,
    title: `${brandName} Provider Independent Contractor Agreement`,
    parties: [
      { label: "Company", lines: coLines },
      { label: "Provider", lines: [`${party.legalName} (“Provider”, “you”)`, ...(party.address ? [party.address] : []), party.signerEmail] },
    ],
    sections: [
      {
        heading: "1. Independent contractor",
        paragraphs: [
          `This agreement is effective ${effectiveDate} and governs the Provider's use of ${brandName} to find and work temporary coverage shifts (“Shifts”) at clinics (“Clinics”).`,
          `The Provider is an independent contractor, not an employee of ${brandName} or of any Clinic. The Provider decides which Shifts to accept, may work for others, and controls their professional methods and clinical judgment. ${brandName} does not withhold taxes; the Provider is responsible for their own taxes, and will receive a Form 1099 where required.`,
        ],
      },
      {
        heading: "2. Licenses, credentials and insurance",
        paragraphs: [
          `The Provider will hold an active, unrestricted license (or, where a state doesn't license the profession, the required national credential) for the profession and state of every Shift, through the end of that Shift. ${brandName} verifies credentials and only offers Shifts the Provider is eligible for.`,
          "The Provider will keep professional liability (malpractice) insurance in force and tell us within 24 hours of any lapse, restriction, investigation or disciplinary action.",
          "The Provider will practice within their scope, follow the Clinic's reasonable site policies, and never enter patient information (PHI) into the platform.",
        ],
      },
      {
        heading: "3. Accepting and working Shifts",
        paragraphs: [
          "Accepting a Shift is a commitment to work it. The Provider will reconfirm upcoming Shifts when asked, tap “On my way” on the day, and arrive on time.",
          `Cancelling within ${hrs(s["payments.providerLateCancelHours"])} of the start is a late cancellation and affects the Provider's reliability. Missing a reconfirmation releases the Shift to another provider; ${s["reconfirm.missesBeforePause"]} misses in ${s["reconfirm.missWindowDays"]} days pauses the account. A no-show may lead to suspension.`,
          `If the Provider turns on On Call, matching Shifts may be accepted automatically on their behalf. The Provider may release an auto-accepted Shift without penalty within ${s["oncall.graceMinutes"]} minutes; after that it is treated like any other accepted Shift.`,
        ],
      },
      {
        heading: "4. Pay",
        paragraphs: [
          "The Provider's pay for each Shift is shown before accepting. Mileage and approved lodging are reimbursed as shown in the platform. Emergency rescue bonuses, when offered, are added to that Shift's pay.",
          `Pay is sent through Stripe Connect to the Provider's own account ${hrs(s["payments.payoutHoldHours"])} after the Shift is completed, unless a Clinic opens a dispute within ${hrs(s["payments.disputeWindowHours"])}. ${brandName} never pays Providers outside Stripe.`,
          "If a Clinic cancels late, the Provider receives the share of the forfeited deposit shown in the platform.",
        ],
      },
      {
        heading: "5. Ongoing work with a Clinic",
        paragraphs: [
          `If a Clinic wants the Provider on a regular schedule, it must be set up as a standing booking through ${brandName}. Each Shift in a standing booking is paid at the platform rate like any other.`,
        ],
      },
      {
        heading: "6. Non-circumvention",
        paragraphs: [
          `While this agreement is in effect and for ${nc} months after the Provider's last Shift at a Clinic booked through ${brandName} (the “Protected Period”), the Provider will not, directly or through any agency or third party: (a) work for, be hired by, contract with or accept payment from that Clinic except through ${brandName}; (b) solicit that Clinic to book or pay them outside ${brandName}; or (c) share or ask for personal contact details to arrange work outside ${brandName}.`,
          `A Clinic that wants to hire the Provider directly must arrange it through ${brandName} (a placement). Once the Clinic completes the placement, the Provider is free to work with that Clinic directly and will no longer be offered its shifts on ${brandName}. The Provider owes nothing for a placement.`,
          `This does not apply to a Clinic the Provider worked for before being introduced through ${brandName}, if the Provider tells us in writing within 30 days of first booking there.`,
          `Messages on ${brandName} are screened automatically, including with automated and AI tools. Messages with contact details or off-platform arrangements are not delivered and may be reviewed by our staff.`,
          `Each breach is a material breach of this agreement. The Provider agrees to pay ${ld} per Clinic engaged in breach as liquidated damages — a reasonable estimate of our loss, not a penalty — and ${brandName} may withhold unpaid amounts owed for the breach and close the Provider's account.`,
        ],
      },
      {
        heading: "7. Ratings and feedback",
        paragraphs: [
          "Clinics may rate the Provider and leave private feedback that only the Provider sees. Private feedback never affects the Provider's rating, badges or matching. The Provider may rate Clinics.",
        ],
      },
      ...common,
    ],
  };
}

function commonSections(brandName: string, co: string, law: string) {
  return [
    {
      heading: "Messages, texts and emails",
      paragraphs: [
        `You agree to receive account, booking and safety messages from ${brandName} by email, text message and in-app notification. Message and data rates may apply. You can turn off optional messages in your settings; booking-critical messages can't be turned off while you have active bookings. Reply STOP to any text to stop texts.`,
      ],
    },
    {
      heading: "Liability and indemnity",
      paragraphs: [
        `${brandName} provides the platform “as is”. To the extent the law allows, ${co}'s total liability under this agreement is limited to the platform fees it received from you in the 12 months before the claim, and neither party is liable for indirect or consequential damages. Each party is responsible for, and will indemnify the other against, claims caused by its own negligence, misconduct or breach of this agreement.`,
      ],
    },
    {
      heading: "Term, changes and ending this agreement",
      paragraphs: [
        "This agreement continues until either party ends it by closing the account or giving written notice. Confirmed Shifts, payment obligations and the non-circumvention section survive termination.",
        `${brandName} may update this agreement. A new version is shown to you to review and sign; it applies only once you sign it.`,
      ],
    },
    {
      heading: "Electronic signature and records",
      paragraphs: [
        "You agree to sign this agreement electronically and to receive it and related notices electronically. Your typed name is your signature and has the same effect as a handwritten one. We record the date and time, your IP address and device, and a fingerprint (SHA-256) of the exact text you signed. A copy is emailed to you and stays available in your account; you may request a paper copy at any time at no charge.",
      ],
    },
    {
      heading: "General",
      paragraphs: [
        `This agreement is governed by the laws of the State of ${law}. It is the entire agreement between the parties about its subject and replaces earlier versions. If any part is unenforceable, the rest remains in effect, and an unenforceable limit is read to the maximum extent the law allows.`,
      ],
    },
  ];
}

/** Canonical plain text of a document: what the signature's SHA-256 covers. */
export function agreementText(doc: AgreementDoc): string {
  const lines = [`${doc.title} — version ${doc.version}`, ""];
  for (const p of doc.parties) lines.push(`${p.label}:`, ...p.lines.map((l) => `  ${l}`), "");
  for (const sec of doc.sections) lines.push(sec.heading, ...sec.paragraphs.map((x) => `  ${x}`), "");
  return lines.join("\n").trimEnd();
}
