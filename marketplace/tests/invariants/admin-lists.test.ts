import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { adminlists, createShift } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider, uid } from "../factories";

const admin = async () => {
  const u = await prisma.user.create({ data: { email: `a-${uid()}@test.dev`, name: "Admin", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
  return { userId: u.id, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
};

describe("Admin → Providers / Clinics filters and counts", () => {
  it("counts providers by group and state, and filters by them", async () => {
    const a = await admin();
    const ready = await makeProvider({ licenses: [{ professionCode: "DC", state: "GA" }] });
    const paused = await makeProvider({ licenses: [{ professionCode: "DC", state: "GA" }] });
    await prisma.provider.update({ where: { id: paused.id }, data: { breakStartsAt: new Date(Date.now() - 86_400_000), breakReason: "INACTIVE" } });
    const all = await adminlists.providerList(a, {});
    expect(all.groups.reduce((n, g) => n + g.count, 0)).toBe(all.total);
    expect(all.matched).toBe(all.total);

    const ga = await adminlists.providerList(a, { state: "GA" });
    expect(ga.rows.map((r) => r.id)).toEqual(expect.arrayContaining([ready.id, paused.id]));
    const inactiveGa = await adminlists.providerList(a, { state: "GA", group: "inactive" });
    expect(inactiveGa.rows.map((r) => r.id)).toContain(paused.id);
    expect(inactiveGa.rows.map((r) => r.id)).not.toContain(ready.id);
    // Chip counts follow the state filter, the state counts follow the chip.
    expect(inactiveGa.groups.find((g) => g.key === "inactive")!.count).toBeGreaterThanOrEqual(1);
    expect(inactiveGa.states.find((s) => s.key === "GA")!.count).toBeGreaterThanOrEqual(1);
    const byName = await adminlists.providerList(a, { q: (await prisma.provider.findUniqueOrThrow({ where: { id: ready.id } })).displayName });
    expect(byName.rows.map((r) => r.id)).toContain(ready.id);
  });

  it("calls a clinic active once it posted in 90 days and filters by location state and card", async () => {
    const a = await admin();
    const c = await makeClinic({ state: "FL", address: `12 List Ln ${uid()}` });
    let list = await adminlists.clinicList(a, { q: c.org.displayName });
    expect(list.rows.find((r) => r.id === c.org.id)!.group).not.toBe("active");
    await createShift(c.actor, { locationId: c.location.id, professionCode: "DC", ...futureWeekday(21) } as never, { post: true });
    list = await adminlists.clinicList(a, { q: c.org.displayName, state: "FL" });
    expect(list.rows.map((r) => r.id)).toContain(c.org.id);
    expect(list.rows.find((r) => r.id === c.org.id)!.group).toBe("active");
    expect((await adminlists.clinicList(a, { q: c.org.displayName, state: "GA" })).rows).toHaveLength(0);
    const card = c.org.hasPaymentMethod ? "no" : "yes";
    expect((await adminlists.clinicList(a, { q: c.org.displayName, payment: card })).rows).toHaveLength(0);
  });
});
