import { Alert } from "@/components/ui/misc";
import { Flow, H, KeyFacts, P, Timeline, Ul } from "@/components/academy/flow";
import { money } from "@/lib/format";
import type { Course, Lesson } from "./types";

/**
 * Clinic training course. Every number below is read from live Settings, so
 * changing a setting in admin updates the training the same moment.
 */

const hrs = (h: number) => (h === 1 ? "1 hour" : `${h} hours`);
const mins = (m: number) => (m === 1 ? "1 minute" : `${m} minutes`);
/** "a 2-hour head start" */
const hrAdj = (h: number) => `${h}-hour`;

const welcome: Lesson = {
  slug: "welcome",
  title: "What we do for your clinic",
  minutes: 3,
  summary: "The marketplace in one picture: who we are, what we check, and what you never have to do again.",
  body: (_s, brand) => (
    <>
      <P>
        When your doctor is out (vacation, CE, illness, a family emergency), the practice still has patients on the schedule. {brand} connects your clinic with licensed providers who
        have open days, checks their credentials for you, and handles booking, payment and the day-of follow-through in one place.
      </P>
      <H>What we do so you don&apos;t have to</H>
      <Ul
        items={[
          <>
            <b>Verify every provider</b>: state license, malpractice coverage and NPI, checked by us before a provider can see a single shift, and re-checked before every shift.
          </>,
          <>
            <b>Set the price</b>: no negotiating. Your rate comes from our regional rate card and is shown before you post.
          </>,
          <>
            <b>Find the best match</b>: drive time, skills, reliability, ratings, and whether they&apos;ve worked with you before.
          </>,
          <>
            <b>Follow through</b>: providers reconfirm before the day and check in on the morning of. If anything goes wrong, we start finding a replacement right away.
          </>,
          <>
            <b>Handle the money</b>: a small deposit when you confirm, the balance after the shift. Providers are paid by us, so you never cut a separate check.
          </>,
        ]}
      />
      <Flow
        caption="The whole journey. Each step has its own lesson."
        steps={[
          { title: "Set up your clinic", detail: "Location, payment method, agreement, team", tone: "brand" },
          { title: "Post a shift", detail: "Date, hours, skills; price shown up front" },
          { title: "We match and reach out", detail: "Applicants and recommended providers, ranked for you" },
          { title: "You pick, or let us pick", detail: "Deposit charged at confirmation", tone: "accent" },
          { title: "Reconfirm and day-of check-in", detail: "We chase it, not you" },
          { title: "Shift done: balance charged, both sides rate", tone: "green" },
        ]}
      />
      <H>The one rule that never bends</H>
      <P>
        A provider can only cover your clinic if they hold a <b>verified license in your clinic&apos;s state</b>, valid through the end of the shift, plus verified malpractice coverage. Living
        nearby doesn&apos;t count, and neither does a license from another state. This is checked at every step, including inside the database itself.
      </P>
    </>
  ),
  quiz: () => [
    {
      q: "Who sets the price of a coverage shift?",
      options: ["You and the provider negotiate it", "The provider sets a day rate", "Our regional rate card, shown before you post"],
      answer: 2,
      why: "Prices come only from the rate card for your clinic's region. Nobody negotiates, and you see the total before posting.",
    },
    {
      q: "A provider lives 10 minutes from your Florida clinic but is licensed only in Georgia. Can they cover for you?",
      options: ["Yes, they're close by", "No, they need a verified Florida license", "Yes, if you approve it"],
      answer: 1,
      why: "Only a verified license in your clinic's state counts. Distance and home address never make someone eligible.",
    },
  ],
};

const setup: Lesson = {
  slug: "setup",
  title: "Setting up your clinic account",
  minutes: 4,
  summary: "The four things you need before your first post, and how owner and staff logins differ.",
  tryIt: { href: "/clinic", label: "Open your setup checklist" },
  body: () => (
    <>
      <P>Your home page shows a setup checklist until these are done. You can save draft shifts at any time, but you can&apos;t post one until all four are complete.</P>
      <Flow
        steps={[
          { title: "1. Confirm your email", detail: "Click the link we sent. Check spam if you don't see it." },
          { title: "2. Add a location", detail: "Your address sets the state, and that decides which licenses qualify." },
          { title: "3. Add a payment method", detail: "Card or bank account, saved securely with Stripe" },
          { title: "4. Sign the Clinic Platform Agreement", detail: "Typed signature; a copy is emailed to you", tone: "accent" },
          { title: "Ready to post", tone: "green" },
        ]}
      />
      <H>Locations</H>
      <Ul
        items={[
          "One clinic account can have many locations, even in different states. Each location is matched only with providers licensed in its state.",
          "Fill in the on-site contact, front-desk phone, parking and arrival notes. Providers see these only after they're booked with you.",
          "Patients per day and the equipment and techniques you use help providers know what to expect. They don't change the price.",
        ]}
      />
      <H>Owner and staff logins</H>
      <P>
        The person who creates the account is the <b>owner</b>. Under Team, the owner can invite staff (an office manager, front desk lead, associate doctor). Staff can post shifts, choose
        providers, send messages and leave ratings. Only the owner can change billing.
      </P>
      <H>Your clinic settings</H>
      <Ul
        items={[
          "Default minimum experience: new shifts start with this (0, 2, 5 or 10 years), and you can change it on any shift.",
          "Relax experience in an emergency: when a provider cancels at the last minute, this lets us also offer the shift to newer providers so you're covered.",
        ]}
      />
      <Alert tone="info" title="If the agreement changes">
        When we update the Clinic Platform Agreement, you&apos;ll see a banner asking you to sign the new version. Shifts already booked stay booked, but you can&apos;t post new ones until it&apos;s
        signed.
      </Alert>
    </>
  ),
  quiz: () => [
    {
      q: "What decides which providers can be matched to a location?",
      options: ["The provider's home city", "The state of the location's address", "The clinic owner's license"],
      answer: 1,
      why: "The location's verified address sets its state, and only providers with a verified license in that state qualify.",
    },
    {
      q: "What can a staff login NOT do?",
      options: ["Post a shift", "Choose a provider", "Change billing"],
      answer: 2,
      why: "Staff can do the day-to-day work. Billing changes are owner-only.",
    },
  ],
};

const posting: Lesson = {
  slug: "posting",
  title: "Posting a shift",
  minutes: 5,
  summary: "A walk through the posting screen: skills, experience, travel, instant book, multi-day bookings.",
  tryIt: { href: "/clinic/shifts/new", label: "Open the posting screen" },
  body: (s) => (
    <>
      <P>Posting takes about a minute. The total price is shown before you post.</P>
      <Flow
        steps={[
          { title: "Which location?" },
          { title: "What kind of coverage?", detail: "The profession you need covered" },
          { title: "When?", detail: "Date, start and end time. Add more days for a multi-day booking." },
          { title: "Details", detail: "Skills, expected patients, minimum experience, travel budget, notes" },
          { title: "Review and post", detail: "Price, travel estimate, promo code", tone: "accent" },
        ]}
      />
      <H>Choosing skills</H>
      <P>
        Tap a skill once to make it <b>preferred</b> (providers with it rank higher). Tap again to make it <b>required</b> (only providers with it are matched). Every required skill shrinks the
        pool, so require only what the day truly needs.
      </P>
      <H>Other options</H>
      <Ul
        items={[
          <>
            <b>Minimum experience</b>: uses the years of practice providers enter, which can&apos;t be more than the years since they graduated. Higher minimums can mean a longer wait.
          </>,
          <>
            <b>Travel budget</b>: the most you&apos;re willing to pay in mileage. Providers whose mileage would cost more aren&apos;t matched.
          </>,
          <>
            <b>Allow lodging</b> (on by default): lets us offer the shift to providers who&apos;ll stay overnight, from up to {mins(s["pricing.lodgingMaxDriveMinutes"])} away. If your provider&apos;s one-way drive is over {mins(s["pricing.lodgingTriggerMinutes"])},
            a flat ${(s["pricing.lodgingNightlyCents"] / 100).toFixed(0)} a night is added (no receipts); nearby providers cost nothing extra.
          </>,
          <>
            <b>Instant book</b>: the first applicant who is a strong match is confirmed automatically, so you don&apos;t have to choose. Leave it off to review applicants yourself.
          </>,
          <>
            <b>Notes for providers</b>: practice style, a typical day, the techniques you use. Never include phone numbers, emails, or anything about a patient.
          </>,
        ]}
      />
      <H>Multi-day bookings</H>
      <P>
        Add more days on the same screen. Each day is its own shift. A provider can take all of them (you can confirm them for every day in one click), and if someone can&apos;t make one day,
        we find cover for just that day. You can cancel a single day or all remaining days.
      </P>
      <H>Promo codes</H>
      <P>If you have a promo code, enter it on the review step. The discount is shown on the price before you post.</P>
    </>
  ),
  quiz: () => [
    {
      q: "You tap a skill twice. What does that mean?",
      options: ["Preferred: providers with it rank higher", "Required: only providers with it are matched", "It's cleared"],
      answer: 1,
      why: "Once = preferred, twice = required, three times = cleared.",
    },
    {
      q: "What does Instant book do?",
      options: ["Confirms the first strong-match applicant automatically", "Books your favorite provider without asking", "Skips the deposit"],
      answer: 0,
      why: "With Instant book on, the first applicant who is a strong match is confirmed right away and the deposit is charged.",
    },
    {
      q: "What should never go in the notes for providers?",
      options: ["The techniques you use", "Anything about a patient, or phone numbers and emails", "What a typical day looks like"],
      answer: 1,
      why: "No patient information is allowed anywhere on the platform, and contact details are shared through the platform only after booking.",
    },
  ],
};

const matching: Lesson = {
  slug: "matching",
  title: "How we find your provider",
  minutes: 6,
  summary: "Favorites first, applicants and recommendations, the selection deadline, and why the best match wins instead of the fastest reply.",
  body: (s) => {
    const tiers = s["matching.deadlineTiers"];
    const week = tiers.find((t) => t.minLeadHours >= 168);
    const near = tiers.find((t) => t.minLeadHours >= 48 && t.minLeadHours < 168);
    return (
      <>
        <P>What happens after you post depends on how far away the shift is.</P>
        <Flow
          steps={[
            { title: "You post the shift", tone: "brand" },
            {
              title: "How soon does it start?",
              branches: [
                {
                  label: "48 hours or more",
                  title: "Planned",
                  detail: `Your favorites get a ${hrAdj(s["matching.favoritesWindowHours"])} head start, then matching providers are notified and can apply. You choose by the deadline.`,
                },
                {
                  label: "Under 48 hours",
                  title: "Urgent",
                  detail: "We start offering the shift to the best-matched providers right away, in small waves. Applications stay open at the same time.",
                  tone: "amber",
                },
              ],
            },
            { title: "Applicants and Recommended appear on the shift page", detail: "Each card shows rating, reliability, drive time, skills, and badges like Favorite or Worked here before" },
            {
              title: "You decide",
              branches: [
                { label: "Pick an applicant", title: "Confirmed immediately", tone: "green" },
                { label: "Invite up to 3 recommended", title: "If several accept, the best match gets it", tone: "accent" },
              ],
            },
            {
              title: "No pick by the deadline?",
              detail: "If a strong applicant applied, we confirm them for you. Otherwise we start Smart Dispatch: offers in ranked waves, then to all remaining eligible providers.",
            },
            { title: "Still nobody?", detail: `You can boost the rate by ${s["pricing.boostPercent"]}% and search a wider area, or stop searching. If it's never filled, you're never charged.`, tone: "amber" },
          ]}
        />
        <H>Your selection deadline</H>
        <KeyFacts
          rows={[
            ...(week ? ([["Shift 7+ days away", `Choose within ${hrs(week.selectionWindowHours)} of posting`]] as [string, string][]) : []),
            ...(near ? ([["Shift 2–7 days away", `Choose within ${hrs(near.selectionWindowHours)} of posting`]] as [string, string][]) : []),
            ["Shift under 48 hours away", "We start reaching out immediately"],
          ]}
        />
        <H>Best match wins, not the fastest reply</H>
        <P>
          Many coverage services text everyone and give the shift to whoever answers first. We don&apos;t. When several providers accept, the one who best fits your shift gets it, not whoever
          happened to be looking at their phone. Providers who accept but aren&apos;t chosen stay on standby, first in line if your provider later cancels.
        </P>
        <H>Need someone fast?</H>
        <P>
          On any open shift, <b>Find someone now</b> skips the rest of the waiting period and starts offering the shift right away. A live tracker shows how many providers have been asked, how
          many accepted, and when the next step happens. You can still pick an applicant at any time.
        </P>
      </>
    );
  },
  quiz: (s) => [
    {
      q: "Three invited providers accept within minutes of each other. Who gets the shift?",
      options: ["Whoever accepted first", "The best match of the three", "You must choose again"],
      answer: 1,
      why: "Awards are rank-protected: the best-matched provider who accepts wins. The others go on standby.",
    },
    {
      q: `A shift is 10 days away. Who sees it first?`,
      options: ["Everyone at once", `Your eligible favorites, for ${hrs(s["matching.favoritesWindowHours"])}`, "Only providers who have worked at your clinic"],
      answer: 1,
      why: "For shifts 48 hours or more away, your eligible favorites get a head start before it opens to everyone.",
    },
    {
      q: "If a shift is never filled, what do you pay?",
      options: ["The deposit", "Nothing", "A posting fee"],
      answer: 1,
      why: "You're charged only when a provider is confirmed. Unfilled shifts cost nothing.",
    },
  ],
};

const money_: Lesson = {
  slug: "pricing-payments",
  title: "Pricing and payments",
  minutes: 5,
  summary: "How the price is built, when you're charged, and what travel costs.",
  tryIt: { href: "/clinic/billing", label: "Open Billing" },
  body: (s) => (
    <>
      <H>How the price is built</H>
      <Ul
        items={[
          "Your base price comes from the rate card for your clinic's region (set by ZIP code) and the shift length: half day (under 4 hours), full day (4–8 hours).",
          `Hours beyond 8 are billed at ${money(s["pricing.overtimeClinicCentsPerHour"])} per hour.`,
          `Premiums apply automatically: weekend +${s["pricing.premiumWeekendPercent"]}%, federal holiday +${s["pricing.premiumHolidayPercent"]}%, posted under 48 hours before the start +${s["pricing.premiumUrgentPercent"]}%${s["pricing.premiumRushPercent"] > 0 ? `, or +${s["pricing.premiumRushPercent"]}% instead when posted under ${s["pricing.rushWithinHours"]} hours before (rush)` : ""}. Premiums raise your provider's pay by the same percent, which is what gets short-notice shifts filled.`,
          <>
            <b>Travel is passed straight through to your provider</b>: mileage at {money(s["pricing.mileageRateCentsPerMile"], { exact: true })} per mile{" "}
            {s["pricing.mileageRoundTrip"] ? "round-trip" : "one-way"}, plus lodging only if you allowed it. We keep nothing from travel.
          </>,
          "Because mileage depends on who's chosen, you see an estimated travel range when posting. The exact amount is locked in when a provider is confirmed.",
        ]}
      />
      <H>When you&apos;re charged</H>
      <Flow
        steps={[
          { title: "Provider confirmed", detail: `Deposit of ${s["payments.depositPercent"]}% of the total is charged`, tone: "brand" },
          { title: "Shift ends" },
          { title: `${hrs(s["payments.autoCompleteHours"])} later, the shift auto-completes`, detail: "Unless you've reported a problem" },
          { title: "Balance charged", detail: "Including final mileage and any lodging", tone: "green" },
          { title: "Lodging, if any", detail: `A flat $${(s["pricing.lodgingNightlyCents"] / 100).toFixed(0)} a night, included in the booking total` },
        ]}
      />
      <KeyFacts
        rows={[
          ["Deposit at confirmation", `${s["payments.depositPercent"]}%`],
          ["Failed deposit: time to fix your payment method", `${hrs(s["payments.paymentFixWindowHours"])} (${hrs(s["payments.paymentFixWindowUrgentHours"])} for urgent shifts)`],
          ["Report a problem with a shift", `Within ${hrs(s["payments.disputeWindowHours"])} after it ends`],
        ]}
      />
      <H>If something wasn&apos;t right</H>
      <P>
        On the shift page, <b>Report a problem</b> is available for {hrs(s["payments.disputeWindowHours"])} after the shift. It holds the provider&apos;s payment until we review it with both sides.
      </P>
      <Alert tone="info" title="Card and bank details">
        Payments run through Stripe. We never see or store your full card or bank numbers, and you never pay a provider directly.
      </Alert>
    </>
  ),
  quiz: (s) => [
    {
      q: "When is the deposit charged?",
      options: ["When you post", "When a provider is confirmed", "After the shift"],
      answer: 1,
      why: `The ${s["payments.depositPercent"]}% deposit is charged only when a provider is confirmed.`,
    },
    {
      q: "Who keeps the mileage you pay?",
      options: ["Split between platform and provider", "The provider, 100%", "The platform"],
      answer: 1,
      why: "Mileage and lodging pass straight through to the provider. We keep nothing from travel.",
    },
  ],
};

const dayOf: Lesson = {
  slug: "before-the-day",
  title: "Before and on the day",
  minutes: 4,
  summary: "Reconfirmation, the “On my way” check-in, and what you'll see as the shift approaches.",
  body: (s) => (
    <>
      <P>
        The most common worry about coverage is &ldquo;will they actually show up?&rdquo; We follow up with the provider so you don&apos;t have to.
      </P>
      <Timeline
        caption={`Reconfirmation is skipped for shifts booked within ${hrs(s["reconfirm.skipIfBookedWithinHours"])} of the start; the provider just committed.`}
        items={[
          { when: "At confirmation", what: "You both get confirmation emails", detail: "The provider now sees your arrival notes, on-site contact and front-desk phone." },
          { when: `${hrs(s["reconfirm.askBeforeHours"])} before`, what: "We ask the provider to reconfirm", detail: `One tap. We remind them ${hrs(s["reconfirm.reminderAfterHours"])} later if needed.` },
          {
            when: `${hrs(s["reconfirm.deadlineBeforeHours"])} before`,
            what: "Not reconfirmed? We release them and find a replacement",
            detail: "You're told right away, and the shift goes back out as urgent.",
            tone: "amber",
          },
          { when: `${hrs(s["checkin.promptBeforeHours"])} before`, what: "We ask the provider to tap “On my way”", tone: "accent" },
          {
            when: `${mins(s["checkin.alertBeforeMinutes"])} before`,
            what: "No “On my way” yet? You and our team are alerted",
            tone: "amber",
          },
          { when: "Shift start", what: "Tap “Provider arrived” on the shift page", detail: "Or “My provider didn't show” (see the next lesson).", tone: "green" },
        ]}
      />
      <H>Helping your provider have a great day</H>
      <Ul
        items={[
          "Keep your location's arrival notes current: parking, which door, who to ask for.",
          "Use Messages for anything specific to the day. The thread stays with the booking.",
          "Tell your front desk who's coming. The provider's name is on the shift page.",
        ]}
      />
      <P>
        Providers who miss reconfirmations {s["reconfirm.missesBeforePause"]} times in {s["reconfirm.missWindowDays"]} days are paused from new work. Reliability is part of every provider&apos;s
        match score.
      </P>
    </>
  ),
  quiz: (s) => [
    {
      q: `Your provider hasn't reconfirmed ${hrs(s["reconfirm.deadlineBeforeHours"])} before the shift. What happens?`,
      options: ["Nothing, they're still booked", "We release them, tell you, and start finding a replacement", "You must call them"],
      answer: 1,
      why: "Unconfirmed at the deadline means released. The shift goes out again as urgent, and you're kept informed.",
    },
    {
      q: "When does the provider see your on-site contact and arrival notes?",
      options: ["When they apply", "Once they're confirmed for your shift", "Never"],
      answer: 1,
      why: "Arrival details are shared only with the provider booked at your location.",
    },
  ],
};

const cancellations: Lesson = {
  slug: "cancellations",
  title: "Cancellations and emergency cover",
  minutes: 5,
  summary: "What a cancellation costs each side, and how we replace a provider who cancels late or doesn't show.",
  body: (s) => (
    <>
      <H>If you cancel</H>
      <KeyFacts
        rows={[
          [`${hrs(s["payments.clinicFreeCancelHours"])} or more before the start`, "Deposit refunded in full"],
          [`Less than ${hrs(s["payments.clinicFreeCancelHours"])} before`, "Deposit kept; part of it goes to the provider for the lost day"],
        ]}
      />
      <H>If your provider cancels</H>
      <P>
        You get a full refund of anything paid for that provider, and we start finding a replacement straight away. You don&apos;t need to do anything.
      </P>
      <Flow
        steps={[
          { title: "Provider cancels, isn't reconfirmed, or doesn't show", tone: "red" },
          {
            title: "How close to the start?",
            branches: [
              { label: "More than " + hrs(s["emergency.triggerWithinHours"]), title: "Standard backfill", detail: "Standby providers first, then ranked offers" },
              {
                label: `Within ${hrs(s["emergency.triggerWithinHours"])}`,
                title: "Emergency cover",
                detail: `Offered to everyone eligible at once, from up to ${s["emergency.driveMultiplier"]}× their usual drive, with a rescue bonus`,
                tone: "amber",
              },
            ],
          },
          { title: "You get “We've had a cancellation”, then “We've found your replacement”", tone: "green" },
        ]}
      />
      <Alert tone="success" title="The rescue bonus comes out of our margin, not your price">
        To fill last-minute gaps we add a bonus to the provider&apos;s pay ({s["emergency.bonusStepsPercent"].join("% → ")}%, rising every {mins(s["emergency.stepMinutes"])} until someone
        accepts). Your price for the shift doesn&apos;t change.
      </Alert>
      <H>If your provider doesn&apos;t show</H>
      <P>
        From 15 minutes before the start, the shift page shows <b>My provider didn&apos;t show</b>. Tap it and:
      </P>
      <Ul
        items={[
          "You aren't charged for that provider.",
          `We post a replacement for the rest of the day, starting about ${mins(s["emergency.replacementLeadMinutes"])} from when you report it, priced only for the hours that remain.`,
          `If less than ${mins(s["emergency.minRemainingMinutes"])} of the shift would be left, we don't send a replacement.`,
        ]}
      />
    </>
  ),
  quiz: (s) => [
    {
      q: `You cancel ${hrs(Math.max(1, s["payments.clinicFreeCancelHours"] * 2))} before the shift. What happens to your deposit?`,
      options: ["Refunded in full", "Kept by the platform", "Half refunded"],
      answer: 0,
      why: `Cancelling ${hrs(s["payments.clinicFreeCancelHours"])} or more before the start is free.`,
    },
    {
      q: "Your provider cancels the night before. Does your price go up to cover the rescue bonus?",
      options: ["Yes, by the bonus amount", "No, the bonus comes from our margin", "Only on weekends"],
      answer: 1,
      why: "Rescue bonuses are paid from the platform's margin. Your price stays the same.",
    },
    {
      q: "Your provider doesn't show. What do you pay for them?",
      options: ["The full shift", "The deposit only", "Nothing"],
      answer: 2,
      why: "A no-show provider costs you nothing, and we send a replacement for the rest of the day when there's enough time left.",
    },
  ],
};

const messaging: Lesson = {
  slug: "messaging-privacy",
  title: "Messaging, privacy and patient information",
  minutes: 3,
  summary: "What you can share, what's blocked, and why.",
  tryIt: { href: "/clinic/messages", label: "Open Messages" },
  body: (_s, brand) => (
    <>
      <H>No patient information, ever</H>
      <P>
        {brand} never collects patient names, records, diagnoses or any other protected health information. Don&apos;t put patient details in shift notes, messages or ratings. The
        provider gets everything clinical on site, through your own systems.
      </P>
      <H>Contact details stay on the platform</H>
      <P>
        Phone numbers, emails, social handles and website links are never delivered in messages, before or after booking, however they&apos;re written (spelled out, spaced, in pieces). This
        protects both sides: everything about the booking stays in one record, and nobody gets contacted outside the arrangement they agreed to.
      </P>
      <Ul
        items={[
          "Before booking: you can message applicants about the shift. Both sides see display names and city only.",
          "After booking: the provider sees your location's arrival notes, on-site contact and front-desk phone so they can reach the office on the day.",
          "Blocked messages aren't delivered, and our team can review them.",
        ]}
      />
      <Alert tone="warning" title="Working together outside the platform">
        Your agreement includes a non-circumvention period: providers you meet here are booked through {brand}. If you want to hire a provider for your practice, there&apos;s a proper way
        to do it (lesson 9).
      </Alert>
    </>
  ),
  quiz: (_s, brand) => [
    {
      q: "Before booking, an applicant writes their cell number spelled out in words. What happens?",
      options: ["It's delivered", "It's blocked and not delivered", "It's delivered with a warning"],
      answer: 1,
      why: "Contact details are blocked in any format, before and after booking.",
    },
    {
      q: "Where should information about a patient go?",
      options: ["In the shift notes", "In a message to the provider", `Nowhere on ${brand}; share it on site through your own systems`],
      answer: 2,
      why: "No patient information is allowed anywhere on the platform.",
    },
  ],
};

const bench: Lesson = {
  slug: "building-your-bench",
  title: "Ratings, favorites, standing bookings and hiring",
  minutes: 5,
  summary: "Turn good experiences into a reliable bench of providers who know your practice.",
  tryIt: { href: "/clinic/providers", label: "Open My providers" },
  body: (s) => (
    <>
      <H>Ratings</H>
      <Ul
        items={[
          `After each shift, both sides rate each other within ${s["ratings.windowDays"]} days.`,
          `Ratings are double-blind: neither side sees the other's rating until both are in, or ${s["ratings.windowDays"]} days pass. Rate honestly.`,
          "You can also send private feedback. Only the provider sees it, and it doesn't affect their rating or who we send you.",
        ]}
      />
      <H>Favorites and blocks</H>
      <P>
        Add a provider to your favorites from a completed shift or their profile. Favorites get a {hrAdj(s["matching.favoritesWindowHours"])} head start on your planned shifts and rank higher in
        your list. Blocked providers are never offered your shifts, and only you see that list.
      </P>
      <H>Standing bookings</H>
      <P>
        Want the same provider every other Friday? Propose a standing booking to someone you&apos;ve worked with. Once they accept, each matching day is booked automatically{" "}
        {s["standing.horizonWeeks"]} weeks ahead at your usual rates, with a deposit per shift like any booking. If they can&apos;t make a particular day, that day is posted normally. Either side can
        end it with {s["standing.endNoticeDays"]} days&apos; notice.
      </P>
      <H>Hiring a provider</H>
      <Flow
        steps={[
          { title: "Request to hire, from the provider's profile", tone: "brand" },
          { title: "We talk with both of you", detail: "Role, timing, and the placement fee" },
          { title: "You review the terms and accept with your name" },
          { title: "Pay the placement fee with your card on file" },
          { title: "You and the provider can work together directly", tone: "green" },
        ]}
      />
      <P>
        This is the only approved way to hire someone you met here. Without it, the non-circumvention period in your agreement lasts {s["agreements.nonCircumventionMonths"]} months after your
        last shift together.
      </P>
    </>
  ),
  quiz: () => [
    {
      q: "When can you see the rating a provider gave your clinic?",
      options: ["Immediately", "Once you've also rated them, or the rating window ends", "Never"],
      answer: 1,
      why: "Ratings are double-blind, so neither side's rating is influenced by the other's.",
    },
    {
      q: "You want to bring a great provider onto your staff. What do you do?",
      options: ["Exchange numbers and call them", "Use Request to hire on their profile", "Post a shift with a job offer in the notes"],
      answer: 1,
      why: "Request to hire is the approved route. We agree a placement fee, and then you can work together directly.",
    },
  ],
};

export const clinicCourse: Course = {
  audience: "clinic",
  title: "Clinic training",
  intro: "Everything your team needs to book coverage with confidence, in about 40 minutes. Every number shown is the one we use today.",
  base: "/clinic/academy",
  lessons: [welcome, setup, posting, matching, money_, dayOf, cancellations, messaging, bench],
};
