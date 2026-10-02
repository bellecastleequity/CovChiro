import { Flow, KeyFacts, P, Ul } from "@/components/academy/flow";
import { money } from "@/lib/format";
import type { HelpArticle, HelpCenter } from "./types";

const hrs = (h: number) => (h === 1 ? "1 hour" : `${h} hours`);

const A: HelpArticle[] = [
  // ---------------- getting started ----------------
  {
    slug: "setup-checklist",
    category: "start",
    title: "What do I need before I can post a shift?",
    summary: "Confirm your email, add a location, add a payment method and sign the agreement.",
    keywords: "setup checklist start onboarding cannot post can't post finish setup",
    popular: true,
    lesson: "setup",
    links: [{ href: "/clinic", label: "Open your setup checklist" }],
    body: () => (
      <>
        <P>You can save draft shifts any time. Posting needs all four of these:</P>
        <Flow
          steps={[
            { title: "Confirm your email", detail: "Use the link we emailed you (check spam). You can resend it from the banner." },
            { title: "Add a location", detail: "Locations → Add. The address sets the state, which decides which licenses qualify." },
            { title: "Add a payment method", detail: "Billing → card or bank account, saved securely with Stripe." },
            { title: "Sign the Clinic Platform Agreement", detail: "Settings → Agreement. A copy is emailed to you.", tone: "accent" },
          ]}
        />
      </>
    ),
  },
  {
    slug: "team",
    category: "start",
    title: "Adding your office manager or staff",
    summary: "Invite teammates; staff can post and manage shifts, only the owner changes billing.",
    keywords: "team invite staff user login manager front desk add person access",
    links: [{ href: "/clinic/team", label: "Open Team" }],
    body: () => (
      <Ul
        items={[
          "Go to Team and invite by email. They get a link to set their password.",
          "Staff can post shifts, choose providers, message, confirm patient counts, sign timesheets and rate.",
          "Only the owner can change billing and payment methods.",
          "Remove someone from Team at any time; their login stops working for your clinic.",
        ]}
      />
    ),
  },
  {
    slug: "locations",
    category: "start",
    title: "Locations, arrival notes and photos",
    summary: "Each location is matched only with providers licensed in its state; arrival details go to the booked provider.",
    keywords: "location address second office parking arrival notes photos dress code contact front desk",
    links: [{ href: "/clinic/locations", label: "Open Locations" }],
    body: () => (
      <Ul
        items={[
          "One account can have many locations, even in different states.",
          "Fill in parking, which door, who to ask for, dress code and the on-site contact. Only the booked provider sees them, after confirmation.",
          "Photos of the entrance and treatment rooms help providers arrive confidently; only you and providers booked there can see them.",
          "Patients per day and techniques you use help providers know what to expect.",
        ]}
      />
    ),
  },
  // ---------------- posting ----------------
  {
    slug: "post-a-shift",
    category: "posting",
    title: "How to post a shift",
    summary: "Location, coverage type, date and time, details, then review the price and post.",
    keywords: "post shift create coverage request book doctor need cover",
    popular: true,
    lesson: "posting",
    links: [{ href: "/clinic/shifts/new", label: "Post a shift" }],
    body: () => (
      <>
        <Flow
          steps={[
            { title: "Where", detail: "Pick the location" },
            { title: "What", detail: "The profession you need covered" },
            { title: "When", detail: "Date and hours; add days for a multi-day booking; choose how many providers you need" },
            { title: "Details", detail: "Patients the covering provider will see, skills, experience, travel budget, notes" },
            { title: "Review", detail: "Price, promo code, then Post", tone: "accent" },
          ]}
        />
        <P>The price is shown before you post. You can also save a draft and finish it later from Shifts.</P>
      </>
    ),
  },
  {
    slug: "light-busy-days",
    category: "posting",
    title: "Light and Busy days: how patient count sets the price",
    summary: "Enter the patients the covering provider will see; extra visits are billed only past the day's limit plus grace.",
    keywords: "light busy volume patients visits expected price tier extra visit overage grace count",
    popular: true,
    body: (s) => (
      <>
        <P>
          Enter how many patients <b>the covering provider</b> will see, not your whole clinic&apos;s volume. If other doctors are working that day, leave their patients out.
        </P>
        <KeyFacts
          rows={[
            ["Light day", `Up to ${s["pricing.volumeLightVisitsFullDay"]} patients (half day: ${s["pricing.volumeLightVisitsHalfDay"]})`],
            ["Busy day", `Up to ${s["pricing.volumeBusyVisitsFullDay"]} patients (half day: ${s["pricing.volumeBusyVisitsHalfDay"]})`],
            ["Grace", `${s["pricing.volumeGraceVisits"]} extra visits free`],
            ["Each visit after that", money(s["pricing.volumeOverageClinicCents"])],
          ]}
        />
        <P>The price never goes below the day you booked. After the shift you see the provider&apos;s count and can confirm it or send yours (see “Checking the patient count”).</P>
      </>
    ),
  },
  {
    slug: "several-providers",
    category: "posting",
    title: "I need more than one provider at the same time",
    summary: "Choose Providers needed: each provider gets a separate booking.",
    keywords: "two doctors multiple providers several same time second provider extra doctor",
    links: [{ href: "/clinic/shifts/new", label: "Post a shift" }],
    body: () => (
      <Ul
        items={[
          "On the When step, choose Providers needed (up to 5). We post one booking per provider.",
          "Each booking has its own price, patient count and confirmation, and one provider can never take two of them.",
          "Enter the patients one provider will see.",
          "Already posted one? Just post another booking for the same time; we'll note that you already have one, which is fine.",
        ]}
      />
    ),
  },
  {
    slug: "multi-day",
    category: "posting",
    title: "Booking several days (vacation, CE week)",
    summary: "Add days on the When step; each day is its own shift that one provider can take together.",
    keywords: "multi day several days week vacation consecutive cancel one day",
    body: () => (
      <Ul
        items={[
          "Add another day on the When step (up to 14).",
          "Providers can apply for all days; you can confirm one provider for every day in one click.",
          "If someone can't make one day, we find cover for just that day.",
          "You can cancel a single day or all remaining days.",
        ]}
      />
    ),
  },
  {
    slug: "instant-book-lodging",
    category: "posting",
    title: "Instant book and lodging: should I turn them on?",
    summary: "Instant book is off by default; lodging is on and only costs extra if your provider stays over.",
    keywords: "instant book auto confirm lodging hotel overnight distant far travel",
    body: (s) => (
      <KeyFacts
        rows={[
          ["Instant book (off by default)", "On: the first strong-match applicant is confirmed right away. Off: you choose; if you don't choose in time, we confirm the best applicant for you."],
          [
            "Lodging (on by default)",
            <>
              Lets providers who&apos;ll stay overnight be offered your shift from up to {Math.round(s["pricing.lodgingMaxDriveMinutes"] / 60)} hours away. If your provider&apos;s drive is over{" "}
              {Math.round(s["pricing.lodgingTriggerMinutes"] / 60)} hours, a flat {money(s["pricing.lodgingNightlyCents"])} a night is added. No receipts. Off: only providers within their own drive limit.
            </>,
          ],
        ]}
      />
    ),
  },
  {
    slug: "edit-draft",
    category: "posting",
    title: "Editing or changing a shift",
    summary: "Drafts can be edited; a posted shift can be cancelled and reposted.",
    keywords: "edit change modify draft time date wrong update",
    links: [{ href: "/clinic/shifts", label: "Open Shifts" }],
    body: (s) => (
      <Ul
        items={[
          "Drafts: open the shift and choose Edit draft. It's re-priced when you save.",
          "Posted but not filled: cancel it from the shift page (no charge) and post a new one.",
          `Booked: cancelling ${hrs(s["payments.clinicFreeCancelHours"])} or more before the start refunds the deposit; later forfeits it.`,
          "Need the same provider again on another date? Use Book again on a past shift.",
        ]}
      />
    ),
  },
  // ---------------- providers ----------------
  {
    slug: "choosing-provider",
    category: "providers",
    title: "Choosing a provider (and what happens if I don't)",
    summary: "Review applicants and pick one, or we confirm the best match at the decision deadline.",
    keywords: "applicants choose select pick provider deadline auto select dispatch offers",
    lesson: "matching",
    body: () => (
      <Ul
        items={[
          "Applicants are ranked by match: license, drive time, skills, reliability, ratings and history with you.",
          "Open an applicant to see their verified credentials and track record, then Select.",
          "If you don't choose by the decision deadline, we confirm the best applicant or reach out to providers in rounds.",
          "Shifts posted at short notice skip the wait: we start reaching out to providers right away.",
        ]}
      />
    ),
  },
  {
    slug: "favorites-blocks",
    category: "providers",
    title: "Favorites, blocks, Book again and standing bookings",
    summary: "Keep the providers you like, never see the ones you don't, and rebook in one tap.",
    keywords: "favorite block rebook book again same provider standing recurring weekly",
    links: [{ href: "/clinic/providers", label: "Open My providers" }],
    body: (s) => (
      <Ul
        items={[
          `Favorites get a ${hrs(s["matching.favoritesWindowHours"])} head start on your planned shifts and rank higher.`,
          "Blocked providers are never offered your shifts; only you see the list.",
          "Book again posts the same hours on a new date and invites the same provider.",
          "Standing booking: propose a repeating schedule to a provider you've worked with; each day is booked automatically.",
        ]}
      />
    ),
  },
  {
    slug: "trust",
    category: "providers",
    title: "How you verify providers",
    summary: "State license, malpractice and NPI, checked by us and re-checked before every shift.",
    keywords: "verify verification license malpractice npi background trust credentials safe",
    body: () => (
      <P>
        Every provider&apos;s state license, malpractice coverage and NPI are verified by our team before they can see a shift, and re-checked before each shift. On a booked shift, the trust
        panel shows their verified license, coverage, completed shifts, ratings and on-time record. A license from another state never qualifies.
      </P>
    ),
  },
  // ---------------- day of ----------------
  {
    slug: "day-of",
    category: "dayof",
    title: "What happens before and on the day",
    summary: "The provider reconfirms and taps On my way; we alert you if they don't.",
    keywords: "reconfirm on my way check in arrive day of late running",
    lesson: "before-the-day",
    body: (s) => (
      <Ul
        items={[
          `${hrs(s["reconfirm.askBeforeHours"])} before, the provider reconfirms. If they don't by ${hrs(s["reconfirm.deadlineBeforeHours"])} before, we release them and find a replacement.`,
          `${hrs(s["checkin.promptBeforeHours"])} before, they tap On my way and you get a text.`,
          `No On my way ${s["checkin.alertBeforeMinutes"]} minutes before? You and our team are alerted.`,
        ]}
      />
    ),
  },
  {
    slug: "no-show",
    category: "dayof",
    title: "My provider didn't show up or cancelled",
    summary: "Tap “My provider didn't show” and we launch emergency cover right away.",
    keywords: "no show didn't show cancelled late emergency replacement cover",
    popular: true,
    lesson: "cancellations",
    body: (s) => (
      <Ul
        items={[
          "On the shift page, tap My provider didn't show (available from shortly before the start).",
          `If a provider cancels within ${hrs(s["emergency.triggerWithinHours"])}, emergency cover starts automatically: everyone eligible is asked at once, with a wider radius.`,
          "You're never charged for a provider who didn't come, and you're told the moment we find a replacement.",
        ]}
      />
    ),
  },
  {
    slug: "timesheet",
    category: "dayof",
    title: "Signing off the timesheet",
    summary: "Approve the provider's punches in one tap from the email, the portal, or on their phone.",
    keywords: "timesheet sign off approve punches hours time clock signature manager",
    links: [{ href: "/clinic/timesheets", label: "Open Timesheets" }],
    body: (s) => (
      <Ul
        items={[
          "When the provider punches out, you get a one-tap link to review in, lunch and out times.",
          "A manager can also sign on the provider's phone before they leave.",
          `If you don't respond, it's approved automatically after ${hrs(s["timeclock.autoApproveHours"])}.`,
          "Something wrong? Tap Something's wrong; we review it before pay goes out.",
        ]}
      />
    ),
  },
  {
    slug: "patient-count",
    category: "dayof",
    title: "Checking the patient count",
    summary: "Confirm the provider's count or send yours before extra visits are charged.",
    keywords: "patient count visits confirm dispute extra visits wrong count different",
    popular: true,
    body: (s) => (
      <Ul
        items={[
          "After the shift the provider enters how many patients they saw. You get a message with the count and any extra-visit amount.",
          `You have ${hrs(s["pricing.volumeDisputeHours"])} after the booking completes to confirm it or send your own count with a reason.`,
          `If the counts differ by ${s["pricing.countTolerance"]} or fewer, we use the average (rounded down). If they differ more, the lower count is billed and our team reviews it.`,
          "No answer means the provider's count stands and any extra visits are charged to your card on file.",
        ]}
      />
    ),
  },
  // ---------------- billing ----------------
  {
    slug: "when-charged",
    category: "billing",
    title: "When am I charged?",
    summary: "A deposit at confirmation, the balance after the shift, extra visits after your check window.",
    keywords: "charge charged when deposit balance invoice bill card payment timing",
    popular: true,
    lesson: "pricing-payments",
    links: [{ href: "/clinic/billing", label: "Open Billing" }],
    body: (s) => (
      <KeyFacts
        rows={[
          ["At confirmation", `Deposit: ${s["payments.depositPercent"]}% of the booking`],
          ["After the shift", `Balance (including mileage and any lodging), ${hrs(s["payments.autoCompleteHours"])} after the end`],
          ["Extra visits, if any", `After your ${hrs(s["pricing.volumeDisputeHours"])} window to check the count`],
        ]}
      />
    ),
  },
  {
    slug: "statements",
    category: "billing",
    title: "Monthly statements for your bookkeeper",
    summary: "Print or save a month of charges and refunds as a PDF.",
    keywords: "statement invoice receipt pdf bookkeeper accountant monthly export",
    links: [{ href: "/clinic/billing/statement", label: "Open statements" }],
    body: () => <P>Billing → Statement shows every charge and refund for a month. Use Print → Save as PDF to send it to your bookkeeper.</P>,
  },
  {
    slug: "payment-failed",
    category: "billing",
    title: "My payment failed",
    summary: "Update your payment method quickly to keep the booking.",
    keywords: "payment failed declined card expired update card billing",
    links: [{ href: "/clinic/billing", label: "Update payment method" }],
    body: (s) => (
      <P>
        We&apos;ll email you. Update your card in Billing within {hrs(s["payments.paymentFixWindowHours"])} ({hrs(s["payments.paymentFixWindowUrgentHours"])} if the shift is soon) to keep the booking;
        we retry automatically once it&apos;s updated.
      </P>
    ),
  },
  {
    slug: "cancel-refund",
    category: "billing",
    title: "Cancelling and refunds",
    summary: "Free cancellation up to a cutoff; after that the deposit is forfeited.",
    keywords: "cancel refund cancellation fee deposit forfeit",
    lesson: "cancellations",
    body: (s) => (
      <Ul
        items={[
          `Cancel ${hrs(s["payments.clinicFreeCancelHours"])} or more before the start: the deposit is refunded.`,
          "Later: the deposit is forfeited, and part of it compensates the provider.",
          "If the provider cancels, you're refunded in full and we look for a replacement.",
          `Something went wrong with a shift? Open a dispute within ${hrs(s["payments.disputeWindowHours"])} after it ends.`,
        ]}
      />
    ),
  },
  {
    slug: "promo-credits",
    category: "billing",
    title: "Promo codes and referral credits",
    summary: "Enter a promo on the review step; referral credits apply automatically.",
    keywords: "promo code discount coupon referral credit refer friend",
    links: [{ href: "/clinic/refer", label: "Refer & earn" }],
    body: () => (
      <Ul
        items={[
          "Enter a promo code on the Review step; the discount shows before you post.",
          "Referral credits you've earned are applied automatically to your next shift when no other code is entered.",
        ]}
      />
    ),
  },
  // ---------------- account ----------------
  {
    slug: "phone-app",
    category: "account",
    title: "Phone app, notifications and calendar",
    summary: "Install the app from your browser, turn on notifications, and sync shifts to your calendar.",
    keywords: "app iphone android install notifications push alerts calendar google outlook ics",
    links: [{ href: "/clinic/notifications", label: "Notifications" }],
    body: () => (
      <Ul
        items={[
          "iPhone: open the site in Safari → Share → Add to Home Screen, then turn on notifications from the app.",
          "Android: tap Install when your browser offers it.",
          "Calendar: on the Shifts page, copy your private calendar link into Google, Apple or Outlook.",
        ]}
      />
    ),
  },
  {
    slug: "agreement",
    category: "account",
    title: "The Clinic Platform Agreement",
    summary: "Sign once; when it's updated you'll be asked to sign the new version before posting.",
    keywords: "agreement contract terms sign signature legal updated version",
    links: [{ href: "/clinic/settings#agreement", label: "Open Settings" }],
    body: () => (
      <P>
        Settings shows when you signed and lets you view or print your copy. When we update it, a banner asks you to sign the new version. Shifts already booked stay booked, but new posts wait
        until it&apos;s signed.
      </P>
    ),
  },
  {
    slug: "search-shortcuts",
    category: "account",
    title: "Finding anything fast",
    summary: "Use the search bar (press / or Ctrl/⌘ K) and reorder your side menu.",
    keywords: "search find shortcut keyboard menu reorder navigation",
    body: () => (
      <Ul
        items={[
          "The search bar at the top finds pages, settings, shifts, providers and locations. Press / or Ctrl/⌘ K anywhere.",
          "On a computer, use Reorder menu at the bottom of the side menu to put your favorite pages first.",
        ]}
      />
    ),
  },
];

export const clinicHelp: HelpCenter = {
  audience: "clinic",
  base: "/clinic/help",
  academyBase: "/clinic/academy",
  categories: [
    { id: "start", title: "Getting started", description: "Setup, team and locations" },
    { id: "posting", title: "Posting shifts", description: "Prices, patient counts, several providers, multi-day" },
    { id: "providers", title: "Choosing providers", description: "Applicants, favorites, verification" },
    { id: "dayof", title: "On the day and after", description: "Check-in, no-shows, timesheets, patient counts" },
    { id: "billing", title: "Billing", description: "Charges, statements, cancellations, promos" },
    { id: "account", title: "Your account", description: "App, notifications, agreement, shortcuts" },
  ],
  articles: A,
};
