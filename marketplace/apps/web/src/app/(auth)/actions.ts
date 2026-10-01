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

/** Student-path fields (signup?student=1 and /join); undefined on the normal path. */
function studentFromForm(fd: FormData) {
  if (str(fd, "student") !== "1") return undefined;
  return {
    school: str(fd, "school"),
    graduationDate: str(fd, "graduationDate") as unknown as Date,
    intendedStates: fd.getAll("intendedStates").map(String),
    licensureApplied: (str(fd, "licensureApplied") === "yes" ? "yes" : "no") as "yes" | "no",
    expectedLicensure: str(fd, "expectedLicensure"),
    preferredArea: str(fd, "preferredArea") || null,
    homeZip: str(fd, "homeZip"),
    maxDriveMinutes: Number(str(fd, "maxDriveMinutes")) || undefined,
    smsConsent: fd.get("smsConsent") === "on",
  };
}

function attributionFromForm(fd: FormData) {
  const utm = Object.fromEntries((["source", "medium", "campaign", "term", "content"] as const).map((k) => [k, str(fd, `utm_${k}`)]).filter(([, v]) => v));
  return {
    campaign: str(fd, "campaign") || undefined,
    source: str(fd, "source") || undefined,
    sourceDetail: str(fd, "sourceDetail") || undefined,
    referredBy: str(fd, "ref") || undefined,
    landingPath: str(fd, "landingPath") || undefined,
    utm,
  };
}

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
      phone: str(fd, "phone") || undefined,
      student: role === "provider" ? studentFromForm(fd) : undefined,
      attribution: role === "provider" ? attributionFromForm(fd) : undefined,
      acceptTerms: fd.get("terms") === "on" ? true : (false as never),
      // Student details come from the student path (studentFromForm) above.
      campaign: str(fd, "campaign") || null,
      prospectToken: str(fd, "c") || (await cookies()).get("cm_pt")?.value || null,
    },
    {
      ip: (await ip()) ?? "unknown",
      visitorId: (await cookies()).get("cm_vid")?.value ?? null,
      guard: { honeypot: str(fd, "website"), startedAt: str(fd, "startedAt") || null, token: str(fd, "cf-turnstile-response") || null },
    },
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
