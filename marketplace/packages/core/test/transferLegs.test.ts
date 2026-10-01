import { describe, expect, it } from "vitest";
import { planTransferLegs } from "../src";

const total = (legs: { amountCents: number }[]) => legs.reduce((a, l) => a + l.amountCents, 0);

describe("linked provider transfers (each leg funded by the booking's own clinic charges)", () => {
  it("a shift's pay is drawn from its deposit, then its balance charge", () => {
    const legs = planTransferLegs([{ assignmentId: "a1", amountCents: 30_000 }], [
      { paymentId: "dep", assignmentId: "a1", capacityCents: 10_000 },
      { paymentId: "bal", assignmentId: "a1", capacityCents: 35_000 },
    ]);
    expect(legs).toEqual([{ paymentId: "dep", amountCents: 10_000 }, { paymentId: "bal", amountCents: 20_000 }]);
  });

  it("several bookings in one run each use their own charges; never another booking's", () => {
    const legs = planTransferLegs([{ assignmentId: "a1", amountCents: 5_000 }, { assignmentId: "a2", amountCents: 7_000 }], [
      { paymentId: "c1", assignmentId: "a1", capacityCents: 9_000 },
      { paymentId: "c2", assignmentId: "a2", capacityCents: 9_000 },
    ]);
    expect(legs).toEqual([{ paymentId: "c1", amountCents: 5_000 }, { paymentId: "c2", amountCents: 7_000 }]);
  });

  it("anything the charges can't cover (bonuses, refunded charges) comes from the balance", () => {
    const legs = planTransferLegs([{ assignmentId: "a1", amountCents: 12_000 }, { assignmentId: null, amountCents: 2_500 }], [{ paymentId: "c1", assignmentId: "a1", capacityCents: 10_000 }]);
    expect(legs).toEqual([{ paymentId: "c1", amountCents: 10_000 }, { paymentId: null, amountCents: 4_500 }]);
  });

  it("a negative adjustment reduces the run, unlinked money first; legs always add up to the net", () => {
    const rows = [{ assignmentId: "a1", amountCents: 20_000 }, { assignmentId: null, amountCents: 1_000 }, { assignmentId: null, amountCents: -3_000 }];
    const legs = planTransferLegs(rows, [{ paymentId: "c1", assignmentId: "a1", capacityCents: 50_000 }]);
    expect(legs).toEqual([{ paymentId: "c1", amountCents: 18_000 }]);
    expect(total(legs)).toBe(18_000);
  });

  it("nothing to pay → no legs", () => {
    expect(planTransferLegs([{ assignmentId: null, amountCents: -500 }], [])).toEqual([]);
  });
});
