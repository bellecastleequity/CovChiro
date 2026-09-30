import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { auth } from "@cm/services";
import { uid } from "../factories";

describe("resend confirmation email", () => {
  it("sends a fresh link that confirms the account; a confirmed account gets nothing", async () => {
    const user = await prisma.user.create({ data: { email: `u-${uid()}@test.dev`, name: "Pat Lee", role: "CLINIC_OWNER" } });
    const mine = () => devOutbox.filter((m) => m.to === user.email);
    expect(await auth.resendVerificationEmail(user.id)).toMatch(/^Sent to /);
    const link = mine().at(-1)!.body.match(/verify-email\?token=([\w-]+)/)![1];
    await auth.verifyEmail(link);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    const before = mine().length;
    expect(await auth.resendVerificationEmail(user.id)).toMatch(/already confirmed/);
    expect(mine()).toHaveLength(before);
  });
});

describe("confirmation link page", () => {
  const newUser = () => prisma.user.create({ data: { email: `v-${uid()}@test.dev`, name: "Sam Diaz", role: "PROVIDER" } });
  const lastToken = (email: string) => devOutbox.filter((m) => m.to === email).at(-1)!.body.match(/verify-email\?token=([\w-]+)/)![1];

  it("second click / scanner pre-open still reads as confirmed", async () => {
    const u = await newUser();
    await auth.resendVerificationEmail(u.id);
    const t = lastToken(u.email);
    expect(await auth.confirmEmailLink(t)).toBe("confirmed");
    expect(await auth.confirmEmailLink(t)).toBe("already_confirmed");
  });

  it("an expired link offers a new one without signing in; a junk link is invalid", async () => {
    const u = await newUser();
    await auth.resendVerificationEmail(u.id);
    const old = lastToken(u.email);
    await prisma.authToken.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await auth.confirmEmailLink(old)).toBe("expired");
    expect(await auth.resendVerificationFromLink(old)).toMatch(/^Sent to /);
    expect(await auth.confirmEmailLink(lastToken(u.email))).toBe("confirmed");
    expect(await auth.confirmEmailLink("not-a-real-token")).toBe("invalid");
    await expect(auth.resendVerificationFromLink("not-a-real-token")).rejects.toThrow(/Sign in/);
  });
});
