import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { auth, getEligibleProviders, hiring, ownside, providerPublicProfile, search, setBlock, setFavorite } from "@cm/services";
import type { Actor } from "@cm/services";
import { insertAssignment, makeClinic, makeProvider, makeShift, uid } from "../factories";

/** One login with a clinic side and a provider side (owners only), each a separate workspace. */
describe("workspaces", () => {
  it("a clinic owner can add a provider side; staff can't; adding again returns the same profile", async () => {
    const clinic = await makeClinic();
    const p = await auth.addProviderSide(clinic.actor, { professionCodes: ["DC"] });
    const provider = await prisma.provider.findUniqueOrThrow({ where: { userId: clinic.user.id }, include: { professions: true } });
    expect(provider.id).toBe(p.id);
    expect(provider.professions.map((x) => x.professionCode)).toEqual(["DC"]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: clinic.user.id } })).role).toBe("CLINIC_OWNER");
    expect((await auth.addProviderSide(clinic.actor, { professionCodes: ["DC"] })).id).toBe(p.id);
    expect(await prisma.provider.count({ where: { userId: clinic.user.id } })).toBe(1);

    const staffUser = await prisma.user.create({ data: { email: `s-${uid()}@test.dev`, name: "Front desk", role: "CLINIC_STAFF", emailVerifiedAt: new Date() } });
    await prisma.clinicMember.create({ data: { userId: staffUser.id, clinicOrgId: clinic.org.id, role: "CLINIC_STAFF" } });
    const staff: Actor = { userId: staffUser.id, role: "CLINIC_STAFF", providerId: null, clinicOrgId: clinic.org.id };
    await expect(auth.addProviderSide(staff, { professionCodes: ["DC"] })).rejects.toThrow(/Only a clinic owner/);
    expect(await prisma.provider.count({ where: { userId: staffUser.id } })).toBe(0);
  });

  it("a provider can add a clinic they own", async () => {
    const p = await makeProvider();
    await auth.addClinicSide(p.actor, { organization: "My Own Chiro" });
    const m = await prisma.clinicMember.findFirstOrThrow({ where: { userId: p.user.id }, include: { clinicOrg: true } });
    expect(m.role).toBe("CLINIC_OWNER");
    expect(m.clinicOrg.displayName).toBe("My Own Chiro");
  });

  it("the session actor holds only the active workspace's ids; switching is refused for a side the login lacks", async () => {
    const clinic = await makeClinic();
    const token = await auth.createSession(clinic.user.id, true);
    let s = (await auth.sessionFromToken(token))!;
    expect(s.workspaces).toEqual({ provider: false, clinic: true });
    await expect(auth.switchWorkspace(s.sessionId, "PROVIDER")).rejects.toThrow(/doesn't have that side/);

    await auth.addProviderSide(clinic.actor, { professionCodes: ["DC"] });
    s = (await auth.sessionFromToken(token))!;
    expect(s.workspaces).toEqual({ provider: true, clinic: true });
    expect(s.actor).toMatchObject({ role: "CLINIC_OWNER", clinicOrgId: clinic.org.id, providerId: null });

    await auth.switchWorkspace(s.sessionId, "PROVIDER");
    s = (await auth.sessionFromToken(token))!;
    expect(s.actor.role).toBe("PROVIDER");
    expect(s.actor.providerId).toBeTruthy();
    expect(s.actor.clinicOrgId).toBeNull();

    await auth.switchWorkspace(s.sessionId, "CLINIC");
    s = (await auth.sessionFromToken(token))!;
    expect(s.actor).toMatchObject({ role: "CLINIC_OWNER", clinicOrgId: clinic.org.id, providerId: null });
  });

  it("F14: an owner who takes shifts is never matched to their own clinic's shifts, only other clinics'", async () => {
    const own = await makeClinic();
    const other = await makeClinic();
    const p = await makeProvider();
    await prisma.clinicMember.create({ data: { userId: p.user.id, clinicOrgId: own.org.id, role: "CLINIC_OWNER" } });
    const ownShift = await makeShift(own.location.id, { days: 240 });
    const otherShift = await makeShift(other.location.id, { days: 240 });

    const mine = await getEligibleProviders(prisma, ownShift.id);
    expect(mine.eligible.map((e) => e.providerId)).not.toContain(p.id);
    expect(mine.excluded.find((e) => e.providerId === p.id)?.result.failures.map((f) => f.code)).toContain("OWN_CLINIC");
    expect((await getEligibleProviders(prisma, otherShift.id)).eligible.map((e) => e.providerId)).toContain(p.id);
  });

  it("the two sides are invisible to each other: owner and staff of the clinic can't see, favorite, block, hire or find the provider side", async () => {
    const own = await makeClinic();
    const p = await makeProvider();
    await prisma.clinicMember.create({ data: { userId: p.user.id, clinicOrgId: own.org.id, role: "CLINIC_STAFF" } });
    const staffUser = await prisma.user.create({ data: { email: `s-${uid()}@test.dev`, name: "Front desk", role: "CLINIC_STAFF", emailVerifiedAt: new Date() } });
    await prisma.clinicMember.create({ data: { userId: staffUser.id, clinicOrgId: own.org.id, role: "CLINIC_STAFF" } });
    const staff: Actor = { userId: staffUser.id, role: "CLINIC_STAFF", providerId: null, clinicOrgId: own.org.id };
    // Even a booking from before (e.g. made before they joined the clinic) doesn't expose them.
    const past = await makeShift(own.location.id, { days: 250 });
    await insertAssignment(past.id, p.id);

    expect(await ownside.isOwnPair(p.id, own.org.id)).toBe(true);
    for (const viewer of [own.actor, staff]) {
      await expect(providerPublicProfile(viewer, p.id)).rejects.toThrow(/not found/i);
      await expect(setFavorite(viewer, p.id, true)).rejects.toThrow(/not found/i);
      await expect(setBlock(viewer, p.id, true)).rejects.toThrow(/not found/i);
      await expect(hiring.requestHire(viewer, { providerId: p.id, positionType: "FULL_TIME" })).rejects.toThrow(/not found/i);
      expect((await search.searchRecords(viewer, p.displayName)).filter((h) => h.group === "Providers")).toEqual([]);
    }
    // Staff membership blocks matching too (F14 covers every member, not only owners).
    const shift = await makeShift(own.location.id, { days: 260 });
    expect((await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId)).not.toContain(p.id);
    // Another clinic still sees them normally.
    const other = await makeClinic();
    expect((await providerPublicProfile(other.actor, p.id)).id ?? p.id).toBeTruthy();
    expect(await ownside.isOwnPair(p.id, other.org.id)).toBe(false);
  });
});
