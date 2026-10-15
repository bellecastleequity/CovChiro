import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { bookings, createShift, postShift } from "@cm/services";
import { futureWeekday, makeClinic } from "../factories";

/** Posting takes a deposit, so a clinic with no card on file can save drafts but never post. */
describe("no payment method, no posting", () => {
  it("createShift(post), postShift and multi-day posting all refuse; a draft still saves", async () => {
    const clinic = await makeClinic();
    await prisma.clinicOrg.update({ where: { id: clinic.org.id }, data: { hasPaymentMethod: false } });
    const day = { locationId: clinic.location.id, professionCode: "DC", ...futureWeekday(12) };

    await expect(createShift(clinic.actor, day, { post: true })).rejects.toThrow(/payment method/);
    const { shiftId } = await createShift(clinic.actor, day, { post: false });
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).status).toBe("DRAFT");
    await expect(postShift(clinic.actor, shiftId)).rejects.toThrow(/Finish setup/);
    await expect(bookings.createMultiDay(clinic.actor, [{ ...day, ...futureWeekday(40) }, { ...day, ...futureWeekday(47) }], { post: true })).rejects.toThrow(/Finish setup|payment method/);
    expect(await prisma.shift.count({ where: { location: { clinicOrgId: clinic.org.id }, status: { not: "DRAFT" } } })).toBe(0);
  });
});
