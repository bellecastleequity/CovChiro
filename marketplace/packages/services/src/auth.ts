import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { authenticator } from "otplib";
import { z } from "zod";
import { brand, env } from "@cm/config";
import { DomainError } from "@cm/core";
import { prisma, seedBase, type Prisma, type User } from "@cm/db";
import { audit, getSettings, SYSTEM, type Actor } from "./context";
import { notifyAdmins, sendEmail } from "./notify";
import { onUserSignup } from "./leads";
import { track } from "./analytics";
import { AttributionInput, attributionFields, StudentInput, studentFields } from "./prelicensure";

/**
 * Email/password auth with DB-backed sessions (cookie holds a random token;
 * only its sha256 is stored), argon2id password hashes, and TOTP MFA —
 * mandatory for PLATFORM_ADMIN. Libraries only; no custom crypto.
 */

export const SESSION_DAYS = 30;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(pw: string) {
  return hash(pw);
}

export async function checkRateLimit(key: string, max: number, windowSeconds: number) {
  const now = new Date();
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (!row || row.windowEnd < now) {
    await prisma.rateLimit.upsert({ where: { key }, create: { key, count: 1, windowEnd: new Date(+now + windowSeconds * 1000) }, update: { count: 1, windowEnd: new Date(+now + windowSeconds * 1000) } });
    return;
  }
  if (row.count >= max) throw new DomainError("FORBIDDEN", "Too many attempts. Please wait a few minutes and try again.", undefined, 429);
  await prisma.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
}

export const SignupInput = z.object({
  role: z.enum(["clinic", "provider"]),
  name: z.string().trim().min(2, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  organization: z.string().trim().max(160).optional(),
  professionCodes: z.array(z.string()).optional(),
  /** Providers only: mobile number (required on the student path). */
  phone: z.string().trim().max(30).optional(),
  /** Providers only, opt-in: "I'm a student or new graduate — not licensed yet". */
  student: StudentInput.optional(),
  attribution: AttributionInput.optional(),
  acceptTerms: z.literal(true, { message: "Please accept the terms to continue." }),
});

export async function signup(raw: z.input<typeof SignupInput>, meta: { ip?: string; visitorId?: string | null } = {}) {
  const input = SignupInput.parse(raw);
  if (meta.ip) await checkRateLimit(`signup:${meta.ip}`, 10, 3600);
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw new DomainError("CONFLICT", "An account with that email already exists. Try signing in.");
  }
  if (input.student && input.role === "provider") {
    if (!(await getSettings())["features.preLicensureEnabled"]) throw new DomainError("FORBIDDEN", "Student sign-up isn't available right now.");
    if ((input.phone ?? "").replace(/\D/g, "").length < 10) throw new DomainError("VALIDATION", "Enter your mobile number.");
  }
  // Prepared outside the transaction: the student ZIP lookup may call the geocoder.
  const studentData = input.role === "provider" && input.student ? await studentFields(input.student, new Date()) : {};
  const passwordHash = await hashPassword(input.password);
  let adminLink = "/admin";
  let details: string[] = [];
  const user = await prisma.$transaction(async (db) => {
    if (input.role === "clinic") {
      const org = input.organization?.trim() || `${input.name}'s clinic`;
      const u = await db.user.create({ data: { email: input.email, name: input.name, passwordHash, role: "CLINIC_OWNER" } });
      const c = await db.clinicOrg.create({ data: { legalName: org, displayName: org, billingEmail: input.email, members: { create: { userId: u.id, role: "CLINIC_OWNER" } } } });
      adminLink = `/admin/clinics/${c.id}`;
      details = [`Clinic: ${org}`];
      return u;
    }
    const professions = await db.profession.findMany({ where: { code: { in: input.professionCodes?.length ? input.professionCodes : ["DC"] } } });
    if (!professions.length) throw new DomainError("VALIDATION", "Choose at least one profession.");
    const u = await db.user.create({ data: { email: input.email, name: input.name, passwordHash, role: "PROVIDER", phone: input.phone || null } });
    const p = await db.provider.create({
      data: {
        userId: u.id,
        legalName: input.name,
        displayName: input.name,
        professions: { create: professions.map((p) => ({ professionCode: p.code })) },
        stats: { create: {} },
        ...(await attributionFields(db, input.attribution)),
        ...studentData,
      } as Prisma.ProviderUncheckedCreateInput,
    });
    adminLink = `/admin/providers/${p.id}`;
    details = [`Profession: ${professions.map((x) => x.displayName).join(", ")}`, ...(input.student ? [`Student / not yet licensed — graduating ${input.student.graduationDate.toISOString().slice(0, 10)}, ${input.student.school}`] : [])];
    return u;
  });
  await audit(prisma, { userId: user.id, role: user.role }, "user.signup", "User", user.id, null, { role: user.role });
  await sendVerificationEmail(user);
  await onUserSignup(user.id, user.email);
  // Let the owner know about every new account.
  await notifyAdmins(prisma, {
    template: "admin_new_signup",
    title: `New ${input.role} signup: ${input.role === "clinic" ? (input.organization?.trim() || input.name) : input.name}`,
    body: `${input.name} (${input.email}) just created a ${input.role} account.`,
    details,
    link: adminLink,
    ctaLabel: `View ${input.role}`,
  }).catch((e) => console.error("admin signup notice failed", e));
  await track({ type: "SIGNUP", userId: user.id, visitorId: meta.visitorId, path: input.attribution?.landingPath ?? null, utm: input.attribution?.utm, props: { role: input.role, student: !!input.student, campaign: input.attribution?.campaign ?? null } });
  return user;
}

async function createToken(userId: string, purpose: string, hours: number) {
  const token = randomBytes(32).toString("base64url");
  await prisma.authToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3_600_000) } });
  return token;
}

async function consumeToken(token: string, purpose: string) {
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) throw new DomainError("VALIDATION", "This link is invalid or has expired.");
  await prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.userId;
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "name">) {
  const token = await createToken(user.id, "EMAIL_VERIFY", 72);
  return sendEmail(user.email, {
    subject: `Confirm your email for ${brand().name}`,
    heading: "Confirm your email",
    paragraphs: [`Hi ${user.name.split(" ")[0]}, please confirm your email address to finish setting up your account.`],
    cta: { label: "Confirm email", url: `/verify-email?token=${token}` },
  });
}

/** "Resend confirmation email" (at most 5 an hour per account). */
export async function resendVerificationEmail(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return "Your email is already confirmed.";
  await checkRateLimit(`verify-resend:${userId}`, 5, 3600);
  if (!(await sendVerificationEmail(user))) {
    throw new DomainError("VALIDATION", `We couldn't send the email just now. Please try again in a few minutes, or contact ${brand().supportEmail}.`);
  }
  return `Sent to ${user.email}. It can take a few minutes — check spam too.`;
}

export async function verifyEmail(token: string) {
  const userId = await consumeToken(token, "EMAIL_VERIFY");
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  // Email may have been a provider's last onboarding step.
  const provider = await prisma.provider.findUnique({ where: { userId }, select: { id: true } });
  if (provider) await (await import("./onboarding")).recomputeProviderStatus(provider.id);
  return userId;
}

export type EmailLinkResult = "confirmed" | "already_confirmed" | "expired" | "invalid";

/**
 * The confirmation link page. Forgiving on purpose: a second click, a
 * reload, or a mail scanner that opened the link first all end at "your
 * email is confirmed" rather than "expired". An expired or superseded link
 * still identifies the account, so the page can offer a new one without
 * making the person sign in.
 */
export async function confirmEmailLink(token: string): Promise<EmailLinkResult> {
  const row = token ? await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } }) : null;
  if (!row || row.purpose !== "EMAIL_VERIFY") return "invalid";
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user) return "invalid";
  if (user.emailVerifiedAt) return "already_confirmed";
  if (row.usedAt || row.expiresAt < new Date()) return "expired";
  await verifyEmail(token);
  return "confirmed";
}

/** "Email me a new link" from an expired confirmation link (no sign-in needed; same rate limit). */
export async function resendVerificationFromLink(token: string) {
  const row = token ? await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } }) : null;
  if (!row || row.purpose !== "EMAIL_VERIFY") throw new DomainError("VALIDATION", "Sign in, then use \"Resend confirmation email\" at the top of the page.");
  return resendVerificationEmail(row.userId);
}

export async function requestPasswordReset(email: string, ip?: string) {
  if (ip) await checkRateLimit(`reset:${ip}`, 5, 3600);
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Same response either way — no account enumeration.
  if (!user || user.disabledAt) return;
  const token = await createToken(user.id, "PASSWORD_RESET", 1);
  await sendEmail(user.email, {
    subject: `Reset your ${brand().name} password`,
    heading: "Reset your password",
    paragraphs: ["Use the button below within the next hour. If you didn't ask for this, you can ignore this email."],
    cta: { label: "Choose a new password", url: `/reset-password?token=${token}` },
  });
}

export async function resetPassword(token: string, password: string) {
  if (password.length < 10) throw new DomainError("VALIDATION", "Use at least 10 characters.");
  const userId = await consumeToken(token, "PASSWORD_RESET");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  await prisma.session.deleteMany({ where: { userId } });
  await audit(prisma, { userId, role: "SYSTEM" }, "user.password_reset", "User", userId);
}

// A fixed hash so a login for an unknown email takes the same time as a wrong password.
let dummyHash: string | null = null;

export async function login(emailRaw: string, password: string, ip?: string) {
  const email = emailRaw.trim().toLowerCase();
  if (ip) await checkRateLimit(`login:${ip}`, 20, 900);
  await checkRateLimit(`login-email:${email}`, 10, 900);
  const user = await prisma.user.findUnique({ where: { email } });
  dummyHash ??= await hash("not-a-real-password");
  const ok = await verify(user?.passwordHash ?? dummyHash, password).catch(() => false);
  if (!user || !ok || user.disabledAt) throw new DomainError("UNAUTHENTICATED", "That email and password don't match.");
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const needsMfa = user.mfaEnabled;
  const mustEnroll = user.role === "PLATFORM_ADMIN" && !user.mfaEnabled;
  const token = await createSession(user.id, !needsMfa && !mustEnroll);
  return { user, token, mfaRequired: needsMfa, mfaEnrollRequired: mustEnroll };
}

export async function createSession(userId: string, mfaVerified: boolean, userAgent?: string) {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), mfaVerified, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000), userAgent: userAgent?.slice(0, 200) } });
  return token;
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export interface SessionInfo {
  sessionId: string;
  user: User;
  mfaVerified: boolean;
  actor: Actor;
}

export async function sessionFromToken(token: string | undefined | null): Promise<SessionInfo | null> {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { provider: true, clinicMembers: true } } } });
  if (!s || s.expiresAt < new Date() || s.user.disabledAt) return null;
  const u = s.user;
  const member = u.clinicMembers[0];
  const actor: Actor = {
    userId: u.id,
    role: u.role === "PROVIDER" ? "PROVIDER" : u.role,
    providerId: u.provider?.id ?? null,
    clinicOrgId: member?.clinicOrgId ?? null,
  };
  const { provider: _p, clinicMembers: _c, ...user } = u;
  return { sessionId: s.id, user: user as User, mfaVerified: s.mfaVerified, actor };
}

// ---------------- TOTP ----------------

authenticator.options = { window: 1 };

export async function beginMfaEnrollment(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const secret = authenticator.generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: secret, mfaEnabled: false } });
  return { secret, otpauthUrl: authenticator.keyuri(user.email, brand().name, secret) };
}

export async function completeMfa(sessionToken: string, code: string, opts: { enrolling: boolean }) {
  const info = await sessionFromToken(sessionToken);
  if (!info) throw new DomainError("UNAUTHENTICATED", "Please sign in again.");
  await checkRateLimit(`mfa:${info.user.id}`, 8, 900);
  const secret = info.user.totpSecret;
  if (!secret || !authenticator.check(code.replace(/\s/g, ""), secret)) throw new DomainError("VALIDATION", "That code didn't match. Try the newest code in your app.");
  if (opts.enrolling) {
    await prisma.user.update({ where: { id: info.user.id }, data: { mfaEnabled: true } });
    await audit(prisma, info.actor, "user.mfa_enabled", "User", info.user.id);
  }
  await prisma.session.update({ where: { id: info.sessionId }, data: { mfaVerified: true } });
}

export async function changePassword(actor: Actor, current: string, next: string) {
  if (!actor.userId) throw new DomainError("UNAUTHENTICATED", "Sign in first.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.passwordHash || !(await verify(user.passwordHash, current))) throw new DomainError("VALIDATION", "Your current password is incorrect.");
  if (next.length < 10) throw new DomainError("VALIDATION", "Use at least 10 characters.");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  await audit(prisma, actor, "user.password_changed", "User", user.id);
}

export { SYSTEM };

// ---------------- phone verification (SMS) ----------------

/** Sends a 6-digit code by SMS. SMS consent is recorded when the code is confirmed (Addendum 02 §8.4). */
export async function startPhoneVerification(actor: Actor, phoneRaw: string) {
  if (!actor.userId) throw new DomainError("UNAUTHENTICATED", "Sign in first.");
  const digits = phoneRaw.replace(/\D/g, "");
  const phone = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
  if (!phone) throw new DomainError("VALIDATION", "Enter a 10-digit US mobile number.");
  await checkRateLimit(`phone:${actor.userId}`, 5, 3600);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await prisma.user.update({ where: { id: actor.userId }, data: { phone, phoneVerifiedAt: null } });
  await prisma.authToken.create({ data: { userId: actor.userId, purpose: "PHONE_VERIFY", tokenHash: sha256(`${actor.userId}:${code}`), expiresAt: new Date(Date.now() + 10 * 60_000) } });
  const { smsProvider } = await import("@cm/integrations");
  await smsProvider().send(phone, `${brand().name}: your verification code is ${code}. Msg & data rates may apply. Reply STOP to opt out.`);
  return phone;
}

export async function confirmPhone(actor: Actor, code: string, smsConsent: boolean) {
  if (!actor.userId) throw new DomainError("UNAUTHENTICATED", "Sign in first.");
  await checkRateLimit(`phone-confirm:${actor.userId}`, 8, 900);
  await consumeToken(`${actor.userId}:${code.trim()}`, "PHONE_VERIFY");
  await prisma.user.update({ where: { id: actor.userId }, data: { phoneVerifiedAt: new Date() } });
  if (actor.providerId) await prisma.provider.update({ where: { id: actor.providerId }, data: { smsConsentAt: smsConsent ? new Date() : null } });
  await audit(prisma, actor, "user.phone_verified", "User", actor.userId, null, { smsConsent });
}

// ----------------------------------------------------------------------
// First-run setup (hosts without a shell, e.g. cPanel): load the base
// configuration and create the first admin. Works only while SETUP_TOKEN is
// set AND no admin exists yet; afterwards the page and action are inert.
// ----------------------------------------------------------------------

export async function setupAvailable() {
  const t = env().SETUP_TOKEN;
  if (!t || t.length < 16) return false;
  return (await prisma.user.count({ where: { role: "PLATFORM_ADMIN" } })) === 0;
}

const SetupInput = z.object({
  token: z.string(),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12, "Use at least 12 characters.").max(200),
});

export async function createFirstAdmin(raw: z.input<typeof SetupInput>, ip?: string) {
  if (ip) await checkRateLimit(`setup:${ip}`, 10, 3600);
  const input = SetupInput.parse(raw);
  const expected = Buffer.from(env().SETUP_TOKEN ?? "");
  const given = Buffer.from(input.token);
  if (!(await setupAvailable()) || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new DomainError("FORBIDDEN", "Setup isn't available. Check the setup token, or sign in if an admin already exists.");
  }
  await seedBase(prisma);
  const user = await prisma.user.create({
    data: { email: input.email, name: input.name, role: "PLATFORM_ADMIN", passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date() },
  });
  await audit(prisma, SYSTEM, "setup.first_admin", "User", user.id, null, { email: user.email });
  return { email: user.email };
}
