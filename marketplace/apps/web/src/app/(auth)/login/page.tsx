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
  if (s && s.mfaVerified) redirect(homeFor(s.user.role));
  const { next, reset, google: problem } = await searchParams;
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
