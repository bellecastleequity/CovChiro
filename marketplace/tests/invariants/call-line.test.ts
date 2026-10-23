import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { callline, growth } from "@cm/services";

const admin = async () => {
  const u = await prisma.user.create({ data: { email: `a-${Math.random().toString(36).slice(2)}@test.dev`, name: "Admin", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
  return { userId: u.id, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
};
const randomPhone = () => `+1407556${Math.floor(1000 + Math.random() * 8999)}`;
const contact = () => `c-${Math.random().toString(36).slice(2)}`;

describe("phone line call menu: continue by text, or a callback", () => {
  it("lookup reads the caller's last four; pressing 1 texts them once from the texting number, logged", async () => {
    const phone = randomPhone(), contactId = contact();
    const look = await callline.callMenu({ action: "lookup", contactId, callerPhone: phone });
    expect(look.lastFour).toBe(phone.slice(-4).split("").join(" "));
    expect(look.canText).toBe(true);

    const r = await callline.callMenu({ action: "text", contactId, callerPhone: phone, choice: "same" });
    expect(r.result).toBe("done");
    expect(r.say).toMatch(/sent a text/);
    expect(await prisma.textMessage.count({ where: { phone, direction: "OUT" } })).toBe(1);
    expect(devOutbox.filter((m) => m.channel === "sms" && m.to === phone && /continue by text/.test(m.body))).toHaveLength(1);
    // The flow retrying the same call never sends a second text.
    expect((await callline.callMenu({ action: "text", contactId, callerPhone: phone, choice: "same" })).result).toBe("done");
    expect(await prisma.textMessage.count({ where: { phone, direction: "OUT" } })).toBe(1);
    expect(await prisma.callLog.findUniqueOrThrow({ where: { contactKey: `${contactId}:TEXT` } })).toMatchObject({ outcome: "TEXT_SENT", phone });
  });

  it("a keyed-in number is used; a bad one asks again; no caller ID asks for digits", async () => {
    const other = randomPhone();
    expect((await callline.callMenu({ action: "text", contactId: contact(), callerPhone: null, choice: "same" })).result).toBe("retry");
    expect((await callline.callMenu({ action: "text", contactId: contact(), callerPhone: randomPhone(), choice: "other", digits: "12345" })).result).toBe("retry");
    const ok = await callline.callMenu({ action: "text", contactId: contact(), callerPhone: randomPhone(), choice: "other", digits: other.slice(2) });
    expect(ok.result).toBe("done");
    expect(await prisma.textMessage.count({ where: { phone: other, direction: "OUT" } })).toBe(1);
  });

  it("never texts a number that texted STOP, and stops after the daily limit", async () => {
    const stopped = randomPhone();
    await growth.suppress("SMS", stopped, "SMS_STOP", "test");
    const r = await callline.callMenu({ action: "text", contactId: contact(), callerPhone: stopped, choice: "same" });
    expect(r.result).toBe("stay");
    expect(await prisma.textMessage.count({ where: { phone: stopped } })).toBe(0);

    const busy = randomPhone();
    for (let i = 0; i < 3; i++) expect((await callline.callMenu({ action: "text", contactId: contact(), callerPhone: busy, choice: "same" })).result).toBe("done");
    const fourth = await callline.callMenu({ action: "text", contactId: contact(), callerPhone: busy, choice: "same" });
    expect(fourth.result).toBe("stay");
    expect(await prisma.textMessage.count({ where: { phone: busy, direction: "OUT" } })).toBe(3);
  });

  it("pressing 2 logs a callback for the team; marking it called back clears it", async () => {
    const phone = randomPhone(), contactId = contact();
    const before = await callline.unhandledCallbacks();
    const r = await callline.callMenu({ action: "callback", contactId, callerPhone: phone, choice: "same" });
    expect(r.result).toBe("done");
    expect(await callline.unhandledCallbacks()).toBe(before + 1);
    const row = await prisma.callLog.findUniqueOrThrow({ where: { contactKey: `${contactId}:CALLBACK` } });
    const a = await admin();
    await callline.markHandled(a, row.id);
    expect(await callline.unhandledCallbacks()).toBe(before);
    expect(await prisma.auditLog.count({ where: { action: "call.handled", entityId: row.id } })).toBe(1);
  });

});
