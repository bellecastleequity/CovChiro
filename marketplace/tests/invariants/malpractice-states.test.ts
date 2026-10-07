import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { expectDbReject, insertAssignment, makeClinic, makeProvider, makeShift } from "../factories";

describe("malpractice states covered (INV-3)", () => {
  it("the database refuses a booking in a state the policy doesn't cover; listing the state or 'all states' allows it", async () => {
    const clinic = await makeClinic(); // Florida
    const p = await makeProvider();
    await prisma.malpracticePolicy.updateMany({ where: { providerId: p.id }, data: { coveredStates: ["VI"] } });
    const sh = await makeShift(clinic.location.id, { days: 33 });
    await expectDbReject(insertAssignment(sh.id, p.id), /INV-3/);

    await prisma.malpracticePolicy.updateMany({ where: { providerId: p.id }, data: { coveredStates: ["FL", "VI"] } });
    const ok = await insertAssignment(sh.id, p.id);
    expect(ok.id).toBeTruthy();

    const all = await makeProvider(); // default: covers every state
    const sh2 = await makeShift(clinic.location.id, { days: 34 });
    expect((await insertAssignment(sh2.id, all.id)).id).toBeTruthy();
  });
});
