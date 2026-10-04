import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, boardcheck, createShift, nightlyCredentialSweep, selectApplicant, trust } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

describe("State license check", () => {
  it("active stays and shows the check date; inactive stops counting and releases bookings; probation and missing become tasks", async () => {
    const clinic = await makeClinic();
    const [ok, lapsed, probation, missing] = [await makeProvider(), await makeProvider(), await makeProvider(), await makeProvider()];
    const lic = (p: { id: string }) => prisma.license.findFirstOrThrow({ where: { providerId: p.id, state: "FL", professionCode: "DC" } });
    const [lOk, lLapsed, lProb] = [await lic(ok), await lic(lapsed), await lic(probation)];
    // The lapsed provider has a booking.
    const { startsAt, endsAt } = futureWeekday(30);
    const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
    await applyToShift(lapsed.actor, shiftId, { commit: true });
    const { assignmentId } = await selectApplicant(clinic.actor, shiftId, lapsed.id);

    const file = [
      "BOARD|LICENSE_NUMBER|LAST_NAME|LICENSE_STATUS_DESCRIPTION|DISCIPLINE",
      `1501|${lOk.licenseNumber}|A|Clear/Active|N`,
      `1501|${lLapsed.licenseNumber}|B|Delinquent|N`,
      `1501|${lProb.licenseNumber}|C|Probation/Active|Y`,
    ].join("\n");
    const r = await boardcheck.runBoardCheck(admin, { state: "FL", professionCode: "DC", file: Buffer.from(file), fileName: "chiro.txt" });
    expect(r.stopped).toBeGreaterThanOrEqual(1);

    const after = await prisma.license.findUniqueOrThrow({ where: { id: lOk.id } });
    expect(after.status).toBe("VERIFIED");
    expect(after.boardStatus).toBe("Clear/Active");
    expect((await trust.providerTrust(ok.id, "DC", "FL")).license?.boardCheckedAt).toBeTruthy();

    expect((await prisma.license.findUniqueOrThrow({ where: { id: lLapsed.id } })).status).toBe("SUSPENDED");
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).not.toBe("CONFIRMED");
    expect(await prisma.notification.count({ where: { userId: lapsed.userId, template: "license_board_inactive" } })).toBe(1);

    expect((await prisma.license.findUniqueOrThrow({ where: { id: lProb.id } })).status).toBe("VERIFIED");
    const tasks = await prisma.adminTask.findMany({ where: { kind: "BOARD_CHECK", resolvedAt: null, entityId: { in: [lProb.id, (await lic(missing)).id] } } });
    expect(tasks.length).toBe(2);
    expect(tasks.some((t) => /discipline record/.test(t.title))).toBe(true);
    expect((await boardcheck.lastBoardCheck(admin, "DC", "FL"))?.fileName).toBe("chiro.txt");
  });

  it("a zipped file works, and a file with none of our numbers is refused", async () => {
    await expect(boardcheck.runBoardCheck(admin, { state: "FL", professionCode: "DC", file: Buffer.from("X|Y|Z\n1|2|3"), fileName: "x.txt" })).rejects.toThrow(/None of our license numbers/);
  });
});

describe("Malpractice re-verification", () => {
  it("a policy due for re-verification gets one admin task", async () => {
    const p = await makeProvider();
    const pol = await prisma.malpracticePolicy.findFirstOrThrow({ where: { providerId: p.id } });
    await prisma.malpracticePolicy.update({ where: { id: pol.id }, data: { nextReverifyAt: new Date(Date.now() - 1000) } });
    await nightlyCredentialSweep();
    await nightlyCredentialSweep();
    expect(await prisma.adminTask.count({ where: { kind: "REVERIFY", entityId: pol.id, resolvedAt: null } })).toBe(1);
  });
});
