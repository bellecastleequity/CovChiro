import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarClock, CreditCard, MapPin, ShieldCheck, Stethoscope, Users } from "lucide-react";
import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { getSettings } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { WelcomePopup } from "@/components/site/welcome-popup";
import QRCode from "qrcode";
import { env } from "@cm/config";
import { GetTheApp, PhoneMockup } from "@/components/site/get-the-app";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ signedout?: string }> }) {
  const appQr = await QRCode.toDataURL(env().APP_BASE_URL || "https://coverageoncall.com", { margin: 1, width: 200 });
  const { signedout } = await searchParams;
  const b = brand();
  const [professions, s, enabledPairs] = await Promise.all([
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" } }),
    getSettings(),
    prisma.professionStateConfig.findMany({ where: { enabled: true }, select: { professionCode: true, state: true } }),
  ]);
  const liveStates = [...new Set(enabledPairs.map((p) => p.state))];
  const liveNames = professions.filter((p) => p.active).map((p) => p.displayName);
  return (
    <>
      {signedout ? (
        <div className="container-page pt-4">
          <Alert tone="success">You've signed out. See you next time.</Alert>
        </div>
      ) : null}
      <section className="relative overflow-hidden bg-gradient-to-b from-accent-50 via-white to-white">
        <div className="container-page grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
              <MapPin className="size-3.5" /> Now live in {liveStates.join(", ") || "Florida"}
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl">
              Licensed coverage for your clinic, <span className="text-accent-600">on call.</span>
            </h1>
            {s["features.comparisonClaim"] ? <p className="mt-4 text-xl font-semibold text-brand-700">We charge our clinics less and get our doctors paid more.</p> : null}
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              Post the days you need covered. We match licensed, verified providers in your state, handle the paperwork, and run payment through the platform. No phone trees, no chasing invoices.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/signup?role=clinic" size="lg">
                I need coverage <ArrowRight className="size-4" />
              </LinkButton>
              <LinkButton href="/signup?role=provider" variant="outline" size="lg">
                I want to pick up shifts
              </LinkButton>
            </div>
            <p className="mt-4 text-sm text-slate-500">Free to join. Clinics pay per shift; providers are paid within days.</p>
          </div>
          <div className="relative">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Coverage request · Tue, Oct 20</div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">Confirmed</span>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  { n: "Dr. Jane Rivera, DC", d: "18 min away · 4.9 ★ · Diversified, Activator", pick: true },
                  { n: "Dr. Marcus Hale, DC", d: "32 min away · 4.8 ★ · Gonstead" },
                  { n: "Dr. Priya Nair, DC", d: "41 min away · New to platform" },
                ].map((c) => (
                  <div key={c.n} className={`flex items-center gap-3 rounded-xl border p-3 ${c.pick ? "border-brand-300 bg-brand-50" : "border-slate-200"}`}>
                    <div className="grid size-10 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{c.n.split(" ")[1][0]}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{c.n}</div>
                      <div className="truncate text-xs text-slate-500">{c.d}</div>
                    </div>
                    {c.pick ? <BadgeCheck className="size-5 text-accent-600" /> : null}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                <ShieldCheck className="size-4 text-accent-600" /> Every candidate holds a verified state license valid through the shift.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container-page py-16">
        <h2 className="text-center text-3xl font-semibold">Built for the way coverage actually works</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            { Icon: ShieldCheck, t: "License-verified, by state", d: "Providers only ever see shifts where they hold a verified license for your profession in your state — checked before they apply and again before every shift." },
            { Icon: CalendarClock, t: "Matched in hours, not days", d: "Pick from applicants, invite recommended providers, or let us choose the best fit by drive time, skills, reliability and ratings." },
            { Icon: CreditCard, t: "Payment handled", d: "Clear per-shift pricing with mileage passed through at cost. A small deposit at confirmation, the balance after the shift." },
          ].map(({ Icon, t, d }) => (
            <div key={t} className="rounded-2xl border border-slate-200 p-6">
              <Icon className="size-6 text-accent-600" />
              <h3 className="mt-4 font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 py-16">
        <div className="container-page">
          <h2 className="text-3xl font-semibold">Professions</h2>
          <p className="mt-2 text-slate-600">{liveNames.length ? `${listJoin(liveNames)} coverage is live. ` : ""}More licensed professions are on the way — join the waitlist for yours.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {professions.map((p) => (
              <Link key={p.code} href={`/${p.slug}`} className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-card">
                <div className="flex items-center justify-between">
                  <Stethoscope className="size-5 text-accent-600" />
                  {p.active ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Live</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Coming soon</span>
                  )}
                </div>
                <div className="mt-3 font-semibold group-hover:text-brand-700">{p.displayName}</div>
                <div className="text-sm text-slate-500">{p.credentialSuffix}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="get-the-app" className="overflow-hidden bg-gradient-to-br from-accent-50 via-white to-brand-50 py-16">
        <div className="container-page grid items-center gap-12 lg:grid-cols-2">
          <div className="text-center lg:text-left">
            <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">The {b.name} app</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Coverage in your pocket.</h2>
            <p className="mx-auto mt-3 max-w-xl text-slate-600 lg:mx-0">
              Get shift offers the moment they&apos;re posted, accept in one tap, punch in and out from the clinic, and sign off timesheets on the spot. Clinics see who&apos;s coming and when they arrive.
            </p>
            <ul className="mx-auto mt-5 grid max-w-md gap-2 text-left text-sm text-slate-700 sm:grid-cols-2 lg:mx-0">
              {["Instant offer alerts", "One-tap accept", "Time clock & sign-off", "Calendar sync"].map((t) => (
                <li key={t} className="flex items-center gap-2"><BadgeCheck className="size-4 text-accent-600" />{t}</li>
              ))}
            </ul>
            <div className="mt-7"><GetTheApp qr={appQr} /></div>
          </div>
          <PhoneMockup />
        </div>
      </section>

      <section className="container-page py-16">
        <div className="grid gap-6 rounded-3xl bg-brand-600 p-8 text-white sm:p-12 lg:grid-cols-2">
          <div>
            <Users className="size-7 text-accent-400" />
            <h2 className="mt-4 text-3xl font-semibold">Clinic owners: take the day off.</h2>
            <p className="mt-3 text-brand-100">Vacations, CE weekends, family time. Post a shift in two minutes and {s["promo.welcomeOfferPercent"]}% off your first one is on us.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <LinkButton href="/signup?role=clinic" size="lg" className="bg-white text-brand-700 hover:bg-brand-50">
              Post your first shift
            </LinkButton>
            <LinkButton href="/for-clinics" size="lg" variant="outline" className="border-brand-400 bg-transparent text-white hover:bg-brand-700">
              See pricing
            </LinkButton>
          </div>
        </div>
      </section>
      <WelcomePopup percent={s["promo.welcomeOfferPercent"]} />
      <span className="sr-only">{b.name}</span>
    </>
  );
}

/** "A", "A and B", "A, B and C". */
function listJoin(xs: string[]) {
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
