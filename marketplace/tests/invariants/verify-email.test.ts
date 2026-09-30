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
