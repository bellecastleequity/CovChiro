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
  {
    slug: "verification",
    category: "start",
    title: "Verifying your clinic",
    summary: "We confirm who owns every clinic on the platform. Most clinics are verified in minutes.",
    keywords: "verify verification ownership owner npi ahca clinic license sunbiz fraud renew yearly",
    links: [{ href: "/clinic/settings/verification", label: "Clinic verification" }],
    body: (s) => (
      <Ul
        items={[
          "To protect providers and patients from fraud, we confirm the legal business, who owns it and their licenses for every clinic. The owner fills in Settings → Clinic verification: the registered business name and number, each owner and their license, the clinic's organization NPI, and a signed ownership statement.",
          "Some states license clinics that aren't wholly owned by licensed practitioners. In Florida, for example, that's the AHCA Health Care Clinic License: if any owner isn't a licensed practitioner, enter its number and upload a copy.",
          s["clinicVerify.autoApprove"]
            ? "We check the details against public records right away. When everything matches, your clinic is verified on the spot; otherwise our team reviews it, usually within one business day."
            : "Our team checks the details against public records, usually within one business day.",
          "You can post shifts before you're verified. They go out to providers as soon as your clinic is verified. Clinics that joined before verification started can keep posting as normal until their deadline.",
          `Verification lasts ${s["clinicVerify.renewMonths"]} months; we remind you before it's due. Tell us within 10 days if ownership changes.`,
          "Never upload patient information.",
        ]}
      />
    ),
  },
  // ---------------- posting ----------------
  {
    slug: "no-provider-available",
    category: "posting",
    title: "When no provider is available yet",
    summary: "We only post a shift when a provider can take it. Otherwise we save it and post it automatically the moment one can.",
    keywords: "no provider available doctor waiting draft booked notify text email automatically post later",
    links: [{ href: "/clinic/shifts/new", label: "Post a shift" }, { href: "/clinic/shifts", label: "My shifts" }],
    body: () => (
      <Ul
        items={[
          "While you fill in a shift we show how many providers could take it right now: licensed in your state, insured, close enough, free that day and not already booked.",
          "If none are currently available, we don't post it, so you're never left waiting on a shift nobody can take. We save it instead, with a tip when a detail (for example required skills or minimum experience) is what's ruling providers out.",
          "\"Post it automatically as soon as a provider is available\" is ticked for you: the moment a provider can take it, we post it and text and email you. Untick it if you'd rather we just tell you, and post it yourself in one tap.",
          "You're never charged to post or wait. The deposit is only charged once a provider is confirmed.",
        ]}
      />
    ),
  },
  {
    slug: "same-provider",
    category: "posting",
    title: "Same provider for every day of a booking",
    summary: "Posting several days? Keep one provider for all of them, or let each day fill on its own.",
    keywords: "same provider multi-day several days continuity one doctor whole week split booking",
    links: [{ href: "/clinic/shifts/new", label: "Post a shift" }],
    body: (s) => (
      <Ul
        items={[
          `When you post two or more days, "Same provider for all days" is ${s["bookings.sameProviderDefault"] ? "ticked" : "unticked"} by default. Untick it to let each day be filled on its own.`,
          "With it on, only providers who are free and qualified for every day can apply, and you confirm one provider for the whole booking. That's better for your patients, but fewer providers can take every day, so it can take longer to fill.",
          "The booking page shows how many providers can take every day, how many could take at least one day if you split it, and who has applied for all of them.",
          `If no one provider has applied for every day by your decision deadline, we ask whether to split it. If you don't answer within ${s["bookings.splitWaitHours"]} hours, or the first day is less than ${s["bookings.splitNowWithinHours"]} hours away, we split it automatically so your days still get covered. You can also split it yourself, or keep waiting, from the booking page.`,
          "Once a provider is booked, if they later have to cancel one day, that day gets cover on its own and they keep the other days.",
        ]}
      />
    ),
  },
  {
    slug: "fly-in",
    category: "posting",
    title: "Fly-in coverage",
    summary: "Few local providers? Let licensed providers from elsewhere fly in for multi-day bookings.",
    keywords: "fly fly-in flight airfare island virgin islands puerto rico travel out of state lodging",
    links: [{ href: "/clinic/shifts/new", label: "Post a shift" }],
    body: (s) => (
      <Ul
        items={[
          `When you post ${s["flyIn.minDays"]}+ consecutive days at least ${s["flyIn.minLeadDays"]} days ahead, tick "Fly-in coverage OK" in Details. Providers licensed and insured in your state who live too far to drive can then apply.`,
          "They apply for all the days together and you choose; a fly-in provider is never auto-booked by instant offers.",
          "If you confirm one, a flat airfare allowance per trip and a nightly lodging allowance are added to your total instead of mileage (the amounts for your state are shown when you post). No receipts. Travel days aren't charged.",
          `The airfare is collected with the deposit. Cancel within ${s["flyIn.airfareRefundHours"]} hours of confirming and it's refunded; after that the provider books flights, so a cancellation keeps the airfare (paid to them) on top of the normal cancellation terms.`,
        ]}
      />
    ),
  },
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
    summary: "Change the date, hours, expected visits or notes of a posted shift; a booked provider accepts or declines.",
    keywords: "edit change modify draft time date wrong update reschedule move hours",
    links: [{ href: "/clinic/shifts", label: "Open Shifts" }],
    body: (s) => (
      <Ul
        items={[
          "Drafts: open the shift and choose Edit draft. It's re-priced when you save.",
          "Posted: open the shift and choose Change shift. You see the new time and price before anything is sent.",
          "Not filled yet: the change applies right away and anyone who applied is told.",
          `Provider booked: they're asked to accept within ${hrs(s["matching.changeResponseHours"])} (sooner for shifts coming up). Until then the shift stays as booked, and you can withdraw the change.`,
          "If they decline or don't answer, they're released with no penalty, your deposit is refunded and we offer the shift with its new details to other providers.",
          `Booked shifts can be changed up to ${hrs(s["matching.changeMinLeadHours"])} before they start. Location, profession and skills can't be changed; cancel and post again for those.`,
          `Cancelling a booked shift ${hrs(s["payments.clinicFreeCancelHours"])} or more before the start refunds the deposit; later forfeits it.`,
          "Need the same provider again on another date? Use Book again on a past shift.",
        ]}
      />
    ),
  },
  // ---------------- providers ----------------
  {
    slug: "own-rate",
    category: "posting",
    title: "Setting your own rate (beta)",
    summary: "Post a shift below the market price; providers apply and you choose.",
    keywords: "own rate set price lower budget discount manual price cheaper release market beta",
    links: [{ href: "/clinic/shifts/new", label: "Post a shift" }],
    body: (s, brand) =>
      s["clinicRate.enabled"] ? (
        <Ul
          items={[
            `On the Review step, tick "Set your own rate" and enter your price: below the market price, and at least ${s["clinicRate.minPercent"]}% of it.`,
            "It isn't filled automatically: providers who are happy with your rate apply, and you choose who to confirm.",
            `Choose what happens if no one is confirmed: release it to ${brand} at market rates at the time shown (currently ${s["clinicRate.releaseHours"]} hours before the start), or don't release and accept it may go unfilled.`,
            `The release window is set by ${brand} between 72 and 168 hours before the start and can change with the season; the exact time for your shift is shown before you post, saved with the shift and emailed to you.`,
            `Available for single-day shifts starting more than ${s["clinicRate.releaseHours"]} hours away. Promo codes can't be combined with your own rate.`,
            'Changed your mind? Tap "Release to market now" on the shift page at any time.',
          ]}
        />
      ) : (
        <p>Setting your own rate isn&apos;t available right now. Shifts are priced at the market rate.</p>
      ),
  },
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
