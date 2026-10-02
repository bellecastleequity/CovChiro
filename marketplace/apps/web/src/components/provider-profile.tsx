import { Award, BadgeCheck, Briefcase, CalendarCheck, Clock, GraduationCap, Heart, Languages, Link2, MapPin, Shield, ShieldCheck, Star, Zap } from "lucide-react";
import type { Badge as BadgeT } from "@cm/core";
import { providerPublicProfile } from "@cm/services";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { dateLabel } from "@/lib/format";

const ICON: Record<string, typeof Star> = {
  license: ShieldCheck, malpractice: Shield, npi: BadgeCheck, oncall: Zap, new: Star, top_rated: Star, punctual: Clock, responsive: Zap, reliable: CalendarCheck,
  veteran: Award, experienced: Award, seasoned: GraduationCap, clinic_favorite: Heart, multi_profession: BadgeCheck, multi_state: MapPin,
};
const TONE: Record<BadgeT["tone"], string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function BadgeList({ badges, compact }: { badges: BadgeT[]; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b) => {
        const Icon = ICON[b.key] ?? Star;
        return (
          <span key={b.key} title={b.description} className={cn("inline-flex items-center gap-1 rounded-full ring-1 ring-inset", compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs", "font-medium", TONE[b.tone])}>
            <Icon className={compact ? "size-3" : "size-3.5"} />
            {b.label}
          </span>
        );
      })}
    </div>
  );
}

export function ProviderProfileView({ p }: { p: Awaited<ReturnType<typeof providerPublicProfile>> }) {
  const earned = p.badges.filter((b) => b.kind === "earned");
  const status = p.badges.filter((b) => b.kind === "status");
  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="flex flex-col gap-5 py-6 sm:flex-row sm:items-center">
          {p.photoUrl ? (
            <img src={`/api/files/${p.photoUrl}`} alt={`${p.displayName} headshot`} className="size-28 rounded-2xl object-cover ring-4 ring-brand-50" />
          ) : (
            <div className="grid size-28 place-items-center rounded-2xl bg-brand-50 text-3xl font-semibold text-brand-700">{p.displayName.replace(/^Dr\.?\s*/, "").slice(0, 1)}</div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">
              {p.displayName}
              {p.credentials.length ? <span className="font-normal text-slate-500">, {[...new Set(p.credentials.map((c) => c.title))].join(", ")}</span> : null}
            </h1>
            {p.headline ? <p className="mt-1 text-slate-600">{p.headline}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              {p.city ? <span className="flex items-center gap-1"><MapPin className="size-4" />{p.city}, {p.state}</span> : null}
              {p.rating ? <span className="flex items-center gap-1"><Star className="size-4 text-amber-500" />{p.rating.avg.toFixed(1)} ({p.rating.count} ratings)</span> : null}
              <span>{p.completedShifts} shifts completed</span>
              {p.memberSince ? <span>Member since {dateLabel(p.memberSince, "UTC", { month: "short", year: "numeric" })}</span> : null}
              {p.linkedinUrl ? (
                <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 font-medium text-[#0a66c2]"><Link2 className="size-4" />LinkedIn</a>
              ) : p.linkedinHidden ? (
                <span className="flex items-center gap-1 text-slate-400" title="Shared after you confirm a shift together"><Link2 className="size-4" />After confirmation</span>
              ) : null}
            </div>
            <div className="mt-3"><BadgeList badges={status} /></div>
          </div>
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="About me" />
            <CardBody><p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{p.about || "This provider hasn't written an About me yet."}</p></CardBody>
          </Card>
          {earned.length ? (
            <Card>
              <CardHeader title="Earned on the platform" description="Badges come from real activity — ratings, reliability, responsiveness and experience." />
              <CardBody className="grid gap-3 sm:grid-cols-2">
                {earned.map((b) => {
                  const Icon = ICON[b.key] ?? Star;
                  return (
                    <div key={b.key} className="flex gap-3 rounded-xl border border-slate-200 p-3">
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset", TONE[b.tone])}><Icon className="size-4" /></span>
                      <div><div className="text-sm font-semibold">{b.label}</div><div className="text-xs text-slate-500">{b.description}</div></div>
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          ) : null}
          {p.reviews.length ? (
            <Card>
              <CardHeader title="What clinics say" />
              <CardBody className="space-y-4">
                {p.reviews.map((r, i) => (
                  <div key={i} className="text-sm">
                    <div className="text-amber-500">{"★".repeat(r.stars)}<span className="text-slate-300">{"★".repeat(5 - r.stars)}</span> <span className="text-xs text-slate-400">{r.professionCode} · {dateLabel(r.date, "UTC", { month: "short", year: "numeric" })}</span></div>
                    <p className="mt-1 text-slate-700">“{r.comment}”</p>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Verified credentials" />
            <CardBody className="space-y-2 text-sm">
              {p.credentials.map((c) => <div key={`${c.professionCode}-${c.state}`} className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-600" />{c.title} · {c.state === "US" ? "National registry" : c.state}</div>)}
              {p.professions.filter((x) => x.yearsInPractice).map((x) => <div key={x.code} className="text-slate-500">{x.name}: {x.yearsInPractice} years in practice</div>)}
              {p.school ? <div className="flex items-center gap-2 text-slate-600"><GraduationCap className="size-4 text-slate-400" />{p.school}{p.graduationYear ? `, ${p.graduationYear}` : ""}</div> : null}
              {p.personalInjuryExperience !== null ? <div className="flex items-center gap-2 text-slate-600"><Briefcase className="size-4 text-slate-400" />Personal injury experience: {p.personalInjuryExperience ? "Yes" : "No"}</div> : null}
              {p.languages.length ? <div className="flex items-center gap-2 text-slate-600"><Languages className="size-4 text-slate-400" />{p.languages.join(", ")}</div> : null}
            </CardBody>
          </Card>
          {p.skills.length ? (
            <Card>
              <CardHeader title="Skills & techniques" />
              <CardBody className="flex flex-wrap gap-1.5">
                {p.skills.map((k) => <span key={k.name} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{k.name}{k.proficiency === 3 ? " · expert" : ""}{k.certified ? " · certified" : ""}</span>)}
              </CardBody>
            </Card>
          ) : null}
          {p.ehrSystems.length ? <Card><CardHeader title="EHR experience" /><CardBody className="text-sm text-slate-600">{p.ehrSystems.join(", ")}</CardBody></Card> : null}
        </div>
      </div>
    </div>
  );
}
