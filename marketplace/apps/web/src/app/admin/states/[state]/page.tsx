import { notFound } from "next/navigation";
import { US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { admin, getSettings } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { pscAction, skillRuleAction, stateConfigAction } from "../../actions";

export default async function StatePage({ params, searchParams }: { params: Promise<{ state: string }>; searchParams: Promise<{ p?: string }> }) {
  const { actor } = await requireActor("admin");
  const state = (await params).state.toUpperCase();
  if (!US_STATES[state]) notFound();
  const { p } = await searchParams;
  const s = await getSettings();
  const { professions, rows } = await admin.stateMatrix(actor);
  const row = rows.find((r) => r.state.state === state)!;
  const regions = await prisma.rateRegion.findMany({ where: { state } });
  const sensitive = await prisma.skill.findMany({ where: { scopeSensitive: true }, include: { stateRules: { where: { state } } } });
  const verified = row.cells.reduce((x, c) => x + c.verifiedProviders, 0);
  return (
    <>
      <PageHeader back={{ href: "/admin/states", label: "States" }} title={`${US_STATES[state]} (${state})`} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="State checklist" description="Required before any profession can be enabled here." />
          <CardBody>
            {verified < s["states.minVerifiedDoctorsWarning"] ? <Alert tone="warning" className="mb-3">Only {verified} verified providers in {state} (warning threshold {s["states.minVerifiedDoctorsWarning"]}).</Alert> : null}
            <ActionForm action={stateConfigAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="state" value={state} />
              <Checkbox name="legalReviewComplete" defaultChecked={row.state.legalReviewComplete} label="Legal review complete (contractor model, fee-splitting, staffing registration, sales tax)" className="sm:col-span-2" />
              <Field label="Legal review notes" className="sm:col-span-2"><Textarea name="legalReviewNotes" defaultValue={row.state.legalReviewNotes ?? ""} /></Field>
              <Field label="Default board lookup URL"><Input name="boardLookupUrl" defaultValue={row.state.boardLookupUrl ?? ""} /></Field>
              <Field label="Default rate region (unmapped ZIPs)"><Select name="defaultRateRegionId" defaultValue={row.state.defaultRateRegionId ?? ""}><option value="">—</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
              <Checkbox name="staffingRegistrationRequired" defaultChecked={row.state.staffingRegistrationRequired} label="Staffing registration required" />
              <Checkbox name="salesTaxOnStaffing" defaultChecked={row.state.salesTaxOnStaffing} label="Sales tax on staffing" />
              <Checkbox name="enabled" defaultChecked={row.state.enabled} label={<strong>State enabled</strong>} />
              <div className="sm:col-span-2"><SubmitButton>Save state</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
        {row.cells.filter((c) => !p || c.professionCode === p).map((c) => {
          const prof = professions.find((x) => x.code === c.professionCode)!;
          const psc = c.psc;
          return (
            <Card key={c.professionCode} id={c.professionCode}>
              <CardHeader title={`${prof.displayName} in ${state}`} description={Object.entries(c.checklist).map(([k, v]) => `${v ? "✓" : "✗"} ${k}`).join("  ·  ")} action={<Badge tone={c.status === "ENABLED" ? "green" : c.status === "READY" ? "blue" : "gray"}>{c.status.toLowerCase()}</Badge>} />
              <CardBody>
                <ActionForm action={pscAction} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="state" value={state} />
                  <input type="hidden" name="professionCode" value={c.professionCode} />
                  <Checkbox name="legalReviewComplete" defaultChecked={psc?.legalReviewComplete} label="Legal review complete (ATTORNEY REVIEW)" />
                  <Checkbox name="licensedAtStateLevel" defaultChecked={psc?.licensedAtStateLevel ?? true} label="Licensed at the state level" />
                  <Checkbox name="alternativeCredentialAllowed" defaultChecked={psc?.alternativeCredentialAllowed} label="Accept a national registry credential instead (only when the state doesn't license this profession)" className="sm:col-span-2" />
                  <Field label="Accepted national credentials" className="sm:col-span-2"><Input name="alternativeCredentialPolicy" placeholder="e.g. ARDMS (RDMS, RDCS, RVT, RMSKS), CCI (RCS, RCCS, RVS, RPhS), ARRT (S, BS, VS)" defaultValue={psc?.alternativeCredentialPolicy ?? ""} /></Field>
                  <Field label="Credential title in this state"><Input name="credentialTitle" defaultValue={psc?.credentialTitle ?? prof.credentialSuffix} /></Field>
                  <Field label="Board lookup URL"><Input name="boardLookupUrl" defaultValue={psc?.boardLookupUrl ?? ""} /></Field>
                  <Field label="Supervision required?"><Select name="supervisionRequired" defaultValue={psc?.supervisionRequired === null || psc?.supervisionRequired === undefined ? "" : psc.supervisionRequired ? "yes" : "no"}><option value="">Not set</option><option value="no">No</option><option value="yes">Yes</option></Select></Field>
                  <Field label="Supervising professions (comma-separated)"><Input name="supervisingProfessionCodes" defaultValue={(psc?.supervisingProfessionCodes.length ? psc.supervisingProfessionCodes : prof.defaultSupervisingProfessionCodes).join(", ")} /></Field>
                  <Field label="Malpractice min per occurrence ($)"><Input name="minOcc" defaultValue={((psc?.malpracticeMinOccurrenceCents ?? prof.defaultMalpracticeMinOccurrenceCents) / 100).toFixed(0)} /></Field>
                  <Field label="Malpractice min aggregate ($)"><Input name="minAgg" defaultValue={((psc?.malpracticeMinAggregateCents ?? prof.defaultMalpracticeMinAggregateCents) / 100).toFixed(0)} /></Field>
                  <Field label="Supervision notes"><Textarea name="supervisionNotes" defaultValue={psc?.supervisionNotes ?? ""} className="min-h-16" /></Field>
                  <Field label="Scope notes"><Textarea name="scopeNotes" defaultValue={psc?.scopeNotes ?? ""} className="min-h-16" /></Field>
                  <Field label="Legal review notes" className="sm:col-span-2"><Textarea name="legalReviewNotes" defaultValue={psc?.legalReviewNotes ?? ""} className="min-h-16" /></Field>
                  <Checkbox name="enabled" defaultChecked={psc?.enabled} label={<strong>Enabled (requires every checklist item, including rate cards)</strong>} className="sm:col-span-2" />
                  <div className="sm:col-span-2"><SubmitButton size="sm">Save {prof.code} × {state}</SubmitButton></div>
                </ActionForm>
                {sensitive.filter((k) => k.professionCode === c.professionCode).map((k) => (
                  <ActionForm key={k.id} action={skillRuleAction} className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                    <input type="hidden" name="skillId" value={k.id} />
                    <input type="hidden" name="professionCode" value={c.professionCode} />
                    <input type="hidden" name="state" value={state} />
                    <span className="font-medium">Scope: {k.name}</span>
                    <Checkbox name="allowed" defaultChecked={k.stateRules.some((r) => r.professionCode === c.professionCode && r.allowed)} label="Allowed in this state" />
                    <Input name="notes" placeholder="Statute / notes" className="h-8 w-56" defaultValue={k.stateRules.find((r) => r.professionCode === c.professionCode)?.notes ?? ""} />
                    <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                  </ActionForm>
                ))}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
