import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { brand } from "@cm/config";
import { US_STATES } from "@cm/core";
import { schools } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { JsonLd } from "@/components/site/json-ld";
import { siteUrl } from "@/lib/seo";
import { ALUMNI_POINTS, NotAffiliated, STUDENT_STEPS, alumniSignup, studentFaqs, studentSignup } from "./school-copy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chiropractic Students & New Grads: Coverage Shifts",
  description: "Chiropractic students and new graduates: sign up before you're licensed, then pick up paid coverage shifts at clinics on the days you choose. Free for providers.",
  keywords: ["chiropractic students", "chiropractic new graduate jobs", "new grad chiropractor", "per diem chiropractor", "chiropractor coverage shifts", "locum chiropractor", "chiropractic school alumni"],
  alternates: { canonical: "/chiropractic-students" },
};

export default async function ChiropracticStudents() {
  const b = brand();
  const list = schools.schoolPages();
  const byState = Object.entries(list.reduce<Record<string, typeof list>>((m, s) => ((m[s.state] ??= []).push(s), m), {})).sort(([a], [z]) => a.localeCompare(z));
  const faqs = studentFaqs();
  const base = await siteUrl();
  return (
    <div className="container-page py-14">
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: base }, { "@type": "ListItem", position: 2, name: "Chiropractic students", item: `${base}/chiropractic-students` }] },
      ]} />
      <div className="max-w-3xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-accent-700">Chiropractic students & alumni</div>
        <h1 className="mt-2 text-4xl font-semibold leading-tight sm:text-5xl">Start your career on your schedule</h1>
        <p className="mt-4 text-lg text-slate-600">Sign up while you're still in school, then pick up paid coverage shifts at clinics as soon as you're licensed. Already practicing? Fill your open days with coverage work.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href={studentSignup()}>I'm a student</LinkButton>
          <LinkButton href={alumniSignup()} variant="outline">I'm already licensed</LinkButton>
        </div>
      </div>

      <section className="mt-14 grid gap-6 md:grid-cols-3">
        {STUDENT_STEPS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6">
            <Icon className="size-6 text-accent-600" />
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-slate-600">{text}</p>
          </div>
        ))}
      </section>

      <section className="mt-14 rounded-2xl bg-brand-600 p-8 text-white">
        <h2 className="text-2xl font-semibold">Already graduated?</h2>
        <ul className="mt-4 space-y-3">
          {ALUMNI_POINTS.map(({ icon: Icon, text }) => <li key={text} className="flex gap-3"><Icon className="mt-0.5 size-5 flex-none text-accent-300" />{text}</li>)}
        </ul>
        <LinkButton href={alumniSignup()} variant="secondary" className="mt-6">Create your profile</LinkButton>
      </section>

      <section className="mt-14">
        <h2 className="text-2xl font-semibold">Find your school</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {byState.map(([st, rows]) => (
            <div key={st}>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{US_STATES[st] ?? st}</div>
              <ul className="mt-2 space-y-2">
                {rows.map((s) => (
                  <li key={s.slug}>
                    <Link href={`/chiropractic-students/${s.slug}`} className="group inline-flex items-center gap-1.5 font-medium text-slate-800 hover:text-brand-700">
                      {s.name} <ArrowRight className="size-4 opacity-0 transition group-hover:opacity-100" />
                    </Link>
                    <div className="text-xs text-slate-500">{s.city}, {s.state}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14 max-w-3xl">
        <h2 className="text-2xl font-semibold">Questions</h2>
        <dl className="mt-4 divide-y divide-slate-200">
          {faqs.map((f) => <div key={f.q} className="py-4"><dt className="font-semibold">{f.q}</dt><dd className="mt-1 text-slate-600">{f.a}</dd></div>)}
        </dl>
      </section>
      <NotAffiliated brand={b.name} />
    </div>
  );
}
