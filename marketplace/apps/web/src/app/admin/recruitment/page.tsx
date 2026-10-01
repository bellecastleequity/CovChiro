import QRCode from "qrcode";
import { US_STATES } from "@cm/core";
import { prelicensure } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { saveCampaignAction } from "../actions";

export const metadata = { title: "Recruitment" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function CampaignFields({ c }: { c?: { slug: string; name: string; kind: string; state: string | null; city: string | null; headline: string | null; costCents: number; active: boolean } }) {
  return (
    <>
      <Field label="Name" htmlFor={`name-${c?.slug ?? "new"}`}>
        <Input id={`name-${c?.slug ?? "new"}`} name="name" defaultValue={c?.name} placeholder="e.g. Palmer Florida — spring graduation fair" required />
      </Field>
      <Field label="Link name" hint="coverageoncall.com/join/<this>" htmlFor={`slug-${c?.slug ?? "new"}`}>
        <Input id={`slug-${c?.slug ?? "new"}`} name="slug" defaultValue={c?.slug} placeholder="palmer-spring26" required />
      </Field>
      <Field label="Type" htmlFor={`kind-${c?.slug ?? "new"}`}>
        <Select id={`kind-${c?.slug ?? "new"}`} name="kind" defaultValue={c?.kind ?? "SCHOOL"}>
          <option value="SCHOOL">Chiropractic school</option>
          <option value="EVENT">Graduation / school event</option>
          <option value="CAMPAIGN">Other campaign</option>
        </Select>
      </Field>
      <Field label="Spend to date ($)" htmlFor={`cost-${c?.slug ?? "new"}`}>
        <Input id={`cost-${c?.slug ?? "new"}`} name="costDollars" type="number" min={0} step="0.01" defaultValue={c ? c.costCents / 100 : 0} />
      </Field>
      <Field label="City" htmlFor={`city-${c?.slug ?? "new"}`}>
        <Input id={`city-${c?.slug ?? "new"}`} name="city" defaultValue={c?.city ?? ""} />
      </Field>
      <Field label="State" htmlFor={`state-${c?.slug ?? "new"}`}>
        <Select id={`state-${c?.slug ?? "new"}`} name="state" defaultValue={c?.state ?? ""}>
          <option value="">—</option>
          {Object.keys(US_STATES).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </Field>
      <Field label="Landing headline (optional)" className="sm:col-span-2" htmlFor={`headline-${c?.slug ?? "new"}`}>
        <Input id={`headline-${c?.slug ?? "new"}`} name="headline" defaultValue={c?.headline ?? ""} placeholder="Join the Chiropractic Coverage Network" />
      </Field>
      <Checkbox name="active" defaultChecked={c?.active ?? true} label="Active (link works)" />
    </>
  );
}

export default async function Recruitment() {
  const { actor } = await requireActor("admin");
  const rows = await prelicensure.campaignReport(actor);
  const qrs = Object.fromEntries(
    await Promise.all(rows.filter((r) => r.active).map(async (r) => [r.id, await QRCode.toDataURL(`${r.url}?utm_source=qr`, { margin: 1, width: 180, color: { dark: "#282472", light: "#ffffff" } })])),
  );
  return (
    <>
      <PageHeader
        title="Recruitment links"
        description="One link and QR code per chiropractic school, graduation event or campaign. Everyone who signs up through a link is attributed to it and lands on the student path (no license needed to join; shifts unlock only after verification)."
      />
      <Card className="mb-6">
        <CardHeader title="Add a link" />
        <CardBody>
          <ActionForm action={saveCampaignAction} className="grid gap-4 sm:grid-cols-2" resetOnSuccess>
            <CampaignFields />
            <div className="sm:col-span-2">
              <SubmitButton>Add link</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Link</Th>
              <Th className="text-right">Visits</Th>
              <Th className="text-right">Sign-ups</Th>
              <Th className="text-right">Visit → sign-up</Th>
              <Th className="text-right">Coverage-ready</Th>
              <Th className="text-right">First shift</Th>
              <Th className="text-right">Spend</Th>
              <Th className="text-right">Cost / sign-up</Th>
              <Th className="text-right">Cost / ready</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <Td>
                  <div className="font-medium">
                    {r.name} {r.active ? null : <Badge tone="gray">Inactive</Badge>}
                  </div>
                  <a href={`${r.url}?preview=1`} target="_blank" rel="noreferrer" className="text-xs text-brand-700">
                    /join/{r.slug}
                  </a>
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-slate-500">QR code &amp; edit</summary>
                    {qrs[r.id] ? (
                      <div className="mt-2">
                        <img src={qrs[r.id]} alt={`QR code for /join/${r.slug}`} width={180} height={180} className="rounded-lg border border-slate-200" />
                        <a href={qrs[r.id]} download={`join-${r.slug}-qr.png`} className="mt-1 block text-brand-700">
                          Download QR
                        </a>
                      </div>
                    ) : null}
                    <ActionForm action={saveCampaignAction} className="mt-3 grid w-[28rem] max-w-full gap-3 sm:grid-cols-2">
                      <input type="hidden" name="id" value={r.id} />
                      <CampaignFields c={r} />
                      <div className="sm:col-span-2">
                        <SubmitButton size="sm">Save</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                </Td>
                <Td className="text-right">{r.visits}</Td>
                <Td className="text-right">{r.signups}</Td>
                <Td className="text-right">{pct(r.signups, r.visits)}</Td>
                <Td className="text-right">{r.coverageReady}</Td>
                <Td className="text-right">{r.firstShift}</Td>
                <Td className="text-right">{r.costCents ? money(r.costCents) : "—"}</Td>
                <Td className="text-right">{r.costCents && r.signups ? money(Math.round(r.costCents / r.signups)) : "—"}</Td>
                <Td className="text-right">{r.costCents && r.coverageReady ? money(Math.round(r.costCents / r.coverageReady)) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
