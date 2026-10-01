"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@cm/services";
import { formAction, str } from "@/lib/action";
import { getSession, homeFor, SESSION_COOKIE, setSessionCookie } from "@/lib/session";

async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/** "Resend confirmation email" for whoever is signed in (providers and clinic users). */
export const resendVerificationAction = formAction(async () => {
  const s = await getSession();
  if (!s) redirect("/login");
  return auth.resendVerificationEmail(s.user.id);
});

export const resendFromLinkAction = formAction(async (fd) => auth.resendVerificationFromLink(str(fd, "token")));

export const loginAction = formAction(async (fd) => {
  const r = await auth.login(str(fd, "email"), str(fd, "password"), await ip());
  await setSessionCookie(r.token);
  if (r.mfaEnrollRequired) redirect("/mfa/setup");
  if (r.mfaRequired) redirect("/mfa");
  const next = str(fd, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : homeFor(r.user.role));
});

export const signupAction = formAction(async (fd) => {
  const role = str(fd, "role") === "provider" ? "provider" : "clinic";
  const user = await auth.signup(
    {
      role,
      name: str(fd, "name"),
      email: str(fd, "email"),
      password: str(fd, "password"),
      organization: str(fd, "organization") || undefined,
      professionCodes: fd.getAll("professions").map(String),
      acceptTerms: fd.get("terms") === "on" ? true : (false as never),
      campaign: str(fd, "campaign") || null,
      graduationDate: str(fd, "graduation") || null,
      isStudent: str(fd, "stage") === "student",
      prospectToken: str(fd, "c") || (await cookies()).get("cm_pt")?.value || null,
    },
    { ip: await ip(), visitorId: (await cookies()).get("cm_vid")?.value ?? null },
  );
  const token = await auth.createSession(user.id, true);
  await setSessionCookie(token);
  const code = str(fd, "code");
  redirect(role === "provider" ? "/provider?welcome=1" : `/clinic?welcome=1${code ? `&code=${encodeURIComponent(code)}` : ""}`);
});

export const mfaVerifyAction = formAction(async (fd) => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  await auth.completeMfa(token, str(fd, "code"), { enrolling: str(fd, "enrolling") === "1" });
  const s = await getSession();
  redirect(homeFor(s?.user.role ?? ""));
});

export const forgotAction = formAction(async (fd) => {
  await auth.requestPasswordReset(str(fd, "email"), await ip());
  return "If that email has an account, a reset link is on its way.";
});

export const resetAction = formAction(async (fd) => {
  if (str(fd, "password") !== str(fd, "confirm")) throw new (await import("@cm/core")).DomainError("VALIDATION", "Passwords don't match.");
  await auth.resetPassword(str(fd, "token"), str(fd, "password"));
  redirect("/login?reset=1");
});

export const setupAction = formAction(async (fd) => {
  await auth.createFirstAdmin({ token: str(fd, "token"), name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password") }, await ip());
  redirect("/login?setup=1");
});
