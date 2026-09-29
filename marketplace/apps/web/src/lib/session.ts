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

/** Server-side gate for every portal page and action. */
export async function requireActor(area: Area): Promise<{ actor: Actor; user: NonNullable<Awaited<ReturnType<typeof getSession>>>["user"] }> {
  const s = await getSession();
  if (!s) redirect("/login");
  const needsMfa = s.user.role === "PLATFORM_ADMIN" || s.user.mfaEnabled;
  if (needsMfa && !s.mfaVerified) redirect(s.user.mfaEnabled ? "/mfa" : "/mfa/setup");
  const ok =
    area === "any" ||
    (area === "provider" && s.actor.role === "PROVIDER") ||
    (area === "clinic" && (s.actor.role === "CLINIC_OWNER" || s.actor.role === "CLINIC_STAFF")) ||
    (area === "admin" && s.actor.role === "PLATFORM_ADMIN");
  if (!ok) redirect(homeFor(s.user.role));
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
