import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth, google } from "@cm/services";
import { GoogleButton, OrDivider } from "@/components/site/google-button";
import { Alert } from "@/components/ui/misc";
import { getSession, homeFor } from "@/lib/session";
import { LoginForm } from "./login-form";

async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; google?: string }> }) {
  const s = await getSession();
  const { next, reset, google: problem } = await searchParams;
  if (s && s.mfaVerified) {
    const home = homeFor(s.actor.role);
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
    // Headed somewhere in their own area (an email link): go straight there.
    if (safeNext && (safeNext === home || safeNext.startsWith(`${home}/`) || safeNext.startsWith(`${home}?`))) redirect(safeNext);
    // Otherwise say who's signed in instead of silently bouncing them home (Oct 2026: an admin signed in
    // as a test provider kept landing on the provider screens), with a way to switch accounts.
    const who = s.actor.role === "PLATFORM_ADMIN" ? "an admin" : s.actor.role === "PROVIDER" ? "a provider" : "a clinic";
    return (
      <>
        <h1 className="text-xl font-semibold">You&apos;re already signed in</h1>
        <p className="mt-2 text-sm text-slate-600">
          Signed in as <b>{s.user.name || s.user.email}</b> ({s.user.email}), {who}.
          {safeNext ? " That page needs a different account." : ""}
        </p>
        <div className="mt-6 space-y-3">
          <form action="/api/auth/logout" method="post">
            <input type="hidden" name="next" value={safeNext ?? "/login"} />
            <button className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Sign out and use another account</button>
          </form>
          <Link href={home} className="block w-full rounded-xl px-4 py-2.5 text-center text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
            Continue as {s.user.name || s.user.email}
          </Link>
        </div>
      </>
    );
  }
  const googleNote = problem ? google.GOOGLE_PROBLEMS[problem as keyof typeof google.GOOGLE_PROBLEMS] : null;
  return (
    <>
      <h1 className="text-xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-500">Sign in to your account.</p>
      {reset ? <Alert tone="success" className="mt-4">Password updated — sign in with your new password.</Alert> : null}
      {googleNote ? <Alert tone={problem === "cancelled" ? "info" : "error"} className="mt-4">{googleNote}</Alert> : null}
      {google.googleEnabled() ? (
        <div className="mt-6">
          <GoogleButton params={{ next }} />
          <p className="mt-2 text-center text-xs text-slate-500">For clinic and provider accounts. New here? We&apos;ll set up your account.</p>
          <OrDivider />
        </div>
      ) : null}
      <LoginForm next={next ?? ""} challenge={await auth.loginChallengeNeeded(await clientIp())} />
      <div className="mt-5 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-slate-500 hover:text-slate-800">
          Forgot password?
        </Link>
        <Link href="/signup" className="font-medium text-brand-700">
          Create an account
        </Link>
      </div>
    </>
  );
}
