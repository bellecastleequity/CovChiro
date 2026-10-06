import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@cm/config";
import { DomainError } from "@cm/core";
import { prisma, type User } from "@cm/db";
import { audit } from "./context";
import { checkRateLimit, createAccount, createSession, SignupInput } from "./auth";

/**
 * Sign in with Google, for clinic and provider accounts (admins always use email, password and
 * 2-step). /api/auth/google/start sends the browser to Google; /api/auth/google/callback swaps the
 * code for Google's ID token (server to server, so the token comes straight from Google) and calls
 * googleSignIn:
 *  - this Google account is already linked → signed in;
 *  - an account has the same email (Google says it's verified) → Google is linked to it, signed in;
 *  - no account → a signed, 30-minute "pending" token; /signup/google asks clinic or provider,
 *    clinic name or profession, and the terms, then googleSignup creates the account (email
 *    already confirmed, no password; one can be set later on the profile/settings page).
 */

export const googleEnabled = () => !!(env().GOOGLE_CLIENT_ID?.trim() && env().GOOGLE_CLIENT_SECRET?.trim());

/**
 * What the running app sees, for Admin → Settings (never the secret itself). Also lists
 * Google-ish variable names that are set under a different name, the usual mistake.
 */
export function googleSetupStatus() {
  const id = env().GOOGLE_CLIENT_ID?.trim() ?? "";
  const secret = env().GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const lookalikes = Object.keys(process.env).filter((k) => /GOOGLE|OAUTH|CLIENT/i.test(k) && !/^GOOGLE_(CLIENT_ID|CLIENT_SECRET|MAPS_API_KEY|MAPS_BROWSER_KEY)$/.test(k));
  return {
    enabled: !!(id && secret),
    clientId: id ? `${id.slice(0, 12)}…${id.slice(-27)}` : null,
    clientIdLooksRight: !id || /\.apps\.googleusercontent\.com$/.test(id),
    secretSet: !!secret,
    redirectUri: googleRedirectUri(),
    lookalikes,
  };
}
export const googleRedirectUri = () => `${env().APP_BASE_URL.replace(/\/$/, "")}/api/auth/google/callback`;

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

const b64 = (b: Buffer) => b.toString("base64url");

/** state + nonce + PKCE verifier for one trip to Google (kept in a short-lived cookie). */
export function googleRequest() {
  const verifier = b64(randomBytes(32));
  return { state: b64(randomBytes(16)), nonce: b64(randomBytes(16)), verifier, challenge: b64(createHash("sha256").update(verifier).digest()) };
}

export function googleAuthUrl(r: { state: string; nonce: string; challenge: string }) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: r.state,
    nonce: r.nonce,
    code_challenge: r.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return u.toString();
}

/** Reads and checks the claims of the ID token Google's token endpoint returned. */
export function profileFromIdToken(idToken: string, nonce: string, now = Date.now()): GoogleProfile {
  const c = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  const ok =
    !!env().GOOGLE_CLIENT_ID &&
    (c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com") &&
    c.aud === env().GOOGLE_CLIENT_ID &&
    typeof c.exp === "number" && c.exp * 1000 > now &&
    c.nonce === nonce &&
    typeof c.sub === "string" && typeof c.email === "string";
  if (!ok) throw new DomainError("VALIDATION", "Google sign-in didn't check out. Please try again.");
  return {
    sub: c.sub as string,
    email: (c.email as string).trim().toLowerCase(),
    emailVerified: c.email_verified === true || c.email_verified === "true",
    name: typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 120) : (c.email as string).split("@")[0],
  };
}

export async function exchangeGoogleCode(code: string, verifier: string, nonce: string): Promise<GoogleProfile> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env().GOOGLE_CLIENT_ID ?? "",
      client_secret: env().GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!r.ok || !j.id_token) {
    console.error("google token exchange failed", r.status, j.error, j.error_description);
    throw new DomainError("VALIDATION", "Google sign-in didn't go through. Please try again.");
  }
  return profileFromIdToken(j.id_token, nonce);
}

// ---------------- pending sign-up (no account yet) ----------------

const PENDING_MINUTES = 30;
const secret = () => env().SESSION_SECRET ?? "dev-secret";
const sign = (payload: string) => createHmac("sha256", secret()).update(`google-pending:${payload}`).digest("base64url");

export function pendingToken(p: Pick<GoogleProfile, "sub" | "email" | "name">, now = Date.now()) {
  const payload = b64(Buffer.from(JSON.stringify({ sub: p.sub, email: p.email, name: p.name, exp: now + PENDING_MINUTES * 60_000 })));
  return `${payload}.${sign(payload)}`;
}

/** The Google identity waiting to become an account, or null (bad or expired token). */
export function readPending(token: string | undefined | null, now = Date.now()): { sub: string; email: string; name: string } | null {
  const [payload, mac] = (token ?? "").split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string; email: string; name: string; exp: number };
    return p.exp > now ? { sub: p.sub, email: p.email, name: p.name } : null;
  } catch {
    return null;
  }
}

// ---------------- sign in / sign up ----------------

export type GoogleProblem = "unverified" | "admin" | "disabled" | "other_google" | "banned";

export const GOOGLE_PROBLEMS: Record<GoogleProblem | "failed" | "cancelled" | "expired" | "off", string> = {
  unverified: "Google hasn't verified that email address yet, so we can't use it to sign you in. Verify it with Google, or sign in with your email and password.",
  admin: "Admin accounts sign in with email, password and a 2-step code, not Google.",
  disabled: "This account is turned off. Contact support if you think this is a mistake.",
  other_google: "That email is already linked to a different Google account. Sign in with that Google account, or with your email and password.",
  banned: "We can't create an account with that email. Contact us if you think this is a mistake.",
  failed: "Google sign-in didn't go through. Please try again.",
  cancelled: "Google sign-in was cancelled.",
  expired: "That Google sign-in took too long. Please try again.",
  off: "Sign in with Google isn't available right now. Use your email and password.",
};

export type GoogleSignInResult =
  | { kind: "session"; user: User; token: string; mfaRequired: boolean }
  | { kind: "signup"; pending: string }
  | { kind: "problem"; problem: GoogleProblem };

export async function googleSignIn(p: GoogleProfile, meta: { ip?: string; userAgent?: string } = {}): Promise<GoogleSignInResult> {
  if (meta.ip) await checkRateLimit(`google:${meta.ip}`, 30, 900);
  const byGoogle = await prisma.user.findUnique({ where: { googleSub: p.sub } });
  let user = byGoogle;
  if (!user) {
    // Linking by email only when Google vouches for it: whoever holds that mailbox owns the account.
    if (!p.emailVerified) return { kind: "problem", problem: "unverified" };
    user = await prisma.user.findUnique({ where: { email: p.email } });
    if (user?.googleSub && user.googleSub !== p.sub) return { kind: "problem", problem: "other_google" };
  }
  if (!user) {
    if (await prisma.bannedEmail.findUnique({ where: { email: p.email } })) return { kind: "problem", problem: "banned" };
    return { kind: "signup", pending: pendingToken(p) };
  }
  if (user.role === "PLATFORM_ADMIN") return { kind: "problem", problem: "admin" };
  if (user.disabledAt) return { kind: "problem", problem: "disabled" };
  const firstLink = !user.googleSub;
  const confirms = !user.emailVerifiedAt && p.emailVerified && p.email === user.email.toLowerCase();
  user = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), ...(firstLink ? { googleSub: p.sub } : {}), ...(confirms ? { emailVerifiedAt: new Date() } : {}) },
  });
  if (firstLink) await audit(prisma, { userId: user.id, role: user.role }, "user.google_linked", "User", user.id, null, { email: p.email });
  if (confirms) {
    // A confirmed email may have been a provider's last onboarding step.
    const provider = await prisma.provider.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (provider) await (await import("./onboarding")).recomputeProviderStatus(provider.id);
  }
  // Optional 2-step still applies (test site: an emailed code, sent by the 2-step page).
  const token = await createSession(user.id, !user.mfaEnabled, meta.userAgent);
  return { kind: "session", user, token, mfaRequired: user.mfaEnabled };
}

export const GoogleSignupInput = SignupInput.pick({ role: true, name: true, organization: true, professionCodes: true, acceptTerms: true, campaign: true, prospectToken: true, referralCode: true });

/** Finishes sign-up for a Google identity with no account yet (the /signup/google form). */
export async function googleSignup(pending: string | undefined | null, raw: z.input<typeof GoogleSignupInput>, meta: { ip?: string; visitorId?: string | null } = {}) {
  const g = readPending(pending);
  if (!g) throw new DomainError("VALIDATION", "Your Google sign-in expired. Please choose Continue with Google again.");
  const input = GoogleSignupInput.parse(raw);
  if (input.role === "clinic" && !input.organization?.trim()) throw new DomainError("VALIDATION", "Enter your clinic's name.");
  if (meta.ip) await checkRateLimit(`signup:${meta.ip}`, 10, 3600);
  if (await prisma.user.findUnique({ where: { googleSub: g.sub } })) throw new DomainError("CONFLICT", "That Google account already has an account here. Sign in with Google.");
  return createAccount({ ...input, email: g.email, attribution: input.role === "provider" && input.campaign ? { campaign: input.campaign } : undefined }, null, { sub: g.sub }, meta);
}
