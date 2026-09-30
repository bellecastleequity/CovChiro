import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { adminAssign, cancelAssignment, dispatch, emergency, setClock } from "@cm/services";
import { makeClinic, makeProvider, makeShift } from "../factories";

const ADMIN = { userId: null, role: "PLATFORM_ADMIN" as const };
let fakeNow = new Date();
const at = (d: Date) => {
  fakeNow = d;
  setClock(() => fakeNow);
};
const advance = (minutes: number) => at(new Date(+fakeNow + minutes * 60_000));
afterEach(() => setClock(null));

/** Far from other tests' providers, like the dispatch suite. */
let area = 0;
async function scenario(n: number, hoursBefore = 3) {
  const base = { lat: 30 + 2.5 * area++, lng: -60.0 }; // away from the dispatch suite's spots
  const clinic = await makeClinic({ state: "FL", lat: base.lat, lng: base.lng });
  // Mid-October (daylight time): 3h before a 9am start is 6am, outside quiet hours.
  const shift = await makeShift(clinic.location.id, { days: 14 + area });
  at(new Date(+shift.startsAt - hoursBefore * 3_600_000));
  const providers = [];
  for (let i = 0; i < n; i++) providers.push(await makeProvider({ home: { lat: base.lat + 0.012 * (i + 1), lng: base.lng, state: "FL" } }));
  return { clinic, shift, providers };
}
const actorOf = async (providerId: string) => {
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  return { userId: p.userId, role: "PROVIDER" as const, providerId };
};
const offersFor = (shiftId: string) => prisma.offer.findMany({ where: { shiftId }, orderBy: [{ createdAt: "asc" }, { matchScore: "desc" }] });

describe("emergency cover", () => {
  it("a provider cancelling within 24h → everyone texted at once with a +10% rescue bonus from margin; clinic told", async () => {
    const { clinic, shift, providers } = await scenario(4);
    const { assignmentId } = await adminAssign(ADMIN, shift.id, providers[0].id);
    await cancelAssignment(await actorOf(providers[0].id), assignmentId, "Sick", { by: "PROVIDER" });
    const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(sh.emergencySource).toBe("PROVIDER_CANCEL");
    expect(sh.emergencyBonusPercent).toBe(10);
    expect(sh.providerPayCents).toBe(Math.round(shift.providerPayCents * 1.1));
    expect(sh.clinicPriceCents).toBe(shift.clinicPriceCents); // the clinic doesn't pay the bonus
    const offers = await offersFor(shift.id);
    expect(offers.filter((o) => o.source === "BROADCAST").map((o) => o.providerId).sort()).toEqual(providers.slice(1).map((p) => p.id).sort());
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: clinic.user.id, template: "backfill" } });
    expect(note.title).toMatch(/We've had a cancellation/);
    expect(note.body).toMatch(/finding a replacement urgently/);
  });

  it("nobody accepts → bonus steps 10 → 15 → 20% with fresh texts, then admins are alerted", async () => {
    const owner = await prisma.user.create({ data: { email: `owner-${Date.now()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
    const { shift, providers } = await scenario(3);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST"); // normal dispatch running
    await emergency.activateEmergency(shift.id, "ADMIN", "test");
    const view = await emergency.emergencyView(ADMIN, shift.id);
    expect(view.candidates.map((c) => c.providerId).sort()).toEqual(providers.map((p) => p.id).sort());
    expect(view.candidates.every((c) => c.lastOffer === "PENDING")).toBe(true);
    const base = shift.providerPayCents;
    for (const pct of [15, 20]) {
      advance(11);
      await dispatch.tickDispatch(fakeNow);
      const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
      expect(sh.emergencyBonusPercent).toBe(pct);
      expect(sh.providerPayCents).toBe(Math.round(base * (1 + pct / 100)));
    }
    const offers = await offersFor(shift.id);
    expect(offers.filter((o) => o.providerId === providers[0].id && o.source === "BROADCAST")).toHaveLength(3); // re-texted each step
    advance(11);
    await dispatch.tickDispatch(fakeNow);
    expect(await prisma.dispatch.count({ where: { shiftId: shift.id, status: "EXHAUSTED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: owner.id, template: "emergency_exhausted", link: `/admin/emergencies/${shift.id}` } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: owner.id, template: "emergency_started" } })).toBeGreaterThan(0);
  });

  it("clinic reports a no-show after the start → no-show recorded, clinic not charged, pro-rated replacement goes out; filled → 'we've found your replacement'", async () => {
    const { clinic, shift, providers } = await scenario(4);
    const { assignmentId } = await adminAssign(ADMIN, shift.id, providers[0].id);
    at(new Date(+shift.startsAt + 30 * 60_000)); // 30 min into an 8h shift
    const r = await emergency.reportNoShow(clinic.actor, assignmentId);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe("NO_SHOW");
    expect((await prisma.providerStats.findUniqueOrThrow({ where: { providerId: providers[0].id } })).noShows).toBe(1);
    const rep = await prisma.shift.findUniqueOrThrow({ where: { id: r.replacementShiftId! } });
    expect(rep.rescueOfShiftId).toBe(shift.id);
    expect(+rep.startsAt).toBe(+fakeNow + 60 * 60_000); // an hour to get there
    expect(+rep.endsAt).toBe(+shift.endsAt);
    expect(rep.clinicPriceCents).toBe(Math.round(shift.clinicPriceCents * (6.5 / 8))); // same deal, pro-rated
    expect(rep.emergencyBonusPercent).toBe(10);
    expect(await prisma.notification.count({ where: { userId: clinic.user.id, template: "no_show_replacement" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: providers[0].userId, template: "no_show_recorded" } })).toBe(1);

    const offers = (await offersFor(rep.id)).filter((o) => o.status === "PENDING");
    expect(offers.map((o) => o.providerId)).not.toContain(providers[0].id);
    const best = [...offers].sort((a, b) => b.matchScore - a.matchScore)[0];
    await dispatch.respondToDispatchOffer(best.id, true, "LINK");
    advance(4); // broadcast hold (in case a better match also accepts)
    await dispatch.tickDispatch(fakeNow);
    const a = await prisma.assignment.findFirstOrThrow({ where: { shiftId: rep.id, status: "CONFIRMED" } });
    expect(a.providerPayCents).toBe(rep.providerPayCents); // bonus carried into pay
    const found = await prisma.notification.findFirstOrThrow({ where: { userId: clinic.user.id, template: "replacement_confirmed_clinic" } });
    expect(found.title).toMatch(/We've found your replacement/);
  });

  it("the clinic can report a no-show only from 15 min before the start, and not after marking 'arrived'", async () => {
    const { clinic, shift, providers } = await scenario(2, 1);
    const { assignmentId } = await adminAssign(ADMIN, shift.id, providers[0].id);
    await expect(emergency.reportNoShow(clinic.actor, assignmentId)).rejects.toThrow(/15 minutes/);
    at(new Date(+shift.startsAt + 5 * 60_000));
    await emergency.markArrived(clinic.actor, assignmentId);
    await expect(emergency.reportNoShow(clinic.actor, assignmentId)).rejects.toThrow(/arrived/);
  });
});
