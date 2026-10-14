import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { dateLabel } from "@/lib/format";
import { exclusionCheckProviderAction, exclusionDecisionAction, idDecisionAction } from "@/app/admin/actions";

const ID_TONE: Record<string, { tone: "green" | "amber" | "red" | "gray" | "blue"; label: string }> = {
  NONE: { tone: "gray", label: "Not started" },
  PENDING: { tone: "gray", label: "Started" },
  PROCESSING: { tone: "blue", label: "With Stripe" },
  VERIFIED: { tone: "green", label: "Verified" },
  NEEDS_REVIEW: { tone: "amber", label: "Needs review" },
  FAILED: { tone: "amber", label: "Didn't pass" },
};
const EX_TONE: Record<string, { tone: "green" | "amber" | "red" | "gray"; label: string }> = {
  UNCHECKED: { tone: "gray", label: "Not checked" },
  CLEAR: { tone: "green", label: "Not listed" },
  POSSIBLE_MATCH: { tone: "amber", label: "Possible match" },
  EXCLUDED: { tone: "red", label: "Excluded" },
};

type P = { id: string; idStatus: string; idAttempts: number; idVerifiedAt: Date | null; idNote: string | null; idSessionId: string | null; exclusionStatus: string; exclusionCheckedAt: Date | null; exclusionNote: string | null; exclusionMatchKey: string | null };

/** Admin provider page: the photo ID check (Stripe Identity) and the federal exclusion list check. */
export function IdExclusionCard({ p, stripeTest }: { p: P; stripeTest: boolean }) {
  const id = ID_TONE[p.idStatus] ?? ID_TONE.NONE;
  const ex = EX_TONE[p.exclusionStatus] ?? EX_TONE.UNCHECKED;
  const stripeLink = p.idSessionId && !p.idSessionId.startsWith("vs_fake_") ? `https://dashboard.stripe.com/${stripeTest ? "test/" : ""}identity/verification-sessions/${p.idSessionId}` : null;
  return (
    <Card>
      <CardHeader title="ID & exclusion checks" />
      <CardBody className="space-y-5 text-sm">
        <section id="id-check" className="scroll-mt-24 space-y-2">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">Photo ID</span><Badge tone={id.tone}>{id.label}</Badge></div>
          <div className="text-xs text-slate-500">{p.idAttempts} {p.idAttempts === 1 ? "try" : "tries"}{p.idVerifiedAt ? ` · verified ${dateLabel(p.idVerifiedAt)}` : ""}</div>
          {p.idNote ? <p className="text-slate-600">{p.idNote}</p> : null}
          {stripeLink ? <a href={stripeLink} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-700">Open in Stripe (ID photos, date of birth) →</a> : null}
          <ActionForm action={idDecisionAction} className="space-y-2">
            <input type="hidden" name="providerId" value={p.id} />
            <Input name="note" placeholder="Note (required to verify by hand)" />
            <div className="flex flex-wrap gap-2">
              {p.idStatus !== "VERIFIED" ? <SubmitButton size="sm" name="decision" value="verify">Mark verified</SubmitButton> : null}
              {p.idStatus === "NEEDS_REVIEW" || p.idStatus === "FAILED" ? <SubmitButton size="sm" variant="outline" name="decision" value="allow_retry">Allow more tries</SubmitButton> : null}
              {p.idStatus === "VERIFIED" ? <SubmitButton size="sm" variant="outline" name="decision" value="reset">Ask to verify again</SubmitButton> : null}
            </div>
          </ActionForm>
        </section>
        <section id="exclusion" className="scroll-mt-24 space-y-2 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">Federal exclusion lists</span><Badge tone={ex.tone}>{ex.label}</Badge></div>
          <div className="text-xs text-slate-500">{p.exclusionCheckedAt ? `Checked ${dateLabel(p.exclusionCheckedAt)}` : "Checked once a list is loaded"} against the OIG list and any uploaded SAM.gov list</div>
          {p.exclusionNote ? <p className="text-slate-600">{p.exclusionNote}</p> : null}
          {p.exclusionStatus === "POSSIBLE_MATCH" || p.exclusionStatus === "EXCLUDED" ? (
            <ActionForm action={exclusionDecisionAction} className="space-y-2">
              <input type="hidden" name="providerId" value={p.id} />
              <Input name="note" placeholder="What you checked (required)" required />
              <div className="flex flex-wrap gap-2">
                {p.exclusionMatchKey ? <SubmitButton size="sm" variant="outline" name="decision" value="not_same_person">Not the same person</SubmitButton> : null}
                {p.exclusionStatus === "POSSIBLE_MATCH" ? <SubmitButton size="sm" variant="danger" name="decision" value="confirm_excluded">Confirm excluded</SubmitButton> : null}
                {p.exclusionStatus === "EXCLUDED" ? <SubmitButton size="sm" variant="outline" name="decision" value="clear">Clear (reinstated)</SubmitButton> : null}
              </div>
              <p className="text-xs text-slate-500">Compare the listing with their ID in Stripe (date of birth, middle name). Confirming releases their booked shifts.</p>
            </ActionForm>
          ) : (
            <ActionForm action={exclusionCheckProviderAction}>
              <input type="hidden" name="providerId" value={p.id} />
              <SubmitButton size="sm" variant="outline">Check now</SubmitButton>
            </ActionForm>
          )}
        </section>
      </CardBody>
    </Card>
  );
}
