import { Flow, KeyFacts, P, Ul } from "@/components/academy/flow";
import { money } from "@/lib/format";
import type { HelpArticle, HelpCenter } from "./types";

const hrs = (h: number) => (h === 1 ? "1 hour" : `${h} hours`);

const A: HelpArticle[] = [
  // ---------------- getting started ----------------
  {
    slug: "get-verified",
    category: "start",
    title: "Why can't I see any shifts yet?",
    summary: "You need a verified license, malpractice, NPI, payout setup and the signed agreement.",
    keywords: "no shifts can't see empty verified verification pending ready checklist",
    popular: true,
    lesson: "getting-ready",
    links: [{ href: "/provider", label: "Open your readiness checklist" }],
    body: () => (
      <>
        <P>Your home page shows what&apos;s left. Shifts appear once everything is done:</P>
        <Flow
          steps={[
            { title: "License verified", detail: "For the profession and state you'll work in" },
            { title: "Malpractice verified", detail: "At or above that state's limits" },
            { title: "NPI added" },
            { title: "Payout setup finished", detail: "Your bank through Stripe" },
            { title: "Provider Platform Agreement signed", tone: "accent" },
            { title: "Availability set", detail: "Shifts must fit your hours and drive limit", tone: "green" },
          ]}
        />
        <P>Still nothing? There may be no open shifts in your area right now. Turn on On Call and notifications so you hear about new ones first.</P>
      </>
    ),
  },
  {
    slug: "credentials",
    category: "start",
    title: "Uploading and renewing your license and malpractice",
    summary: "Upload each license and your certificate; renew before they expire.",
    keywords: "license upload malpractice certificate insurance renew expire expiring npi verify",
    links: [{ href: "/provider/credentials", label: "Open Credentials" }],
    body: (s) => (
      <Ul
        items={[
          "Add one license per profession and state. We verify it with the state board, usually within a business day.",
          "Upload your malpractice certificate showing the limits and dates.",
          `We remind you ${(s["credentials.expiryReminderDays"] as number[]).join(", ")} days before anything expires. A credential that expires before a shift ends means you can't keep that shift.`,
        ]}
      />
    ),
  },
  {
    slug: "payouts-setup",
    category: "start",
    title: "Setting up payouts (Stripe)",
    summary: "Step by step: what Stripe asks and how to answer. About 5 minutes.",
    keywords: "stripe bank direct deposit payout setup account connect tax w-9 ssn independent contractor business type product description website",
    links: [{ href: "/provider/payouts", label: "Open Payout setup" }],
    body: (_s, brand) => (
      <>
        <P>
          Payout setup opens Stripe, our payment partner, to confirm your identity and bank account. You can&apos;t be matched until it&apos;s finished. We never pay outside Stripe, and we
          never see your full bank or tax numbers. Have your Social Security number (or EIN) and your bank login or routing and account numbers handy.
        </P>
        <Flow
          caption="What Stripe asks, in order"
          steps={[
            { title: "Email and phone", detail: "Stripe texts you a code. This also becomes your Stripe sign-in for viewing payouts later." },
            { title: "Business type: Individual / sole proprietorship", detail: "You're paid as an independent contractor (1099), not as an employee. Choose Company only if you're paid through your own LLC or corporation.", tone: "accent" },
            { title: "Your details", detail: "Legal name, date of birth, home address and SSN, exactly as on your tax records." },
            { title: "Professional details", detail: `Usually filled in for you. If Stripe asks for a website or description, use our website or: "Independent contractor providing clinic coverage shifts through ${brand}."` },
            { title: "Bank account", detail: "Sign in to your bank or type the routing and account numbers. Payouts go here." },
            { title: "Review and submit", detail: "Every section must show complete. You come back here when you're done.", tone: "green" },
          ]}
        />
        <KeyFacts
          rows={[
            ["Taxes", "Stripe collects your W-9 and sends your 1099 each January."],
            ["Change bank later", "Payout setup → Open Stripe dashboard."],
            ["Stuck on \"Almost there\"?", "Click Continue Stripe setup; Stripe shows exactly what's missing."],
          ]}
        />
      </>
    ),
  },

  {
    slug: "availability",
    category: "start",
    title: "Availability, drive limit and overnight travel",
    summary: "Set when you're free, how far you'll drive, and whether you'll stay over for distant shifts.",
    keywords: "availability hours schedule drive distance radius far travel overnight lodging blackout",
    links: [
      { href: "/provider/availability", label: "Open Availability" },
      { href: "/provider/profile", label: "Drive limit (Profile)" },
    ],
    body: (s) => (
      <Ul
        items={[
          "Weekly hours, extra open dates and blackout dates decide which shifts fit you.",
          "Enter the hours you can be at the clinic. Your drive doesn't have to fit inside them; we just keep travel time clear between your shifts and around blackouts.",
          "Your drive limit (on your profile) is the longest one-way drive you'll take.",
          `Willing to stay overnight? When a clinic allows lodging you can be offered shifts up to ${Math.round(s["pricing.lodgingMaxDriveMinutes"] / 60)} hours away, with ${money(s["pricing.lodgingNightlyCents"])} a night added to your pay when the drive is over ${Math.round(s["pricing.lodgingTriggerMinutes"] / 60)} hours. No receipts.`,
        ]}
      />
    ),
  },
  {
    slug: "minimum-pay",
    category: "start",
    title: "Setting my minimum pay",
    summary: "Shifts paying less than your minimum are hidden and never offered to you.",
    keywords: "minimum pay floor rate lowest hide low paying",
    links: [{ href: "/provider/profile#min-pay", label: "Open My minimum pay" }],
    body: () => (
      <Ul
        items={[
          "Profile → My minimum pay: full day and half day (or hourly).",
          "It filters Find shifts, alerts, offers and On Call. Clinics never see it.",
          "It compares base pay (with any premium); extra-visit pay doesn't count, and mileage only if you tick the box.",
          "Raising it never cancels shifts you've already booked.",
        ]}
      />
    ),
  },
  // ---------------- finding work ----------------
  {
    slug: "apply",
    category: "work",
    title: "Applying, offers and On Call",
    summary: "Three ways to get booked; the best match wins, not the fastest click.",
    keywords: "apply application offer invite accept on call auto book standby",
    popular: true,
    lesson: "finding-shifts",
    links: [
      { href: "/provider/shifts", label: "Find shifts" },
      { href: "/provider/oncall", label: "On Call" },
    ],
    body: (s) => (
      <KeyFacts
        rows={[
          ["Apply", "Commit to work it if chosen. The clinic picks, or we confirm the best applicant at the deadline."],
          ["Offers", "We invite the best-matched providers in rounds; accept within the time shown."],
          ["On Call", `Matching shifts are booked for you automatically. Release one without penalty within ${s["oncall.graceMinutes"]} minutes.`],
        ]}
      />
    ),
  },
  {
    slug: "light-busy",
    category: "work",
    title: "Light and Busy days, and extra-visit pay",
    summary: "The clinic says how many patients you'll see; extra visits pay you per visit.",
    keywords: "light busy patients visits volume extra pay per visit overage",
    body: (s) => (
      <P>
        A Light day expects up to {s["pricing.volumeLightVisitsFullDay"]} patients on a full day; a Busy day up to {s["pricing.volumeBusyVisitsFullDay"]}. If you see more than the day covers plus{" "}
        {s["pricing.volumeGraceVisits"]} grace visits, each extra visit pays you {money(s["pricing.volumeOverageProviderCents"])}. Enter your count after the shift so it can be paid.
      </P>
    ),
  },
  // ---------------- before / during / after ----------------
  {
    slug: "reconfirm",
    category: "shift",
    title: "Reconfirming and “On my way”",
    summary: "One tap each; missing them releases the shift and hurts your reliability.",
    keywords: "reconfirm confirm on my way check in released missed reminder",
    popular: true,
    lesson: "before-the-shift",
    body: (s) => (
      <Ul
        items={[
          `${hrs(s["reconfirm.askBeforeHours"])} before, we ask you to reconfirm. Not done by ${hrs(s["reconfirm.deadlineBeforeHours"])} before = released, counted as a late cancellation.`,
          `${hrs(s["checkin.promptBeforeHours"])} before, tap On my way when you leave; the clinic gets a text.`,
          `${s["reconfirm.missesBeforePause"]} missed reconfirmations in ${s["reconfirm.missWindowDays"]} days pause your account.`,
        ]}
      />
    ),
  },
  {
    slug: "cancel",
    category: "shift",
    title: "I can't make a shift",
    summary: "Cancel as early as you can from the shift page.",
    keywords: "cancel can't make sick emergency late cancellation drop shift",
    links: [{ href: "/provider/assignments", label: "Open My shifts" }],
    body: (s) => (
      <Ul
        items={[
          "Open the shift in My shifts and choose Cancel. The clinic is told and we look for a replacement.",
          `Within ${hrs(s["payments.providerLateCancelHours"])} of the start it's a late cancellation and lowers your reliability.`,
          "Not showing up without cancelling can lead to suspension.",
          "Booked by On Call by mistake? Use the no-penalty release on the shift page while it's offered.",
          "If a clinic changes a shift you're booked on (date, hours or details), we ask you to accept or decline. Declining, or not answering in time, releases you with no penalty.",
        ]}
      />
    ),
  },
  {
    slug: "time-clock",
    category: "shift",
    title: "Using the time clock (and fixing a missed punch)",
    summary: "Punch in, lunch, punch out; add a missed punch with a note.",
    keywords: "time clock punch in out lunch break missed forgot timesheet hours",
    popular: true,
    lesson: "on-the-shift",
    links: [{ href: "/provider", label: "Today's time clock" }],
    body: (s) => (
      <Ul
        items={[
          `Punch in from ${s["timeclock.earliestInMinutes"]} minutes before the start; Start/End lunch if you take one; Punch out when you leave.`,
          "Forgot? Add the missed punch with a short note; it's marked as hand-entered.",
          "Punching out sends your timesheet to the clinic. A manager can sign on your phone, or later by email.",
          "Punches use our server's time; location is optional and only flags punches far from the clinic.",
        ]}
      />
    ),
  },
  {
    slug: "patient-count",
    category: "shift",
    title: "Entering how many patients I saw",
    summary: "Your own patients only, a number only, within the time limit.",
    keywords: "patient count visits how many saw enter number extra visits pay",
    popular: true,
    lesson: "after-the-shift",
    body: (s) => (
      <Ul
        items={[
          "After you punch out, enter the patients you saw on the same screen (or on the shift page).",
          "Count only your own patients, not other doctors'. A number only: never names or details.",
          `You have up to ${hrs(s["pricing.volumeLateClaimHours"])} after the shift. With no count, extra visits can't be paid.`,
          `The clinic has ${hrs(s["pricing.volumeDisputeHours"])} to confirm or send theirs. A difference of ${s["pricing.countTolerance"]} or less is averaged; more goes to our team, and the lower count is paid meanwhile.`,
        ]}
      />
    ),
  },
  // ---------------- pay ----------------
  {
    slug: "when-paid",
    category: "pay",
    title: "When do I get paid?",
    summary: "Your pay is released to your bank after the shift completes and a short hold.",
    keywords: "paid payout when money bank deposit hold release",
    popular: true,
    links: [{ href: "/provider/earnings", label: "Open Earnings" }],
    body: (s) => (
      <Flow
        steps={[
          { title: "Shift ends" },
          { title: `${hrs(s["payments.autoCompleteHours"])} later it completes`, detail: "Unless a problem is reported" },
          { title: `${hrs(s["payments.payoutHoldHours"])} hold`, detail: `Clinics can raise a problem for ${hrs(s["payments.disputeWindowHours"])}` },
          { title: "Sent to your bank through Stripe", detail: "Usually arrives in 1–2 business days", tone: "green" },
        ]}
      />
    ),
  },
  {
    slug: "whats-included",
    category: "pay",
    title: "What's included in my pay",
    summary: "Shift pay and premiums, mileage, lodging and extra visits.",
    keywords: "pay breakdown mileage lodging premium weekend holiday rush extra visits bonus",
    body: (s) => (
      <KeyFacts
        rows={[
          ["Shift pay", "From the rate card, including any weekend, holiday or short-notice premium"],
          ["Mileage", <>{money(s["pricing.mileageRateCentsPerMile"], { exact: true })}/mile {s["pricing.mileageRoundTrip"] ? "round trip" : "one way"}</>],
          ["Lodging", `${money(s["pricing.lodgingNightlyCents"])} a night when the clinic allows it and your drive is over ${Math.round(s["pricing.lodgingTriggerMinutes"] / 60)} hours`],
          ["Extra visits", `${money(s["pricing.volumeOverageProviderCents"])} each past the day's limit + ${s["pricing.volumeGraceVisits"]} grace`],
          ["Referral bonus", "When a colleague you invite completes their first shift"],
        ]}
      />
    ),
  },
  {
    slug: "payout-held",
    category: "pay",
    title: "My payout is on hold or late",
    summary: "Usually an open problem report, a payout setup issue, or the normal hold.",
    keywords: "payout hold late missing not paid delayed dispute stripe",
    links: [
      { href: "/provider/earnings", label: "Open Earnings" },
      { href: "/provider/payouts", label: "Payout setup" },
    ],
    body: () => (
      <Ul
        items={[
          "Earnings shows each payment's status and why it's held.",
          "A clinic problem report holds that shift's pay until our team resolves it.",
          "If Stripe needs more information, Payout setup will say so.",
          "Still stuck? Contact support below and mention the shift date.",
        ]}
      />
    ),
  },
  {
    slug: "taxes",
    category: "pay",
    title: "Year-end earnings summary for taxes",
    summary: "Print or save a year of payouts as a PDF.",
    keywords: "tax taxes 1099 annual year end statement summary pdf",
    links: [{ href: "/provider/earnings/statement", label: "Open year-end summary" }],
    body: () => <P>Earnings → Year-end summary lists every payout by month. Use Print → Save as PDF for your accountant.</P>,
  },
  // ---------------- account ----------------
  {
    slug: "stay-active",
    category: "account",
    title: "Staying active (and coming back after a pause)",
    summary: "Show you're still taking shifts at least once a month, or your profile is paused until you tap to come back.",
    keywords: "active inactive paused pause still available reactivate break offers stopped",
    links: [{ href: "/provider", label: "Open your dashboard" }],
    body: (s) => (
      <Ul
        items={[
          "Any of these keeps you active: a completed shift, applying to a shift, accepting an offer or invitation, having an upcoming booking, or tapping \"I'm still available\". Just signing in doesn't count.",
          `If none of that happens for ${s["activity.pauseAfterDays"]} days, we pause your profile: no new offers or invitations. Bookings you already have aren't affected.`,
          `We remind you first, ${s["activity.reminderDays"].join(" and ")} days after your last activity, by email and in the app (the last reminder also by text).`,
          "To come back, tap \"I'm active again\" in the email, the text or the banner on your dashboard. You're matched to shifts again right away.",
          "Providers in states we haven't opened yet are never paused. Neither is a break you set up yourself.",
        ]}
      />
    ),
  },
  {
    slug: "ratings",
    category: "account",
    title: "Ratings and private feedback",
    summary: "Double-blind ratings after each shift; private feedback only you see.",
    keywords: "rating review stars feedback private reputation",
    links: [{ href: "/provider/feedback", label: "Open Feedback" }],
    body: (s) => (
      <Ul
        items={[
          `Rate the clinic within ${s["ratings.windowDays"]} days. Neither side sees the other's rating until both are in.`,
          "Clinics can also send private feedback that only you see; it doesn't affect your rating.",
        ]}
      />
    ),
  },
  {
    slug: "messages",
    category: "account",
    title: "Messaging a clinic",
    summary: "Messages stay on the platform; contact details and side deals are blocked.",
    keywords: "message chat contact phone email clinic blocked",
    links: [{ href: "/provider/messages", label: "Open Messages" }],
    body: () => (
      <P>
        Use Messages for anything about a shift. Phone numbers, emails, social handles and arranging work off the platform are never delivered. Everything you need to arrive (address, contact,
        front desk phone) is on the booked shift page. Never include patient information.
      </P>
    ),
  },
  {
    slug: "phone-app",
    category: "account",
    title: "Phone app, notifications and calendar",
    summary: "Install the app, turn on alerts, and add your shifts to your calendar.",
    keywords: "app iphone android install notifications push alerts calendar google apple outlook",
    links: [{ href: "/provider/notifications", label: "Notifications" }],
    body: () => (
      <Ul
        items={[
          "iPhone: open the site in Safari → Share → Add to Home Screen, then turn on notifications from the app.",
          "Android: tap Install when your browser offers it.",
          "Calendar: on My shifts, copy your private calendar link into Google, Apple or Outlook.",
        ]}
      />
    ),
  },
  {
    slug: "hire-standing",
    category: "account",
    title: "A clinic wants to hire me or book me regularly",
    summary: "Regular days go through standing bookings; hiring goes through Request to hire.",
    keywords: "hire job offer permanent standing recurring regular weekly direct",
    links: [{ href: "/provider/standing", label: "Standing bookings" }],
    body: (s) => (
      <Ul
        items={[
          "Standing booking: the clinic proposes a repeating schedule; you accept, and each day is booked at the normal rate.",
          "Hiring: the clinic uses Request to hire and we arrange it with both of you.",
          `Working directly with a clinic you met here outside those routes isn't allowed for ${s["agreements.nonCircumventionMonths"]} months after your last shift together.`,
        ]}
      />
    ),
  },
];

export const providerHelp: HelpCenter = {
  audience: "provider",
  base: "/provider/help",
  academyBase: "/provider/academy",
  categories: [
    { id: "start", title: "Getting started", description: "Verification, payouts, availability, minimum pay" },
    { id: "work", title: "Finding work", description: "Applying, offers, On Call, Light and Busy days" },
    { id: "shift", title: "Before, during and after", description: "Reconfirming, cancelling, time clock, patient counts" },
    { id: "pay", title: "Pay", description: "When you're paid, what's included, holds, taxes" },
    { id: "account", title: "Your account", description: "Ratings, messages, app, standing bookings" },
  ],
  articles: A,
};
