import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type Actor } from "@cm/services";

export const SESSION_COOKIE = "cm_session";

export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return auth.sessionFromToken(token);
});

export function homeFor(role: string) {
  if (role === "PLATFORM_ADMIN") return "/admin";
  if (role === "PROVIDER") return "/provider";
  return "/clinic";
}

type Area = "provider" | "clinic" | "admin" | "any";

/** Where this session lands: the home of its active workspace. */
export function homeOf(s: { actor: { role: string } }) {
  return homeFor(s.actor.role);
}

/** Server-side gate for every portal page and action. */
export async function requireActor(area: Area): Promise<{ actor: Actor; user: NonNullable<Awaited<ReturnType<typeof getSession>>>["user"] }> {
  let s = await getSession();
  if (!s) redirect("/login");
  // One login with a clinic and a provider side: opening the other side's page (a link in an email,
  // a bookmark) switches this session to that side instead of bouncing them.
  const wantsProvider = area === "provider" && s.actor.role !== "PROVIDER" && s.workspaces.provider;
  const wantsClinic = area === "clinic" && s.actor.role === "PROVIDER" && s.workspaces.clinic;
  if (s.user.role !== "PLATFORM_ADMIN" && (wantsProvider || wantsClinic)) {
    await auth.switchWorkspace(s.sessionId, wantsProvider ? "PROVIDER" : "CLINIC");
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    s = (await auth.sessionFromToken(token))!;
  }
  const needsMfa = s.user.role === "PLATFORM_ADMIN" || s.user.mfaEnabled;
  // Test site: 2-step is an emailed code, so there's nothing to set up first.
  if (needsMfa && !s.mfaVerified) redirect(s.user.mfaEnabled || auth.emailCodeMfa() ? "/mfa" : "/mfa/setup");
  const ok =
    area === "any" ||
    (area === "provider" && s.actor.role === "PROVIDER") ||
    (area === "clinic" && (s.actor.role === "CLINIC_OWNER" || s.actor.role === "CLINIC_STAFF")) ||
    (area === "admin" && s.actor.role === "PLATFORM_ADMIN");
  if (!ok) redirect(homeOf(s));
  return { actor: s.actor, user: s.user };
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: auth.SESSION_DAYS * 86_400,
  });
}
