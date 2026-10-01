import { brand } from "@cm/config";
import { dollars } from "@cm/core";
import { getSettings } from "@cm/services";

export const dynamic = "force-dynamic";
export const metadata = { title: "Referral program terms" };

export default async function ReferralTerms() {
  const b = brand();
  const s = await getSettings();
  const you = dollars(s["referrals.referrerRewardCents"]);
  const friend = dollars(s["referrals.refereeRewardCents"]);
  const items = [
    `Anyone with a ${b.name} provider or clinic account can share a personal referral link. A new account is linked to the first referral link or code it signs up with.`,
    `A referral qualifies when the new account completes its first shift on ${b.name}: for a provider, a shift they worked that was marked complete; for a clinic, a shift it posted that was worked and paid in full. It must qualify within ${s["referrals.expiryMonths"]} months of signing up.`,
    `When a referral qualifies, the person who referred gets ${you} and the new account gets ${friend}. Rewards are issued about ${s["referrals.holdDays"]} days after the qualifying shift.`,
    `Providers receive rewards as pay through their connected Stripe account, with their next payment. Clinics receive a one-time credit that is applied to their next shift and expires after ${s["referrals.creditExpiryDays"]} days. Credits have no cash value.`,
    "Referring yourself, creating duplicate or fake accounts, or arranging shifts only to earn rewards doesn't qualify. We may review any referral and decline or reverse rewards that don't meet these terms. Accounts that are banned don't earn rewards.",
    "Rewards are for introducing people to the platform. They are not payment for referring patients or any healthcare services, and they never depend on patient volume or billing.",
    "Rewards may be reportable income; providers receive tax forms from Stripe where required.",
    "We may change or end the program at any time. Rewards already earned are still paid.",
  ];
  return (
    <section className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Referral program terms</h1>
      <ol className="mt-6 list-decimal space-y-3 pl-5 text-slate-700">{items.map((t) => <li key={t}>{t}</li>)}</ol>
    </section>
  );
}
