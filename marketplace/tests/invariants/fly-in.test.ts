import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, bookings, cancelShiftByClinic, evaluateProviderForShift, getEligibleProviders, getSettings, setFlyInStates } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const ATLANTA = { lat: 33.749, lng: -84.388, state: "GA" }; // far beyond a 90-minute drive to Orlando

async function flyInBooking(firstDay: number, n = 2, flyIn = true) {
  const clinic = await makeClinic(); // Orlando, FL
  const first = futureWeekday(firstDay);
  const days = Array.from({ length: n }, (_, i) => ({
    locationId: clinic.location.id,
    professionCode: "DC",
    startsAt: new Date(+first.startsAt + i * 86_400_000),
    endsAt: new Date(+first.endsAt + i * 86_400_000),
    flyIn,
  }));
  const r = await bookings.createMultiDay(clinic.actor, days, { post: true });
  return { clinic, ...r };
}

async function flyer() {
  const p = await makeProvider({ home: ATLANTA, maxDriveMinutes: 90 }); // licensed + insured in FL
  await setFlyInStates(p.actor, ["FL"]);
  return p;
}

describe("fly-in coverage", () => {
  it("posting snapshots the destination's allowances and the cut-off; too few days or too little notice is refused", async () => {
    const s = await getSettings();
    const { shiftIds } = await flyInBooking(30);
    const rows = await prisma.shift.findMany({ where: { id: { in: shiftIds } }, orderBy: { startsAt: "asc" } });
    expect(rows.every((r) => r.flyInAirfareCents === s["flyIn.defaultAirfareDollars"] * 100 && r.flyInNightlyCents === s["pricing.lodgingNightlyCents"])).toBe(true);
    expect(+rows[0].flyInUntil!).toBe(+rows[0].startsAt - s["flyIn.minLeadDays"] * 86_400_000);

    const clinic = await makeClinic();
    const one = futureWeekday(40);
    await expect(bookings.createMultiDay(clinic.actor, [{ locationId: clinic.location.id, professionCode: "DC", ...one, flyIn: true }], { post: true })).rejects.toThrow(/consecutive days/);
    const soon = futureWeekday(1);
    const twoSoon = [0, 1].map((i) => ({ locationId: clinic.location.id, professionCode: "DC", startsAt: new Date(+soon.startsAt + i * 86_400_000), endsAt: new Date(+soon.endsAt + i * 86_400_000), flyIn: true }));
    if (+soon.startsAt - Date.now() < s["flyIn.minLeadDays"] * 86_400_000) {
      await expect(bookings.createMultiDay(clinic.actor, twoSoon, { post: true })).rejects.toThrow(/notice/);
    }
  });

  it("only providers who fly to that state skip the drive limit, and only on fly-in bookings; credentials still apply", async () => {
    const { shiftIds } = await flyInBooking(60);
    const { shiftIds: plain } = await flyInBooking(61, 2, false);
    const f = await flyer();
    const driveOnly = await makeProvider({ home: ATLANTA, maxDriveMinutes: 90 });
    const noLicense = await makeProvider({ home: ATLANTA, licenses: [{ professionCode: "DC", state: "GA" }] });
    await expect(setFlyInStates(noLicense.actor, ["FL"])).rejects.toThrow(/license/);

    const ev = await evaluateProviderForShift(prisma, f.id, shiftIds[0]);
    expect(ev.result).toMatchObject({ eligible: true, flyIn: true });
    expect(ev.pair.mileageCents).toBe(0);
    expect((await evaluateProviderForShift(prisma, driveOnly.id, shiftIds[0])).result.failures.map((x) => x.filter)).toContain("F7");
    expect((await evaluateProviderForShift(prisma, f.id, plain[0])).result.failures.map((x) => x.filter)).toContain("F7");

    // The set version (SQL prefilter) agrees with the single check.
    const set = await getEligibleProviders(prisma, shiftIds[0]);
    expect(set.eligible.map((e) => e.providerId)).toContain(f.id);
    expect(set.eligible.map((e) => e.providerId)).not.toContain(driveOnly.id);
  });

  it("fly-in providers apply for the whole trip; confirmation charges airfare once, lodging each night, no mileage", async () => {
    const s = await getSettings();
    const { clinic, shiftIds } = await flyInBooking(90, 3);
    const f = await flyer();
    await expect(applyToShift(f.actor, shiftIds[0], { note: null, commit: true })).rejects.toThrow(/all of its days/);
    expect((await bookings.applyToAllDays(f.actor, shiftIds[0], { note: null, commit: true })).applied).toBe(3);
    expect((await bookings.confirmForAllDays(clinic.actor, shiftIds[0], f.id)).confirmed).toBe(3);
    const as = await prisma.assignment.findMany({ where: { providerId: f.id, shiftId: { in: shiftIds } }, orderBy: { startsAt: "asc" } });
    const airfare = s["flyIn.defaultAirfareDollars"] * 100;
    expect(as.map((a) => a.airfareCents)).toEqual([airfare, 0, 0]);
    expect(as.every((a) => a.flyIn && a.mileageCents === 0 && a.lodgingEstimateCents === s["pricing.lodgingNightlyCents"])).toBe(true);
    expect(as[0].clinicTotalCents).toBe(as[0].clinicPriceCents - as[0].promoDiscountCents + s["pricing.lodgingNightlyCents"] + airfare);
    expect(as[0].providerTotalCents).toBe(as[0].providerPayCents + s["pricing.lodgingNightlyCents"] + airfare);
    // The airfare is collected in full with the deposit; no drive buffer around a fly-in day.
    expect(as[0].depositCents).toBeGreaterThanOrEqual(airfare);
    expect(as.every((a) => a.bufferMinutes === s["matching.travelBufferExtraMinutes"])).toBe(true);
  });

  it("clinic cancels inside its change window: airfare refunded; after it: airfare paid to the provider", async () => {
    const run = async (firstDay: number, hoursSinceConfirm: number) => {
      const { clinic, shiftIds } = await flyInBooking(firstDay, 2);
      const f = await flyer();
      await bookings.applyToAllDays(f.actor, shiftIds[0], { note: null, commit: true });
      await bookings.confirmForAllDays(clinic.actor, shiftIds[0], f.id);
      const as = await prisma.assignment.findMany({ where: { providerId: f.id, shiftId: { in: shiftIds } }, orderBy: { startsAt: "asc" } });
      await prisma.assignment.updateMany({ where: { id: { in: as.map((a) => a.id) } }, data: { confirmedAt: new Date(Date.now() - hoursSinceConfirm * 3_600_000) } });
      // Last day first, then the day carrying the airfare (no other days left by then).
      await cancelShiftByClinic(clinic.actor, shiftIds[1], "Plans changed");
      await cancelShiftByClinic(clinic.actor, shiftIds[0], "Plans changed");
      return prisma.payout.findMany({ where: { assignmentId: as[0].id, description: { contains: "airfare" } } });
    };
    expect(await run(120, 1)).toHaveLength(0);
    const kept = await run(150, 48);
    expect(kept).toHaveLength(1);
    expect(kept[0].amountCents).toBe((await getSettings())["flyIn.defaultAirfareDollars"] * 100);
  });

  it("a provider who cancels the whole trip gets no airfare and the clinic is refunded", async () => {
    const { clinic, shiftIds } = await flyInBooking(180, 2);
    const f = await flyer();
    await bookings.applyToAllDays(f.actor, shiftIds[0], { note: null, commit: true });
    await bookings.confirmForAllDays(clinic.actor, shiftIds[0], f.id);
    const first = await prisma.assignment.findFirstOrThrow({ where: { providerId: f.id, shiftId: shiftIds[0] } });
    await bookings.cancelBookingDays(f.actor, first.id, "Can't travel", "remaining");
    expect(await prisma.payout.count({ where: { providerId: f.id, description: { contains: "airfare" } } })).toBe(0);
  });
});
