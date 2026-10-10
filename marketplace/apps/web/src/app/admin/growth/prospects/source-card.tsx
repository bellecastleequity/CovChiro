import { CASL_CONSENT_BASES, countryOf } from "@cm/core";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { dateLabel, humanize } from "@/lib/format";
import { consentBasisAction } from "../actions";

const BASIS: Record<string, string> = {
  EXPRESS: "Express consent (they asked to hear from us)",
  CONSPICUOUS_PUBLICATION: "Business address they published themselves, no 'no solicitation' note, relevant to their role",
  EXISTING_BUSINESS: "Existing business relationship",
};

/** Where a prospect came from (registry, Apollo, CSV, by hand), enrichment, and for Canada the CASL consent basis. */
export function SourceCard({ entity, p }: {
  entity: "PROSPECT" | "PROVIDER_PROSPECT";
  p: { id: string; state: string; source: string | null; apolloPersonId: string | null; apolloOrganizationId: string | null; sourceVerifiedAt: Date | null; enrichmentStatus: string; enrichmentCredits: number; consentBasis: string | null; consentNote: string | null; title?: string | null; decisionMakerTitle?: string | null };
}) {
  const canada = countryOf(p.state) === "CA";
  return (
    <Card>
      <CardHeader title="Source" description="An outside record is a lead, never proof of a license or of the details it lists." />
      <CardBody className="space-y-2 text-sm">
        <div className="flex justify-between gap-3"><span className="text-slate-500">Found through</span><span>{p.source ?? "—"}</span></div>
        {p.apolloPersonId || p.apolloOrganizationId ? <div className="flex justify-between gap-3"><span className="text-slate-500">Apollo ids</span><span className="text-right font-mono text-xs">{[p.apolloPersonId && `person ${p.apolloPersonId}`, p.apolloOrganizationId && `org ${p.apolloOrganizationId}`].filter(Boolean).join(" · ")}</span></div> : null}
        {p.title || p.decisionMakerTitle ? <div className="flex justify-between gap-3"><span className="text-slate-500">{entity === "PROSPECT" ? "Contact's title" : "Title"}</span><span>{p.title ?? p.decisionMakerTitle}</span></div> : null}
        {p.sourceVerifiedAt ? <div className="flex justify-between gap-3"><span className="text-slate-500">Source last confirmed</span><span>{dateLabel(p.sourceVerifiedAt)}</span></div> : null}
        <div className="flex justify-between gap-3"><span className="text-slate-500">Paid enrichment</span><span>{humanize(p.enrichmentStatus)}{p.enrichmentCredits ? ` · ${p.enrichmentCredits} credit${p.enrichmentCredits === 1 ? "" : "s"} (est.)` : ""}</span></div>
        {canada ? (
          <ActionForm action={consentBasisAction} className="space-y-2 border-t border-slate-100 pt-3">
            <input type="hidden" name="entity" value={entity} />
            <input type="hidden" name="id" value={p.id} />
            <p className="text-xs text-slate-600">Canada (CASL): commercial emails go out only with Canada outreach on in Growth settings and a consent basis recorded here.</p>
            <Field label="Consent basis">
              <Select name="basis" defaultValue={p.consentBasis ?? ""}>
                <option value="">None recorded (no commercial email)</option>
                {CASL_CONSENT_BASES.map((b) => <option key={b} value={b}>{BASIS[b]}</option>)}
              </Select>
            </Field>
            <Field label="How you know (required with a basis)"><Input name="note" defaultValue={p.consentNote ?? ""} placeholder="e.g. listed on their clinic's contact page, checked Oct 12" /></Field>
            <SubmitButton size="sm" variant="outline">Save consent basis</SubmitButton>
          </ActionForm>
        ) : null}
      </CardBody>
    </Card>
  );
}
