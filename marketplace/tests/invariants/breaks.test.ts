import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "@cm/db";
import { applyToShift, breaks, createShift, evaluateProviderForShift, selectApplicant } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

/** Taking a break: new shifts stop from the start date; each existing booking kept or released; resume. */

describe("Taking a break", () => {
  it("keeps one booking, releases another, blocks new shifts, and resume opens them again", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const book = async (days: number) => {
      const { startsAt, endsAt } = futureWeekday(days);
      const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
      await applyToShift(provider.actor, shiftId, { commit: true });
      const { assignmentId } = await selectApplicant(clinic.actor, shiftId, provider.id);
      return { shiftId, assignmentId };
    };
    const keep = await book(14);
    const release = await book(21);
    const { startsAt, endsAt } = futureWeekday(28);
    const { shiftId: open } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
    expect((await evaluateProviderForShift(prisma, provider.id, open)).result.eligible).toBe(true);

    const p = await prisma.provider.findUniqueOrThrow({ where: { id: provider.id } });
    const startDate = DateTime.now().setZone(p.homeTimeZone).plus({ days: 10 }).toISODate()!;
    const preview = await breaks.previewBreak(provider.actor, startDate);
    expect(preview.during.map((b) => b.id).sort()).toEqual([keep.assignmentId, release.assignmentId].sort());
    await expect(breaks.startBreak(provider.actor, { startDate, release: [release.assignmentId], keep: [] })).rejects.toThrow(/every booking/);
    const r = await breaks.startBreak(provider.actor, { startDate, release: [release.assignmentId], keep: [keep.assignmentId] });
    expect(r).toMatchObject({ released: 1, kept: 1 });

    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: keep.assignmentId } })).status).toBe("CONFIRMED");
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: release.assignmentId } })).status).toBe("CANCELLED");
    const ev = await evaluateProviderForShift(prisma, provider.id, open);
    expect(ev.result.eligible).toBe(false);
    expect(ev.result.failures[0].message).toMatch(/break/);
    expect((await breaks.breakStatus(provider.id)).scheduled).toBe(true);

    await expect(breaks.resumeCoverage(provider.actor, { resumeDate: startDate, hoursConfirmed: false })).rejects.toThrow(/confirm/);
    await breaks.resumeCoverage(provider.actor, { resumeDate: DateTime.now().setZone(p.homeTimeZone).toISODate()!, hoursConfirmed: true });
    expect((await breaks.breakStatus(provider.id)).scheduled).toBe(false);
    expect((await evaluateProviderForShift(prisma, provider.id, open)).result.eligible).toBe(true);
  });
});
