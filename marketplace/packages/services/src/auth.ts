import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { authenticator } from "otplib";
import { z } from "zod";
import { assessSender, checkHuman, requireHuman, type FormGuard } from "./spam";
import { recordReferralSignup } from "./referrals";
import { brand, env, isSandbox } from "@cm/config";
import { humanVerifier } from "@cm/integrations";
import { DomainError } from "@cm/core";
import { prisma, seedBase, type Prisma, type User } from "@cm/db";
import { audit, getSettings, SYSTEM, type Actor } from "./context";
import { notifyAdmins, sendEmail } from "./notify";
import * as growthPublic from "./growth/public";
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

/** Adds one to a counter that resets after windowSeconds; returns the count before this one. */
async function bump(key: string, windowSeconds: number) {
  const now = new Date();
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (!row || row.windowEnd < now) {
    await prisma.rateLimit.upsert({ where: { key }, create: { key, count: 1, windowEnd: new Date(+now + windowSeconds * 1000) }, update: { count: 1, windowEnd: new Date(+now + windowSeconds * 1000) } });
    return 0;
  }
  await prisma.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
  return row.count;
}

async function currentCount(key: string) {
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  return row && row.windowEnd >= new Date() ? row.count : 0;
}

export async function checkRateLimit(key: string, max: number, windowSeconds: number) {
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (row && row.windowEnd >= new Date() && row.count >= max) throw new DomainError("FORBIDDEN", "Too many attempts. Please wait a few minutes and try again.", undefined, 429);
  await bump(key, windowSeconds);
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
  /** Growth attribution: /join/<campaign> link, pre-licensure details, or a prospect's emailed-link token. */
  campaign: z.string().trim().max(60).optional().nullable(),
  graduationDate: z.string().trim().max(10).optional().nullable(),
  isStudent: z.boolean().optional(),
  prospectToken: z.string().trim().max(60).optional().nullable(),
  /** Referral code from /r/<code> (link or cookie). */
  referralCode: z.string().trim().max(40).optional().nullable(),
});

export async function signup(raw: z.input<typeof SignupInput>, meta: { ip?: string; visitorId?: string | null; guard?: FormGuard } = {}) {
  const input = SignupInput.parse(raw);
  if (meta.ip) {
    await checkRateLimit(`signup:${meta.ip}`, 10, 3600);
    if ((await checkHuman({ ...meta.guard, ip: meta.ip })) === "bot") throw new DomainError("VALIDATION", "Something went wrong. Please refresh the page and try again.");
  }
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw new DomainError("CONFLICT", "An account with that email already exists. Try signing in.");
  }
  if (await prisma.bannedEmail.findUnique({ where: { email: input.email.trim().toLowerCase() } })) {
    throw new DomainError("FORBIDDEN", "We can't create an account with that email. Contact us if you think this is a mistake.");
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
  let clinicOrgId: string | null = null;
  let providerId: string | null = null;
  const user = await prisma.$transaction(async (db) => {
    if (input.role === "clinic") {
      const org = input.organization?.trim() || `${input.name}'s clinic`;
      const u = await db.user.create({ data: { email: input.email, name: input.name, passwordHash, role: "CLINIC_OWNER" } });
      const c = await db.clinicOrg.create({ data: { legalName: org, displayName: org, billingEmail: input.email, members: { create: { userId: u.id, role: "CLINIC_OWNER" } } } });
      adminLink = `/admin/clinics/${c.id}`;
      clinicOrgId = c.id;
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
    providerId = p.id;
    details = [`Profession: ${professions.map((x) => x.displayName).join(", ")}`, ...(input.student ? [`Student / not yet licensed — graduating ${input.student.graduationDate.toISOString().slice(0, 10)}, ${input.student.school}`] : [])];
    return u;
  });
  await audit(prisma, { userId: user.id, role: user.role }, "user.signup", "User", user.id, null, { role: user.role });
  await sendVerificationEmail(user);
  await onUserSignup(user.id, user.email);
  if (input.referralCode) await recordReferralSignup(user.id, input.referralCode);
  try {
    // The student path (input.student) is the source of truth; Growth only records attribution from it.
    if (providerId) {
      await growthPublic.onProviderSignup(providerId, {
        campaign: input.campaign ?? input.attribution?.campaign ?? null,
        graduationDate: input.student ? input.student.graduationDate.toISOString().slice(0, 10) : input.graduationDate,
        isStudent: !!input.student || !!input.isStudent,
        prospectToken: input.prospectToken,
      });
    }
    if (clinicOrgId) await growthPublic.onClinicSignup(clinicOrgId, input.prospectToken);
  } catch (e) {
    console.error("growth signup attribution failed", e);
  }
  // Spam signups are only flagged here (never blocked): the owner decides with suspend / ban.
  const spam = await assessSender({ name: input.name, email: input.email, text: input.organization ?? "" }).catch(() => null);
  if (spam?.category) await audit(prisma, { userId: user.id, role: user.role }, "user.signup_flagged", "User", user.id, null, { score: spam.score, reasons: spam.reasons });
  // Let the owner know about every new account.
  await notifyAdmins(prisma, {
    template: "admin_new_signup",
    title: `${spam?.category ? "Possible spam — " : ""}New ${input.role} signup: ${input.role === "clinic" ? (input.organization?.trim() || input.name) : input.name}`,
    body: `${input.name} (${input.email}) just created a ${input.role} account.`,
    details: spam?.category ? [...details, `Spam check: ${spam.reasons.join(", ")} (score ${spam.score}). Suspend or ban from their admin page if it isn't a real ${input.role}.`] : details,
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
export async function resendVerificationFromLink(token: string, guard?: FormGuard) {
  if (guard) await requireHuman(guard);
  const row = token ? await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } }) : null;
  if (!row || row.purpose !== "EMAIL_VERIFY") throw new DomainError("VALIDATION", "Sign in, then use \"Resend confirmation email\" at the top of the page.");
  return resendVerificationEmail(row.userId);
}

/** guard: the public "Forgot password" form (an admin-sent reset has none). */
export async function requestPasswordReset(email: string, ip?: string, guard?: FormGuard) {
  if (guard) await requireHuman({ ...guard, ip });
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
  // A fresh password ends any sign-in lockout for this email.
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (u) await prisma.rateLimit.deleteMany({ where: { key: { in: [`login-fail:${u.email}`, `login-email:${u.email}`] } } });
  await audit(prisma, { userId, role: "SYSTEM" }, "user.password_reset", "User", userId);
}

// A fixed hash so a login for an unknown email takes the same time as a wrong password.
let dummyHash: string | null = null;

/** Thrown when sign-in needs the human check; the form then shows the check (SignInGuard). */
export const LOGIN_CHALLENGE = "For your security, please complete the \u201cverify you're human\u201d check, then sign in again.";
export const LOGIN_MISMATCH_CHECK = "That email and password don't match. Please complete the \u201cverify you're human\u201d check, then try again.";
export const LOGIN_LOCKED = "Too many wrong passwords. For your security, sign-in for this email is paused for 15 minutes. Use \u201cForgot password?\u201d below to reset it now.";
const FAIL_WINDOW = 900;

/** True when sign-in from this address already needs the human check (the page shows it up front). */
export async function loginChallengeNeeded(ip?: string | null) {
  if (humanVerifier().name === "off") return false;
  const after = (await getSettings())["spam.loginChallengeAfter"];
  return after === 0 || (!!ip && (await currentCount(`login-fail-ip:${ip}`)) >= after);
}

/**
 * humanToken: the Turnstile token from the sign-in form. It's only required after
 * spam.loginChallengeAfter failed sign-ins for this email or from this address
 * (password guessing spread over many accounts or addresses), and only when Turnstile keys are set.
 */
export async function login(emailRaw: string, password: string, ip?: string, opts: { humanToken?: string | null } = {}) {
  const email = emailRaw.trim().toLowerCase();
  if (ip) await checkRateLimit(`login:${ip}`, 20, FAIL_WINDOW);
  await checkRateLimit(`login-email:${email}`, 10, FAIL_WINDOW);
  const settings = await getSettings();
  const after = settings["spam.loginChallengeAfter"];
  if ((await currentCount(`login-fail:${email}`)) >= settings["spam.loginLockoutAfter"]) {
    throw new DomainError("FORBIDDEN", LOGIN_LOCKED, undefined, 429);
  }
  const failures = Math.max(await currentCount(`login-fail:${email}`), ip ? await currentCount(`login-fail-ip:${ip}`) : 0);
  if (failures >= after) {
    const v = await humanVerifier().verify(opts.humanToken ?? null, ip ?? null);
    if (!v.ok) throw new DomainError("VALIDATION", LOGIN_CHALLENGE);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  dummyHash ??= await hash("not-a-real-password");
  const ok = await verify(user?.passwordHash ?? dummyHash, password).catch(() => false);
  if (!user || !ok || user.disabledAt) {
    const byEmail = (await bump(`login-fail:${email}`, FAIL_WINDOW)) + 1;
    const byIp = ip ? (await bump(`login-fail-ip:${ip}`, FAIL_WINDOW)) + 1 : 0;
    if (byEmail >= settings["spam.loginLockoutAfter"]) throw new DomainError("FORBIDDEN", LOGIN_LOCKED, undefined, 429);
    // From now on the form shows the check (the page looks for "verify you're human").
    if (Math.max(byEmail, byIp) >= after && humanVerifier().name !== "off") throw new DomainError("UNAUTHENTICATED", LOGIN_MISMATCH_CHECK);
    throw new DomainError("UNAUTHENTICATED", "That email and password don't match.");
  }
  await prisma.rateLimit.deleteMany({ where: { key: `login-fail:${email}` } });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  // Test site: 2-step is an emailed code for everyone who needs one (no authenticator app).
  if (isSandbox() && (user.role === "PLATFORM_ADMIN" || user.mfaEnabled)) {
    const token = await createSession(user.id, false);
    await sendEmailCode(user.id).catch((e) => console.error("mfa email code failed", e));
    return { user, token, mfaRequired: true, mfaEnrollRequired: false };
  }
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

// ---------------- emailed sign-in code (test site) ----------------

const MFA_EMAIL = "MFA_EMAIL";
const emailCodeHash = (userId: string, code: string) => sha256(`mfa-email:${userId}:${code}`);

/** True when 2-step uses an emailed code instead of an authenticator app (the test site). */
export const emailCodeMfa = () => isSandbox();

/** Emails a fresh 6-digit sign-in code (valid 10 minutes; replaces any earlier one). */
export async function sendEmailCode(userId: string) {
  await checkRateLimit(`mfa-email:${userId}`, 5, 900);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const code = String(randomInt(100000, 1000000));
  await prisma.authToken.deleteMany({ where: { userId, purpose: MFA_EMAIL } });
  await prisma.authToken.create({ data: { userId, purpose: MFA_EMAIL, tokenHash: emailCodeHash(userId, code), expiresAt: new Date(Date.now() + 10 * 60_000) } });
  await sendEmail(user.email, {
    subject: `${brand().name} sign-in code: ${code}`,
    heading: "Your sign-in code",
    paragraphs: [`Enter this code to finish signing in: ${code}`, "It works for 10 minutes. If you didn't try to sign in, you can ignore this email and consider changing your password."],
    essential: true,
  });
}

/** Is there an unexpired emailed code waiting? (The 2-step page sends one if not.) */
export async function hasPendingEmailCode(userId: string) {
  return (await prisma.authToken.count({ where: { userId, purpose: MFA_EMAIL, expiresAt: { gt: new Date() } } })) > 0;
}

export async function completeMfa(sessionToken: string, code: string, opts: { enrolling: boolean }) {
  const info = await sessionFromToken(sessionToken);
  if (!info) throw new DomainError("UNAUTHENTICATED", "Please sign in again.");
  await checkRateLimit(`mfa:${info.user.id}`, 8, 900);
  if (emailCodeMfa()) {
    const row = await prisma.authToken.findUnique({ where: { tokenHash: emailCodeHash(info.user.id, code.replace(/\s/g, "")) } });
    if (!row || row.userId !== info.user.id || row.purpose !== MFA_EMAIL || row.expiresAt < new Date()) {
      throw new DomainError("VALIDATION", "That code didn't match or has expired. Use the newest email, or send a new code.");
    }
    await prisma.authToken.delete({ where: { id: row.id } });
    await prisma.session.update({ where: { id: info.sessionId }, data: { mfaVerified: true } });
    return;
  }
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
  const { smsProvider, textingEnabled, TWILIO_ERROR_HELP } = await import("@cm/integrations");
  const sms = smsProvider();
  if (!textingEnabled() && env().NODE_ENV === "production") {
    throw new DomainError("CONFLICT", "Text alerts aren't available yet — we'll email you instead for now. Your number is saved.");
  }
  if (!(await sms.send(phone, `${brand().name}: your verification code is ${code}. Msg & data rates may apply. Reply STOP to opt out.`))) {
    const help = sms.lastErrorCode ? TWILIO_ERROR_HELP[sms.lastErrorCode] : null;
    throw new DomainError("VALIDATION", `We couldn't text ${phone}. ${help ?? sms.lastError ?? "The text service rejected it."}`);
  }
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
