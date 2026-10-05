import { textingEnabled } from "@cm/integrations";
import { Moon, PhoneCall, Zap } from "lucide-react";
import { oncall } from "@cm/services";
import { InfoTip } from "@/components/ui/info-tip";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, RequiredMark } from "@/components/ui/form";
import { Alert, PageHeader, Stat } from "@/components/ui/misc";
import { dateTimeLabel, pct } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { onCallRuleAction, onCallToggleAction, phoneConfirmAction, phoneStartAction, quietHoursAction, snoozeAction } from "../actions";

export const metadata = { title: "On Call & offers" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const TIER_LABEL = { SAME_DAY: "same-day", SHORT: "short-notice", NEAR: "this-week", PLANNED: "planned" } as const;
const WINDOW = { SAME_DAY: "5 minutes", SHORT: "15 minutes", NEAR: "90 minutes", PLANNED: "2 hours" } as const;

export default async function OnCallPage() {
  const { actor, user } = await requireActor("provider");
  const o = await oncall.onCallOverview(actor);
  const rule = o.rules[0];
  const windows = (rule?.recurringWindows as { weekday: number; startMin: number; endMin: number }[] | undefined) ?? [];
  const p = o.provider;
  const snoozed = p.snoozedUntil && p.snoozedUntil > new Date();
  return (
    <>
      <PageHeader title="On Call & offers" description="Go On Call to be booked instantly for shifts that match your rules — no waiting, no reply needed." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className={o.onCallNow ? "border-brand-300 ring-2 ring-brand-100" : ""}>
            <CardBody className="flex flex-wrap items-center justify-between gap-4 py-5">
              <div className="flex items-center gap-3">
                <span className={`grid size-12 place-items-center rounded-2xl ${o.onCallNow ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"}`}><Zap className="size-6" /></span>
                <div>
                  <div className="text-lg font-semibold">{o.onCallNow ? "You're On Call" : rule?.pausedUntil && rule.pausedUntil > new Date() ? `Paused until ${dateTimeLabel(rule.pausedUntil, p.homeTimeZone)}` : "On Call is off"}</div>
                  <div className="text-sm text-slate-500">{rule ? rule.summary : "Set your rules below, then go On Call."}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {o.onCallNow ? (
                  <>
                    <ActionForm action={onCallToggleAction}><input type="hidden" name="mode" value="pause-today" /><SubmitButton variant="outline" size="sm">Pause for today</SubmitButton></ActionForm>
                    <ActionForm action={onCallToggleAction}><input type="hidden" name="mode" value="off" /><SubmitButton variant="ghost" size="sm">Turn off</SubmitButton></ActionForm>
                  </>
                ) : (
                  <ActionForm action={onCallToggleAction}><input type="hidden" name="mode" value="on" /><SubmitButton disabled={!o.eligibility.ok}>Go On Call</SubmitButton></ActionForm>
                )}
              </div>
            </CardBody>
            {!o.eligibility.ok ? <CardBody className="border-t border-slate-100"><Alert tone="warning" title="Before you can go On Call">{o.eligibility.reasons.join(" · ")}</Alert></CardBody> : null}
          </Card>

          <Card>
            <CardHeader title={<>Your On Call rules<InfoTip label="About On Call">With On Call on, a shift that matches every rule below is accepted for you automatically, so you don&apos;t have to watch for offers. It&apos;s a real booking: you can release it with no penalty only during the short grace period right after it&apos;s booked.</InfoTip></>} description="You're confirmed automatically — and the booking is binding — when a shift you're licensed and available for matches every rule. You get a short grace period to cancel with no penalty." />
            <CardBody>
              <ActionForm action={onCallRuleAction} className="grid gap-4 sm:grid-cols-2">
                {rule ? <input type="hidden" name="ruleId" value={rule.id} /> : null}
                <fieldset className="sm:col-span-2">
                  <legend className="mb-1.5 text-sm font-medium text-slate-700">Professions<RequiredMark /></legend>
                  <div className="flex flex-wrap gap-4">{o.activeProfessions.map((x) => <Checkbox key={x.code} name="professions" value={x.code} defaultChecked={!rule || rule.professionCodes.includes(x.code)} label={x.name} />)}</div>
                  {!o.activeProfessions.length ? <p className="text-sm text-slate-500">You'll be able to choose professions once you're active in at least one.</p> : null}
                </fieldset>
                <fieldset className="sm:col-span-2">
                  <legend className="mb-1.5 text-sm font-medium text-slate-700">Days</legend>
                  <div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <Checkbox key={d} name={`day-${i}`} defaultChecked={rule ? windows.some((w) => w.weekday === i) : i >= 1 && i <= 5} label={d} />)}</div>
                </fieldset>
                <Field label="From"><Input type="time" name="start" defaultValue={windows[0] ? hhmm(windows[0].startMin) : "07:00"} /></Field>
                <Field label="Until"><Input type="time" name="end" defaultValue={windows[0] ? hhmm(windows[0].endMin) : "18:00"} /></Field>
                <Field label="Or specific dates — from"><Input type="date" name="dateFrom" /></Field>
                <Field label="to"><Input type="date" name="dateTo" /></Field>
                <Field label="Max drive (minutes)" hint={`Up to your profile max of ${p.maxDriveMinutes}.`}><Input type="number" name="maxDriveMinutes" min={5} max={p.maxDriveMinutes} defaultValue={rule?.maxDriveMinutes ?? Math.min(45, p.maxDriveMinutes)} /></Field>
                <Field label={<>Minimum notice (minutes)<InfoTip label="About minimum notice">Shifts starting sooner than this won&apos;t be auto-accepted, so you always have time to get ready and drive there.</InfoTip></>}><Input type="number" name="minNotice" min={0} defaultValue={rule?.minNoticeMinutes ?? 90} /></Field>
                <Field label={<>Min pay — full day ($)<InfoTip label="About minimum pay">Only shifts paying at least this much (before mileage) are auto-accepted. Leave blank to accept any rate.</InfoTip></>}><Input name="minFull" inputMode="decimal" defaultValue={rule?.minPayFullDayCents ? rule.minPayFullDayCents / 100 : ""} /></Field>
                <Field label="Min pay — half day ($)"><Input name="minHalf" inputMode="decimal" defaultValue={rule?.minPayHalfDayCents ? rule.minPayHalfDayCents / 100 : ""} /></Field>
                <Field label="Min pay — hourly ($/hr)"><Input name="minHourly" inputMode="decimal" defaultValue={rule?.minPayHourlyCents ? rule.minPayHourlyCents / 100 : ""} /></Field>
                <Field label={<>Min clinic rating<InfoTip label="About clinic rating">The average rating providers gave the clinic. When this is set, clinics that don&apos;t have ratings yet aren&apos;t auto-accepted; choose Any to include them.</InfoTip></>}><Select name="minClinicRating" defaultValue={rule?.minClinicRating?.toString() ?? ""}><option value="">Any</option>{[4, 4.5, 4.8].map((r) => <option key={r} value={r}>{r}★+</option>)}</Select></Field>
                <Field label={<>Max On Call shifts per day<InfoTip label="About daily limit">A cap on how many shifts On Call books for you in one day. Shifts you accept yourself don&apos;t count.</InfoTip></>}><Input type="number" name="maxPerDay" min={1} max={3} defaultValue={rule?.maxPerDay ?? 1} /></Field>
                <Field label="Max per week"><Input type="number" name="maxPerWeek" min={1} max={14} defaultValue={rule?.maxPerWeek ?? 5} /></Field>
                <div className="space-y-2 sm:col-span-2">
                  <Checkbox name="favoritesOnly" defaultChecked={rule?.favoritesOnly} label={<>Only clinics I&apos;ve favorited<InfoTip label="About favorites only">On Call only books shifts at clinics you&apos;ve marked as favorites. You can favorite a clinic after completing a shift there.</InfoTip></>} />
                  <Checkbox name="allowOvernight" defaultChecked={rule?.allowOvernight} label="Allow overnight shifts where lodging is covered" />
                </div>
                <div className="sm:col-span-2"><SubmitButton>Save rules</SubmitButton></div>
              </ActionForm>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><PhoneCall className="size-4 text-accent-600" />Mobile & texts</span>} />
            <CardBody className="space-y-3">
              {!textingEnabled() ? <Alert tone="info" title="By email for now">Text alerts are coming soon. Until then, shift offers and alerts are emailed to you, so keep an eye on your inbox.</Alert> : (<>
              {user.phoneVerifiedAt ? <div className="text-sm">Verified: <strong>{user.phone}</strong> {p.smsConsentAt ? <Badge tone="green">Texts on</Badge> : <Badge tone="amber">Texts off</Badge>}</div> : null}
              <ActionForm action={phoneStartAction} className="flex gap-2">
                <Input name="phone" type="tel" placeholder="(407) 555-0123" defaultValue={user.phone ?? ""} required />
                <SubmitButton variant="outline" size="md">Send code</SubmitButton>
              </ActionForm>
              <ActionForm action={phoneConfirmAction} className="space-y-2">
                <Input name="code" inputMode="numeric" maxLength={6} placeholder="6-digit code" required />
                <Checkbox name="consent" defaultChecked label="Text me shift offers and account alerts. Msg & data rates may apply. Reply STOP to opt out." />
                <SubmitButton size="sm">Verify</SubmitButton>
              </ActionForm>
              </>)}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Pause offers" />
            <CardBody className="space-y-2">
              {snoozed ? <Alert tone="info">Offers paused until {dateTimeLabel(p.snoozedUntil!, p.homeTimeZone)}.</Alert> : null}
              <div className="flex flex-wrap gap-2">
                {snoozed ? (
                  <ActionForm action={snoozeAction}><input type="hidden" name="mode" value="resume" /><SubmitButton size="sm">Resume offers</SubmitButton></ActionForm>
                ) : (
                  <>
                    <ActionForm action={snoozeAction}><input type="hidden" name="mode" value="today" /><SubmitButton size="sm" variant="outline">For today</SubmitButton></ActionForm>
                    <ActionForm action={snoozeAction}><input type="hidden" name="mode" value="week" /><SubmitButton size="sm" variant="outline">This week</SubmitButton></ActionForm>
                  </>
                )}
              </div>
              <ActionForm action={snoozeAction} className="flex gap-2"><input type="hidden" name="mode" value="until" /><Input type="date" name="until" required className="h-9" /><SubmitButton size="sm" variant="ghost">Pause until</SubmitButton></ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Moon className="size-4 text-accent-600" />Quiet hours</span>} description="No offers during these hours." />
            <CardBody>
              <ActionForm action={quietHoursAction} className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input type="time" name="start" defaultValue={hhmm(p.quietHoursStart)} aria-label="Quiet from" />
                  <Input type="time" name="end" defaultValue={hhmm(p.quietHoursEnd)} aria-label="Quiet until" />
                </div>
                <Checkbox name="urgent" defaultChecked={p.urgentDuringQuietHours} label={<>Still send urgent (same-day / next-day) offers<InfoTip label="About urgent offers">Last-minute cover, often with a rescue bonus. Turn this off to never be contacted during quiet hours.</InfoTip></>} />
                <SubmitButton size="sm" variant="outline">Save</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={<>How quickly you answer<InfoTip label="About response speed">The share of offers you answered, yes or no, within the window. Providers who answer quickly are asked first, so a quick no helps you too.</InfoTip></>} description="Only you see this. Declining counts as answering — it helps clinics too." />
            <CardBody className="grid grid-cols-2 gap-2">
              {(["SAME_DAY", "SHORT", "NEAR", "PLANNED"] as const).map((t) => {
                const r = o.responsiveness.find((x) => x.tier === t);
                return <Stat key={t} label={TIER_LABEL[t]} value={r && r.offers >= 1 ? pct(r.hits / r.offers) : "—"} hint={`answered within ${WINDOW[t]}`} />;
              })}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
