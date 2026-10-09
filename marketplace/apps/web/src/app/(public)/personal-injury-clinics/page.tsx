import type { Metadata } from "next";
import Link from "next/link";
import {
  AlarmClock,
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarCheck,
  CalendarHeart,
  CarFront,
  ClipboardCheck,
  Clock,
  FileText,
  HeartHandshake,
  MessageSquareText,
  PartyPopper,
  Repeat,
  ShieldCheck,
  Siren,
  Sparkles,
  Timer,
  UserPlus,
  Users,
} from "lucide-react";
import { brand } from "@cm/config";
import { getSettings } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { JsonLd } from "@/components/site/json-ld";
import { HeroArt, TurnoverArt, TwoLocationsArt } from "@/components/site/pi-art";
import { PiCalculators } from "@/components/site/pi-calculators";
import { calculatorPrices } from "@/lib/calculator-prices";
import { money } from "@/lib/format";
import { siteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Chiropractic Coverage for Personal Injury Clinics",
    description: "Keep your personal injury practice open when a doctor is out, open a second location without splitting yourself in two, and bridge staff turnover with verified covering chiropractors.",
    alternates: { canonical: "/personal-injury-clinics" },
  };
}

const SIGNUP = "/signup?role=clinic&utm_source=site&utm_campaign=personal-injury";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold uppercase tracking-wider text-accent-700">{children}</div>;
}

export default async function PersonalInjuryClinics() {
  const s = await getSettings();
  const prices = await calculatorPrices();
  const from = prices ? Math.min(...prices.groups.map((g) => g.lightCents)) : null;
  const name = brand().name;

  const faqs: { q: string; a: string }[] = [
    {
      q: "Will a covering doctor know personal injury documentation?",
      a: "Providers tell us whether they have personal injury experience, and you see it on every applicant before you choose. Leave notes on your protocols, forms and EHR when you post, and they're shared with your provider once confirmed.",
    },
    {
      q: "Are covering doctors verified?",
      a: "Every provider's state license and malpractice insurance are verified before they can apply, and licenses are checked again against the state's own records. You see what was verified and when on your booking.",
    },
    {
      q: "What if the covering doctor cancels?",
      a: `If a provider cancels within ${s["emergency.triggerWithinHours"]} hours of the start, or doesn't show, emergency cover kicks in: we go straight to every qualified provider nearby, with a bonus from our side, and tell you the moment someone's confirmed.`,
    },
    {
      q: "Can a covering doctor take my patients or referral relationships?",
      a: "Providers agree not to deal with clinics or patients they met through us outside the platform, and messages are screened so contact details aren't exchanged. If you'd like to hire a covering doctor permanently, you can, through a simple placement agreement.",
    },
    {
      q: "How is billing handled for visits by a covering doctor?",
      a: "Billing rules for covering providers vary by payer, and PIP has its own. Check with your billing team or compliance advisor how they want covered visits documented before your first covered day.",
    },
    {
      q: "What does it cost?",
      a: `${from ? `Full days start from ${money(from)} (Light day) where we're open, ` : ""}priced by region and how busy the day is, shown before you post. You pay a ${s["payments.depositPercent"]}% deposit when a provider is confirmed and the balance after the shift. Creating an account and enrolling your clinic is free.`,
    },
    {
      q: "Do I have to post a shift to enroll?",
      a: "No. Enroll now, finish verification and setup once, and you can post in a couple of minutes the day you need someone.",
    },
  ];

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          url: `${siteUrl()}/personal-injury-clinics`,
          mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
        }}
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 text-white">
        <div className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-accent-500/20 blur-3xl" />
        <div className="container-page relative grid items-center gap-10 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-accent-200 ring-1 ring-white/20">
              <CarFront className="size-4" /> For personal injury clinics
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl">
              Never turn away an accident patient <span className="text-accent-300">because a doctor is out.</span>
            </h1>
            <p className="mt-5 text-lg text-brand-100">
              Personal injury practices run on availability. {name} gives you verified covering chiropractors for sick days, vacations, a second location and the weeks between hires, so your doors stay open and your new patients get seen.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href={SIGNUP} size="lg" className="bg-accent-500 text-brand-950 hover:bg-accent-400">
                Enroll your clinic free <ArrowRight className="size-4" />
              </LinkButton>
              <LinkButton href="#calculators" size="lg" variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10">
                Run your numbers
              </LinkButton>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-brand-100">
              <span className="flex items-center gap-1.5"><BadgeCheck className="size-4 text-accent-300" />Licenses verified</span>
              <span className="flex items-center gap-1.5"><Clock className="size-4 text-accent-300" />Post in minutes</span>
              <span className="flex items-center gap-1.5"><ShieldCheck className="size-4 text-accent-300" />No contracts, no monthly fee</span>
            </div>
          </div>
          <HeroArt />
        </div>
      </section>

      {/* Why PI feels it most */}
      <section className="container-page py-16 lg:py-20">
        <div className="max-w-2xl">
          <Eyebrow>Why it hits personal injury practices hardest</Eyebrow>
          <h2 className="mt-2 text-3xl font-semibold">A closed day costs more than the visits on the schedule.</h2>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Timer, title: "New patients can't wait", text: "In Florida, PIP generally requires treatment to start within 14 days of the accident. A patient who can't get in goes to the next clinic that can see them." },
            { icon: Repeat, title: "Care plans need consistency", text: "Injury cases run on regular visits. Gaps in treatment are hard on patients and harder to explain later in their file." },
            { icon: Users, title: "Turnover is constant", text: "Associates move on and temp doctors come and go. Every gap between hires is weeks of a doctor's schedule at risk." },
            { icon: HeartHandshake, title: "Referral partners expect you open", text: "The people who send you patients need to know you can see them this week, not after the doctor is back." },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-slate-200 p-6">
              <div className="grid size-11 place-items-center rounded-xl bg-accent-50 text-accent-700"><c.icon className="size-5" /></div>
              <h3 className="mt-4 font-semibold">{c.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{c.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Calculators */}
      <section id="calculators" className="scroll-mt-20 bg-slate-50 py-16 lg:py-20">
        <div className="container-page">
          <div className="max-w-2xl">
            <Eyebrow>Run your own numbers</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">What coverage is worth to your practice</h2>
            <p className="mt-3 text-slate-600">Four quick calculators with our live rates and your own figures. Nothing you type leaves this page.</p>
          </div>
          <div className="mt-8"><PiCalculators prices={prices} /></div>
        </div>
      </section>

      {/* Grow & scale */}
      <section className="container-page py-16 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>Grow and scale</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">Open a second location without splitting yourself in two.</h2>
            <p className="mt-4 text-slate-600">The hardest part of a new location isn&apos;t the lease. It&apos;s that you can&apos;t be in two offices at once, and hiring a full-time doctor before the patients are there is a big bet.</p>
            <ul className="mt-6 space-y-4">
              {[
                { icon: Building2, t: "Open on day one", d: "Cover the days you can't be there while the new office builds its patient base." },
                { icon: Repeat, t: "Same doctor every week", d: "A standing booking books your favorite covering doctor on the same weekdays, automatically." },
                { icon: UserPlus, t: "Hire when the numbers say so", d: "When the location is ready for a full-time doctor, you can hire the one your patients already know." },
              ].map((x) => (
                <li key={x.t} className="flex gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><x.icon className="size-4" /></div>
                  <div><div className="font-semibold">{x.t}</div><div className="text-sm text-slate-600">{x.d}</div></div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl bg-gradient-to-br from-slate-50 to-accent-50 p-6 ring-1 ring-slate-200"><TwoLocationsArt /></div>
        </div>
      </section>

      {/* Time off + holidays */}
      <section className="bg-brand-950 py-16 text-white lg:py-20">
        <div className="container-page">
          <div className="max-w-2xl">
            <div className="text-sm font-semibold uppercase tracking-wider text-accent-300">Keep your doctors</div>
            <h2 className="mt-2 text-3xl font-semibold">Give your providers real time off. Without closing.</h2>
            <p className="mt-3 text-brand-100">Burned-out doctors leave. When time off doesn&apos;t mean a closed office or a colleague carrying a double schedule, people take it, and they stay.</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { icon: CalendarHeart, t: "Vacations and CE weekends", d: "Book coverage for a week away or a seminar weekend, weeks ahead or the night before." },
              { icon: PartyPopper, t: "Holidays and the weeks around them", d: `The days your own team wants off are the days injury patients still call. Plan coverage early; holiday shifts carry a +${s["pricing.premiumHolidayPercent"]}% premium that goes toward getting them filled.` },
              { icon: AlarmClock, t: "Sick days and surprises", d: "Short notice? Post it and Smart Dispatch asks the best-matched available doctors first, in waves, until someone accepts." },
            ].map((c) => (
              <div key={c.t} className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                <c.icon className="size-6 text-accent-300" />
                <h3 className="mt-4 font-semibold">{c.t}</h3>
                <p className="mt-2 text-sm text-brand-100">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Turnover */}
      <section className="container-page py-16 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="order-2 lg:order-1 rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200"><TurnoverArt /></div>
          <div className="order-1 lg:order-2">
            <Eyebrow>Fill the gaps</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">Turnover without the scramble.</h2>
            <p className="mt-4 text-slate-600">When an associate gives notice, the clock starts. Coverage keeps their schedule open while you hire the right person instead of the first available one.</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-700">
              {[
                "Post multi-day bookings in one go, and keep the same provider for every day if you want continuity",
                "Book the same doctor every week with a standing booking",
                "Like who you got? Request to hire them through us",
              ].map((t) => (
                <li key={t} className="flex gap-2"><ClipboardCheck className="mt-0.5 size-4 shrink-0 text-accent-600" />{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* How it works flow */}
      <section className="bg-slate-50 py-16 lg:py-20">
        <div className="container-page">
          <div className="max-w-2xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">From &ldquo;we need someone&rdquo; to a doctor in the room</h2>
          </div>
          <ol className="relative mt-10 grid gap-5 md:grid-cols-5">
            <div className="absolute left-0 right-0 top-7 hidden h-0.5 bg-gradient-to-r from-brand-200 via-accent-300 to-brand-200 md:block" aria-hidden="true" />
            {[
              { icon: CalendarCheck, t: "Post the day", d: "Date, hours, how busy it is. You see the price before you post." },
              { icon: Sparkles, t: "Verified doctors apply", d: "Only licensed, insured providers who are free and in range. PI experience shown." },
              { icon: BadgeCheck, t: "You choose", d: "Or let the best match be confirmed automatically at your deadline." },
              { icon: Siren, t: "They arrive", d: "Live arrival time on the day, and clock-in when they're on site." },
              { icon: FileText, t: "Sign off & done", d: "One-tap timesheet. We pay the doctor; you get one clear receipt." },
            ].map((x, i) => (
              <li key={x.t} className="relative rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200">
                <div className="relative grid size-14 place-items-center rounded-2xl bg-brand-600 text-white"><x.icon className="size-6" /><span className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-accent-500 text-xs font-bold text-brand-950">{i + 1}</span></div>
                <div className="mt-4 font-semibold">{x.t}</div>
                <div className="mt-1 text-sm text-slate-600">{x.d}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Enroll now */}
      <section className="container-page py-16 lg:py-20">
        <div className="grid gap-10 rounded-3xl bg-gradient-to-br from-accent-50 to-white p-8 ring-1 ring-accent-200 lg:grid-cols-2 lg:p-12">
          <div>
            <Eyebrow>Enroll before you need us</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">The worst time to set up coverage is the morning your doctor calls in sick.</h2>
            <p className="mt-4 text-slate-600">Enrolling is free. Do the one-time setup now, and the day you need someone it&apos;s a two-minute post, not a two-hour scramble.</p>
            <LinkButton href={SIGNUP} size="lg" className="mt-6">Enroll your clinic free <ArrowRight className="size-4" /></LinkButton>
          </div>
          <ol className="space-y-3">
            {[
              { t: "Create your clinic account", d: "Name, email, done." },
              { t: "Add your location", d: "Plus parking, arrival notes and photos for your covering doctor." },
              { t: "Verify your clinic", d: "A few minutes; most clinics are verified right away." },
              { t: "Add a payment method and sign the agreement", d: "Nothing is charged until a provider is confirmed." },
              { t: "Post when you need someone", d: "Today, next month, or every Tuesday." },
            ].map((x, i) => (
              <li key={x.t} className="flex gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <div><div className="font-semibold">{x.t}</div><div className="text-sm text-slate-600">{x.d}</div></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Concerns */}
      <section className="bg-slate-50 py-16 lg:py-20">
        <div className="container-page grid gap-10 lg:grid-cols-3">
          <div>
            <Eyebrow>Your questions</Eyebrow>
            <h2 className="mt-2 text-3xl font-semibold">What PI clinic owners ask us</h2>
            <p className="mt-3 text-slate-600">Something else on your mind? <Link href="/contact" className="font-medium text-brand-700 underline">Ask us</Link>, a person answers.</p>
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-500"><MessageSquareText className="size-4" />No patient information is ever needed to book coverage.</div>
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
            <h2 className="text-3xl font-semibold">Keep every injury patient on schedule.</h2>
            <p className="mt-2 text-brand-100">Enroll free today. Post when you need someone.</p>
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
