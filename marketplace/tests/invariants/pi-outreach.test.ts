import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { admin as adminSvc, growth, invalidateSettings } from "@cm/services";
import { uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
let me = { userId: null as string | null, role: "PLATFORM_ADMIN" as const };
const PI_KEYS = ["CLINIC_PI_FIRST_CONTACT", "CLINIC_PI_GROWTH"];

beforeAll(async () => {
  const u = await prisma.user.create({ data: { email: `owner-${uid()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN" } });
  me = { userId: u.id, role: "PLATFORM_ADMIN" };
  await growth.ensureGrowthDefaults();
  await adminSvc.updateSetting(admin, "growth.postalAddress", "1 Main St, Orlando, FL 32801");
  invalidateSettings();
});
afterAll(async () => {
  await prisma.promptTemplate.updateMany({ where: { key: { in: PI_KEYS } }, data: { status: "DRAFT", active: false } });
});

async function clinic(practiceType: string) {
  const r = await growth.addClinicByHand(me, { clinicName: `PI Test ${uid()}`, email: `pi-${uid()}@clinic.dev`, city: "Tampa", state: "FL", start: "save" });
  await prisma.clinicProspect.update({ where: { id: r.prospect.id }, data: { practiceType, outreachPaused: false } });
  await growth.sendFirstOutreachNow(me, r.prospect.id);
  return prisma.communication.findFirstOrThrow({ where: { entityId: r.prospect.id } });
}

describe("personal injury outreach", () => {
  it("PI emails are installed as drafts; until approved, PI clinics get the general first email", async () => {
    const rows = await prisma.promptTemplate.findMany({ where: { key: { in: PI_KEYS } } });
    expect(rows.map((r) => r.key).sort()).toEqual([...PI_KEYS].sort());
    expect(rows.every((r) => r.status === "DRAFT" && !r.active)).toBe(true);
    expect((await clinic("Personal injury")).promptKey).toBe("CLINIC_FIRST_CONTACT");
  });

  it("once approved, PI clinics get the PI email with a tracked link to the PI page; other clinics don't", async () => {
    await prisma.promptTemplate.updateMany({ where: { key: { in: PI_KEYS } }, data: { status: "APPROVED", active: true, approvedAt: new Date() } });
    const pi = await clinic("Auto accident & injury care");
    expect(pi.promptKey).toBe("CLINIC_PI_FIRST_CONTACT");
    expect(pi.body).toMatch(/\/personal-injury-clinics\?c=[a-f0-9]+/);
    expect((await clinic("Sports injury")).promptKey).toBe("CLINIC_FIRST_CONTACT");
  });

  it("the prospect list filters to personal injury practices", async () => {
    const r = await growth.addClinicByHand(me, { clinicName: `Filter PI ${uid()}`, email: `f-${uid()}@clinic.dev`, state: "FL", start: "save" });
    await prisma.clinicProspect.update({ where: { id: r.prospect.id }, data: { practiceType: "Whiplash and personal injury" } });
    const other = await growth.addClinicByHand(me, { clinicName: `Filter Family ${uid()}`, email: `g-${uid()}@clinic.dev`, state: "FL", start: "save" });
    const ids = (await growth.prospects(me, { focus: "pi", q: "Filter" })).rows.map((x) => x.id);
    expect(ids).toContain(r.prospect.id);
    expect(ids).not.toContain(other.prospect.id);
  });
});
