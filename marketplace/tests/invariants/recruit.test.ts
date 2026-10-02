import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, createShift, respondToOffer, selectApplicant, shiftRecruit } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

async function post(days: number) {
  const clinic = await makeClinic();
  const { startsAt, endsAt } = futureWeekday(days);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, expectedPatients: 10 }, { post: true });
  return { clinic, shiftId };
}

describe("recruit a provider for a shift", () => {
  it("link shows a summary without the clinic, and an eligible colleague is invited and can accept", async () => {
    const { clinic, shiftId } = await post(80);
    const link = await shiftRecruit.createLink(admin, shiftId, "Dr. Lee");
    expect(link.url).toMatch(/\/s\/[\w-]+$/);
    const sum = await shiftRecruit.summary(link.token);
    expect(sum).toMatchObject({ state: "OPEN", shift: { city: clinic.location.city, tier: "Light day", payCents: 42000 } });
    expect(JSON.stringify(sum)).not.toContain(clinic.org.displayName);
    expect(await shiftRecruit.shareMessage(link.token)).toContain(link.url);

    const colleague = await makeProvider();
    const r = await shiftRecruit.claim(colleague.id, link.token);
    expect(r).toMatchObject({ shiftId, invited: true });
    const offer = await prisma.offer.findFirstOrThrow({ where: { shiftId, providerId: colleague.id } });
    expect(offer.source).toBe("ADMIN");
    const res = await respondToOffer(colleague.actor, offer.id, true);
    expect(res.confirmed).toBe(true);
    expect((await shiftRecruit.summary(link.token, false))?.state).toBe("CLOSED");
    expect((await shiftRecruit.linksForShift(admin, shiftId))[0]!.claims).toHaveLength(1);
  });

  it("a colleague who isn't verified yet sees what's left, and is invited by the sweep once eligible", async () => {
    const { shiftId } = await post(81);
    const link = await shiftRecruit.createLink(admin, shiftId);
    const newbie = await makeProvider({ licenses: [{ professionCode: "DC", state: "FL", status: "PENDING_VERIFICATION" }] });
    const r = await shiftRecruit.claim(newbie.id, link.token);
    expect(r.invited).toBe(false);
    expect(r.steps?.map((s) => s.label).join(" ")).toMatch(/license/i);
    expect(await prisma.offer.count({ where: { shiftId, providerId: newbie.id } })).toBe(0);
    const claims = await shiftRecruit.myClaims(newbie.actor);
    expect(claims[0]).toMatchObject({ shiftId, state_: "WAITING" });

    await prisma.license.updateMany({ where: { providerId: newbie.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
    expect(await shiftRecruit.recruitSweep()).toBeGreaterThanOrEqual(1);
    expect(await prisma.offer.count({ where: { shiftId, providerId: newbie.id, status: "PENDING" } })).toBe(1);
  });

  it("the shift stays open to everyone else: filled elsewhere means no invitation", async () => {
    const { clinic, shiftId } = await post(82);
    const link = await shiftRecruit.createLink(admin, shiftId);
    const other = await makeProvider();
    await applyToShift(other.actor, shiftId, { commit: true });
    await selectApplicant(clinic.actor, shiftId, other.id);
    const late = await makeProvider();
    const r = await shiftRecruit.claim(late.id, link.token);
    expect(r).toMatchObject({ invited: false, closed: true });
    await expect(shiftRecruit.createLink(admin, shiftId)).rejects.toThrow(/isn't open/);
    await expect(shiftRecruit.createLink(clinic.actor, shiftId)).rejects.toThrow();
  });
});
