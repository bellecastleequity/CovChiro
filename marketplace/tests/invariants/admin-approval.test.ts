import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { admin as adminSvc, AGREEMENT_VERSION, agreementForSigning, createShift, getEligibleProviders, requestAgreement, signAgreement } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider, makeShift } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const readyNotes = (userId: string) => prisma.notification.count({ where: { userId, template: "provider_ready" } });

describe("admin approval", () => {
  it("activates an onboarding provider (profile steps waived) but never waives the agreement", async () => {
    const p = await makeProvider({ status: "ONBOARDING", professions: [{ code: "DC", status: "ONBOARDING" }] });
    await prisma.provider.update({ where: { id: p.id }, data: { photoUrl: null, agreementSignedAt: null, agreementVersion: null } });
    await adminSvc.approveProvider(admin, p.id);
    const after = await prisma.provider.findUniqueOrThrow({ where: { id: p.id }, include: { professions: true } });
    expect(after.status).toBe("ACTIVE");
    expect(after.professions.every((x) => x.status === "ACTIVE")).toBe(true);
    // Approved, but no agreement: not matched, and no "you're ready" email yet.
    const clinic = await makeClinic();
    const shift = await makeShift(clinic.location.id);
    const ids = async () => (await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId);
    expect(await ids()).not.toContain(p.id);
    expect(await readyNotes(p.userId)).toBe(0);
    // Signing the current agreement completes it.
    const actor = { userId: p.userId, role: "PROVIDER" as const, providerId: p.id, clinicOrgId: null };
    const envelope = (await requestAgreement(actor)).split("/").pop()!;
    const view = await agreementForSigning(actor, envelope);
    await signAgreement(actor, envelope, { typedName: "Pat Provider", consent: true, agree: true, viewedHash: view.hash! }, { ip: null, userAgent: null });
    expect(await ids()).toContain(p.id);
    expect(await readyNotes(p.userId)).toBe(1);
    await adminSvc.approveProvider(admin, p.id); // again: no second "ready"
    expect(await readyNotes(p.userId)).toBe(1);
  });

  it("an out-of-date agreement stops matching and posting until the new version is signed", async () => {
    const p = await makeProvider();
    const clinic = await makeClinic();
    const shift = await makeShift(clinic.location.id, { days: 23 });
    await prisma.provider.update({ where: { id: p.id }, data: { agreementVersion: AGREEMENT_VERSION.PROVIDER - 1 } });
    expect((await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId)).not.toContain(p.id);
    await prisma.clinicOrg.update({ where: { id: clinic.org.id }, data: { agreementVersion: AGREEMENT_VERSION.CLINIC - 1 } });
    const { startsAt, endsAt } = futureWeekday(30);
    await expect(createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true })).rejects.toThrow(/current Clinic Platform Agreement/);
    // Drafts are still fine.
    await expect(createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: false })).resolves.toBeTruthy();
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
