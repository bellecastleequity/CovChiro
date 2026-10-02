"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, CalendarDays, Check, ChevronLeft, MapPin, ShieldCheck, Stethoscope, Users } from "lucide-react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ClosingPanel, usePerVisit } from "@/components/clinic/closing-panel";
import { Checkbox, Field, Input, PhiNotice, Select, Textarea } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { createShiftAction, quoteAction, updateDraftAction } from "../../actions";

interface Prof {
  code: string;
  displayName: string;
  pricingModel: string;
  enabled: boolean;
  unavailableReason: string | null;
  supervisionRequired: boolean;
  supervisingProfessionCodes: string[];
  skills: { id: string; name: string; crossProfession: boolean }[];
}
interface Loc {
  id: string;
  name: string;
  city: string;
  state: string;
  timeZone: string;
  professions: Prof[];
}
interface DayQuote {
  date: string;
  subtotalCents: number;
  premiums: { kind: string; percent: number }[];
}
interface Quote {
  days?: DayQuote[];
  totalCents?: number;
  coverageCents: number;
  discountCents: number;
  promoCode: string | null;
  premiums: { kind: string; percent: number }[];
  tier: string;
  hours: number;
  billableHours: number;
  subtotalCents: number;
  volume?: {
    tier: "LIGHT" | "BUSY";
    terms: { ceiling: number; grace: number; overageClinicCents: number };
    disputeHours: number;
    ceilings: { LIGHT: number; BUSY: number };
    clinicPrices: { LIGHT: number; BUSY: number };
    recentCounts: number[];
    suggested: number | null;
    warning: string | null;
  } | null;
}

const TIER_LABEL = { LIGHT: "Light day", BUSY: "Busy day" } as const;

const STEPS = ["Where", "What", "When", "Details", "Review"] as const;

/** A saved draft being edited (times already in the location's local zone). */
export interface DraftInit {
  id: string;
  inGroup: boolean;
  locationId: string;
  professionCode: string;
  date: string;
  start: string;
  end: string;
  requiredSkillIds: string[];
  preferredSkillIds: string[];
  expectedPatients: string;
  minYears: string;
  notes: string;
  instantBook: boolean;
  lodgingAllowed: boolean;
  lodgingCap: string;
  maxTravelBudget: string;
  sup: { supervisorName: string; supervisorProfessionCode: string; supervisorLicenseNumber: string; onSiteEntireShift: boolean } | null;
}

export function PostShiftWizard({ locations, canPost, defaultCode, defaultMinYears = 0, mileage, draft, volumeCodes = [] }: { locations: Loc[]; canPost: boolean; defaultCode: string; defaultMinYears?: number; mileage: { rateLabel: string; roundTrip: boolean }; draft?: DraftInit; volumeCodes?: string[] }) {
  const [step, setStep] = useState(0);
  const [locationId, setLocationId] = useState(draft && locations.some((l) => l.id === draft.locationId) ? draft.locationId : locations[0].id);
  const loc = locations.find((l) => l.id === locationId)!;
  const firstEnabled = loc.professions.find((p) => p.enabled)?.code ?? "";
  const [professionCode, setProfessionCode] = useState(draft?.professionCode ?? firstEnabled);
  const prof = loc.professions.find((p) => p.code === professionCode);
  const tomorrow = new Date(Date.now() + 86_400_000 * 3).toISOString().slice(0, 10);
  // One row per day; a booking of several days is posted together.
  const [days, setDays] = useState([draft ? { date: draft.date, start: draft.start, end: draft.end } : { date: tomorrow, start: "08:00", end: "17:00" }]);
  const { date, start, end } = days[0];
  const setDay = (i: number, patch: Partial<{ date: string; start: string; end: string }>) => setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const addDay = () =>
    setDays((ds) => {
      const last = ds[ds.length - 1];
      const next = new Date(`${last.date}T12:00:00`);
      next.setDate(next.getDate() + 1);
      return [...ds, { date: next.toISOString().slice(0, 10), start: last.start, end: last.end }];
    });
  const [required, setRequired] = useState<string[]>(draft?.requiredSkillIds ?? []);
  const [preferred, setPreferred] = useState<string[]>(draft?.preferredSkillIds ?? []);
  const [expectedPatients, setExpectedPatients] = useState(draft?.expectedPatients ?? "");
  const [minYears, setMinYears] = useState(draft?.minYears ?? String(defaultMinYears));
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [instantBook, setInstantBook] = useState(draft?.instantBook ?? false);
  const [lodgingAllowed, setLodgingAllowed] = useState(draft?.lodgingAllowed ?? false);
  const [lodgingCap, setLodgingCap] = useState(draft?.lodgingCap || "150");
  const [maxTravelBudget, setMaxTravelBudget] = useState(draft?.maxTravelBudget ?? "");
  const [promoCode, setPromoCode] = useState(defaultCode);
  const [sup, setSup] = useState(draft?.sup ?? { supervisorName: "", supervisorProfessionCode: prof?.supervisingProfessionCodes[0] ?? "", supervisorLicenseNumber: "", onSiteEntireShift: false });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [perVisit, setPerVisit] = usePerVisit(locationId);
  const [volumeAck, setVolumeAck] = useState(false);
  const volumePriced = !!prof && prof.pricingModel !== "HOURLY" && volumeCodes.includes(prof.code);
  const visitsNum = expectedPatients === "" ? null : Math.max(0, Math.floor(Number(expectedPatients) || 0));

  const payload = useMemo(
    () =>
      JSON.stringify({
        locationId,
        professionCode,
        date,
        start,
        end,
        days,
        requiredSkillIds: required,
        preferredSkillIds: preferred,
        expectedPatients: expectedPatients ? Number(expectedPatients) : null,
        minYearsExperience: Number(minYears),
        notes,
        instantBook,
        lodgingAllowed,
        lodgingCap: lodgingAllowed ? lodgingCap : null,
        maxTravelBudget: maxTravelBudget || null,
        promoCode: promoCode.trim() || null,
        supervisionAttestation: prof?.supervisionRequired ? sup : null,
      }),
    [locationId, professionCode, date, start, end, days, required, preferred, expectedPatients, minYears, notes, instantBook, lodgingAllowed, lodgingCap, maxTravelBudget, promoCode, sup, prof],
  );

  function refreshQuote() {
    const fd = new FormData();
    fd.set("payload", payload);
    startTransition(async () => {
      const r: ActionState = await quoteAction(null, fd);
      if (r?.error) {
        setQuote(null);
        setQuoteError(r.error);
      } else {
        setQuote(r?.data as Quote);
        setQuoteError(null);
      }
    });
  }

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const supOk = !prof?.supervisionRequired || (sup.supervisorName.length > 1 && sup.supervisorLicenseNumber.length > 2 && sup.onSiteEntireShift && !!sup.supervisorProfessionCode);
  const daysOk = days.every((d) => d.date && d.start && d.end) && new Set(days.map((d) => d.date)).size === days.length;
  const canNext = [!!locationId, !!prof?.enabled && supOk, daysOk, !volumePriced || visitsNum != null, true][step];
  // Re-price as the expected visits change (they pick Light or Busy).
  useEffect(() => {
    if (step < 3) return;
    const t = setTimeout(refreshQuote, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedPatients]);
  const v = quote?.volume ?? null;
  const coverageTotal = quote ? (quote.days && quote.days.length > 1 ? (quote.totalCents ?? 0) : quote.subtotalCents) : null;
  const closing = (collapsible: boolean) => (
    <ClosingPanel visits={visitsNum} days={days.length} coverageCents={coverageTotal} perVisit={perVisit} onPerVisit={setPerVisit} collapsible={collapsible} />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ol className="mb-5 flex gap-2 overflow-x-auto text-xs font-medium">
          {STEPS.map((s, i) => (
            <li key={s} className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 whitespace-nowrap", i === step ? "bg-brand-600 text-white" : i < step ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500")}>
              {i < step ? <Check className="size-3.5" /> : <span>{i + 1}</span>} {s}
            </li>
          ))}
        </ol>
        <Card>
          <CardBody className="space-y-5 py-6">
            {step === 0 ? (
              <div className="space-y-3">
                <h2 className="flex items-center gap-2 font-semibold"><MapPin className="size-4 text-accent-600" />Which location?</h2>
                {locations.map((l) => (
                  <label key={l.id} className={cn("flex cursor-pointer items-center justify-between rounded-xl border p-4", l.id === locationId ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
                    <span>
                      <span className="block font-medium">{l.name}</span>
                      <span className="text-sm text-slate-500">{l.city}, {l.state}</span>
                    </span>
                    <input type="radio" name="loc" checked={l.id === locationId} onChange={() => { setLocationId(l.id); setProfessionCode(l.professions.find((p) => p.enabled)?.code ?? ""); setRequired([]); setPreferred([]); }} className="size-4 text-brand-600" />
                  </label>
                ))}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-4">
                <h2 className="flex items-center gap-2 font-semibold"><Stethoscope className="size-4 text-accent-600" />What kind of coverage?</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {loc.professions.map((p) => (
                    <button
                      type="button"
                      key={p.code}
                      disabled={!p.enabled}
                      onClick={() => { setProfessionCode(p.code); setRequired([]); setPreferred([]); setSup((s) => ({ ...s, supervisorProfessionCode: p.supervisingProfessionCodes[0] ?? "" })); }}
                      className={cn("rounded-xl border p-4 text-left", p.code === professionCode ? "border-brand-500 bg-brand-50" : "border-slate-200", !p.enabled && "cursor-not-allowed opacity-60")}
                    >
                      <div className="font-medium">{p.displayName}</div>
                      <div className="text-xs text-slate-500">{p.enabled ? (p.pricingModel === "HOURLY" ? "Priced hourly" : "Half / full day") : p.unavailableReason}</div>
                    </button>
                  ))}
                </div>
                {prof?.supervisionRequired ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><ShieldCheck className="size-4" />Supervision attestation required<InfoTip label="About supervision">State law requires this profession to work under a licensed supervisor who is physically on site for the whole shift. We record your attestation with the shift; only providers who can legally work under that supervisor are matched.</InfoTip></div>
                    <p className="mt-1 text-xs text-amber-900">{prof.displayName}s must be supervised on site in {loc.state}. Name the supervising provider who will be present for the entire shift.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field label="Supervisor name"><Input value={sup.supervisorName} onChange={(e) => setSup({ ...sup, supervisorName: e.target.value })} /></Field>
                      <Field label="Supervisor profession">
                        <Select value={sup.supervisorProfessionCode} onChange={(e) => setSup({ ...sup, supervisorProfessionCode: e.target.value })}>
                          {prof.supervisingProfessionCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                        </Select>
                      </Field>
                      <Field label="License number"><Input value={sup.supervisorLicenseNumber} onChange={(e) => setSup({ ...sup, supervisorLicenseNumber: e.target.value })} /></Field>
                    </div>
                    <Checkbox className="mt-3" checked={sup.onSiteEntireShift} onChange={(e) => setSup({ ...sup, onSiteEntireShift: e.target.checked })} label="I confirm this person will be on site and available for the entire shift, as state law requires." />
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-4">
                <h2 className="flex items-center gap-2 font-semibold"><CalendarDays className="size-4 text-accent-600" />When?</h2>
                <div className="space-y-3">
                  {days.map((d, i) => (
                    <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                      <Field label={days.length > 1 ? `Day ${i + 1}` : "Date"}><Input type="date" value={d.date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDay(i, { date: e.target.value })} /></Field>
                      <Field label="Start"><Input type="time" value={d.start} onChange={(e) => setDay(i, { start: e.target.value })} /></Field>
                      <Field label="End"><Input type="time" value={d.end} onChange={(e) => setDay(i, { end: e.target.value })} /></Field>
                      {days.length > 1 ? (
                        <Button type="button" variant="ghost" onClick={() => setDays((ds) => ds.filter((_, j) => j !== i))} aria-label={`Remove day ${i + 1}`}>Remove</Button>
                      ) : <span />}
                    </div>
                  ))}
                </div>
                {days.length < 14 && !draft ? <Button type="button" variant="outline" size="sm" onClick={addDay}>+ Add another day</Button> : null}
                {new Set(days.map((d) => d.date)).size !== days.length ? <p className="text-sm text-red-700">Two rows have the same date.</p> : null}
                <p className="text-xs text-slate-500">
                  Times are local to {loc.name} ({loc.timeZone.replace("America/", "").replace("_", " ")}).
                  {days.length > 1 ? " Several days are posted together as one booking: providers can apply to all of them at once, and you can confirm one provider for every day." : " Need several days? Add them here and post them as one booking."}
                </p>
              </div>
            ) : null}

            {step === 3 && prof ? (
              <div className="space-y-5">
                {volumePriced ? (
                  <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                    <Field
                      label={<><Users className="mr-1 inline size-4 text-accent-600" />Expected patient visits{days.length > 1 ? " per day" : ""}<InfoTip label="About expected visits">Your price depends on how busy the day is. A Light day is cheaper; a Busy day covers more visits. If the day turns out busier than the tier you book, each visit past its limit (plus a small grace) is billed per visit after the shift, and you can check the count first.</InfoTip></>}
                      hint={v ? `Light: up to ${v.ceilings.LIGHT} visits · Busy: up to ${v.ceilings.BUSY}.` : undefined}
                    >
                      <Input type="number" min={0} max={300} inputMode="numeric" value={expectedPatients} onChange={(e) => setExpectedPatients(e.target.value)} placeholder="e.g. 18" className="max-w-40 text-lg font-semibold" />
                    </Field>
                    {v?.suggested != null && expectedPatients === "" ? (
                      <button type="button" onClick={() => setExpectedPatients(String(v.suggested))} className="mt-2 text-sm font-medium text-brand-700 underline">Your last {v.recentCounts.length} coverage days averaged {v.suggested} visits. Use {v.suggested}</button>
                    ) : null}
                    {v && visitsNum != null && !pending ? (
                      <p className="mt-3 text-sm text-slate-700">
                        <b>{TIER_LABEL[v.tier]}</b> · {money(quote!.coverageCents)}{days.length > 1 ? " a day" : ""}. Covers up to {v.terms.ceiling + v.terms.grace} visits; each visit past that adds {money(v.terms.overageClinicCents)}.
                      </p>
                    ) : null}
                    {v?.warning ? <p className="mt-2 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{v.warning}</p> : null}
                  </div>
                ) : null}
                <div>
                  <h2 className="font-semibold">Skills<InfoTip label="About skills">Tap a skill once for <b>preferred</b> (providers who have it rank higher) and again for <b>required</b> (only providers with it, and any certification it needs, are matched). Tap a third time to clear it. Requiring many skills means fewer providers qualify.</InfoTip></h2>
                  <p className="text-xs text-slate-500">Required skills filter providers; preferred skills improve their match score.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {prof.skills.map((k) => {
                      const r = required.includes(k.id);
                      const p = preferred.includes(k.id);
                      return (
                        <button
                          type="button"
                          key={k.id}
                          onClick={() => {
                            if (!r && !p) toggle(preferred, setPreferred, k.id);
                            else if (p) { toggle(preferred, setPreferred, k.id); toggle(required, setRequired, k.id); }
                            else toggle(required, setRequired, k.id);
                          }}
                          className={cn("rounded-full border px-3 py-1 text-sm", r ? "border-brand-600 bg-brand-600 text-white" : p ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-300 text-slate-600")}
                          title="Click: preferred → required → off"
                        >
                          {k.name}{r ? " · required" : p ? " · preferred" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {!volumePriced ? (
                    <Field label={<>Expected patients<InfoTip label="About expected patients">Roughly how many patients the provider will see. It helps them judge the pace of the day; it doesn't change the price.</InfoTip></>}><Input type="number" min={0} value={expectedPatients} onChange={(e) => setExpectedPatients(e.target.value)} /></Field>
                  ) : null}
                  <Field label={<>Minimum experience<InfoTip label="About minimum experience">Uses the years practicing providers enter on their profile (it can't exceed the years since they graduated). Higher minimums mean fewer providers qualify, so the shift may take longer to fill. Your default is in Settings, where you can also let emergency cover ignore it.</InfoTip></>} hint="Higher minimums mean fewer providers can take it.">
                    <Select value={minYears} onChange={(e) => setMinYears(e.target.value)}>
                      <option value="0">Any experience</option>
                      <option value="2">2+ years</option>
                      <option value="5">5+ years</option>
                      <option value="10">10+ years</option>
                    </Select>
                  </Field>
                  <Field
                    label={
                      <>
                        Max travel budget ($, optional)
                        <InfoTip label="About the travel budget">
                          The most you&apos;re willing to pay for this provider&apos;s travel, on top of the shift price. Travel is mileage ({mileage.rateLabel} per mile, {mileage.roundTrip ? "round trip" : "one way"}, from the provider&apos;s home to your clinic) plus lodging if you allow it. Providers whose estimated travel would cost more won&apos;t be offered the shift. Leave it blank for no limit; nearby providers cost little in mileage.
                        </InfoTip>
                      </>
                    }
                    hint="Mileage + lodging cap. Providers beyond it won't be matched."
                  >
                    <Input inputMode="decimal" value={maxTravelBudget} onChange={(e) => setMaxTravelBudget(e.target.value)} placeholder="No limit" />
                  </Field>
                </div>
                <Field label={<>Notes for providers<InfoTip label="About notes">Shown to eligible providers before they apply: practice style, a typical day, techniques you use. Don&apos;t include phone numbers or emails, or any patient information; arrival details are shared after a provider is confirmed.</InfoTip></>}>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Practice style, typical day, equipment. Arrival details are shared after confirmation." />
                  <PhiNotice />
                </Field>
                <div className="space-y-2">
                  <Checkbox checked={instantBook} onChange={(e) => setInstantBook(e.target.checked)} label={<>Instant book — confirm the first well-matched applicant automatically<InfoTip label="About instant book">The first applicant who is a strong match (license, skills, distance, reliability) is confirmed right away and the deposit is charged, so you don&apos;t have to choose. Leave it off to review applicants and pick yourself.</InfoTip></>} />
                  <Checkbox checked={lodgingAllowed} onChange={(e) => setLodgingAllowed(e.target.checked)} label={<>Allow lodging for distant providers (reimbursed at cost)<InfoTip label="About lodging">Lets us offer the shift to providers who live too far to drive in that morning. They book their own room and upload the receipt, and you reimburse the actual cost up to your nightly cap. Without it, only providers within their usual drive time are matched.</InfoTip></>} />
                  {lodgingAllowed ? <Field label={<>Nightly lodging cap ($)<InfoTip label="About the lodging cap">The most you&apos;ll reimburse per night. Receipts above it are reimbursed up to the cap.</InfoTip></>} className="max-w-xs"><Input inputMode="decimal" value={lodgingCap} onChange={(e) => setLodgingCap(e.target.value)} /></Field> : null}
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-4">
                <h2 className="font-semibold">{draft ? "Review & save changes" : "Review & post"}</h2>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-slate-500">Location</dt><dd className="font-medium">{loc.name}, {loc.city} {loc.state}</dd></div>
                  <div><dt className="text-slate-500">Coverage</dt><dd className="font-medium">{prof?.displayName}</dd></div>
                  <div><dt className="text-slate-500">When</dt><dd className="font-medium">{days.length > 1 ? `${days.length} days: ${days.map((d) => d.date).join(", ")}` : `${date} · ${start}–${end}`}</dd></div>
                  <div><dt className="text-slate-500">Booking</dt><dd className="font-medium">{instantBook ? "Instant book" : "You choose from applicants"}</dd></div>
                </dl>
                <div className="flex gap-2">
                  <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Promo code" className="font-mono" />
                  <Button type="button" variant="outline" onClick={refreshQuote} disabled={pending}>Apply</Button>
                </div>
                {volumePriced && v ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <p>
                      <b>{TIER_LABEL[v.tier]}</b> for about {visitsNum} visits{days.length > 1 ? " a day" : ""}. Final visit counts may affect the final booking price: visits past {v.terms.ceiling + v.terms.grace} are billed at {money(v.terms.overageClinicCents)} each. The price never goes below the tier you book.
                    </p>
                    <p className="mt-1">After the shift you&apos;ll see the provider&apos;s count, and you have {v.disputeHours} hour{v.disputeHours === 1 ? "" : "s"} after the booking completes to dispute it before your card on file is charged.</p>
                    <Checkbox className="mt-3" checked={volumeAck} onChange={(e) => setVolumeAck(e.target.checked)} label="I understand the final price may go up if the day is busier than booked." />
                  </div>
                ) : null}
                {!canPost ? <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle className="size-4 shrink-0" /><span>Finish setup to post: a payment method and the current Clinic Platform Agreement (<a href="/clinic/settings#agreement" className="font-medium underline">sign in Settings</a>). You can save a draft now.</span></p> : null}
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={draft ? updateDraftAction : createShiftAction} successMessage={false}>
                    {draft ? <input type="hidden" name="shiftId" value={draft.id} /> : null}
                    <input type="hidden" name="payload" value={payload} />
                    <input type="hidden" name="mode" value="post" />
                    <SubmitButton size="lg" pendingText="Posting…" disabled={volumePriced && !volumeAck}>{days.length > 1 ? `Post ${days.length}-day booking` : "Post shift"}</SubmitButton>
                  </ActionForm>
                  <ActionForm action={draft ? updateDraftAction : createShiftAction} successMessage={false}>
                    {draft ? <input type="hidden" name="shiftId" value={draft.id} /> : null}
                    <input type="hidden" name="payload" value={payload} />
                    <input type="hidden" name="mode" value="draft" />
                    <SubmitButton variant="outline" size="lg">{draft ? "Save changes" : "Save draft"}</SubmitButton>
                  </ActionForm>
                </div>
              </div>
            ) : null}

            {step >= 3 && volumePriced ? <div className="lg:hidden">{closing(true)}</div> : null}

            <div className="flex justify-between border-t border-slate-100 pt-4">
              <Button type="button" variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 0}><ChevronLeft className="size-4" />Back</Button>
              {step < STEPS.length - 1 ? (
                <Button type="button" disabled={!canNext} onClick={() => { const next = step + 1; setStep(next); if (next >= 3) refreshQuote(); }}>Continue</Button>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </div>
      <div>
        <div className="lg:sticky lg:top-20">
        <Card>
          <CardBody className="space-y-3 py-5">
            <h3 className="font-semibold">Price</h3>
            {pending ? <p className="text-sm text-slate-400">Calculating…</p> : null}
            {quoteError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{quoteError}</p> : null}
            {quote && !pending ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Coverage ({quote.tier === "HOURLY" ? `${quote.billableHours}h` : quote.tier === "HALF_DAY" ? "half day" : `full day${quote.hours > 8 ? ` + ${Math.round((quote.hours - 8) * 100) / 100}h OT` : ""}`})</span><span className="tabular-nums">{money(quote.coverageCents)}</span></div>
                {v ? <div className="flex justify-between text-xs text-slate-500"><span>{TIER_LABEL[v.tier]} · up to {v.terms.ceiling + v.terms.grace} visits</span><span>+{money(v.terms.overageClinicCents)}/visit after</span></div> : null}
                {quote.premiums.map((p) => <div key={p.kind} className="flex justify-between text-xs text-slate-500"><span>incl. {p.kind.toLowerCase()} premium</span><span>+{p.percent}%</span></div>)}
                {quote.discountCents ? <div className="flex justify-between text-emerald-700"><span>Promo {quote.promoCode}</span><span className="tabular-nums">−{money(quote.discountCents)}</span></div> : null}
                {quote.days && quote.days.length > 1 ? (
                  <>
                    {quote.days.map((d) => <div key={d.date} className="flex justify-between text-xs text-slate-600"><span>{d.date}{d.premiums.length ? ` (${d.premiums.map((p) => `${p.kind.toLowerCase()} +${p.percent}%`).join(", ")})` : ""}</span><span className="tabular-nums">{money(d.subtotalCents)}</span></div>)}
                    <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold"><span>Total, {quote.days.length} days</span><span className="tabular-nums">{money(quote.totalCents ?? 0)}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold"><span>Subtotal</span><span className="tabular-nums">{money(quote.subtotalCents)}</span></div>
                )}
                <p className="text-xs text-slate-500">Plus mileage at cost for the provider you confirm{lodgingAllowed ? " and any approved lodging" : ""}. A deposit is charged at confirmation; the balance after the shift.</p>
              </div>
            ) : !quoteError && !pending ? (
              <p className="text-sm text-slate-500">Choose a date and time to see the price.</p>
            ) : null}
            {v ? (
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs">
                {(["LIGHT", "BUSY"] as const).map((t) => (
                  <div key={t} className={cn("rounded-lg border p-2", v.tier === t ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
                    <div className="font-semibold text-slate-800">{TIER_LABEL[t]}</div>
                    <div className="text-slate-500">up to {v.ceilings[t]} visits</div>
                    <div className="mt-0.5 font-medium tabular-nums text-slate-900">from {money(v.clinicPrices[t])}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
        {volumePriced && step >= 3 ? <div className="mt-4 hidden lg:block">{closing(false)}</div> : null}
        </div>
      </div>
    </div>
  );
}
