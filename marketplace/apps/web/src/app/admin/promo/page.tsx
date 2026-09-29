import QRCode from "qrcode";
import { env } from "@cm/config";
import { promo } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { dateLabel, money, pct } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { createPromoAction, dripCopyAction, landingAction, togglePromoAction } from "../actions";

export const metadata = { title: "Promo codes" };

export default async function Promo() {
  const { actor } = await requireActor("admin");
  const codes = await promo.listPromos(actor);
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  const qrs = Object.fromEntries(await Promise.all(codes.filter((c) => c.landingEnabled).map(async (c) => [c.code, await QRCode.toDataURL(`${base}/offer/${c.code}?utm_source=qr`, { margin: 1, width: 160 })])));
  return (
    <>
      <PageHeader title="Promo codes" description="Discounts come out of the platform margin only — never provider pay or mileage. Personal codes (welcome offers and campaign sign-ups) are managed from Leads." />
      <Card className="mb-6">
        <CardHeader title="Create a code" />
        <CardBody>
          <ActionForm action={createPromoAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" resetOnSuccess>
            <Field label="Code"><Input name="code" required placeholder="SPRING26" className="font-mono uppercase" /></Field>
            <Field label="Type"><Select name="kind"><option value="PERCENT">% off</option><option value="FIXED">$ off</option></Select></Field>
            <Field label="Value" hint="Percent, or dollars for $ off"><Input name="value" inputMode="decimal" required /></Field>
            <Field label="Total uses (blank = unlimited)"><Input name="maxUses" type="number" min={1} /></Field>
            <Field label="Uses per clinic"><Input name="maxUsesPerClinic" type="number" min={1} defaultValue={1} /></Field>
            <Field label="Starts"><Input name="startsAt" type="date" /></Field>
            <Field label="Expires"><Input name="expiresAt" type="date" /></Field>
            <Field label="Internal note"><Input name="description" /></Field>
            <Checkbox name="firstShiftOnly" label="First shift only" className="sm:col-span-2" />
            <div className="lg:col-span-4"><SubmitButton>Create code</SubmitButton></div>
          </ActionForm>
        </CardBody>
      </Card>
      <div className="space-y-4">
        {codes.map((c) => {
          const drip = (c.dripCustom as { subject: string; intro: string }[] | null) ?? [];
          return (
            <Card key={c.id}>
              <CardHeader
                title={<span className="font-mono">{c.code}</span>}
                description={`${c.label}${c.firstShiftOnly ? " · first shift only" : ""} · used ${c.usedCount}${c.maxUses ? `/${c.maxUses}` : ""}${c.expiresAt ? ` · expires ${dateLabel(c.expiresAt)}` : ""}`}
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone={c.active ? "green" : "gray"}>{c.active ? "Active" : "Off"}</Badge>
                    <ActionForm action={togglePromoAction} successMessage={false}><input type="hidden" name="code" value={c.code} /><input type="hidden" name="active" value={c.active ? "0" : "1"} /><SubmitButton size="sm" variant="outline">{c.active ? "Turn off" : "Turn on"}</SubmitButton></ActionForm>
                  </div>
                }
              />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
                  {[["Page visits", c.stats.visits], ["Sign-ups", c.stats.signups], ["Visit→sign-up", pct(c.stats.visits ? c.stats.signups / c.stats.visits : null)], ["Redemptions", c.stats.redemptions], ["Discount given", money(c.stats.discountCents)], ["Revenue", money(c.stats.revenueCents)]].map(([l, v]) => (
                    <div key={l as string} className="rounded-xl bg-slate-50 p-2.5"><div className="text-xs text-slate-500">{l}</div><div className="font-semibold">{v}</div></div>
                  ))}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">Campaign landing page {c.landingEnabled ? "(on)" : "(off)"}</summary>
                  <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto]">
                    <ActionForm action={landingAction} className="space-y-3">
                      <input type="hidden" name="code" value={c.code} />
                      <Checkbox name="enabled" defaultChecked={c.landingEnabled} label="Landing page on — the code itself can then only be redeemed via personal copies from the page" />
                      <Field label="Audience"><Select name="audience" defaultValue={c.landingAudience}><option value="CLINIC">Clinics (issues a personal code)</option><option value="PROVIDER">Providers (lead capture only)</option></Select></Field>
                      <Field label="Headline"><Input name="headline" defaultValue={c.landingHeadline ?? ""} maxLength={200} /></Field>
                      <Field label="Description"><Textarea name="description" defaultValue={c.landingDescription ?? ""} maxLength={1000} /></Field>
                      <SubmitButton size="sm">Save landing page</SubmitButton>
                    </ActionForm>
                    {c.landingEnabled ? (
                      <div className="text-center text-xs">
                        <img src={qrs[c.code]} alt={`QR code for ${c.code}`} className="mx-auto rounded-lg border border-slate-200" width={160} height={160} />
                        <a href={`/offer/${c.code}?preview=1`} target="_blank" className="mt-2 block text-brand-700">Preview page</a>
                        <div className="mt-1 break-all font-mono text-slate-500">{base}/offer/{c.code}</div>
                        <a href={qrs[c.code]} download={`${c.code}-qr.png`} className="mt-1 block text-brand-700">Download QR</a>
                      </div>
                    ) : null}
                  </div>
                </details>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">Follow-up email copy</summary>
                  <ActionForm action={dripCopyAction} className="mt-3 space-y-3">
                    <input type="hidden" name="code" value={c.code} />
                    <p className="text-xs text-slate-500">Leave blank to use the standard email for that step.</p>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[200px_1fr]">
                        <Input name={`subject-${i}`} defaultValue={drip[i]?.subject ?? ""} placeholder={`Email ${i + 1} subject`} />
                        <Textarea name={`intro-${i}`} defaultValue={drip[i]?.intro ?? ""} placeholder="Opening paragraph" className="min-h-10" />
                      </div>
                    ))}
                    <SubmitButton size="sm" variant="outline">Save emails</SubmitButton>
                  </ActionForm>
                </details>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
