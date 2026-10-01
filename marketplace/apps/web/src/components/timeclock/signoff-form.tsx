import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Input, Textarea } from "@/components/ui/form";
import type { ActionState } from "@/components/ui/action-form";
import { SignaturePad } from "./signature-pad";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Manager sign-off: typed name (+ title), confirmation, optional/required drawn signature; plus "Something's wrong". */
export function SignOffForm({ approve, report, hidden, defaultName, signatureRequired, cta = "Approve & sign", reportOnly }: { approve: Act; report?: Act; hidden: Record<string, string>; defaultName?: string; signatureRequired?: boolean; cta?: string; reportOnly?: boolean }) {
  const fields = Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  if (reportOnly && report) {
    return (
      <ActionForm action={report} className="mt-2 space-y-2">
        {fields}
        <Textarea name="reason" required minLength={5} placeholder="What's not right?" />
        <SubmitButton variant="danger" size="sm">Report a problem</SubmitButton>
      </ActionForm>
    );
  }
  return (
    <div className="space-y-4">
      <ActionForm action={approve} className="space-y-3">
        {fields}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input name="approverName" defaultValue={defaultName} placeholder="Manager's full name" required minLength={2} aria-label="Manager's full name" />
          <Input name="approverTitle" placeholder="Title (optional)" aria-label="Title" />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">Signature{signatureRequired ? "" : " (optional)"}</div>
          <SignaturePad required={signatureRequired} />
        </div>
        <Input name="note" placeholder="Note (optional)" aria-label="Note" />
        <Checkbox name="confirm" required label="I confirm these times are correct." />
        <SubmitButton>{cta}</SubmitButton>
      </ActionForm>
      {report ? (
        <details className="rounded-xl border border-slate-200 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-red-700">Something&apos;s wrong</summary>
          <ActionForm action={report} className="mt-2 space-y-2">
            {fields}
            <Textarea name="reason" required minLength={5} placeholder="What's not right? (e.g. arrived at 9:30, not 8:58)" />
            <p className="text-xs text-slate-500">We&apos;ll review it with both of you. Pay for this shift is held until it&apos;s resolved.</p>
            <SubmitButton variant="danger" size="sm">Report a problem</SubmitButton>
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}
