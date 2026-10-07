import { admin, emaildns, google } from "@cm/services";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { env } from "@cm/config";
import { GoogleBrowserCheck } from "@/components/admin/google-browser-check";
import { googleCheckAction, settingAction, testEmailAction, testTextAction } from "../actions";

export const metadata = { title: "Settings" };

const DNS_TONE = { ok: "green", warn: "amber", fail: "red" } as const;
const DNS_LABEL = { ok: "OK", warn: "Improve", fail: "Missing / wrong" } as const;

export default async function Settings({ searchParams }: { searchParams: Promise<{ emailcheck?: string }> }) {
  const { actor, user } = await requireActor("admin");
  const dnsCheck = (await searchParams).emailcheck ? await emaildns.emailDnsCheck(actor).catch(() => null) : null;
  const rows = await admin.settingsView(actor);
  const groups = [...new Set(rows.map((r) => r.group))];
  const open = rows.filter((r) => r.flag).length;
  return (
    <>
      <PageHeader title="Settings" description={`Every owner decision and threshold lives here. ${open} are flagged OWNER DECISION or ATTORNEY REVIEW. Changes are audit-logged.`} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Email check" description="Sends a test email the same way signup confirmations and booking emails go out, and shows the email service's exact reply if it fails." />
          <ActionForm action={testEmailAction} className="flex flex-wrap items-center gap-2 px-5 pb-5">
            <Input name="to" type="email" required defaultValue={user.email} className="w-72" />
            <SubmitButton size="sm" variant="outline">Send test email</SubmitButton>
          </ActionForm>
        </Card>
        <Card id="email-dns" className="scroll-mt-20">
          <CardHeader
            title="Email deliverability check"
            description={`Looks up the DNS records inbox providers check before trusting mail from ${emaildns.sendingDomain()} (SPF, DKIM, DMARC, MX) and says exactly what to add. Without them, booking and outreach emails tend to land in spam.`}
          />
          <CardBody className="space-y-3 pt-0">
            <Link href="?emailcheck=1#email-dns" className={buttonClass("outline", "sm")}>{dnsCheck ? "Check again" : "Check DNS records"}</Link>
            {dnsCheck ? (
              <ul className="space-y-3 text-sm">
                {dnsCheck.checks.map((c) => (
                  <li key={c.key} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center gap-2 font-medium">{c.label} <Badge tone={DNS_TONE[c.state]}>{DNS_LABEL[c.state]}</Badge></div>
                    {c.found ? <div className="mt-1 break-all font-mono text-xs text-slate-500">{c.found}</div> : null}
                    {c.fix ? <div className="mt-1 text-slate-700">{c.fix}</div> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Google check" description="Tests both Maps keys and shows Google's exact answer. The server key (GOOGLE_MAPS_API_KEY) does address lookup, time zones and drive times; the browser key (GOOGLE_MAPS_BROWSER_KEY) gives address suggestions as people type." />
          <div className="flex flex-wrap items-start gap-4 px-5 pb-5">
            <ActionForm action={googleCheckAction}>
              <SubmitButton size="sm" variant="outline" pendingText="Checking…">Test server key</SubmitButton>
            </ActionForm>
            <GoogleBrowserCheck browserKey={env().GOOGLE_MAPS_BROWSER_KEY ?? null} />
          </div>
        </Card>
        {(() => {
          const g = google.googleSetupStatus();
          return (
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-2">Sign in with Google {g.enabled ? <Badge tone="green">On</Badge> : <Badge tone="amber">Off</Badge>}</span>}
                description="The Continue with Google button shows on sign-in and sign-up once the app sees both keys below (Setup Node.js App → Environment variables, then Stop App and Start App)."
              />
              <dl className="grid gap-2 px-5 pb-5 text-sm sm:grid-cols-[14rem_1fr]">
                <dt className="font-mono text-xs text-slate-500">GOOGLE_CLIENT_ID</dt>
                <dd>{g.clientId ? <span className="font-mono text-xs">{g.clientId}</span> : <span className="text-red-700">Not set</span>}{g.clientId && !g.clientIdLooksRight ? <span className="ml-2 text-amber-700">Should end in .apps.googleusercontent.com (that&apos;s the Client ID, not the project ID).</span> : null}</dd>
                <dt className="font-mono text-xs text-slate-500">GOOGLE_CLIENT_SECRET</dt>
                <dd>{g.secretSet ? "Set" : <span className="text-red-700">Not set</span>}</dd>
                <dt className="text-xs text-slate-500">Authorized redirect URI</dt>
                <dd className="font-mono text-xs">{g.redirectUri} <span className="font-sans text-slate-500">(add exactly this in Google Cloud → Credentials → your OAuth client)</span></dd>
                {g.lookalikes.length ? (
                  <>
                    <dt className="text-xs text-slate-500">Similar names found</dt>
                    <dd className="text-amber-700">{g.lookalikes.join(", ")}: if one of these holds the Google sign-in key, rename it to the name above.</dd>
                  </>
                ) : null}
              </dl>
            </Card>
          );
        })()}
        <Card>
          <CardHeader title="Text message check" description="Sends a test text through Twilio, waits for the delivery result, and explains any Twilio error in plain words (missing keys, trial account, A2P 10DLC / toll-free registration, wrong sender…)." />
          <ActionForm action={testTextAction} className="flex flex-wrap items-center gap-2 px-5 pb-5">
            <Input name="to" type="tel" required defaultValue={user.phone ?? ""} placeholder="Your mobile number" className="w-72" />
            <SubmitButton size="sm" variant="outline" pendingText="Sending… (up to 15 seconds)">Send test text</SubmitButton>
          </ActionForm>
        </Card>
        {groups.map((g) => (
          <Card key={g} id={`g-${g.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="scroll-mt-20">
            <CardHeader title={g} />
            <div className="divide-y divide-slate-100">
              {rows.filter((r) => r.group === g).map((r) => {
                const complex = typeof r.value === "object";
                const unit = unitFor(r.key);
                return (
                  <div key={r.key} id={`s-${r.key}`} className="scroll-mt-20 target:bg-accent-50"><ActionForm action={settingAction} className="grid gap-2 px-5 py-3 sm:grid-cols-[1fr_320px_auto] sm:items-center">
                    <input type="hidden" name="key" value={r.key} />
                    <div>
                      <div className="text-sm font-medium">{r.label} {r.flag ? <Badge tone={r.flag === "ATTORNEY_REVIEW" ? "red" : "amber"}>{r.flag === "ATTORNEY_REVIEW" ? "Attorney review" : "Owner decision"}</Badge> : null}</div>
                      <div className="font-mono text-xs text-slate-400">{r.key}</div>
                      {r.help ? <div className="text-xs text-slate-500">{r.help}</div> : null}
                    </div>
                    {complex ? (
                      <Textarea name="value" defaultValue={JSON.stringify(r.value, null, 1)} className="min-h-20 font-mono text-xs" />
                    ) : typeof r.value === "boolean" ? (
                      <Select name="value" defaultValue={String(r.value)}>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </Select>
                    ) : unit.money ? (
                      <div className="flex items-center gap-2">
                        <input type="hidden" name="unit" value="cents" />
                        <span className="text-sm text-slate-500">$</span>
                        <Input name="value" type="number" step="0.01" min={0} defaultValue={(Number(r.value) / 100).toFixed(2)} className="text-right" />
                        {unit.suffix ? <span className="shrink-0 text-sm text-slate-500">{unit.suffix}</span> : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input name="value" defaultValue={String(r.value)} className={unit.suffix ? "text-right" : "font-mono"} />
                        {unit.suffix ? <span className="shrink-0 text-sm text-slate-500">{unit.suffix}</span> : null}
                      </div>
                    )}
                    <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                  </ActionForm></div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

/** How a setting's number is shown: money in dollars (stored as cents), with a unit after it. */
function unitFor(key: string): { money: boolean; suffix: string | null } {
  if (/Cents/.test(key)) return { money: true, suffix: /PerMile/.test(key) ? "per mile" : /PerHour/.test(key) ? "per hour" : null };
  if (/Percent$/.test(key)) return { money: false, suffix: "%" };
  if (/Hours$/.test(key)) return { money: false, suffix: "hours" };
  if (/(Minutes|Min)$/.test(key)) return { money: false, suffix: "min" };
  if (/Days$/.test(key)) return { money: false, suffix: "days" };
  if (/Months$/.test(key)) return { money: false, suffix: "months" };
  return { money: false, suffix: null };
}
