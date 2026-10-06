import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { auth, google } from "@cm/services";
import { uid } from "../factories";

const profile = (email: string, extra: Partial<google.GoogleProfile> = {}): google.GoogleProfile => ({ sub: `g-${uid()}`, email, emailVerified: true, name: "Pat Lee", ...extra });

describe("Sign in with Google", () => {
  it("links Google to an existing clinic or provider account with the same email and signs in", async () => {
    const email = `c-${uid()}@test.dev`;
    const user = await auth.signup({ role: "clinic", name: "Pat Lee", email, password: "correct-horse-battery", organization: "Sunrise Chiropractic", acceptTerms: true });
    const p = profile(email.toUpperCase());
    p.email = p.email.toLowerCase();
    const r = await google.googleSignIn(p);
    expect(r.kind).toBe("session");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.googleSub).toBe(p.sub);
    // Google vouches for the mailbox, so the email counts as confirmed.
    expect(after.emailVerifiedAt).not.toBeNull();
    if (r.kind === "session") expect((await auth.sessionFromToken(r.token))?.user.id).toBe(user.id);
    // Next time the Google id alone finds the account.
    expect((await google.googleSignIn({ ...p, email: `changed-${uid()}@test.dev` })).kind).toBe("session");
  });

  it("no account yet: a pending token, then sign-up makes a confirmed, password-less account", async () => {
    const email = `p-${uid()}@test.dev`;
    const p = profile(email, { name: "Sam Diaz" });
    const r = await google.googleSignIn(p);
    expect(r.kind).toBe("signup");
    if (r.kind !== "signup") return;
    expect(google.readPending(r.pending)).toEqual({ sub: p.sub, email, name: "Sam Diaz" });
    const before = devOutbox.filter((m) => m.to === email).length;
    const user = await google.googleSignup(r.pending, { role: "provider", name: "Sam Diaz", professionCodes: ["DC"], acceptTerms: true });
    expect(user).toMatchObject({ email, role: "PROVIDER", googleSub: p.sub, passwordHash: null });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await prisma.provider.findUnique({ where: { userId: user.id } })).not.toBeNull();
    // No "confirm your email" message for a Google account.
    expect(devOutbox.filter((m) => m.to === email && /Confirm your email/.test(m.subject ?? ""))).toHaveLength(before);
    // The same pending token can't make a second account.
    await expect(google.googleSignup(r.pending, { role: "provider", name: "Sam Diaz", professionCodes: ["DC"], acceptTerms: true })).rejects.toThrow(/already has an account/);
    // They can set a first password later without a current one.
    await auth.changePassword({ userId: user.id, role: "PROVIDER", providerId: null, clinicOrgId: null }, "", "a-brand-new-password");
    expect((await auth.login(email, "a-brand-new-password")).user.id).toBe(user.id);
  });

  it("clinic sign-up needs a clinic name and the terms; a tampered or expired pending token is refused", async () => {
    const r = await google.googleSignIn(profile(`c-${uid()}@test.dev`));
    if (r.kind !== "signup") throw new Error("expected signup");
    await expect(google.googleSignup(r.pending, { role: "clinic", name: "Pat Lee", acceptTerms: true })).rejects.toThrow(/clinic's name/);
    await expect(google.googleSignup(r.pending, { role: "clinic", name: "Pat Lee", organization: "Bayside", acceptTerms: false as never })).rejects.toThrow();
    const [payload, mac] = r.pending.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), email: "someone-else@test.dev" })).toString("base64url");
    expect(google.readPending(`${forged}.${mac}`)).toBeNull();
    expect(google.readPending(r.pending, Date.now() + 31 * 60_000)).toBeNull();
    const clinic = await google.googleSignup(r.pending, { role: "clinic", name: "Pat Lee", organization: "Bayside Chiropractic", acceptTerms: true });
    expect(await prisma.clinicMember.findFirst({ where: { userId: clinic.id, role: "CLINIC_OWNER" } })).not.toBeNull();
  });

  it("refuses admins, turned-off accounts, unverified Google emails, a second Google account, and banned emails", async () => {
    const adminEmail = `a-${uid()}@test.dev`;
    await prisma.user.create({ data: { email: adminEmail, name: "Owner", role: "PLATFORM_ADMIN" } });
    expect(await google.googleSignIn(profile(adminEmail))).toEqual({ kind: "problem", problem: "admin" });

    const offEmail = `off-${uid()}@test.dev`;
    await prisma.user.create({ data: { email: offEmail, name: "Off", role: "CLINIC_OWNER", disabledAt: new Date() } });
    expect(await google.googleSignIn(profile(offEmail))).toEqual({ kind: "problem", problem: "disabled" });

    const email = `u-${uid()}@test.dev`;
    const u = await prisma.user.create({ data: { email, name: "Una", role: "CLINIC_OWNER" } });
    expect(await google.googleSignIn(profile(email, { emailVerified: false }))).toEqual({ kind: "problem", problem: "unverified" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).googleSub).toBeNull();
    expect((await google.googleSignIn(profile(email))).kind).toBe("session");
    expect(await google.googleSignIn(profile(email))).toEqual({ kind: "problem", problem: "other_google" });

    const banned = `b-${uid()}@test.dev`;
    await prisma.bannedEmail.create({ data: { email: banned } });
    expect(await google.googleSignIn(profile(banned))).toEqual({ kind: "problem", problem: "banned" });
  });

  it("signed in: connects any Google account (even another email), refuses one already in use and admins; disconnect needs a password", async () => {
    const email = `office-${uid()}@clinic.dev`;
    const user = await auth.signup({ role: "clinic", name: "Pat Lee", email, password: "correct-horse-battery", organization: "Sunrise Chiropractic", acceptTerms: true });
    const gmail = profile(`pat.${uid()}@gmail.com`);
    expect(await google.connectGoogle(user.id, gmail)).toEqual({ ok: true });
    // Now Continue with Google with the Gmail account signs in to the office login.
    const r = await google.googleSignIn(gmail);
    expect(r.kind === "session" && r.user.id).toBe(user.id);

    const other = await prisma.user.create({ data: { email: `x-${uid()}@test.dev`, name: "X", role: "PROVIDER" } });
    expect(await google.connectGoogle(other.id, gmail)).toEqual({ ok: false, problem: "taken" });
    const admin = await prisma.user.create({ data: { email: `ad-${uid()}@test.dev`, name: "A", role: "PLATFORM_ADMIN" } });
    expect(await google.connectGoogle(admin.id, profile(`ad.${uid()}@gmail.com`))).toEqual({ ok: false, problem: "admin" });

    const actor = { userId: user.id, role: "CLINIC_OWNER" as const, providerId: null, clinicOrgId: null };
    expect(await google.disconnectGoogle(actor)).toMatch(/disconnected/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).googleSub).toBeNull();
    // A Google-only login can't disconnect (it would be locked out).
    const g2 = await google.googleSignIn(profile(`solo-${uid()}@test.dev`));
    if (g2.kind !== "signup") throw new Error("expected signup");
    const solo = await google.googleSignup(g2.pending, { role: "provider", name: "Solo", professionCodes: ["DC"], acceptTerms: true });
    await expect(google.disconnectGoogle({ userId: solo.id, role: "PROVIDER", providerId: null, clinicOrgId: null })).rejects.toThrow(/Set a password first/);
  });

  it("only accepts Google ID tokens meant for us with the right nonce", () => {
    const tok = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
    const claims = { iss: "https://accounts.google.com", aud: "someone-elses-client", exp: Date.now() / 1000 + 600, nonce: "n1", sub: "1", email: "a@b.dev", email_verified: true };
    expect(() => google.profileFromIdToken(tok(claims), "n1")).toThrow(/didn't check out/);
  });
});
