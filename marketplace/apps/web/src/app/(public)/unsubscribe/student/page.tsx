import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { unsubscribeStudentAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe", robots: { index: false } };

/** Credential follow-up opt-out for students. A button (not a GET) so link scanners can't unsubscribe people. */
export default async function UnsubscribeStudent({ searchParams }: { searchParams: Promise<{ p?: string; t?: string }> }) {
  const { p, t } = await searchParams;
  return (
    <div className="container-page max-w-lg py-24 text-center">
      <h1 className="text-2xl font-semibold">Stop credential reminder emails?</h1>
      <p className="mt-3 text-slate-600">We'll stop checking in about your license and malpractice insurance. You'll still get emails about verification results, shifts and payments.</p>
      <ActionForm action={unsubscribeStudentAction} className="mt-6">
        <input type="hidden" name="p" value={p ?? ""} />
        <input type="hidden" name="t" value={t ?? ""} />
        <SubmitButton>Unsubscribe</SubmitButton>
      </ActionForm>
    </div>
  );
}
