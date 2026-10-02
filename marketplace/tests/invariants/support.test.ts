import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { support } from "@cm/services";
import { makeClinic, makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

describe("help center support requests", () => {
  it("clinic opens a request, admins reply, the clinic replies back, and only they can see it", async () => {
    const clinic = await makeClinic();
    const r = await support.createRequest(clinic.actor, { topic: "Payments and billing", subject: "Charge on my card", body: "I see two charges for the same day, can you check?" });
    expect(r).toMatchObject({ audience: "CLINIC", status: "OPEN", clinicOrgId: clinic.org.id });
    const admins = await prisma.user.findMany({ where: { role: "PLATFORM_ADMIN" }, select: { id: true } });
    if (admins.length) expect(await prisma.notification.count({ where: { userId: { in: admins.map((a) => a.id) }, template: "support_new" } })).toBeGreaterThan(0);

    await support.adminReply(admin, r.id, "Thanks, one was the deposit and one the balance.");
    expect((await prisma.supportRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("ANSWERED");
    expect(await support.answeredCount(clinic.user.id)).toBe(1);
    expect(await prisma.notification.count({ where: { userId: clinic.user.id, template: "support_answer" } })).toBe(1);

    await support.reply(clinic.actor, r.id, "Got it, thank you!");
    const thread = await support.myRequest(clinic.actor, r.id);
    expect(thread.status).toBe("OPEN");
    expect(thread.messages.map((m) => m.fromStaff)).toEqual([false, true, false]);

    // Someone else can't read or reply.
    const other = await makeProvider();
    await expect(support.myRequest(other.actor, r.id)).rejects.toThrow(/not found/i);
    await expect(support.reply(other.actor, r.id, "hello there")).rejects.toThrow(/not found/i);

    await support.closeOwn(clinic.actor, r.id);
    expect((await support.adminList(admin, "CLOSED")).rows.map((x) => x.id)).toContain(r.id);
  });

  it("refuses patient information, unknown topics fall back to Other, and shifts must be the user's own", async () => {
    const provider = await makeProvider();
    await expect(support.createRequest(provider.actor, { topic: "Other", subject: "Help", body: "Patient name: John Smith DOB 01/02/1980 was upset" })).rejects.toThrow(/patient information/i);
    const clinic = await makeClinic();
    const shift = await prisma.shift.create({
      data: { locationId: clinic.location.id, professionCode: "DC", state: "XX", startsAt: new Date(Date.now() + 9e8), endsAt: new Date(Date.now() + 9e8 + 288e5), clinicPriceCents: 1, providerPayCents: 1, createdById: clinic.user.id },
    });
    const r = await support.createRequest(provider.actor, { topic: "Made up", subject: "A question", body: "How do I add a missed punch?", shiftId: shift.id });
    expect(r).toMatchObject({ topic: "Other", shiftId: null, audience: "PROVIDER" });
    await expect(support.createRequest(admin, { topic: "Other", subject: "x".repeat(5), body: "hello world" })).rejects.toThrow();
  });

  it("Need help now: needs a reachable number or email, alerts admins and emails the support inbox", async () => {
    const { devOutbox } = await import("@cm/integrations");
    const clinic = await makeClinic();
    await expect(support.escalate(clinic.actor, { body: "Our provider hasn't arrived", method: "CALLBACK", phone: "" })).rejects.toThrow(/phone number/i);
    await expect(support.escalate(clinic.actor, { body: "Our provider hasn't arrived", method: "EMAIL", email: "nope" })).rejects.toThrow(/email/i);
    const r = await support.escalate(clinic.actor, { body: "Our provider hasn't arrived and patients are waiting", method: "CALLBACK", phone: "1 (407) 555-0142", email: "office@example.com" });
    expect(r).toMatchObject({ method: "CALLBACK", reach: "(407) 555-0142" });
    const row = await prisma.supportRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ urgent: true, contactPhone: "+14075550142", contactEmail: "office@example.com", status: "OPEN" });
    expect(devOutbox.some((m) => m.to === "support@coverageoncall.com" && /URGENT/.test(m.subject ?? "") && m.body.includes("(407) 555-0142"))).toBe(true);
    expect((await support.urgentWaiting()).map((x) => x.id)).toContain(r.id);
    await support.adminMarkContacted(admin, r.id);
    expect((await support.urgentWaiting()).map((x) => x.id)).not.toContain(r.id);
    expect(support.cleanPhone("407.555.0142")).toBe("+14075550142");
    expect(support.cleanPhone("555-0142")).toBeNull();
  });
});
