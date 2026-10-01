import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { accounts, auth, search } from "@cm/services";
import { makeClinic, makeProvider, uid } from "../factories";

const adminActor = async () => {
  const u = await prisma.user.create({ data: { email: `admin-${uid()}@test.dev`, name: "Owner Admin", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
  return { userId: u.id, role: "PLATFORM_ADMIN" as const };
};

describe("Admin → Users: suspend, unsuspend, delete a single login", () => {
  it("suspends a clinic staff login (signed out, can't sign in) and unsuspends it", async () => {
    const admin = await adminActor();
    const clinic = await makeClinic();
    const email = `staff-${uid()}@test.dev`;
    const staff = await prisma.user.create({ data: { email, name: "Front Desk", role: "CLINIC_STAFF", passwordHash: await auth.hashPassword("correct-horse-battery"), emailVerifiedAt: new Date() } });
    await prisma.clinicMember.create({ data: { clinicOrgId: clinic.org.id, userId: staff.id, role: "CLINIC_STAFF" } });
    await auth.login(email, "correct-horse-battery");

    await accounts.setUserSuspended(admin, staff.id, true, "Left the practice");
    expect(await prisma.session.count({ where: { userId: staff.id } })).toBe(0);
    await expect(auth.login(email, "correct-horse-battery")).rejects.toThrow();
    expect((await accounts.listUsers(admin, { status: "suspended", q: email })).map((u) => u.id)).toEqual([staff.id]);

    await accounts.setUserSuspended(admin, staff.id, false, "");
    await expect(auth.login(email, "correct-horse-battery")).resolves.toBeTruthy();

    await accounts.deleteUser(admin, staff.id, "Duplicate login");
    expect(await prisma.user.findUnique({ where: { id: staff.id } })).toBeNull();
    expect(await prisma.clinicMember.count({ where: { clinicOrgId: clinic.org.id } })).toBe(1);
  });

  it("guards: not yourself, not the clinic's only login, not a provider account", async () => {
    const admin = await adminActor();
    await expect(accounts.setUserSuspended(admin, admin.userId!, true, "oops")).rejects.toThrow(/your own/);
    const clinic = await makeClinic();
    await expect(accounts.deleteUser(admin, clinic.user.id, "test")).rejects.toThrow(/only login/);
    const p = await makeProvider();
    await expect(accounts.deleteUser(admin, p.userId, "test")).rejects.toThrow(/provider's page/);
  });
});

describe("backend search", () => {
  it("admins find providers, clinics and shifts; clinics and providers only their own", async () => {
    const admin = await adminActor();
    const tag = `Zq${uid().slice(0, 6)}`;
    const p = await makeProvider();
    await prisma.provider.update({ where: { id: p.id }, data: { displayName: `Dr. ${tag} Rivera` } });
    const clinic = await makeClinic();
    await prisma.clinicOrg.update({ where: { id: clinic.org.id }, data: { displayName: `${tag} Chiropractic` } });
    const other = await makeClinic();

    const hits = await search.searchRecords(admin, tag);
    expect(hits.find((h) => h.group === "Providers")?.href).toBe(`/admin/providers/${p.id}`);
    expect(hits.find((h) => h.group === "Clinics")?.href).toBe(`/admin/clinics/${clinic.org.id}`);

    // Another clinic can't find this one or its provider.
    expect(await search.searchRecords(other.actor, tag)).toEqual([]);
    expect(await search.searchRecords(p.actor, tag)).toEqual([]);
    expect(await search.searchRecords(admin, "a")).toEqual([]);
  });
});
