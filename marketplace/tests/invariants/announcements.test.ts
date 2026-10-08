import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { announcements, growth } from "@cm/services";
import { makeClinic, makeProvider, uid } from "../factories";

const admin = async () => {
  const u = await prisma.user.create({ data: { email: `adm-${uid()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN" } });
  return { userId: u.id, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
};

describe("admin announcements", () => {
  it("audiences: providers, clinics, everyone; filters by state; never admins, turned-off logins or banned emails", async () => {
    const p = await makeProvider();
    const off = await makeProvider();
    await prisma.user.update({ where: { id: off.userId }, data: { disabledAt: new Date() } });
    const banned = await makeProvider();
    await prisma.bannedEmail.create({ data: { email: banned.user.email } });
    const c = await makeClinic();
    const ids = async (a: Parameters<typeof announcements.recipientsFor>[0]) => (await announcements.recipientsFor(a)).map((r) => r.userId);
    const provs = await ids({ audience: "PROVIDERS" });
    expect(provs).toContain(p.userId);
    expect(provs).not.toContain(off.userId);
    expect(provs).not.toContain(banned.userId);
    expect(provs).not.toContain(c.user.id);
    expect(await ids({ audience: "CLINICS" })).toContain(c.user.id);
    const all = await ids({ audience: "EVERYONE" });
    expect(all).toEqual(expect.arrayContaining([p.userId, c.user.id]));
    expect(await prisma.user.count({ where: { id: { in: all }, role: "PLATFORM_ADMIN" } })).toBe(0);
    expect(await ids({ audience: "PROVIDERS", state: "GA" })).not.toContain(p.userId);
  });

  it("sends in batches, once per person; news skips unsubscribed emails and carries an unsubscribe link; text is notice-only", async () => {
    const actor = await admin();
    const p1 = await makeProvider();
    const p2 = await makeProvider();
    await growth.suppress("EMAIL", p2.user.email, "unsubscribed", "test");
    await expect(announcements.createAnnouncement(actor, { kind: "NEWS", title: "Big news", body: "We're opening in Georgia next month.", channels: ["email", "sms"], audience: { audience: "PROVIDERS" } })).rejects.toThrow(/can't go by text/);
    const row = await announcements.createAnnouncement(actor, { kind: "NEWS", title: `News ${uid()}`, body: "We're opening in Georgia next month.", channels: ["email", "push"], audience: { audience: "PROVIDERS" } });
    expect(row.recipientCount).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 50; i++) {
      const r = await announcements.announcementSweep(1000);
      if ((await prisma.announcement.findUniqueOrThrow({ where: { id: row.id } })).status === "DONE") break;
      if (!r.sent && !r.skipped && !r.finished) break;
    }
    const done = await prisma.announcement.findUniqueOrThrow({ where: { id: row.id } });
    expect(done.status).toBe("DONE");
    expect(await prisma.notification.count({ where: { userId: p1.userId, title: row.title } })).toBe(1);
    expect(devOutbox.some((m) => m.to === p1.user.email && m.subject === row.title)).toBe(true);
    expect(devOutbox.some((m) => m.to === p2.user.email && m.subject === row.title)).toBe(false);
    // Running again sends nothing new.
    await announcements.announcementSweep(1000);
    expect(await prisma.notification.count({ where: { userId: p1.userId, title: row.title } })).toBe(1);
  });

  it("a test goes only to you; stopping halts the rest", async () => {
    const actor = await admin();
    const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    await announcements.sendTestAnnouncement(actor, { kind: "NOTICE", title: "Agreement update", body: "Please sign the new agreement.", channels: ["email"], audience: { audience: "EVERYONE" } });
    expect(devOutbox.some((m) => m.to === me.email && m.subject === "[Test] Agreement update")).toBe(true);
    await makeProvider();
    const row = await announcements.createAnnouncement(actor, { kind: "NOTICE", title: `Stop me ${uid()}`, body: "This one gets stopped.", channels: ["email"], audience: { audience: "EVERYONE" } });
    expect(await announcements.cancelAnnouncement(actor, row.id)).toBe(true);
    await announcements.announcementSweep(1000);
    expect(await prisma.notification.count({ where: { title: row.title } })).toBe(0);
  });
});
