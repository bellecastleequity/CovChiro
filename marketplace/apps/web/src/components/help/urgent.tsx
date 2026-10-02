import Link from "next/link";
import { ArrowLeft, BellOff, Clock, Mail, MessageSquareText, PhoneCall, Siren } from "lucide-react";
import { prisma } from "@cm/db";
import { getSettings, type Actor } from "@cm/services";
import { escalateAction } from "@/app/help-actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, PhiNotice, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import type { HelpCenter } from "@/lib/help/types";

const METHODS = [
  { v: "CALLBACK", label: "Call me back", Icon: PhoneCall },
  { v: "TEXT", label: "Text me", Icon: MessageSquareText },
  { v: "EMAIL", label: "Email me", Icon: Mail },
] as const;

const pretty = (p: string | null) => (p ?? "").replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

/** Tips so our call or text actually gets through. */
function StandBy({ method }: { method: string }) {
  return (
    <ul className="mt-2 space-y-1.5 text-sm">
      {method !== "EMAIL" ? (
        <>
          <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0" />Keep your phone with you for the next 30 minutes.</li>
          <li className="flex gap-2">
            <BellOff className="mt-0.5 size-4 shrink-0" />
            Turn off call blocking for now: on iPhone, Settings → Phone → Silence Unknown Callers (off); on Android, Phone → Settings → Spam / Caller ID protection (off). We may call from a number you don&apos;t recognize.
          </li>
        </>
      ) : (
        <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0" />Watch your inbox, and check spam or junk in case our reply lands there.</li>
      )}
    </ul>
  );
}

export async function UrgentHelp({ center, actor, user, shiftId, sentId }: { center: HelpCenter; actor: Actor; user: { name: string; email: string; phone: string | null }; shiftId?: string; sentId?: string }) {
  const s = await getSettings();
  if (sentId) {
    const r = await prisma.supportRequest.findFirst({ where: { id: sentId, userId: actor.userId! } });
    if (r) {
      const how = r.contactMethod === "EMAIL" ? `email you at ${r.contactEmail}` : r.contactMethod === "TEXT" ? `text you at ${pretty(r.contactPhone)}` : `call you at ${pretty(r.contactPhone)}`;
      return (
        <div className="mx-auto max-w-2xl">
          <PageHeader eyebrow="Need help now?" title="We're on it. Please stand by." />
          <Alert tone="success" title={`We'll ${how} within minutes.`}>
            {s["support.urgentPromise"]}
            <StandBy method={r.contactMethod ?? "CALLBACK"} />
          </Alert>
          <p className="mt-4 text-sm text-slate-600">
            You can follow this request and add details any time in <Link href={`${center.base}/requests/${r.id}`} className="font-medium text-brand-700 underline">your request</Link>.
          </p>
        </div>
      );
    }
  }
  const since = new Date(Date.now() - 2 * 86_400_000);
  const shifts =
    center.audience === "clinic"
      ? await prisma.shift.findMany({ where: { location: { clinicOrgId: actor.clinicOrgId! }, startsAt: { gte: since }, status: { not: "DRAFT" } }, include: { location: { select: { name: true, timeZone: true } } }, orderBy: { startsAt: "asc" }, take: 20 })
      : await prisma.shift.findMany({ where: { assignments: { some: { providerId: actor.providerId! } }, startsAt: { gte: since } }, include: { location: { select: { name: true, timeZone: true } } }, orderBy: { startsAt: "asc" }, take: 20 });
  return (
    <div className="mx-auto max-w-2xl">
      <Link href={center.base} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" />
        Help center
      </Link>
      <PageHeader eyebrow="Need help now?" title="Reach our team right away" description={`For anything that can't wait: a no-show, a problem at the clinic, a payment issue today. ${s["support.urgentPromise"]}`} />
      <Card className="border-red-200">
        <CardBody>
          <ActionForm action={escalateAction} className="space-y-5" successMessage={false}>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-800">How should we reach you?</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {METHODS.map((m, i) => (
                  <label key={m.v} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-800 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                    <input type="radio" name="method" value={m.v} defaultChecked={i === 0} className="size-4 text-brand-600" />
                    <m.Icon className="size-4 text-accent-600" />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Best phone number" hint="Needed for a call or text.">
                <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={pretty(user.phone)} placeholder="(555) 555-5555" />
              </Field>
              <Field label="Best email" hint="Needed if you'd like an email.">
                <Input name="email" type="email" autoComplete="email" defaultValue={user.email} />
              </Field>
            </div>
            {shifts.length ? (
              <Field label="Which shift? (optional)">
                <Select name="shiftId" defaultValue={shiftId ?? ""}>
                  <option value="">Not about a specific shift</option>
                  {shifts.map((sh) => <option key={sh.id} value={sh.id}>{dateLabel(sh.startsAt, sh.location.timeZone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {sh.location.name}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field label="What's happening?">
              <Textarea name="body" required minLength={5} maxLength={4000} rows={4} placeholder="e.g. Our provider hasn't arrived and patients are waiting." />
              <PhiNotice />
            </Field>
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <b>Please stand by after you send this.</b> We&apos;ll reach you within minutes.
              <StandBy method="CALLBACK" />
            </div>
            <SubmitButton size="lg" variant="danger" pendingText="Sending…">
              <Siren className="size-4" />
              Get help now
            </SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
      <p className="mt-4 text-sm text-slate-500">
        Not urgent? <Link href={`${center.base}/contact`} className="font-medium text-brand-700 underline">Send a regular request</Link>. {s["support.replyTime"]}
      </p>
    </div>
  );
}
