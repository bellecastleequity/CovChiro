import { beforeAll, describe, expect, it } from "vitest";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { adminAssign, applyToShift, auth, getEligibleProviders, nightlyCredentialSweep, prelicensure, recomputeProviderStatus, shiftBoard } from "@cm/services";
import { expectDbReject, insertAssignment, makeClinic, makeProvider, makeShift, uid } from "../factories";

/**
 * Pre-licensure (opt-in student path). The student flag and its fields are
 * reporting/nurture only: they must never open any path onto a shift, and
 * reminders must never ask for something already provided.
 */

type P = Awaited<ReturnType<typeof makeProvider>>;
type C = Awaited<ReturnType<typeof makeClinic>>;
const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const DAY = 86_400_000;

async function makeStudent(o: Parameters<typeof makeProvider>[0] = {}, grad = new Date(Date.now() - 40 * DAY)) {
  const p = await makeProvider(o);
  await prisma.provider.update({ where: { id: p.id }, data: { preLicensure: true, preLicensureSince: new Date(Date.now() - 60 * DAY), graduationDate: grad, createdAt: new Date(Date.now() - 60 * DAY) } });
  return p;
}

async function assertCannotWork(p: P, shiftId: string) {
  expect((await shiftBoard(p.actor)).map((b) => b.id)).not.toContain(shiftId);
  expect((await getEligibleProviders(prisma, shiftId)).eligible.map((e) => e.providerId)).not.toContain(p.id);
  await expect(applyToShift(p.actor, shiftId, { commit: true })).rejects.toBeInstanceOf(DomainError);
  await expect(adminAssign({ ...admin }, shiftId, p.id)).rejects.toBeInstanceOf(DomainError);
  await expectDbReject(insertAssignment(shiftId, p.id), /INV-1|INV-3/);
}

let fl: C;
beforeAll(async () => {
  fl = await makeClinic({ state: "FL" });
});

describe("student flag never grants eligibility (INV-1 / INV-3)", () => {
  it("student with no license or malpractice", async () => {
    const p = await makeStudent({ licenses: [], malpractice: null, professions: [{ code: "DC" }] });
    await assertCannotWork(p, (await makeShift(fl.location.id)).id);
  });
  it("student with license pending verification", async () => {
    const p = await makeStudent({ licenses: [{ professionCode: "DC", state: "FL", status: "PENDING_VERIFICATION" }] });
    await assertCannotWork(p, (await makeShift(fl.location.id)).id);
  });
  it("student with verified license but malpractice pending", async () => {
    const p = await makeStudent({ malpractice: [{ covered: ["DC"], status: "PENDING_VERIFICATION" }] });
    await assertCannotWork(p, (await makeShift(fl.location.id)).id);
  });
  it("student with rejected license, even when ACTIVE and admin-approved", async () => {
    const p = await makeStudent({ licenses: [{ professionCode: "DC", state: "FL", status: "REJECTED" }] });
    await prisma.provider.update({ where: { id: p.id }, data: { adminApprovedAt: new Date(), status: "ACTIVE" } });
    await assertCannotWork(p, (await makeShift(fl.location.id)).id);
  });
  it("student whose license expires before the shift ends", async () => {
    const p = await makeStudent({ licenses: [{ professionCode: "DC", state: "FL", expiresAt: new Date(Date.now() + 2 * DAY) }] });
    await assertCannotWork(p, (await makeShift(fl.location.id, { days: 10 })).id);
  });
});

describe("graduating out", () => {
  it("flag turns off once license AND malpractice are verified; eligibility is unchanged by it", async () => {
    const p = await makeStudent();
    const shift = await makeShift(fl.location.id);
    // Fully credentialed: eligible whether or not the flag is on (it's never read by eligibility)…
    expect((await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId)).toContain(p.id);
    await recomputeProviderStatus(p.id);
    const after = await prisma.provider.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.preLicensure).toBe(false);
    expect(after.graduatedOutAt).not.toBeNull();
    expect((await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId)).toContain(p.id);
  });
  it("license verified alone keeps the student path on (malpractice reminder still due)", async () => {
    const p = await makeStudent({ malpractice: null });
    await recomputeProviderStatus(p.id);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).preLicensure).toBe(true);
  });
});

describe("student signup", () => {
  it("opt-in fields + recruitment link attribution; account stays ONBOARDING", async () => {
    const email = `stu-${uid()}@test.dev`;
    const user = await auth.signup({
      role: "provider", name: "Casey Graduate", email, password: "a-strong-password", phone: "407-555-0101", acceptTerms: true,
      student: { school: "Palmer College of Chiropractic - Florida", graduationDate: new Date(Date.now() + 30 * DAY), intendedStates: ["FL"], licensureApplied: "no", expectedLicensure: "1-3", homeZip: "32801", smsConsent: true },
      attribution: { campaign: "palmer", utm: { source: "qr", campaign: "spring" }, landingPath: "/join/palmer" },
    });
    const p = await prisma.provider.findUniqueOrThrow({ where: { userId: user.id }, include: { recruitCampaign: true } });
    expect(p.preLicensure).toBe(true);
    expect(p.status).toBe("ONBOARDING");
    expect(p.recruitCampaign?.slug).toBe("palmer");
    expect(p.acquisitionSource).toBe("school");
    expect(p.utmCampaign).toBe("spring");
    expect(p.homeZip).toBe("32801");
    expect(p.homeLat).toBeNull(); // the ZIP never completes the "home base" step
    expect(p.smsConsentAt).not.toBeNull();
    expect((await prelicensure.readinessSummary(p.id)).stage).toBe("registered");
  });
  it("normal signup is unchanged: no student fields", async () => {
    const user = await auth.signup({ role: "provider", name: "Lic Ensed", email: `lic-${uid()}@test.dev`, password: "a-strong-password", acceptTerms: true });
    const p = await prisma.provider.findUniqueOrThrow({ where: { userId: user.id } });
    expect(p.preLicensure).toBe(false);
    expect(p.graduationDate).toBeNull();
    expect(p.acquisitionSource).toBe("direct");
  });
});

describe("credential follow-ups", () => {
  const sentFor = (userId: string) => prisma.notification.findMany({ where: { userId, template: { startsWith: "prelicensure_" } } });

  it("license missing: one email at day 30+, none again inside the gap", async () => {
    const p = await makeStudent({ licenses: [], malpractice: null, professions: [{ code: "DC" }] });
    await prelicensure.runPreLicensureFollowups();
    await prelicensure.runPreLicensureFollowups();
    const sent = await sentFor(p.userId);
    expect(sent.map((n) => n.template)).toEqual(["prelicensure_license_missing"]);
    expect(sent[0]!.title).toBe("Have you received your chiropractic license?");
  });
  it("license pending + malpractice missing: asks only for malpractice", async () => {
    const p = await makeStudent({ licenses: [{ professionCode: "DC", state: "FL", status: "PENDING_VERIFICATION" }], malpractice: null });
    await prelicensure.runPreLicensureFollowups();
    expect((await sentFor(p.userId)).map((n) => n.template)).toEqual(["prelicensure_malpractice_missing"]);
  });
  it("license verified + malpractice missing: the 'license verified' copy", async () => {
    const p = await makeStudent({ malpractice: null });
    await prelicensure.runPreLicensureFollowups();
    const [n] = await sentFor(p.userId);
    expect(n?.title).toBe("Your license is verified — add your malpractice insurance");
  });
  it("both submitted and under review: nothing sent", async () => {
    const p = await makeStudent({ licenses: [{ professionCode: "DC", state: "FL", status: "PENDING_VERIFICATION" }], malpractice: [{ covered: ["DC"], status: "PENDING_VERIFICATION" }] });
    await prelicensure.runPreLicensureFollowups();
    expect(await sentFor(p.userId)).toHaveLength(0);
  });
  it("not before day 30, not when unsubscribed, never for non-students", async () => {
    const early = await makeStudent({ licenses: [], malpractice: null, professions: [{ code: "DC" }] }, new Date(Date.now() - 10 * DAY));
    await prisma.provider.update({ where: { id: early.id }, data: { createdAt: new Date(Date.now() - 10 * DAY) } });
    const optedOut = await makeStudent({ licenses: [], malpractice: null, professions: [{ code: "DC" }] });
    await prisma.provider.update({ where: { id: optedOut.id }, data: { credFollowupOptOut: true } });
    const regular = await makeProvider({ licenses: [], malpractice: null, professions: [{ code: "DC" }] });
    await prisma.provider.update({ where: { id: regular.id }, data: { createdAt: new Date(Date.now() - 100 * DAY) } });
    await prelicensure.runPreLicensureFollowups();
    for (const p of [early, optedOut, regular]) expect(await sentFor(p.userId)).toHaveLength(0);
  });
  it("unsubscribe link token is checked", async () => {
    const p = await makeStudent();
    await expect(prelicensure.unsubscribeStudent(p.id, "bogus-token-0000000000")).rejects.toBeInstanceOf(DomainError);
    const t = new URL(prelicensure.studentUnsubscribeUrl(p.id)).searchParams.get("t")!;
    await prelicensure.unsubscribeStudent(p.id, t);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).credFollowupOptOut).toBe(true);
  });
});

describe("renewal reminders (all providers)", () => {
  it("default points include 14 days", async () => {
    const p = await makeProvider({ licenses: [{ professionCode: "DC", state: "FL", expiresAt: new Date(Date.now() + 14 * DAY - 3_600_000) }] });
    await nightlyCredentialSweep(new Date());
    const n = await prisma.notification.findMany({ where: { userId: p.userId, template: "credential_expiring" } });
    expect(n.map((x) => x.title)).toContain("Your DC license (FL) expires in 14 days");
  });
});
