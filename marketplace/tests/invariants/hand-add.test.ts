import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { admin as adminSvc, growth, invalidateSettings } from "@cm/services";
import { uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}

// A real admin login: a person's send is never "automated", so the marketing switch doesn't hold it.
let me = { userId: null as string | null, role: "PLATFORM_ADMIN" as const };
beforeAll(async () => {
  const u = await prisma.user.create({ data: { email: `owner-${uid()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN" } });
  me = { userId: u.id, role: "PLATFORM_ADMIN" };
  await growth.ensureGrowthDefaults();
  await setting("growth.postalAddress", "1 Main St, Orlando, FL 32801");
});
afterEach(async () => {
  await setting("growth.clinicMarketing", true);
});

describe("clinics added by hand", () => {
  it("send now: the first approved outreach email goes out even with clinic marketing off; follow-ups wait for the switches", async () => {
    await setting("growth.clinicMarketing", false);
    const email = `front-${uid()}@clinic.dev`;
    const r = await growth.addClinicByHand(me, { clinicName: "Heard-About Chiropractic", email, city: "Tampa", state: "FL", start: "now" });
    expect(r.existed).toBe(false);
    expect(r.sent).toMatchObject({ subject: expect.any(String) });
    const row = await prisma.clinicProspect.findUniqueOrThrow({ where: { id: r.prospect.id } });
    expect(row).toMatchObject({ source: "Added by hand", outreachStep: 1, stage: "OUTREACH_STARTED" });
    const c = await prisma.communication.findMany({ where: { entityId: row.id } });
    expect(c.map((x) => [x.promptKey, x.status])).toEqual([["CLINIC_FIRST_CONTACT", "SENT"]]);
    expect(devOutbox.some((m) => m.to === email)).toBe(true);
    expect(r.readiness.waits.join(" ")).toMatch(/Clinic marketing is switched off/);
    // Sending the first email twice is refused.
    await expect(growth.sendFirstOutreachNow(me, row.id)).rejects.toThrow(/already gone out/);
  });

  it("same email again returns the existing clinic; 'just save' pauses outreach; a closed market says why and sends nothing", async () => {
    const email = `dup-${uid()}@clinic.dev`;
    const a = await growth.addClinicByHand(me, { clinicName: "Saved Chiro", email, state: "FL", start: "save" });
    expect((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: a.prospect.id } })).outreachPaused).toBe(true);
    const b = await growth.addClinicByHand(me, { clinicName: "Saved Chiro again", email: email.toUpperCase(), state: "FL", start: "now" });
    expect(b).toMatchObject({ existed: true });
    expect(b.prospect.id).toBe(a.prospect.id);

    const closed = await growth.addClinicByHand(me, { clinicName: "Far Away Chiro", email: `far-${uid()}@clinic.dev`, state: "WY", start: "now" });
    expect(closed.sent).toMatchObject({ error: expect.stringMatching(/outreach isn't open in WY/) });
    expect(await prisma.communication.count({ where: { entityId: closed.prospect.id, status: "SENT" } })).toBe(0);
    await expect(growth.addClinicByHand(me, { clinicName: "No email", email: "not-an-email", start: "auto" })).rejects.toThrow(/valid email/);
  });
});
