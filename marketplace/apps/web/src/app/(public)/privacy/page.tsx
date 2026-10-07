import { brand } from "@cm/config";
import { getSettings } from "@cm/services";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy policy", alternates: { canonical: "/privacy" } };

/** Updated when what we collect or share changes. Owner: have counsel review before relying on it. */
const UPDATED = "October 8, 2026";

export default async function Privacy() {
  const b = brand();
  const s = await getSettings();
  const company = s["agreements.companyLegalName"] || b.name;
  const privacy = s["email.privacyInbox"];
  const sections: { h: string; p: (string | string[])[] }[] = [
    {
      h: "Who we are",
      p: [
        `${b.name} (operated by ${company}) runs a marketplace that connects clinics with licensed healthcare providers for temporary coverage shifts. This policy explains what personal information we collect on ${b.domain}, our apps and our messages, how we use and share it, and your choices.`,
        `${b.name} never collects or stores patient information (protected health information). Clinics and providers agree not to enter it, and our forms and messages block it.`,
      ],
    },
    {
      h: "What we collect",
      p: [
        [
          "Account details: name, email, phone number, password (stored only as a secure hash), and the role you sign up as.",
          "Provider profile and credentials: professional details, home base (address, used to work out distance and drive time), licenses, malpractice policy details and documents, NPI, skills, availability, a photo and an optional bio.",
          "Clinic details: clinic and location names and addresses, team members, and the shifts you post.",
          "Bookings and work records: applications, offers, bookings, time-clock punches, visit counts (numbers only), timesheet sign-offs, ratings, private feedback and messages sent through the platform.",
          "Location during a shift, only if you choose to share it: when a provider taps \"On my way\" or clocks in, the phone's position is used once to estimate arrival time or distance from the clinic. Only the result (an arrival time, a distance) is kept; the position itself is not stored. Sharing stops when the page is closed.",
          "Payments: card or bank details are entered on Stripe's pages and held by Stripe, not by us. We keep payment amounts, statuses and Stripe reference numbers.",
          "Tax information: providers give their legal name, address and Social Security number or EIN (the details on a W-9) to Stripe during payout setup. We never see or store the number; we only receive from Stripe whether the tax information is complete.",
          "Sign in with Google (optional): your Google account's ID, name and email address. We never receive your Google password.",
          "Devices and usage: IP address, browser and device type, pages visited and actions taken, used for security (fraud and spam checks, sign-in protection) and to improve the service. Push-notification subscriptions if you turn on app alerts.",
          "Information from public sources: for clinic and provider outreach, we use public business information such as the national NPI registry, practice websites and public business email addresses.",
        ],
      ],
    },
    {
      h: "How we use it",
      p: [
        [
          "To run the marketplace: verify credentials, match providers to shifts they're licensed and insured for, book and confirm shifts, process payments and payouts, and keep work records.",
          "To communicate: account, booking, reminder and safety messages by email, text, push notification and in-app notification, and replies to your questions.",
          "Marketing: emails about our service to clinics and providers, always with an unsubscribe link. Marketing texts are sent only with your consent.",
          "Safety and compliance: preventing fraud, spam and off-platform dealing, checking licenses against state records, and meeting tax and legal duties.",
          "Improving the service, including with AI tools that help write and sort messages and summarize information. AI never decides credential eligibility or prices, and patient information is never sent to it.",
        ],
      ],
    },
    {
      h: "Text messages (SMS)",
      p: [
        `If you give us your mobile number and opt in, ${b.name} sends texts such as verification codes, shift offers you can answer by reply, booking confirmations and changes, reminders and arrival updates. Message frequency varies. Message and data rates may apply.`,
        "Reply STOP to any text to stop texts, START to turn them back on, and HELP for help. Opting in to texts is not required to use the service.",
        "We do not sell, rent or share your mobile number or text-messaging opt-in with third parties or affiliates for their marketing purposes. Mobile numbers are shared only with the service providers that deliver our texts (such as Twilio), and only to send them.",
      ],
    },
    {
      h: "Who we share it with",
      p: [
        [
          "Between clinics and providers, as needed for a booking: clinics see a provider's professional profile, verified credentials (never license numbers or home address), ratings and reliability; booked providers see the clinic's address, arrival notes and on-site contact.",
          "Service providers who work for us under contract: hosting and database (Namecheap, Neon), payments and tax forms (Stripe), email (SendGrid), texting (Twilio), maps and sign-in (Google), spam protection (Cloudflare), analytics on public pages (Google Analytics), and AI providers (such as OpenAI, Anthropic or Google) for the tasks described above.",
          "When required by law, to protect people's safety, or to enforce our agreements, and to a buyer if the business is sold (under this policy).",
        ],
        "We do not sell personal information.",
      ],
    },
    {
      h: "Cookies",
      p: [
        "We use cookies to keep you signed in, remember sign-up and referral links, and protect forms from spam. Google Analytics runs on our public pages only (never inside accounts), without tracking codes from our emails.",
      ],
    },
    {
      h: "How long we keep it",
      p: [
        "We keep account and booking records while your account is open and as long as needed afterwards for payments, taxes, disputes and legal duties (generally up to 7 years for financial records). Spam submissions are deleted after a short period. Backups are encrypted and kept for a limited time.",
      ],
    },
    {
      h: "Your choices and rights",
      p: [
        `You can update your profile and notification settings in your account, unsubscribe from marketing emails with the link in any email, and stop texts by replying STOP. To request a copy of your information, a correction or deletion of your account, email ${privacy}. When an account has work history, we erase personal details and keep the records the law requires.`,
      ],
    },
    {
      h: "Security",
      p: [
        "We use encryption in transit, hashed passwords, optional two-step sign-in, sign-in attempt limits, encrypted backups and access limited to people who need it. No system is perfectly secure; tell us right away if you think your account has been misused.",
      ],
    },
    {
      h: "Children",
      p: ["The service is for professionals and businesses and is not meant for anyone under 18."],
    },
    {
      h: "Changes and contact",
      p: [
        `We'll post changes here and update the date above; for significant changes we'll also tell account holders. Questions: ${privacy}${s["agreements.companyAddress"] ? `, or by mail to ${company}, ${s["agreements.companyAddress"]}` : ""}.`,
      ],
    },
  ];
  return (
    <section className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated {UPDATED}</p>
      <div className="mt-8 space-y-8 text-slate-700">
        {sections.map((sec) => (
          <div key={sec.h}>
            <h2 className="text-lg font-semibold text-slate-900">{sec.h}</h2>
            <div className="mt-2 space-y-3">
              {sec.p.map((x, i) => (Array.isArray(x) ? <ul key={i} className="list-disc space-y-1.5 pl-5">{x.map((li) => <li key={li}>{li}</li>)}</ul> : <p key={i}>{x}</p>))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
