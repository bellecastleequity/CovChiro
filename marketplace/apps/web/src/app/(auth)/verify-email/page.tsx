import Link from "next/link";
import { auth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { getSession, homeFor } from "@/lib/session";
import { resendFromLinkAction } from "../actions";

export const dynamic = "force-dynamic";

const COPY: Record<auth.EmailLinkResult, { title: string; body: string }> = {
  confirmed: { title: "Email confirmed", body: "Thanks — you're all set." },
  already_confirmed: { title: "Email confirmed", body: "Your email is already confirmed — you're all set." },
  expired: { title: "Link expired", body: "This confirmation link has expired or was replaced by a newer one." },
  invalid: { title: "Link not recognised", body: "This confirmation link isn't valid. Sign in, then use \"Resend confirmation email\" at the top of the page." },
};

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const result = await auth.confirmEmailLink(token).catch((): auth.EmailLinkResult => "invalid");
  const session = await getSession();
  const { title, body } = COPY[result];
  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
      {result === "expired" ? (
        <ActionForm action={resendFromLinkAction} className="mt-4">
          <input type="hidden" name="token" value={token} />
          <SubmitButton size="sm" variant="outline" pendingText="Sending…">Email me a new link</SubmitButton>
        </ActionForm>
      ) : null}
      <Link href={session ? homeFor(session.user.role) : "/login"} className="mt-6 inline-block font-medium text-brand-700">
        Continue
      </Link>
    </div>
  );
}
