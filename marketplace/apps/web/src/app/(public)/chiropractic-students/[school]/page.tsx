import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { brand } from "@cm/config";
import { US_STATES, stateAreasByCode } from "@cm/core";
import { schools } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { JsonLd } from "@/components/site/json-ld";
import { siteUrl } from "@/lib/seo";
import { ALUMNI_POINTS, NotAffiliated, STUDENT_STEPS, alumniSignup, studentFaqs, studentSignup } from "../school-copy";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ school: string }> }): Promise<Metadata> {
  const s = schools.schoolPage((await params).school);
  if (!s) return {};
  const state = US_STATES[s.state] ?? s.state;
  return {
    title: `${s.short} Students & Alumni: Chiropractic Coverage Shifts`,
    description: `${s.name} (${s.city}, ${s.state}) students and graduates: sign up before you're licensed, then pick up paid chiropractic coverage shifts in ${state} and beyond.`,
    keywords: [`${s.name} students`, `${s.name} alumni`, `${s.short} graduates`, `chiropractor jobs ${s.city}`, `new grad chiropractor ${state}`, `per diem chiropractor ${state}`, "chiropractic coverage shifts"],
    alternates: { canonical: `/chiropractic-students/${s.slug}` },
  };
}

export default async function SchoolPage({ params }: { params: Promise<{ school: string }> }) {
  const s = schools.schoolPage((await params).school);
  if (!s) notFound();
  const b = brand();
  const state = US_STATES[s.state] ?? s.state;
  const area = stateAreasByCode(s.state);
  const faqs = studentFaqs(s.name);
  const nearby = schools.schoolPages().filter((x) => x.state === s.state && x.slug !== s.slug);
  const base = await siteUrl();
  return (
    <div className="container-page py-14">
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: base },
          { "@type": "ListItem", position: 2, name: "Chiropractic students", item: `${base}/chiropractic-students` },
          { "@type": "ListItem", position: 3, name: s.name, item: `${base}/chiropractic-students/${s.slug}` },
        ] },
      ]} />
      <Link href="/chiropractic-students" className="text-sm font-medium text-slate-500 hover:text-slate-900">← All schools</Link>
      <div className="mt-6 max-w-3xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-accent-700">For {s.short} students & alumni</div>
        <h1 className="mt-2 text-4xl font-semibold leading-tight sm:text-5xl">Chiropractic coverage shifts for {s.short} students and graduates</h1>
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-500"><MapPin className="size-4" />{s.name} · {s.city}, {state}</p>
        <p className="mt-4 text-lg text-slate-600">
          Studying at {s.short}? Sign up now and be ready to work the moment you're licensed. Already a {s.short} graduate? Pick up paid coverage shifts at clinics that need a doctor for a day, a week or longer, on the days you choose.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href={studentSignup(s.slug)}>I'm a {s.short} student</LinkButton>
          <LinkButton href={alumniSignup(s.slug)} variant="outline">I'm a licensed graduate</LinkButton>
        </div>
      </div>

      <section className="mt-14">
        <h2 className="text-2xl font-semibold">For students: sign up before you graduate</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {STUDENT_STEPS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <Icon className="size-6 text-accent-600" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14 rounded-2xl bg-brand-600 p-8 text-white">
        <h2 className="text-2xl font-semibold">For {s.short} alumni</h2>
        <ul className="mt-4 space-y-3">
          {ALUMNI_POINTS.map(({ icon: Icon, text }) => <li key={text} className="flex gap-3"><Icon className="mt-0.5 size-5 flex-none text-accent-300" />{text}</li>)}
        </ul>
        <LinkButton href={alumniSignup(s.slug)} variant="secondary" className="mt-6">Create your profile</LinkButton>
      </section>

      <section className="mt-14 max-w-3xl">
        <h2 className="text-2xl font-semibold">Where you can work</h2>
        <p className="mt-3 text-slate-600">
          Chiropractic coverage is open in every U.S. state, {state} included. You'll see shifts in each state where your license and malpractice are verified, so many graduates add the state they plan to practice in as well as the one near {s.city}.
          {area ? <> See <Link href={`/chiropractic/${area.slug}`} className="font-medium text-brand-700 underline">chiropractic coverage in {state}</Link>.</> : null}
        </p>
        {nearby.length ? <p className="mt-3 text-sm text-slate-500">Also in {state}: {nearby.map((x, i) => <span key={x.slug}>{i ? ", " : ""}<Link href={`/chiropractic-students/${x.slug}`} className="underline">{x.name}</Link></span>)}.</p> : null}
      </section>

      <section className="mt-14 max-w-3xl">
        <h2 className="text-2xl font-semibold">Questions</h2>
        <dl className="mt-4 divide-y divide-slate-200">
          {faqs.map((f) => <div key={f.q} className="py-4"><dt className="font-semibold">{f.q}</dt><dd className="mt-1 text-slate-600">{f.a}</dd></div>)}
        </dl>
      </section>
      <NotAffiliated school={s.name} brand={b.name} />
    </div>
  );
}
