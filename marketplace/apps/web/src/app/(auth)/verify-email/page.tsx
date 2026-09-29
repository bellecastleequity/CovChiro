import Link from "next/link";
import { auth } from "@cm/services";

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
  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold">{ok ? "Email confirmed" : "Link expired"}</h1>
      <p className="mt-2 text-sm text-slate-500">{ok ? "Thanks — you're all set." : "This confirmation link is invalid or has expired. Sign in to request a new one."}</p>
      <Link href="/login" className="mt-6 inline-block font-medium text-brand-700">
        Continue
      </Link>
    </div>
  );
}
