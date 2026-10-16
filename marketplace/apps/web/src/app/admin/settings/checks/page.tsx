import { emaildns, google } from "@cm/services";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { env } from "@cm/config";
import { GoogleBrowserCheck } from "@/components/admin/google-browser-check";
import { googleCheckAction, testEmailAction, testTextAction } from "../../actions";

export const metadata = { title: "Checks & connections" };

const DNS_TONE = { ok: "green", warn: "amber", fail: "red" } as const;
const DNS_LABEL = { ok: "OK", warn: "Improve", fail: "Missing / wrong" } as const;

/** Test tools for the outside services (email, DNS, Google, texts), moved off the Settings page. */
export default async function SettingsChecks({ searchParams }: { searchParams: Promise<{ emailcheck?: string }> }) {
  const { actor, user } = await requireActor("admin");
  const dnsCheck = (await searchParams).emailcheck ? await emaildns.emailDnsCheck(actor).catch(() => null) : null;
  return (
    <>
      <PageHeader back={{ href: "/admin/settings", label: "Settings" }} title="Checks & connections" description="Test that email, texts and Google keys work, and see what DNS records email needs." />
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
      </div>
    </>
  );
}
