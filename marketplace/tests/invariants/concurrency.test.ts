import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { adminAssign, applyToShift, selectApplicant } from "@cm/services";
import { expectDbReject, insertAssignment, makeClinic, makeProvider, makeShift } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

describe("concurrency (SPEC §19 Phase 2 acceptance, §20.2)", () => {
  it("20 simultaneous selections on one shift produce exactly one assignment", async () => {
    const clinic = await makeClinic();
    const shift = await makeShift(clinic.location.id, { days: 14 });
    const providers = await Promise.all(Array.from({ length: 20 }, () => makeProvider()));
    for (const p of providers) await applyToShift(p.actor, shift.id, { commit: true });
    const results = await Promise.allSettled(providers.map((p) => selectApplicant(clinic.actor, shift.id, p.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.assignment.count({ where: { shiftId: shift.id } })).toBe(1);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe("CONFIRMED");
    expect(await prisma.application.count({ where: { shiftId: shift.id, status: "SELECTED" } })).toBe(1);
    expect(await prisma.application.count({ where: { shiftId: shift.id, status: "NOT_SELECTED" } })).toBe(19);
    for (const r of results) if (r.status === "rejected") expect((r.reason as { code: string }).code).toBe("CONFLICT");
  });

  it("double-booking one provider on two overlapping shifts is blocked by the exclusion constraint", async () => {
    const clinic = await makeClinic();
    const p = await makeProvider();
    const a = await makeShift(clinic.location.id, { days: 16 });
    const b = await makeShift(clinic.location.id, { days: 16 });
    const results = await Promise.allSettled([adminAssign({ ...admin }, a.id, p.id), adminAssign({ ...admin }, b.id, p.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.assignment.count({ where: { providerId: p.id, status: "CONFIRMED" } })).toBe(1);
    // And directly at the database.
    const c = await makeShift(clinic.location.id, { days: 16 });
    await expectDbReject(insertAssignment(c.id, p.id), /no_provider_overlap|exclusion|conflicting key/i);
  });

  it("travel buffer is part of the overlap check", async () => {
    const clinic = await makeClinic();
    const p = await makeProvider();
    const a = await makeShift(clinic.location.id, { days: 18 });
    await insertAssignment(a.id, p.id, { bufferMinutes: 60 });
    // Next shift starts 90 minutes after the first ends; each side buffers 60 min → overlap.
    const creator = await prisma.user.findFirstOrThrow();
    const b = await prisma.shift.create({
      data: {
        locationId: clinic.location.id,
        professionCode: "DC",
        state: "XX",
        startsAt: new Date(+a.endsAt + 90 * 60_000),
        endsAt: new Date(+a.endsAt + 5 * 3_600_000),
        status: "OPEN",
        clinicPriceCents: 32500,
        providerPayCents: 20000,
        createdById: creator.id,
      },
    });
    await expectDbReject(insertAssignment(b.id, p.id, { bufferMinutes: 60 }), /no_provider_overlap|exclusion|conflicting key/i);
    await insertAssignment(b.id, p.id, { bufferMinutes: 10 }).then(async (x) => {
      // 60 + 10 < 90 minutes apart → allowed
      expect(x.status).toBe("CONFIRMED");
    });
  });
});
