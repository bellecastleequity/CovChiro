import QRCode from "qrcode";
import { env } from "@cm/config";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { saveCampaignAction } from "../actions";
import { GrowthTabs, usd } from "../ui";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function Campaigns() {
  const { actor } = await requireActor("admin");
  const [a, schools] = await Promise.all([growth.campaigns(actor), growth.schoolFunnel()]);
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  const qrs = Object.fromEntries(await Promise.all(a.byCampaign.filter((c) => c.campaign.audience === "PROVIDER").map(async ({ campaign: c }) => [c.code, await QRCode.toDataURL(`${base}/join/${c.code}?utm_source=qr`, { margin: 1, width: 600, color: { dark: "#282472", light: "#ffffff" } })])));
  return (
    <>
      <PageHeader title="Campaigns" description="Provider and clinic campaigns: school and event links (/join/CODE) with print-ready QR codes, recruitment pushes in a metro (tag a market's prospects under Supply & Demand), and clinic campaigns. Success is measured to coverage-ready and first shift for providers, and to completed bookings for clinics. Sign-ups alone don't count." />
      <GrowthTabs current="/admin/growth/campaigns" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {a.byCampaign.map((m) => {
          const { campaign: c, registered, coverageReady, firstShift, clinics, clinicsBooked } = m;
          const cac = c.audience === "PROVIDER" ? (coverageReady ? Math.round(c.spendCents / coverageReady) : null) : clinicsBooked ? Math.round(c.spendCents / clinicsBooked) : null;
          return (
            <Card key={c.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-semibold">{c.name}</div><div className="font-mono text-xs text-slate-500">{c.audience === "PROVIDER" ? `/join/${c.code}` : c.code}</div></div>
                  <div className="flex gap-1"><Badge>{c.kind}</Badge>{c.active ? null : <Badge tone="red">Inactive</Badge>}</div>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div><dt className="text-slate-500">Visits</dt><dd className="text-lg font-semibold tabular-nums">{c.visits}</dd></div>
                  <div><dt className="text-slate-500">{c.audience === "PROVIDER" ? "Registered" : "Prospects"}</dt><dd className="text-lg font-semibold tabular-nums">{c.audience === "PROVIDER" ? registered : clinics}</dd></div>
                  <div><dt className="text-slate-500">{c.audience === "PROVIDER" ? "Coverage-ready" : "Booked"}</dt><dd className="text-lg font-semibold tabular-nums">{c.audience === "PROVIDER" ? coverageReady : clinicsBooked}</dd></div>
                </dl>
                <p className="mt-2 text-xs text-slate-500">{c.geography ? `${c.geography} · ` : ""}{c.professionCode} · {m.messagesSent} sent · {m.replies} replies</p>
                <p className="text-xs text-slate-500">{c.audience === "PROVIDER" ? `${firstShift} first shift · ${m.providerShifts} completed shifts · ` : `${m.clinicAccounts} accounts · ${m.coverageRequests} requests · ${m.completedBookings} completed · `}spend {usd(c.spendCents)} · cost per conversion {usd(cac)}</p>
                {qrs[c.code] ? (
                  <div className="mt-3 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrs[c.code]} alt={`QR code for /join/${c.code}`} className="size-24 rounded border border-slate-200" />
                    <a href={qrs[c.code]} download={`join-${c.code}-qr.png`} className="text-sm font-medium text-brand-700 hover:underline">Download QR (print size)</a>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader title="School recruiting" description="Students and graduates by school, through to repeat provider. Connected to the student (pre-licensure) path: the school comes from their sign-up." />
        <Table>
          <thead><tr><Th>School</Th><Th className="text-right">Leads</Th><Th className="text-right">Graduates</Th><Th className="text-right">Licensed</Th><Th className="text-right">Malpractice</Th><Th className="text-right">Coverage-ready</Th><Th className="text-right">First shift</Th><Th className="text-right">Repeat</Th></tr></thead>
          <tbody>
            {schools.length ? schools.map((r) => <tr key={r.school}><Td>{r.school}</Td>{([r.leads, r.graduates, r.licensed, r.insured, r.coverageReady, r.firstShift, r.repeat]).map((n, i) => <Td key={i} className="text-right tabular-nums">{n}</Td>)}</tr>) : <tr><Td colSpan={8} className="text-slate-500">No providers with a school yet.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Message versions → outcomes" description="Per prompt version, how many recipients went on to engage or book (clinics) or become coverage-ready and take a first shift (providers)." />
          <Table>
            <thead><tr><Th>Prompt</Th><Th className="text-right">Sent</Th><Th className="text-right">Engaged</Th><Th className="text-right">Booked</Th><Th className="text-right">Ready</Th><Th className="text-right">1st shift</Th></tr></thead>
            <tbody>
              {a.prompts.map((p) => <tr key={`${p.key}${p.version}`}><Td className="font-mono text-xs">{p.key} v{p.version}</Td><Td className="text-right tabular-nums">{p.sent}</Td><Td className="text-right tabular-nums">{p.engaged}</Td><Td className="text-right tabular-nums">{p.booked}</Td><Td className="text-right tabular-nums">{p.coverageReady}</Td><Td className="text-right tabular-nums">{p.firstShift}</Td></tr>)}
              {!a.prompts.length ? <tr><Td colSpan={6} className="text-slate-500">No messages sent yet.</Td></tr> : null}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Add or edit a campaign" description="Same code updates the existing campaign. Spend feeds the CAC numbers." />
          <CardBody>
            <ActionForm action={saveCampaignAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Code (URL)"><Input name="code" required placeholder="palmer-fall26" /></Field>
              <Field label="Name"><Input name="name" required placeholder="Palmer career fair, fall 2026" /></Field>
              <Field label="Audience"><Select name="audience"><option value="PROVIDER">Providers (/join link)</option><option value="CLINIC">Clinics</option></Select></Field>
              <Field label="Kind"><Select name="kind">{["school", "event", "ads", "social", "email", "referral", "other"].map((k) => <option key={k}>{k}</option>)}</Select></Field>
              <Field label="School name"><Input name="schoolName" /></Field>
              <Field label="Geography"><Input name="geography" placeholder="Jacksonville, FL" /></Field>
              <Field label="Profession code"><Input name="professionCode" defaultValue="DC" /></Field>
              <Field label="Spend to date ($)"><Input name="spend" inputMode="decimal" placeholder="0" /></Field>
              <Field label="Landing headline" className="sm:col-span-2"><Input name="headline" /></Field>
              <Field label="Landing text" className="sm:col-span-2"><Textarea name="body" /></Field>
              <div><SubmitButton size="sm">Save campaign</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
