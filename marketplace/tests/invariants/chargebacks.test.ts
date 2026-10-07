import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { adminAssign, chargebacks, createShift } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider, makeShift } from "../factories";

const ADMIN = { userId: null, role: "PLATFORM_ADMIN" as const };

describe("card disputes (chargebacks)", () => {
  it("opening holds the booking's unsent provider pay and pauses posting; evidence comes from the records; closing lifts the pause", async () => {
    const clinic = await makeClinic();
    const p = await makeProvider();
    const sh = await makeShift(clinic.location.id, { days: 40 });
    const { assignmentId } = await adminAssign(ADMIN, sh.id, p.id);
    const deposit = await prisma.payment.findFirstOrThrow({ where: { assignmentId, type: "DEPOSIT" } });
    const payout = await prisma.payout.create({ data: { providerId: p.id, assignmentId, kind: "ADJUSTMENT", description: "test", amountCents: 1000, status: "SCHEDULED" } });

    const row = await chargebacks.recordStripeDispute({ id: `dp_${sh.id}`, amount: deposit.amountCents, reason: "product_not_received", status: "needs_response", payment_intent: deposit.stripePaymentIntentId, evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400 } });
    expect(row).toMatchObject({ clinicOrgId: clinic.org.id, assignmentId, status: "needs_response" });
    expect(await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({ onHold: true });

    const day = futureWeekday(45);
    await expect(createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", ...day }, { post: true })).rejects.toThrow(/card dispute/);

    const d = await chargebacks.chargebackDetail(ADMIN, row.id);
    expect(d.evidence.customer_name).toBeTruthy();
    expect(d.evidence.uncategorized_text).toMatch(/did not raise any problem/);
    expect((await chargebacks.submitChargebackEvidence(ADMIN, row.id, { submit: true, note: "Clinic re-booked the same provider later." })).status).toBe("under_review");

    expect(await chargebacks.releaseChargebackHolds(ADMIN, row.id)).toBe(row.heldPayoutIds.length);
    expect(row.heldPayoutIds).toContain(payout.id);
    // A repeat webhook updates, never duplicates.
    await chargebacks.recordStripeDispute({ id: `dp_${sh.id}`, amount: deposit.amountCents, reason: "product_not_received", status: "won", payment_intent: deposit.stripePaymentIntentId });
    expect(await prisma.chargeDispute.count({ where: { stripeDisputeId: `dp_${sh.id}` } })).toBe(1);
    expect((await prisma.chargeDispute.findUniqueOrThrow({ where: { id: row.id } })).closedAt).not.toBeNull();
    const ok = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", ...day }, { post: true });
    expect(ok.shiftId).toBeTruthy();
  });
});

describe("territory rate cards", () => {
  it("Puerto Rico and the Virgin Islands have a region and 4 chiropractic cards each, set as the default region", async () => {
    for (const [st, name, fullBusy] of [["PR", "PR-All", 57500], ["VI", "VI-All", 75000]] as const) {
      const r = await prisma.rateRegion.findUniqueOrThrow({ where: { name }, include: { rateCards: true } });
      expect(r.state).toBe(st);
      expect(r.rateCards.filter((c) => c.professionCode === "DC")).toHaveLength(4);
      expect(r.rateCards.find((c) => c.durationTier === "FULL_DAY" && c.volumeTier === "BUSY")?.clinicPriceCents).toBe(fullBusy);
      expect((await prisma.stateConfig.findUniqueOrThrow({ where: { state: st } })).defaultRateRegionId).toBe(r.id);
    }
  });
});
