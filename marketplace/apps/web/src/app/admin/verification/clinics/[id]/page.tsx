import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleHelp, ExternalLink, FileText, XCircle } from "lucide-react";
import { clinicVerify } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { clinicVerificationDecisionAction } from "../../../actions";

export const metadata = { title: "Clinic verification" };

const ICON = {
  PASS: <CheckCircle2 className="size-4 text-emerald-600" />,
  REVIEW: <CircleHelp className="size-4 text-amber-600" />,
  FAIL: <XCircle className="size-4 text-red-600" />,
  SKIP: <CircleAlert className="size-4 text-slate-400" />,
};
const when = (d: Date) => dateLabel(d, "America/New_York", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ClinicVerificationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  const { id } = await params;
  const d = await clinicVerify.clinicVerificationDetail(actor, id);
  const { row, rule } = d;
  const org = row.clinicOrg;
  const loc = org.locations[0];
  const open = row.status === "PENDING" || row.status === "NEEDS_INFO";
  return (
    <>
      <PageHeader
        back={{ href: "/admin/verification/clinics", label: "Clinic verification" }}
        eyebrow={<Link href={`/admin/clinics/${org.id}`} className="hover:underline">{org.displayName}</Link>}
        title={row.entityName}
        description={`Sent ${when(row.submittedAt)} · signed by ${row.attestName}${row.attestIp ? ` (${row.attestIp})` : ""}`}
        actions={<Badge tone={row.status === "APPROVED" ? "green" : row.status === "REJECTED" ? "red" : "amber"}>{row.status.replace("_", " ").toLowerCase()}{row.autoApproved ? " · automatic" : ""}</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Automatic checks" />
            <div className="divide-y divide-slate-100">
              {d.checks.map((c) => (
                <div key={c.key} className="flex gap-3 px-5 py-3 text-sm">
                  <div className="mt-0.5">{ICON[c.outcome]}</div>
                  <div>
                    <div className="font-medium">{c.label}</div>
                    <div className="text-slate-600">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="What they told us" />
            <CardBody className="space-y-4 text-sm">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <div><dt className="text-slate-500">Registered</dt><dd>{row.entityState} #{row.entityNumber}{rule ? <> · <a href={rule.entityLookupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700">{rule.entityRegistry}<ExternalLink className="size-3" /></a></> : null}</dd></div>
                <div><dt className="text-slate-500">Organization NPI</dt><dd>{row.orgNpi ? <a href={`https://npiregistry.cms.hhs.gov/provider-view/${row.orgNpi}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700">{row.orgNpi}<ExternalLink className="size-3" /></a> : "None given"}</dd></div>
                <div><dt className="text-slate-500">{rule?.facilityLicenseName ?? "Facility license"}</dt><dd>{row.facilityLicenseNumber ?? "—"}{row.facilityLicenseNumber && rule?.facilityLicenseLookupUrl ? <> · <a href={rule.facilityLicenseLookupUrl} target="_blank" rel="noreferrer" className="text-brand-700">look up</a></> : null}</dd></div>
                <div><dt className="text-slate-500">Exemption certificate</dt><dd>{row.facilityExemptionNumber ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Location</dt><dd>{loc ? `${loc.addressLine1}, ${loc.city}, ${loc.state} ${loc.zip}` : "None"}</dd></div>
                <div><dt className="text-slate-500">Logins</dt><dd>{org.members.map((m) => `${m.user.name} <${m.user.email}>`).join(", ")}</dd></div>
              </dl>
              <div>
                <div className="mb-1 font-medium">Owners</div>
                <ul className="space-y-1">
                  {d.owners.map((o, i) => (
                    <li key={i}>{o.name} · {o.percent}% · {o.licensed ? `${o.professionCode} license ${o.licenseState} ${o.licenseNumber}${o.npi ? ` · NPI ${o.npi}` : ""}` : "not a licensed practitioner"}</li>
                  ))}
                </ul>
              </div>
              {row.documentKeys.length ? (
                <div className="flex flex-wrap gap-3">
                  {row.documentKeys.map((k, i) => <a key={k} href={`/api/files/${k}`} target="_blank" className="flex items-center gap-1 text-brand-700"><FileText className="size-4" />Document {i + 1}</a>)}
                </div>
              ) : <p className="text-slate-500">No documents uploaded.</p>}
              {rule?.note ? <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{rule.note}</p> : null}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          {open ? (
            <Card>
              <CardHeader title="Decide" description="The clinic sees your note for 'Ask for more' and 'Decline'." />
              <CardBody className="space-y-4">
                <ActionForm action={clinicVerificationDecisionAction} className="space-y-3">
                  <input type="hidden" name="id" value={row.id} />
                  <Field label="Note"><Textarea name="note" placeholder="e.g. Please upload the AHCA license certificate." /></Field>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton name="decision" value="APPROVE">Verify</SubmitButton>
                    <SubmitButton name="decision" value="NEEDS_INFO" variant="outline">Ask for more</SubmitButton>
                    <SubmitButton name="decision" value="REJECT" variant="outline">Decline</SubmitButton>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Decision" />
              <CardBody className="text-sm">{row.decidedAt ? when(row.decidedAt) : ""}{row.decisionNote ? <p className="mt-2 text-slate-600">{row.decisionNote}</p> : null}</CardBody>
            </Card>
          )}
          {d.history.length ? (
            <Card>
              <CardHeader title="Earlier submissions" />
              <div className="divide-y divide-slate-100">
                {d.history.map((h) => (
                  <Link key={h.id} href={`/admin/verification/clinics/${h.id}`} className="block px-5 py-2 text-sm hover:bg-slate-50">
                    {when(h.submittedAt)} · {h.status.toLowerCase()}{h.autoApproved ? " (automatic)" : ""}
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
