import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { dispatch, growth, renderEmail, texts } from "@cm/services";
import { makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const randomPhone = () => `+1407555${Math.floor(1000 + Math.random() * 8999)}`;

describe("business number: Admin → Texts inbox", () => {
  it("a text from someone new lands in the inbox, gets one automatic reply, and alerts the team", async () => {
    const phone = randomPhone();
    const reply = await dispatch.handleInboundSms(phone, "Hi, do you cover clinics in Tampa next week?");
    expect(reply).toMatch(/Thanks for your text/);
    // A second text soon after: stored, but no second automatic reply.
    expect(await dispatch.handleInboundSms(phone, "Also Sarasota")).toBe("");
    const rows = await prisma.textMessage.findMany({ where: { phone }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.direction)).toEqual(["IN", "OUT", "IN"]);
    const convo = (await texts.conversations(admin)).find((c) => c.phone === phone)!;
    expect(convo.unread).toBe(2);
    // The team is told once per burst: an email to the support inbox (plus in-app/push for each admin).
    expect(devOutbox.filter((m) => m.channel === "email" && m.subject?.startsWith("New text from") && m.body.includes("Tampa"))).toHaveLength(1);
  });

  it("a provider's free-text message is linked to their account; shift-offer answers still work as before", async () => {
    const p = await makeProvider();
    const phone = randomPhone();
    await prisma.user.update({ where: { id: p.userId }, data: { phone, phoneVerifiedAt: new Date() } });
    await dispatch.handleInboundSms(phone, "Running 10 minutes late to the Orlando clinic");
    expect(await prisma.textMessage.findFirstOrThrow({ where: { phone, direction: "IN" } })).toMatchObject({ userId: p.userId });
    // YES without any open offer isn't an offer answer either: it goes to the inbox too.
    await dispatch.handleInboundSms(phone, "yes");
    expect(await prisma.textMessage.count({ where: { phone, direction: "IN" } })).toBe(2);
    expect(await dispatch.handleInboundSms(phone, "HELP")).toMatch(/55-COVER/);
  });

  it("the team replies from the business number, never to a number that texted STOP", async () => {
    const phone = randomPhone();
    await dispatch.handleInboundSms(phone, "Is this CoverageOnCall?");
    await texts.sendText(admin, phone, "Yes! How can we help?");
    expect(devOutbox.some((m) => m.channel === "sms" && m.to === phone && m.body === "Yes! How can we help?")).toBe(true);
    const t = await texts.thread(admin, phone);
    expect(t.messages.at(-1)).toMatchObject({ direction: "OUT", status: "SENT" });
    expect(t.messages.filter((m) => m.direction === "IN").every((m) => m.readAt)).toBe(true);

    await growth.suppress("SMS", phone, "SMS_STOP", "test");
    await expect(texts.sendText(admin, phone, "Still there?")).rejects.toThrow(/STOP/);
  });

  it("every email footer offers the business line for calls only (never texting)", () => {
    const { html, text } = renderEmail({ subject: "s", heading: "h", paragraphs: ["p"] }, { phone: { label: "(855) 55-COVER", tel: "+18555526837" } });
    expect(html).toContain('href="tel:+18555526837"');
    expect(html).not.toContain("sms:");
    expect(html).not.toMatch(/or text/i);
    expect(text).toContain("Call (855) 55-COVER");
  });
});
