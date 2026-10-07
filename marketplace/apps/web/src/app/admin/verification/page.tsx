import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { credentialPlace, NATIONAL_CREDENTIAL } from "@cm/core";
import { admin } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { resolveNpiAction, reviewCertAction, reviewLicenseAction, reviewMalpracticeAction } from "../actions";


/** Where to check a national registry credential (the credential letters say which registry). */
const REGISTRY_LOOKUPS = [
  ["ARDMS", "https://www.ardms.org/maintain-certification/registrant-support/statusverification/"],
  ["CCI", "https://cci-online.org/"],
  ["ARRT", "https://www.arrt.org/"],
] as const;
export const metadata = { title: "Verification" };

function Decide({ action, hidden, withExpiry, expiry }: { action: typeof reviewLicenseAction; hidden: Record<string, string>; withExpiry?: boolean; expiry?: Date | null }) {
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <ActionForm action={action} className="flex flex-wrap items-end gap-2">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="hidden" name="decision" value="approve" />
        {withExpiry ? <Input type="date" name="expiresAt" defaultValue={expiry?.toISOString().slice(0, 10)} className="h-9 w-40" aria-label="Confirmed expiration" /> : null}
        <SubmitButton size="sm">Verify</SubmitButton>
      </ActionForm>
      <ActionForm action={action} className="flex flex-wrap items-end gap-2">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="hidden" name="decision" value="reject" />
        <Input name="reason" placeholder="Reason" className="h-9 w-48" />
        <SubmitButton size="sm" variant="outline">Reject</SubmitButton>
      </ActionForm>
    </div>
  );
}

export default async function Verification() {
  const { actor } = await requireActor("admin");
  const q = await admin.verificationQueue(actor);
  const empty = !q.licenses.length && !q.policies.length && !q.certs.length && !q.npi.length;
  return (
    <>
      <PageHeader actions={<Link href="/admin/verification/state-check" className="text-sm font-medium text-brand-700">State license check →</Link>} title="Verification queue" description="Confirm name, number, status and expiration against the state board (profession + state) before verifying. Credentials for states that aren't open yet are listed last." />
      {empty ? <Empty title="Queue is clear" /> : null}
      <div className="space-y-6">
        {q.licenses.length ? (
          <Card>
            <CardHeader title={`Licenses (${q.licenses.length})`} />
            <div className="divide-y divide-slate-100">
              {q.licenses.map((l) => (
                <div key={l.id} className="px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">{l.provider.legalName} <span className="font-normal text-slate-500">({l.provider.displayName})</span>{!l.marketOpen ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">Market not open · low priority</span> : null}{l.provider.preLicensure ? <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-200">Student — new graduate</span> : null}</div>
                      <div className="text-slate-600">{l.profession.displayName} · {credentialPlace(l.state)} · #{l.licenseNumber}{l.credentialTitle ? ` · ${l.credentialTitle}` : ""} · expires {dateLabel(l.expiresAt, "UTC", { month: "short", day: "numeric", year: "numeric" })}</div>
                    </div>
                    <div className="flex gap-3">
                      {l.documentUrl ? <a className="flex items-center gap-1 text-brand-700" href={`/api/files/${l.documentUrl}`} target="_blank"><FileText className="size-4" />Upload</a> : null}
                      {l.state === NATIONAL_CREDENTIAL ? (
                        REGISTRY_LOOKUPS.map(([name, url]) => <a key={name} className="flex items-center gap-1 text-brand-700" href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />{name}</a>)
                      ) : l.boardLookupUrl ? <a className="flex items-center gap-1 text-brand-700" href={l.boardLookupUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Board lookup</a> : <span className="text-amber-700">No board URL for {l.professionCode}/{l.state}</span>}
                    </div>
                  </div>
                  <Decide action={reviewLicenseAction} hidden={{ id: l.id }} withExpiry expiry={l.expiresAt} />
                </div>
              ))}
            </div>
          </Card>
        ) : null}
        {q.policies.length ? (
          <Card>
            <CardHeader title={`Malpractice (${q.policies.length})`} />
            <div className="divide-y divide-slate-100">
              {q.policies.map((m) => (
                <div key={m.id} className="px-5 py-4 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <div className="font-semibold">{m.provider.legalName}{!m.marketOpen ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">Market not open · low priority</span> : null}{m.provider.preLicensure ? <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-200">Student — new graduate</span> : null}</div>
                      <div className="text-slate-600">{m.carrier} #{m.policyNumber} · {money(m.perOccurrenceCents)}/{money(m.aggregateCents)} · covers {m.coveredProfessionCodes.join(", ")} in {m.coveredStates.length ? m.coveredStates.join(", ") : "all states"} · expires {dateLabel(m.expiresAt, "UTC", { month: "short", day: "numeric", year: "numeric" })}</div>
                    </div>
                    <a className="flex items-center gap-1 text-brand-700" href={`/api/files/${m.documentUrl}`} target="_blank"><FileText className="size-4" />Certificate</a>
                  </div>
                  <Decide action={reviewMalpracticeAction} hidden={{ id: m.id }} />
                </div>
              ))}
            </div>
          </Card>
        ) : null}
        {q.certs.length ? (
          <Card>
            <CardHeader title={`Skill certifications (${q.certs.length})`} />
            <div className="divide-y divide-slate-100">
              {q.certs.map((c) => (
                <div key={`${c.providerId}-${c.skillId}`} className="px-5 py-4 text-sm">
                  <div className="flex justify-between"><span className="font-semibold">{c.provider.displayName} · {c.skill.name}</span>{c.certificationUrl ? <a className="text-brand-700" href={`/api/files/${c.certificationUrl}`} target="_blank">Certificate</a> : null}</div>
                  <Decide action={reviewCertAction} hidden={{ providerId: c.providerId, skillId: c.skillId }} withExpiry expiry={c.certificationExpiresAt} />
                </div>
              ))}
            </div>
          </Card>
        ) : null}
        {q.npi.length ? (
          <Card>
            <CardHeader title="NPI name mismatches" />
            <CardBody className="space-y-3">
              {q.npi.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{p.legalName} · NPI {p.npi} <a className="text-brand-700" target="_blank" rel="noreferrer" href={`https://npiregistry.cms.hhs.gov/provider-view/${p.npi}`}>registry</a></span>
                  <div className="flex gap-2">
                    <ActionForm action={resolveNpiAction}><input type="hidden" name="providerId" value={p.id} /><input type="hidden" name="decision" value="approve" /><SubmitButton size="sm">Accept</SubmitButton></ActionForm>
                    <ActionForm action={resolveNpiAction}><input type="hidden" name="providerId" value={p.id} /><input type="hidden" name="decision" value="reject" /><SubmitButton size="sm" variant="outline">Clear NPI</SubmitButton></ActionForm>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
