import { ExternalLink, FileText } from "lucide-react";
import { credentialPlace, NATIONAL_CREDENTIAL, US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { providerProfile, getSettings } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { CanTake } from "../can-take";
import { addProfessionAction, deleteLicenseAction, licenseAction, malpracticeAction, skillsAction } from "../actions";

export const metadata = { title: "Credentials" };

export default async function Credentials() {
  const { actor } = await requireActor("provider");
  const { provider, canTake, nationalCredentialStates } = await providerProfile(actor);
  const rs = await getSettings();
  const myCodes = provider.professions.map((p) => p.professionCode);
  const [allProfessions, skills] = await Promise.all([
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.skill.findMany({ where: { active: true, OR: [{ professionCode: { in: myCodes } }, { professionCode: null }] }, orderBy: [{ professionCode: "asc" }, { name: "asc" }] }),
  ]);
  const held = new Map(provider.skills.map((s) => [s.skillId, s]));
  return (
    <>
      <PageHeader title="Credentials" description={<>You can take: <CanTake canTake={canTake} /></>} />
      <div className="space-y-6">
        {provider.professions.map((pp) => {
          const lic = provider.licenses.filter((l) => l.professionCode === pp.professionCode);
          const nationalStates = nationalCredentialStates[pp.professionCode] ?? [];
          return (
            <Card key={pp.professionCode}>
              <CardHeader title={`${pp.profession.displayName} licenses`} description={`${pp.profession.credentialSuffix} · status: ${pp.status.toLowerCase()}`} action={<StatusBadge status={pp.status} />} />
              <CardBody>
                {lic.length ? (
                  <ul className="mb-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {lic.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                        <div>
                          <div className="font-medium">{credentialPlace(l.state)} · {l.credentialTitle ?? pp.profession.credentialSuffix} #{l.licenseNumber}</div>
                          <div className="text-xs text-slate-500">Expires {dateLabel(l.expiresAt, "UTC", { month: "short", day: "numeric", year: "numeric" })}{l.rejectionReason ? ` · ${l.rejectionReason}` : ""}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={l.status} />
                          {l.documentUrl ? <a href={`/api/files/${l.documentUrl}`} target="_blank" className="text-slate-400 hover:text-slate-700" aria-label="View document"><FileText className="size-4" /></a> : null}
                          <ActionForm action={deleteLicenseAction} confirm="Remove this license?" successMessage={false}>
                            <input type="hidden" name="licenseId" value={l.id} />
                            <button className="text-xs text-slate-400 hover:text-red-600">Remove</button>
                          </ActionForm>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ActionForm action={licenseAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" resetOnSuccess>
                  <input type="hidden" name="professionCode" value={pp.professionCode} />
                  <Field label="State">
                    <Select name="state" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {nationalStates.length ? <option value={NATIONAL_CREDENTIAL}>National registry credential</option> : null}
                      {Object.entries(US_STATES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </Select>
                  </Field>
                  <Field label="License number"><Input name="licenseNumber" required /></Field>
                  <Field label={<>Title (as issued)<InfoTip label="About the title">The credential exactly as your board issues it (for example DC, LMT, PT). Clinics see it next to your name.</InfoTip></>}><Input name="credentialTitle" placeholder={pp.profession.credentialSuffix} /></Field>
                  <Field label="Expires"><Input name="expiresAt" type="date" required /></Field>
                  <Field label="Copy (optional)"><Input name="document" type="file" accept="application/pdf,image/*" /></Field>
                  <div className="sm:col-span-2 lg:col-span-5"><SubmitButton size="sm">Add / update license</SubmitButton></div>
                </ActionForm>
                <p className="mt-2 text-xs text-slate-500">We verify every license with the state board before you can take shifts in that state. Editing a license sends it back for verification.</p>
                {nationalStates.length ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {nationalStates.map((s) => US_STATES[s]).join(", ")} {nationalStates.length === 1 ? "doesn't" : "don't"} license this profession, so a verified national registry credential (for example ARDMS, CCI or ARRT) qualifies you there. In states that issue a license, you need that state's license.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          );
        })}

        <Card>
          <CardHeader title="Add another profession" description="Dual-licensed? Add each profession you practice." />
          <CardBody>
            <ActionForm action={addProfessionAction} className="flex flex-wrap gap-2">
              <Select name="professionCode" className="w-auto max-w-full" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {allProfessions.filter((p) => !myCodes.includes(p.code)).map((p) => <option key={p.code} value={p.code}>{p.displayName}{p.active ? "" : " (coming soon)"}</option>)}
              </Select>
              <SubmitButton variant="outline">Add</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<>Malpractice insurance<InfoTip label="About malpractice">Required to be matched. Each state sets minimum per-occurrence and aggregate limits; you&apos;re only matched in states where your verified policy meets them and is current through the shift.</InfoTip></>} description="One policy can cover several professions — list each one it covers." />
          <CardBody>
            {provider.malpractice.length ? (
              <ul className="mb-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {provider.malpractice.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div>
                      <div className="font-medium">{m.carrier} · {m.policyNumber}</div>
                      <div className="text-xs text-slate-500">{money(m.perOccurrenceCents)} / {money(m.aggregateCents)} · expires {dateLabel(m.expiresAt, "UTC", { month: "short", day: "numeric", year: "numeric" })} · covers {m.coveredProfessionCodes.join(", ")}</div>
                    </div>
                    <StatusBadge status={m.status} />
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mb-5 rounded-xl bg-sky-50 p-4 text-sm text-sky-900 ring-1 ring-sky-200">
              <b>Please list us as a certificate holder.</b> Ask your carrier to add <b>{rs["agreements.companyLegalName"]}</b>{rs["agreements.companyAddress"] ? <>, {rs["agreements.companyAddress"]}</> : null} as a certificate holder on your policy, so we hear about any change or cancellation directly. Tell us within 24 hours if your coverage changes, lapses or is cancelled.
            </div>
            <ActionForm action={malpracticeAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" resetOnSuccess>
              <Field label="Carrier"><Input name="carrier" required /></Field>
              <Field label="Policy number"><Input name="policyNumber" required /></Field>
              <Field label="Expires"><Input name="expiresAt" type="date" required /></Field>
              <Field label={<>Per-occurrence limit ($)<InfoTip label="About per-occurrence">The most your policy pays for a single claim, as shown on your certificate of insurance. Often $1,000,000.</InfoTip></>}><Input name="perOccurrence" inputMode="numeric" placeholder="1,000,000" required /></Field>
              <Field label={<>Aggregate limit ($)<InfoTip label="About aggregate">The most your policy pays for all claims in the policy year. Often $3,000,000.</InfoTip></>}><Input name="aggregate" inputMode="numeric" placeholder="3,000,000" required /></Field>
              <Field label="Certificate of insurance"><Input name="document" type="file" accept="application/pdf,image/*" required /></Field>
              <fieldset className="sm:col-span-2 lg:col-span-3">
                <legend className="mb-1.5 text-sm font-medium text-slate-700">Professions covered</legend>
                <div className="flex flex-wrap gap-4">
                  {provider.professions.map((p) => <Checkbox key={p.professionCode} name="covered" value={p.professionCode} defaultChecked label={p.profession.displayName} />)}
                </div>
              </fieldset>
              <div className="sm:col-span-2 lg:col-span-3"><SubmitButton size="sm">Submit policy</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<>Skills &amp; techniques<InfoTip label="About skills">Clinics mark skills as required or preferred. Required ones decide whether you&apos;re matched at all, and some need a verified certificate before they count.</InfoTip></>} description="Used to match you with clinics. Certification-based skills need a verified certificate." />
          <CardBody>
            <ActionForm action={skillsAction} className="space-y-4">
              {[...myCodes, null].map((code) => {
                const list = skills.filter((k) => k.professionCode === code);
                if (!list.length) return null;
                return (
                  <fieldset key={code ?? "cross"}>
                    <legend className="mb-2 text-sm font-semibold text-slate-800">{code ? allProfessions.find((p) => p.code === code)?.displayName : "Cross-profession"}</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {list.map((k) => {
                        const h = held.get(k.id);
                        return (
                          <div key={k.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <Checkbox name="skill" value={k.id} defaultChecked={!!h} label={k.name} />
                              <Select name={`prof-${k.id}`} defaultValue={String(h?.proficiency ?? 2)} className="h-8 w-auto text-xs" aria-label="Proficiency">
                                <option value="1">Basic</option><option value="2">Proficient</option><option value="3">Expert</option>
                              </Select>
                            </div>
                            {k.requiresCertification ? (
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <input type="hidden" name={`certExisting-${k.id}`} value={h?.certificationUrl ?? ""} />
                                <Input name={`cert-${k.id}`} type="file" accept="application/pdf,image/*" className="h-9 text-xs" aria-label="Certificate" />
                                <Input name={`certExp-${k.id}`} type="date" defaultValue={h?.certificationExpiresAt?.toISOString().slice(0, 10)} className="h-9 text-xs" aria-label="Certificate expires" />
                                <div className="sm:col-span-2">{h?.certificationStatus ? <StatusBadge status={h.certificationStatus} /> : <Badge tone="amber">Certificate required</Badge>}{k.scopeSensitive ? <Badge className="ml-1">Scope varies by state</Badge> : null}</div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
              <SubmitButton size="sm">Save skills</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <p className="flex items-center gap-1 text-xs text-slate-500"><ExternalLink className="size-3" />Please report any board action or lapse within 24 hours, as required by your Provider Agreement.</p>
      </div>
    </>
  );
}
