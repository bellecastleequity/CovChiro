import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarCheck, Check, Clock, Phone, Receipt, ShieldCheck, Sparkles, Users } from "lucide-react";
import { brand } from "@cm/config";
import { getSettings } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { JsonLd } from "@/components/site/json-ld";
import { calculatorPrices } from "@/lib/calculator-prices";
import { money } from "@/lib/format";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Temporary & Locum Chiropractor Coverage: How It Works and What It Costs",
    description: "How clinics find a temporary or locum chiropractor for sick days, vacations and gaps between hires. Calling around vs staffing agencies vs on-demand platforms, and what each one costs.",
    alternates: { canonical: "/temporary-chiropractor-coverage" },
  };
}

const SIGNUP = "/signup?role=clinic&utm_source=site&utm_campaign=locum-guide";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold uppercase tracking-wider text-accent-700">{children}</div>;
}

export default async function TemporaryChiropractorCoverage() {
  const s = await getSettings();
  const prices = await calculatorPrices();
  const name = brand().name;
  const deposit = s["payments.depositPercent"];
  const freeCancel = s["payments.clinicFreeCancelHours"];

  // Each row compares the same question across the three ways clinics usually find cover.
  const rows: { q: string; network: string; agency: string; platform: string }[] = [
    {
      q: "How you find someone",
      network: "You call and text colleagues, classmates and old associates until someone says yes.",
      agency: "You call a recruiter, who searches their roster and comes back with a candidate.",
      platform: "You post the day yourself. Available, qualified providers nearby are notified and apply.",
    },
    {
      q: "Who checks the license and insurance",
      network: "You do, if you get to it.",
      agency: "The agency, to its own standard. Ask what they check and how often.",
      platform: `${name} verifies every provider's state license and malpractice insurance before they can apply, and rechecks licenses against state records.`,
    },
    {
      q: "Lead time",
      network: "Depends on who picks up the phone.",
      agency: "Often days to weeks; same-day requests depend on who's on the roster.",
      platform: "Post in a couple of minutes, any time. Short-notice days are sent out in waves until someone accepts.",
    },
    {
      q: "How the price is set",
      network: "Whatever you agree on, plus your time arranging it.",
      agency: "A day or hourly rate quoted per booking, which includes the agency's margin.",
      platform: "A published day rate by region and how busy the day is, shown before you post.",
    },
    {
      q: "Contracts and minimums",
      network: "None, but nothing in writing either.",
      agency: "Many use a services agreement; some have minimum bookings or notice periods.",
      platform: "No contract term, no monthly fee, no minimum. Enrolling is free.",
    },
    {
      q: "If the covering doctor cancels",
      network: "You start calling again.",
      agency: "The agency looks for a replacement, if one is available.",
      platform: `Emergency cover: within ${s["emergency.triggerWithinHours"]} hours of the start, every qualified provider nearby is contacted at once, with a bonus from our side.`,
    },
    {
      q: "Hiring them permanently",
      network: "Between you and them.",
      agency: "Usually a placement or conversion fee set in the agency's agreement.",
      platform: "Allowed, through a simple placement agreement.",
    },
  ];

  const faqs: { q: string; a: string }[] = [
    {
      q: "What is a locum chiropractor?",
      a: "A locum (short for locum tenens, \"holding the place\") is a licensed chiropractor who covers another doctor's schedule for a set time: a sick day, a vacation, a CE weekend, maternity leave or the weeks between hires. They treat your patients in your clinic, following your notes and protocols.",
    },
    {
      q: "Is a temporary chiropractor the same as a locum?",
      a: "In practice, yes. Clinics also say fill-in, covering, per diem or relief chiropractor. They all mean a licensed doctor booked for specific days rather than hired as a permanent associate.",
    },
    {
      q: "How much does a temporary chiropractor cost?",
      a: prices
        ? `With ${name}, full days start from ${money(Math.min(...prices.groups.map((g) => g.lightCents)))} (Light day) where we're open. Rates vary by region and how busy the day is, with premiums for short notice, weekends and holidays, and the price is shown before you post. Agency rates vary by agency and market, so ask for an all-in day rate in writing.`
        : `With ${name}, rates vary by region and how busy the day is, with premiums for short notice, weekends and holidays, and the price is shown before you post. Agency rates vary by agency and market, so ask for an all-in day rate in writing.`,
    },
    {
      q: "Does the covering chiropractor need a license in my state?",
      a: "Yes. A covering doctor must hold an active license in the state where they treat. On our platform, only providers licensed in your state can see and apply to your shifts.",
    },
    {
      q: "Who pays the covering doctor?",
      a: `You pay ${name}: a ${deposit}% deposit when a provider is confirmed and the balance after the shift. We pay the provider, so there's no separate invoice or payroll setup on your side.`,
    },
    {
      q: "How far ahead do I need to book?",
      a: "You can book months ahead or the same day. Booking ahead gives you more applicants to choose from and avoids short-notice premiums, but the day you need someone urgently, you can still post.",
    },
    {
      q: "What about billing for visits seen by a covering doctor?",
      a: "Payer rules for covering providers differ, and some have their own forms or time limits. Check with your billing team or compliance advisor how they want covered visits documented before the first covered day.",
    },
  ];

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          url: `${siteUrl()}/temporary-chiropractor-coverage`,
          mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
        }}
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 text-white">
        <div className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-accent-500/20 blur-3xl" />
        <div className="container-page relative py-16 lg:py-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-accent-200 ring-1 ring-white/20">
              <Users className="size-4" /> A guide for clinic owners
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl">
              Temporary &amp; locum chiropractor coverage: <span className="text-accent-300">how it works and what it costs.</span>
            </h1>
            <p className="mt-5 text-lg text-brand-100">
              When a doctor is out, you have three ways to keep the schedule open: call around, call an agency, or post the day on an on-demand platform. Here&apos;s how each one works, what it costs, and when it makes sense.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="#compare" size="lg" className="bg-accent-500 text-brand-950 hover:bg-accent-400">
                Compare the options <ArrowRight className="size-4" />
              </LinkButton>
              <LinkButton href="#cost" size="lg" variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10">
                See what it costs
              </LinkButton>
            </div>
          </div>
        </div>
      </section>

      {/* What it is */}
      <section className="container-page py-16 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>The basics</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">What temporary coverage is, and when clinics use it</h2>
            <p className="mt-4 text-slate-600">
              A temporary or locum chiropractor is a licensed doctor who treats your patients in your clinic for set days, using your notes, forms and protocols. Your schedule stays open, your patients keep their care plans, and you don&apos;t take on a permanent hire.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              { t: "Sick days", d: "The 6 a.m. call that would otherwise mean a day of cancellations." },
              { t: "Vacations and CE", d: "Real time off for you or your associates, without closing." },
              { t: "Leave", d: "Parental or medical leave, covered week by week." },
              { t: "Between hires", d: "Keep a departing associate's schedule open while you hire well." },
              { t: "A second location", d: "Cover the days you can't be in two places at once." },
              { t: "Busy seasons", d: "An extra doctor on the days your schedule overflows." },
            ].map((x) => (
              <li key={x.t} className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold">{x.t}</div>
                <div className="mt-1 text-sm text-slate-600">{x.d}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Comparison */}
      <section id="compare" className="scroll-mt-20 bg-slate-50 py-16 lg:py-20">
        <div className="container-page">
          <div className="max-w-2xl">
            <Eyebrow>Side by side</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">Calling around vs an agency vs an on-demand platform</h2>
            <p className="mt-3 text-slate-600">Agencies and networks differ, so treat the first two columns as what&apos;s typical and ask your options the same questions.</p>
          </div>

          {/* Table on wide screens */}
          <div className="mt-8 hidden overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-900">
                <tr>
                  <th className="w-[19%] p-4 font-semibold" scope="col"><span className="sr-only">Question</span></th>
                  <th className="w-[27%] p-4 font-semibold" scope="col"><span className="flex items-center gap-2"><Phone className="size-4 text-slate-500" />Calling around</span></th>
                  <th className="w-[27%] p-4 font-semibold" scope="col"><span className="flex items-center gap-2"><Users className="size-4 text-slate-500" />Staffing agency</span></th>
                  <th className="w-[27%] bg-brand-50 p-4 font-semibold text-brand-800" scope="col"><span className="flex items-center gap-2"><Sparkles className="size-4" />On-demand platform</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.q} className="align-top">
                    <th scope="row" className="p-4 font-semibold text-slate-900">{r.q}</th>
                    <td className="p-4 text-slate-600">{r.network}</td>
                    <td className="p-4 text-slate-600">{r.agency}</td>
                    <td className="bg-brand-50/60 p-4 text-slate-800">{r.platform}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards on phones */}
          <div className="mt-8 space-y-4 md:hidden">
            {rows.map((r) => (
              <div key={r.q} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
                <h3 className="font-semibold">{r.q}</h3>
                <dl className="mt-3 space-y-3 text-sm">
                  <div><dt className="font-medium text-slate-500">Calling around</dt><dd className="text-slate-600">{r.network}</dd></div>
                  <div><dt className="font-medium text-slate-500">Staffing agency</dt><dd className="text-slate-600">{r.agency}</dd></div>
                  <div className="rounded-xl bg-brand-50 p-3"><dt className="font-medium text-brand-800">On-demand platform</dt><dd className="text-slate-800">{r.platform}</dd></div>
                </dl>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { icon: Phone, t: "Calling around works when…", d: "You have a trusted colleague who's free, the need is planned, and you're comfortable checking their license and insurance yourself." },
              { icon: Users, t: "An agency works when…", d: "You want someone else to recruit for a long assignment and the margin and agreement terms fit your budget." },
              { icon: Sparkles, t: "A platform works when…", d: "You want to choose from verified applicants yourself, see the price up front, and post anything from a same-day sick call to every Tuesday." },
            ].map((c) => (
              <div key={c.t} className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
                <div className="grid size-11 place-items-center rounded-xl bg-accent-50 text-accent-700"><c.icon className="size-5" /></div>
                <h3 className="mt-4 font-semibold">{c.t}</h3>
                <p className="mt-2 text-sm text-slate-600">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cost */}
      <section id="cost" className="container-page scroll-mt-20 py-16 lg:py-20">
        <div className="max-w-2xl">
          <Eyebrow>What it costs</Eyebrow>
          <h2 className="mt-2 text-3xl font-semibold">What a covered day costs with {name}</h2>
          <p className="mt-3 text-slate-600">Our live rates, straight from the price list clinics see when they post. No subscription and no fee to enroll.</p>
        </div>

        {prices ? (
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {prices.groups.map((g) => (
              <div key={g.tier} className="rounded-2xl border border-slate-200 p-6">
                <div className="text-sm font-semibold text-slate-500">{g.label}, full day, from</div>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-3xl font-semibold text-brand-800">{money(g.lightCents)}</div>
                    <div className="text-sm text-slate-600">Light day, up to {prices.lightCeiling} visits</div>
                  </div>
                  <div>
                    <div className="text-3xl font-semibold text-brand-800">{money(g.busyCents)}</div>
                    <div className="text-sm text-slate-600">Busy day, up to {prices.busyCeiling} visits</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-8 rounded-2xl border border-slate-200 p-6 text-slate-600">Rates are shown by region when you post. <Link href="/for-clinics" className="font-medium text-brand-700 underline">See pricing</Link>.</p>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="font-semibold">What moves the price</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {[
                "Your region: major cities and smaller towns have their own rates.",
                "How busy the day is: Light or Busy, by the visits you expect.",
                ...(prices ? [`Visits past your tier: ${prices.graceVisits} extra visits are free, then ${money(prices.overagePerVisitCents)} per visit.`] : []),
                `Short notice: +${s["pricing.premiumUrgentPercent"]}% when posted under 48 hours ahead, +${s["pricing.premiumRushPercent"]}% under ${s["pricing.rushWithinHours"]} hours.`,
                `Weekends +${s["pricing.premiumWeekendPercent"]}%, federal holidays +${s["pricing.premiumHolidayPercent"]}%.`,
              ].map((t) => (
                <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent-600" />{t}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-slate-500">Premiums raise the provider&apos;s pay by the same percent, which is what gets short-notice days filled.</p>
          </div>
          <div>
            <h3 className="font-semibold">How you pay</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {[
                "Nothing is charged to post or enroll.",
                `A ${deposit}% deposit when a provider is confirmed.`,
                "The balance after the shift.",
                `Free cancellation up to ${freeCancel} hours before the start.`,
                "We pay the provider. You get one clear receipt.",
              ].map((t) => (
                <li key={t} className="flex gap-2"><Receipt className="mt-0.5 size-4 shrink-0 text-accent-600" />{t}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200">
          <h3 className="font-semibold">Comparing quotes? Ask every option the same five questions.</h3>
          <ol className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
            {[
              "What's the all-in day rate, including any fees or margin?",
              "Who verifies the license and malpractice insurance, and when?",
              "What happens, and what do I pay, if the doctor cancels?",
              "Is there a contract term, minimum or notice period?",
              "What does it cost to hire the doctor permanently?",
            ].map((t, i) => (
              <li key={t} className="flex gap-2"><span className="font-semibold text-brand-700">{i + 1}.</span>{t}</li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-slate-600">
            Want the cost of <em>not</em> covering a day? Try the <Link href="/tools/cost-of-closing" className="font-medium text-brand-700 underline">cost of closing calculator</Link>.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50 py-16 lg:py-20">
        <div className="container-page">
          <div className="max-w-2xl">
            <Eyebrow>How it works with {name}</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">From a gap in the schedule to a doctor in the room</h2>
          </div>
          <ol className="mt-10 grid gap-5 md:grid-cols-4">
            {[
              { icon: CalendarCheck, t: "Post the day", d: "Date, hours and how busy it is. The price is shown before you post." },
              { icon: BadgeCheck, t: "Verified doctors apply", d: "Only licensed, insured providers who are free and in range." },
              { icon: Users, t: "You choose", d: "Or let the best match be confirmed automatically at your deadline." },
              { icon: Clock, t: "They arrive, you sign off", d: "Live arrival time on the day, then a one-tap timesheet." },
            ].map((x, i) => (
              <li key={x.t} className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200">
                <div className="relative grid size-14 place-items-center rounded-2xl bg-brand-600 text-white"><x.icon className="size-6" /><span className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-accent-500 text-xs font-bold text-brand-950">{i + 1}</span></div>
                <div className="mt-4 font-semibold">{x.t}</div>
                <div className="mt-1 text-sm text-slate-600">{x.d}</div>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-slate-600">More detail on <Link href="/how-it-works" className="font-medium text-brand-700 underline">how it works</Link>.</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="container-page py-16 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-3">
          <div>
            <Eyebrow>Questions</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">Locum coverage, answered</h2>
            <p className="mt-3 text-slate-600">Something else? <Link href="/contact" className="font-medium text-brand-700 underline">Ask us</Link>, a person answers.</p>
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-500"><ShieldCheck className="size-4" />No patient information is ever needed to book coverage.</div>
          </div>
          <div className="space-y-3 lg:col-span-2">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-2xl bg-white p-5 ring-1 ring-slate-200 open:shadow-card">
                <summary className="cursor-pointer list-none font-semibold marker:hidden">
                  <span className="flex items-center justify-between gap-4">{f.q}<span className="text-xl leading-none text-slate-400 transition group-open:rotate-45">+</span></span>
                </summary>
                <p className="mt-3 text-sm text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="bg-gradient-to-br from-brand-700 to-brand-950 py-16 text-white">
        <div className="container-page flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-semibold">Set up coverage before you need it.</h2>
            <p className="mt-2 text-brand-100">Enrolling is free. The day you need someone, it&apos;s a two-minute post.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <LinkButton href={SIGNUP} size="lg" className="bg-accent-500 text-brand-950 hover:bg-accent-400">Enroll your clinic free</LinkButton>
            <LinkButton href="/for-clinics" size="lg" variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10">See pricing</LinkButton>
          </div>
        </div>
      </section>
    </>
  );
}
