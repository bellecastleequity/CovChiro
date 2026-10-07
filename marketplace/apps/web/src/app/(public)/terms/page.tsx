import Link from "next/link";
import { brand } from "@cm/config";
import { getSettings } from "@cm/services";

export const dynamic = "force-dynamic";
export const metadata = { title: "Terms of service", alternates: { canonical: "/terms" } };

const UPDATED = "October 8, 2026";

export default async function Terms() {
  const b = brand();
  const s = await getSettings();
  const company = s["agreements.companyLegalName"] || b.name;
  const items = [
    `These terms cover your use of ${b.domain} and ${b.name}'s apps and messages. ${b.name} is operated by ${company}.`,
    `Clinics and providers who book or work shifts also sign the ${b.name} Clinic Agreement or Provider Agreement in their account. That agreement governs bookings, prices, payments, cancellations, credentials and non-circumvention, and it takes priority over these terms where they differ. A copy of what you signed is emailed to you and kept in your account.`,
    `${b.name} is a marketplace. Clinics decide whom to book and remain responsible for their practice and patients; providers are independent contractors who decide which shifts to take and use their own professional judgment. ${b.name} verifies licenses and malpractice coverage but does not practice medicine or supervise care.`,
    "You must give accurate information, keep your sign-in details private, and be at least 18. Accounts are for professionals and businesses using the service for its intended purpose.",
    "Don't enter patient information anywhere on the platform. Don't share contact details to arrange work outside the platform, misuse other people's information, scrape the site, interfere with its operation, or post anything unlawful, false or abusive. We may suspend or close accounts that do.",
    "Prices and pay come from our rate engine and are shown before you post or accept a shift. Payments and payouts are handled by Stripe under Stripe's own terms.",
    `Text messages: if you opt in, we send account and booking texts. Message frequency varies; message and data rates may apply. Reply STOP to stop, HELP for help. See our privacy policy for how we handle your number.`,
    `The site, our software and our content belong to ${company}. You may use them only to use the service.`,
    "The service is provided as is. To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability to you is limited as set out in your Clinic or Provider Agreement (or, if you have none, to $100).",
    `These terms are governed by the laws of the State of ${s["agreements.governingState"]}. We may update them; we'll post changes here and update the date. Questions: ${b.supportEmail}.`,
  ];
  return (
    <section className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of service</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated {UPDATED}</p>
      <ol className="mt-8 list-decimal space-y-3 pl-5 text-slate-700">{items.map((t) => <li key={t}>{t}</li>)}</ol>
      <p className="mt-8 text-sm text-slate-600">See also our <Link href="/privacy" className="text-brand-700 underline">privacy policy</Link> and <Link href="/referral-terms" className="text-brand-700 underline">referral program terms</Link>.</p>
    </section>
  );
}
