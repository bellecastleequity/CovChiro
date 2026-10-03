import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@cm/services";
import { Alert } from "@/components/ui/misc";
import { getSession, homeFor } from "@/lib/session";
import { LoginForm } from "./login-form";

async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const s = await getSession();
  if (s && s.mfaVerified) redirect(homeFor(s.user.role));
  const { next, reset } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-500">Sign in to your account.</p>
      {reset ? <Alert tone="success" className="mt-4">Password updated — sign in with your new password.</Alert> : null}
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
