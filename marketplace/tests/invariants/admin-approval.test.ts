import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { admin as adminSvc, getEligibleProviders } from "@cm/services";
import { makeClinic, makeProvider, makeShift } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const readyNotes = (userId: string) => prisma.notification.count({ where: { userId, template: "provider_ready" } });

describe("admin approval", () => {
  it("activates an onboarding provider (profile steps waived) and sends 'ready' once", async () => {
    const p = await makeProvider({ status: "ONBOARDING", professions: [{ code: "DC", status: "ONBOARDING" }] });
    await prisma.provider.update({ where: { id: p.id }, data: { photoUrl: null, agreementSignedAt: null } });
    await adminSvc.approveProvider(admin, p.id);
    const after = await prisma.provider.findUniqueOrThrow({ where: { id: p.id }, include: { professions: true } });
    expect(after.status).toBe("ACTIVE");
    expect(after.professions.every((x) => x.status === "ACTIVE")).toBe(true);
    expect(await readyNotes(p.userId)).toBe(1);
    await adminSvc.approveProvider(admin, p.id); // again: no second "ready"
    expect(await readyNotes(p.userId)).toBe(1);
    const clinic = await makeClinic();
    const shift = await makeShift(clinic.location.id);
    expect((await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId)).toContain(p.id);
  });

  it("never waives licensing: approved but unverified license → no shifts, no 'ready' email", async () => {
    const p = await makeProvider({ status: "ONBOARDING", licenses: [{ professionCode: "DC", state: "FL", status: "PENDING_VERIFICATION" }], professions: [{ code: "DC", status: "ONBOARDING" }] });
    await adminSvc.approveProvider(admin, p.id);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("ACTIVE");
    expect(await readyNotes(p.userId)).toBe(0);
    const clinic = await makeClinic();
    const shift = await makeShift(clinic.location.id);
    expect((await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId)).not.toContain(p.id);
    // Verifying the license later completes it: verified email wording + "ready" email.
    const lic = await prisma.license.findFirstOrThrow({ where: { providerId: p.id } });
    await adminSvc.reviewLicense(admin, lic.id, { approve: true });
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: p.userId, template: "license_verified" } });
    expect(n.title).toBe("Your Florida chiropractor license is verified");
    expect(n.body).not.toMatch(/can now take/i);
    expect(await readyNotes(p.userId)).toBe(1);
  });

  it("approving a clinic activates it", async () => {
    const c = await makeClinic();
    await prisma.clinicOrg.update({ where: { id: c.org.id }, data: { status: "ONBOARDING", agreementSignedAt: null } });
    await adminSvc.approveClinic(admin, c.org.id);
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } })).status).toBe("ACTIVE");
  });
});
