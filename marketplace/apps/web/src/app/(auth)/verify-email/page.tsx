import Link from "next/link";
import { auth } from "@cm/services";
import { ResendVerification } from "@/components/shell/resend-verification";
import { getSession, homeFor } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let ok = false;
  try {
    if (token) {
      await auth.verifyEmail(token);
      ok = true;
    }
  } catch {
    ok = false;
  }
  const session = await getSession();
  const canResend = !ok && session && !session.user.emailVerifiedAt;
  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold">{ok ? "Email confirmed" : "Link expired"}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {ok ? "Thanks — you're all set." : canResend ? "This confirmation link is invalid or has expired. Get a new one:" : "This confirmation link is invalid or has expired. Sign in, then use \"Resend confirmation email\" at the top of the page."}
      </p>
      {canResend ? <ResendVerification label="Send a new confirmation link" className="mt-4" /> : null}
      <Link href={session ? homeFor(session.user.role) : "/login"} className="mt-6 inline-block font-medium text-brand-700">
        Continue
      </Link>
    </div>
  );
}
