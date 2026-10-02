import { Alert } from "@/components/ui/misc";
import { Flow, H, KeyFacts, P, Timeline, Ul } from "@/components/academy/flow";
import { money } from "@/lib/format";
import type { Course, Lesson } from "./types";

/**
 * Provider training course. Like the clinic course, every number is read from live Settings, so
 * the lessons always match how the platform behaves today. The pre-shift and post-shift lessons
 * are the heart of it: they're the steps and requirements that decide reliability and pay.
 */

const hrs = (h: number) => (h === 1 ? "1 hour" : `${h} hours`);
const mins = (m: number) => (m === 1 ? "1 minute" : `${m} minutes`);

const welcome: Lesson = {
  slug: "welcome",
  title: "How coverage works for you",
  minutes: 3,
  summary: "Fill your open days with paid coverage shifts: how you find them, get booked and get paid.",
  body: (s, brand) => (
    <>
      <P>
        Clinics post the days they need covered. {brand} matches those shifts to licensed, verified providers nearby, shows you the pay up front, and handles booking, the day-of
        follow-through and payment. You never chase an invoice.
      </P>
      <Flow
        caption="Your side of every shift. The next lessons take each step in turn."
        steps={[
          { title: "Get verified and ready", detail: "License, malpractice, payouts, agreement, availability", tone: "brand" },
          { title: "Find shifts or get offers", detail: "Pay, mileage and lodging shown before you commit" },
          { title: "Get booked", detail: "Confirmed by the clinic, by us, or by On Call", tone: "accent" },
          { title: "Before the shift", detail: "Reconfirm, then tap “On my way”", tone: "amber" },
          { title: "On the shift", detail: "Punch in, lunch, punch out" },
          { title: "After the shift", detail: "Patient count, clinic sign-off, rating", tone: "amber" },
          { title: "Paid to your bank through Stripe", tone: "green" },
        ]}
      />
      <H>The one rule that never bends</H>
      <P>
        You can only cover a shift if you hold a <b>verified license for that profession in the clinic&apos;s state</b>, valid through the end of the shift, plus <b>verified malpractice coverage</b> at
        that state&apos;s limits. Where you live doesn&apos;t matter, and a license from another state never counts. It&apos;s checked when you apply, when you&apos;re booked and again before each
        shift.
      </P>
      <H>What we never do</H>
      <Ul
        items={[
          "Award a shift to whoever clicks first. The best-matched provider wins, so speed alone never beats a better match.",
          "Let anyone negotiate your pay down. Pay comes from our rate card and is shown before you commit.",
          "Store patient information. You never enter patient details anywhere on the platform.",
        ]}
      />
    </>
  ),
  quiz: () => [
    {
      q: "You live in Georgia and hold a Florida license. Can you cover a Florida clinic?",
      options: ["Yes, the Florida license is what counts", "No, you must live in Florida", "Only with clinic approval"],
      answer: 0,
      why: "Only a verified license in the clinic's state matters. Home address never makes you eligible or ineligible.",
    },
    {
      q: "Two providers accept the same offer. Who gets the shift?",
      options: ["Whoever accepted first", "The better-matched provider", "The one closer to the clinic, always"],
      answer: 1,
      why: "Shifts are never awarded on speed alone; the higher match score wins.",
    },
  ],
};

const ready: Lesson = {
  slug: "getting-ready",
  title: "Requirements: getting verified and ready",
  minutes: 5,
  summary: "What you need before you can see or take a shift, and how to keep it current.",
  tryIt: { href: "/provider", label: "Open your readiness checklist" },
  body: (s) => (
    <>
      <P>Your home page shows a checklist until you&apos;re coverage-ready. You can&apos;t see, apply for or be offered shifts until every item is done.</P>
      <Flow
        steps={[
          { title: "1. License", detail: "Upload it for each state and profession. We verify it with the state board.", tone: "brand" },
          { title: "2. Malpractice coverage", detail: "Your certificate, at or above the limits for the state you'll work in" },
          { title: "3. NPI", detail: "Your individual NPI number" },
          { title: "4. Payout setup", detail: "Connect your bank through Stripe, so you can be paid" },
          { title: "5. Sign the Provider Platform Agreement", detail: "Typed signature; a copy is emailed to you", tone: "accent" },
          { title: "6. Availability and drive limit", detail: "When you're free and how far you'll drive" },
          { title: "Coverage-ready: shifts appear", tone: "green" },
        ]}
      />
      <H>Keep it current</H>
      <Ul
        items={[
          <>
            We remind you before a license or policy expires ({(s["credentials.expiryReminderDays"] as number[]).join(", ")} days ahead). Upload the renewal early: a credential that expires before
            a shift ends means you can&apos;t keep that shift.
          </>,
          "Report any board action or lapse in coverage within 24 hours, as your agreement requires.",
          "When the agreement is updated you'll see a banner. Shifts you're booked on stay booked, but you can't take new ones until you sign.",
        ]}
      />
      <H>Settings that decide which shifts you see</H>
      <KeyFacts
        rows={[
          ["Availability", "Your weekly hours, plus open dates and blackout dates"],
          ["Drive limit", "The longest one-way drive you'll take (your profile)"],
          ["Overnight travel", <>Willing to stay over? You can be offered shifts up to {mins(s["pricing.lodgingMaxDriveMinutes"])} away when the clinic allows lodging</>],
          ["My minimum pay", "Shifts paying less than your minimum are hidden and never offered to you"],
          ["Skills and experience", "Clinics can require skills or a minimum number of years"],
        ]}
      />
    </>
  ),
  quiz: () => [
    {
      q: "Your malpractice policy expires the day before a shift you're booked on. What happens?",
      options: ["Nothing, you're already booked", "You can't keep the shift unless the renewal is verified in time", "The clinic decides"],
      answer: 1,
      why: "Coverage must be valid through the end of every shift. Upload renewals early so they're verified in time.",
    },
    {
      q: "You set a full-day minimum pay of $450. A Light day paying $420 is posted nearby. Will you see it?",
      options: ["Yes, at the top of the list", "No, it's below your minimum, so it's hidden and never offered", "Only by text message"],
      answer: 1,
      why: "Your minimum pay filters everything: the shift list, alerts, offers and On Call.",
    },
  ],
};

const finding: Lesson = {
  slug: "finding-shifts",
  title: "Finding shifts, offers and On Call",
  minutes: 5,
  summary: "Applying, answering offers, what Light and Busy days mean, and auto-booking with On Call.",
  tryIt: { href: "/provider/shifts", label: "Open Find shifts" },
  body: (s) => (
    <>
      <H>Three ways to get booked</H>
      <KeyFacts
        rows={[
          ["Apply", "Pick a shift on Find shifts and commit to work it if chosen. The clinic picks, or we pick the best applicant at the deadline."],
          ["Offers", "We invite the best-matched providers in rounds. Accept in the time shown; if several accept, the best match wins."],
          ["On Call", <>Set rules (days, distance, minimum pay) and matching shifts are booked for you automatically. You can release an auto-booked shift without penalty within {mins(s["oncall.graceMinutes"])}.</>],
        ]}
      />
      <Alert tone="warning" title="Applying is a commitment">
        Only apply or accept if you will work the shift. Backing out later is a late cancellation if it&apos;s within {hrs(s["payments.providerLateCancelHours"])} of the start, and it counts against your
        reliability.
      </Alert>
      <H>Reading a shift</H>
      <Ul
        items={[
          "Pay shows your shift pay plus mileage (and lodging if you'd need to stay over). Weekend, holiday and short-notice premiums are already included.",
          <>
            <b>Light day / Busy day</b>: how many patients the clinic expects <i>you</i> to see. If you see more than the day covers (plus {s["pricing.volumeGraceVisits"]} grace visits), each extra
            visit pays you {money(s["pricing.volumeOverageProviderCents"])} on top.
          </>,
          "Required skills and minimum experience are set by the clinic. You only see shifts you qualify for.",
          "The exact address, arrival notes and on-site contact appear once you're booked.",
        ]}
      />
      <H>Rank, not speed</H>
      <P>
        Your match score uses drive time, skills, experience, ratings, reliability and whether the clinic has worked with you before. Being reliable (reconfirming, checking in, finishing your
        paperwork) is the surest way to be offered more.
      </P>
    </>
  ),
  quiz: (s) => [
    {
      q: "On Call booked you for a shift you can't do. What should you do?",
      options: [`Release it within ${mins(s["oncall.graceMinutes"])} for no penalty`, "Just don't show up", "Message the clinic for their phone number"],
      answer: 0,
      why: "Auto-booked shifts have a no-penalty release window. After it, it's like any other booked shift.",
    },
    {
      q: "A Busy day covers 30 patients plus grace. You see more than that. What happens?",
      options: ["Nothing extra", "Each extra visit is paid on top of your shift pay", "The clinic decides whether to pay you"],
      answer: 1,
      why: "Extra visits beyond the day's limit and grace are paid per visit once the count settles.",
    },
  ],
};

const before: Lesson = {
  slug: "before-the-shift",
  title: "Before the shift: steps and requirements",
  minutes: 5,
  summary: "Reconfirming, “On my way”, what to prepare and the deadlines that protect your reliability.",
  tryIt: { href: "/provider/assignments", label: "Open My shifts" },
  body: (s) => (
    <>
      <Alert tone="info" title="The short version">
        Reconfirm when we ask, tap <b>On my way</b> when you leave, and read the arrival notes the night before. Those three steps keep your booking safe and your reliability high.
      </Alert>
      <Timeline
        caption={`Reconfirmation is skipped for shifts booked within ${hrs(s["reconfirm.skipIfBookedWithinHours"])} of the start; you just committed.`}
        items={[
          { when: "When you're booked", what: "Confirmation email + calendar entry", detail: "The exact address, arrival notes, parking, dress code and on-site contact unlock on the shift page.", tone: "brand" },
          { when: `${hrs(s["reconfirm.askBeforeHours"])} before`, what: "We ask you to reconfirm: one tap", detail: `A reminder follows ${hrs(s["reconfirm.reminderAfterHours"])} later if needed.` },
          {
            when: `${hrs(s["reconfirm.deadlineBeforeHours"])} before`,
            what: "Deadline: not reconfirmed = released",
            detail: "The shift goes to another provider and it counts as a late cancellation by you.",
            tone: "red",
          },
          { when: "The night before", what: "Read the arrival notes, plan the drive, charge your phone", detail: "Message the clinic through the platform if anything's unclear." },
          { when: `${hrs(s["checkin.promptBeforeHours"])} before`, what: "Tap “On my way” when you leave", detail: "The clinic is told you're coming (and gets a text).", tone: "accent" },
          { when: `${mins(s["checkin.alertBeforeMinutes"])} before`, what: "No “On my way” yet? The clinic and our team are alerted", tone: "amber" },
          { when: "Arrival", what: "Punch in on the time clock", detail: `You can punch in from ${mins(s["timeclock.earliestInMinutes"])} before the start.`, tone: "green" },
        ]}
      />
      <H>Requirements for every shift</H>
      <Ul
        items={[
          "Your license and malpractice must be valid through the end of the shift.",
          "Arrive on time, dressed as the clinic's notes say, with anything they ask you to bring.",
          "Work within your scope and the state's rules, and follow the clinic's reasonable site policies and protocols.",
          "Keep everything on the platform: no phone numbers, emails or side deals in messages. Contact details are shared through the shift page.",
          "Never enter patient names or details anywhere on the platform.",
        ]}
      />
      <H>Can&apos;t make it?</H>
      <P>
        Cancel from the shift page as early as you can. Within {hrs(s["payments.providerLateCancelHours"])} of the start it&apos;s a <b>late cancellation</b>; within{" "}
        {hrs(s["emergency.triggerWithinHours"])} we launch emergency cover for the clinic. Late cancellations lower your reliability; {s["reconfirm.missesBeforePause"]} missed reconfirmations in{" "}
        {s["reconfirm.missWindowDays"]} days pause your account, and a no-show can lead to suspension.
      </P>
    </>
  ),
  quiz: (s) => [
    {
      q: `You haven't reconfirmed ${hrs(s["reconfirm.deadlineBeforeHours"])} before your shift. What happens?`,
      options: ["Nothing, you're still booked", "You're released, the shift goes to someone else, and it counts against you", "The clinic calls you"],
      answer: 1,
      why: "Reconfirmation protects clinics from no-shows. Missing the deadline releases the shift and counts as a late cancellation.",
    },
    {
      q: "When should you tap “On my way”?",
      options: ["When you leave for the clinic", "After the shift", "Only if you're running late"],
      answer: 0,
      why: "It tells the clinic you're coming. Without it, they and our team are alerted shortly before the start.",
    },
    {
      q: "Where do you find the parking and arrival notes?",
      options: ["In the shift listing before you apply", "On the shift page once you're booked", "You have to call the clinic"],
      answer: 1,
      why: "Arrival details unlock only for the booked provider.",
    },
  ],
};

const during: Lesson = {
  slug: "on-the-shift",
  title: "On the shift: the time clock",
  minutes: 3,
  summary: "Punch in, lunch, punch out, fixing a missed punch, and on-site sign-off.",
  tryIt: { href: "/provider", label: "See today's time clock" },
  body: (s) => (
    <>
      <Flow
        steps={[
          { title: "Punch in when you arrive", detail: `From ${mins(s["timeclock.earliestInMinutes"])} before the start. More than ${mins(s["timeclock.lateGraceMinutes"])} late is flagged.`, tone: "brand" },
          { title: "Start lunch / End lunch", detail: "Optional, but record it if you take one" },
          { title: "Punch out when you leave", detail: "This sends your timesheet to the clinic to sign off", tone: "accent" },
        ]}
      />
      <Ul
        items={[
          "Punches use our server's time, not your phone's. Sharing your location is optional; it only flags a punch made far from the clinic.",
          "Forgot to punch? Add the missed punch by hand with a short note. It's marked as hand-entered for the clinic.",
          s["timeclock.allowOnsiteSignature"]
            ? "The clinic's manager can sign your timesheet on your phone before you leave, or sign off later by email or in their portal."
            : "The clinic signs off your timesheet by email or in their portal.",
          `If you never punch out, we close the day at the scheduled end and flag it, so punch out before you go.`,
        ]}
      />
      <Alert tone="info" title="Punches don't change your pay">
        Your pay comes from the rate card. The timesheet is the clinic&apos;s record of the day; if something&apos;s wrong, it goes to a review instead of a deduction.
      </Alert>
    </>
  ),
  quiz: () => [
    {
      q: "You forgot to punch in this morning. What do you do?",
      options: ["Nothing", "Add the missed punch with a short note", "Text the clinic owner"],
      answer: 1,
      why: "Add it by hand with a note; it's marked as hand-entered so the clinic can see why.",
    },
    {
      q: "What happens when you punch out?",
      options: ["Your timesheet goes to the clinic to sign off", "You're paid immediately", "Nothing until the next day"],
      answer: 0,
      why: "Punching out submits the day's timesheet for the clinic's sign-off.",
    },
  ],
};

const after: Lesson = {
  slug: "after-the-shift",
  title: "After the shift: steps and requirements",
  minutes: 5,
  summary: "Patient count, clinic sign-off, completion, ratings and when the money lands.",
  tryIt: { href: "/provider/assignments", label: "Open My shifts" },
  body: (s) => (
    <>
      <Alert tone="info" title="The short version">
        Punch out, enter how many patients <b>you</b> saw, and rate the clinic. That&apos;s it: we handle sign-off, billing and your payout.
      </Alert>
      <Timeline
        items={[
          { when: "When you leave", what: "Punch out", detail: "Your timesheet goes to the clinic for sign-off.", tone: "brand" },
          {
            when: "Right after (same screen)",
            what: "Enter the patients you saw",
            detail: `A number only: your own patients, never names or details. You have up to ${hrs(s["pricing.volumeLateClaimHours"])} after the shift; with no count, extra visits can't be paid.`,
            tone: "accent",
          },
          {
            when: `${hrs(s["pricing.volumeDisputeHours"])} for the clinic`,
            what: "The clinic confirms your count or sends theirs",
            detail: "A small difference is split down the middle; a big one is reviewed by our team, and the lower count is paid meanwhile.",
          },
          { when: `${hrs(s["payments.autoCompleteHours"])} after the end`, what: "The shift completes automatically", detail: "Unless a problem has been reported." },
          {
            when: `${hrs(s["payments.payoutHoldHours"])} after completion`,
            what: "Your pay is released to your bank",
            detail: "Shift pay, mileage, lodging and any extra visits, through Stripe.",
            tone: "green",
          },
          { when: `Within ${s["ratings.windowDays"]} days`, what: "Rate the clinic", detail: "Double-blind: neither of you sees the other's rating until both are in." },
        ]}
      />
      <H>Requirements after every shift</H>
      <Ul
        items={[
          "Punch out (or add the missed punch) the same day.",
          "Enter your patient count honestly: it's checked against the clinic's records.",
          `Answer the clinic's messages about the day. Clinics can open a dispute for ${hrs(s["payments.disputeWindowHours"])} after the shift; pay for that shift waits until it's resolved.`,
          "Keep your payout account (Stripe) in good standing so transfers go through.",
        ]}
      />
      <H>What you&apos;re paid</H>
      <KeyFacts
        rows={[
          ["Shift pay", "From the rate card, with any weekend, holiday or short-notice premium"],
          ["Mileage", <>{money(s["pricing.mileageRateCentsPerMile"], { exact: true })}/mile {s["pricing.mileageRoundTrip"] ? "round trip" : "one way"}</>],
          ["Lodging", <>{money(s["pricing.lodgingNightlyCents"])} a night when your drive is over {mins(s["pricing.lodgingTriggerMinutes"])} and the clinic allows lodging. No receipts.</>],
          ["Extra patients", <>{money(s["pricing.volumeOverageProviderCents"])} per visit past the day&apos;s limit + {s["pricing.volumeGraceVisits"]} grace</>],
        ]}
      />
      <P>Earnings shows every payment and its status, and a year-end summary you can print for taxes.</P>
    </>
  ),
  quiz: (s) => [
    {
      q: "Another doctor at the clinic also saw patients that day. What count do you enter?",
      options: ["The clinic's total", "Only the patients you saw yourself", "Leave it blank"],
      answer: 1,
      why: "The count is always your own patients. Other doctors' patients don't count toward your day.",
    },
    {
      q: "When is your pay released?",
      options: ["The moment you punch out", `${hrs(s["payments.payoutHoldHours"])} after the shift completes`, "At the end of the month"],
      answer: 1,
      why: `Shifts complete ${hrs(s["payments.autoCompleteHours"])} after the end; pay is released after the hold, unless a dispute is open.`,
    },
    {
      q: "What may you write in the patient count?",
      options: ["A number only", "Patient initials", "Patient names so the clinic can check"],
      answer: 0,
      why: "No patient information is ever stored. Enter a number only.",
    },
  ],
};

const reputation: Lesson = {
  slug: "reliability",
  title: "Reliability, ratings and more work",
  minutes: 3,
  summary: "What raises your match score, favorites, standing bookings and referrals.",
  body: (s) => (
    <>
      <H>What raises your ranking</H>
      <Ul
        items={[
          "Reconfirming on time and tapping “On my way”.",
          "Finishing your paperwork: punch out, patient count, rating.",
          "Good ratings, and returning to clinics that liked working with you.",
          "Few late cancellations and no no-shows.",
        ]}
      />
      <H>Favorites and standing bookings</H>
      <P>
        Clinics can favorite you; favorites get first look at their planned shifts for {hrs(s["matching.favoritesWindowHours"])}. A clinic can also propose a <b>standing booking</b> (say every
        other Friday). Each day is booked through the platform at the normal rate, and either side can end it with notice.
      </P>
      <H>Working directly with a clinic</H>
      <P>
        If a clinic wants to hire you, they use <b>Request to hire</b> and we arrange it. Outside that, your agreement doesn&apos;t allow working directly with a clinic you met here for{" "}
        {s["agreements.nonCircumventionMonths"]} months after your last shift together.
      </P>
      <H>Refer and earn</H>
      <P>Share your referral link from Refer &amp; earn. When a colleague you invite completes their first shift, you both get a bonus.</P>
    </>
  ),
  quiz: () => [
    {
      q: "A clinic you covered wants you on staff. What's the right way?",
      options: ["Swap numbers and agree privately", "They use Request to hire and we arrange it", "Post it in shift notes"],
      answer: 1,
      why: "Request to hire is the approved route; it protects you both under the agreement.",
    },
  ],
};

export const providerCourse: Course = {
  audience: "provider",
  title: "Provider training",
  intro: "Everything you need to take coverage shifts with confidence, in about 30 minutes. The before- and after-shift lessons are the ones that protect your bookings and your pay.",
  base: "/provider/academy",
  lessons: [welcome, ready, finding, before, during, after, reputation],
};
