import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { unsubscribeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe", robots: { index: false } };

/** Confirmation button (not a GET) so email link scanners can't unsubscribe people. */
export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="container-page max-w-lg py-24 text-center">
      <h1 className="text-2xl font-semibold">Unsubscribe from offer emails?</h1>
      <p className="mt-3 text-slate-600">You'll still receive emails about shifts and payments on your account.</p>
      <ActionForm action={unsubscribeAction} className="mt-6">
        <input type="hidden" name="token" value={token ?? ""} />
        <SubmitButton>Unsubscribe</SubmitButton>
      </ActionForm>
    </div>
  );
}
