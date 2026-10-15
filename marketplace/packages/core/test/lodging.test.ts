import { describe, expect, it } from "vitest";
import { balanceDueCents, depositWithTravel, lodgingAdvancePlan, lodgingOnCancel, lodgingOnReplacement, lodgingReleaseFloor } from "../src";
import { d, S } from "./fixtures";

const START = d("2026-11-10T14:00:00Z");
const H = 3_600_000;
const at = (hoursBefore: number) => new Date(+START - hoursBefore * H);

describe("lodging up front", () => {
  it("the deposit takes all of the lodging and the usual percent of the rest", () => {
    // $400 coverage + $40 mileage + $115 lodging, 25% deposit.
    expect(depositWithTravel({ clinicTotalCents: 55_500, airfareCents: 0, lodgingCents: 11_500, lodgingCreditCents: 0, depositPercent: 25 })).toBe(11_000 + 11_500);
    // No lodging: same as before.
    expect(depositWithTravel({ clinicTotalCents: 44_000, airfareCents: 0, lodgingCents: 0, lodgingCreditCents: 0, depositPercent: 25 })).toBe(11_000);
    // Airfare too (fly-in).
    expect(depositWithTravel({ clinicTotalCents: 100_000, airfareCents: 40_000, lodgingCents: 17_500, lodgingCreditCents: 0, depositPercent: 25 })).toBe(10_625 + 40_000 + 17_500);
    // Pay in full: everything.
    expect(depositWithTravel({ clinicTotalCents: 55_500, airfareCents: 0, lodgingCents: 11_500, lodgingCreditCents: 0, depositPercent: 100 })).toBe(55_500);
  });

  it("a hold from the previous provider is never charged again", () => {
    expect(depositWithTravel({ clinicTotalCents: 55_500, airfareCents: 0, lodgingCents: 11_500, lodgingCreditCents: 11_500, depositPercent: 25 })).toBe(11_000);
    // Two nights needed, one held: only the difference.
    expect(depositWithTravel({ clinicTotalCents: 67_000, airfareCents: 0, lodgingCents: 23_000, lodgingCreditCents: 11_500, depositPercent: 25 })).toBe(11_000 + 11_500);
    expect(balanceDueCents({ clinicTotalCents: 55_500, collectedCents: 11_000, lodgingCreditCents: 11_500 })).toBe(33_000);
    expect(balanceDueCents({ clinicTotalCents: 55_500, collectedCents: 55_500, lodgingCreditCents: 11_500 })).toBe(0);
  });

  it("the advance waits for reconfirmation unless the booking was too late to be asked", () => {
    expect(lodgingReleaseFloor(START, S)).toEqual(at(48));
    const early = lodgingAdvancePlan({ startsAt: START, confirmedAt: at(240), now: at(240) }, S);
    expect(early.waitForReconfirm).toBe(true);
    expect(early.releaseAt).toEqual(at(48));
    // Booked 60 h out: no reconfirmation asked, released when the window opens.
    expect(lodgingAdvancePlan({ startsAt: START, confirmedAt: at(60), now: at(60) }, S)).toEqual({ waitForReconfirm: false, releaseAt: at(48) });
    // Booked 20 h out: released at once.
    expect(lodgingAdvancePlan({ startsAt: START, confirmedAt: at(20), now: at(20) }, S)).toEqual({ waitForReconfirm: false, releaseAt: at(20) });
    // Reconfirmation off: nothing to wait for.
    expect(lodgingAdvancePlan({ startsAt: START, confirmedAt: at(240), now: at(240) }, { ...S, "reconfirm.enabled": false }).waitForReconfirm).toBe(false);
  });

  const base = { now: at(30), startsAt: START, lodgingCents: 11_500, nightlyCents: 11_500, collectedCents: 11_500, paidOutCents: 0, reopen: true };

  it("a provider dropping out holds the lodging and takes back the advance", () => {
    expect(lodgingOnCancel({ ...base, by: "PROVIDER" }, S)).toEqual({ holdCents: 11_500, refundCents: 0, providerKeepsCents: 0, reverseCents: 0 });
    expect(lodgingOnCancel({ ...base, by: "PROVIDER", paidOutCents: 11_500 }, S)).toEqual({ holdCents: 11_500, refundCents: 0, providerKeepsCents: 0, reverseCents: 11_500 });
    // Removed by us (credential lapse, ID check): same, the shift is refilled.
    expect(lodgingOnCancel({ ...base, by: "PLATFORM", paidOutCents: 11_500 }, S).holdCents).toBe(11_500);
  });

  it("a no-show (nothing to refill) refunds the clinic and takes back the advance", () => {
    expect(lodgingOnCancel({ ...base, by: "PROVIDER", reopen: false, paidOutCents: 11_500 }, S)).toEqual({ holdCents: 0, refundCents: 11_500, providerKeepsCents: 0, reverseCents: 11_500 });
  });

  it("the clinic cancelling early gets all of it back", () => {
    expect(lodgingOnCancel({ ...base, by: "CLINIC", now: at(72) }, S)).toEqual({ holdCents: 0, refundCents: 11_500, providerKeepsCents: 0, reverseCents: 0 });
  });

  it("the clinic cancelling late: the provider keeps one night, the rest is refunded", () => {
    // Two nights paid out, one kept.
    expect(lodgingOnCancel({ ...base, by: "CLINIC", lodgingCents: 23_000, collectedCents: 23_000, paidOutCents: 23_000 }, S)).toEqual({ holdCents: 0, refundCents: 11_500, providerKeepsCents: 11_500, reverseCents: 11_500 });
    // Not sent yet: the provider is paid the night.
    expect(lodgingOnCancel({ ...base, by: "CLINIC" }, S)).toEqual({ holdCents: 0, refundCents: 0, providerKeepsCents: 11_500, reverseCents: 0 });
    // Never more than what was collected.
    expect(lodgingOnCancel({ ...base, by: "CLINIC", collectedCents: 5_000 }, S).providerKeepsCents).toBe(5_000);
    // Setting 0 nights: everything refunded.
    expect(lodgingOnCancel({ ...base, by: "CLINIC", paidOutCents: 11_500 }, { ...S, "lodging.clinicCancelKeepNights": 0 })).toEqual({ holdCents: 0, refundCents: 11_500, providerKeepsCents: 0, reverseCents: 11_500 });
  });

  it("a replacement uses the hold; what they don't need goes back to the clinic", () => {
    expect(lodgingOnReplacement(11_500, 11_500)).toEqual({ creditCents: 11_500, refundCents: 0 });
    expect(lodgingOnReplacement(11_500, 0)).toEqual({ creditCents: 0, refundCents: 11_500 });
    expect(lodgingOnReplacement(11_500, 23_000)).toEqual({ creditCents: 11_500, refundCents: 0 });
    expect(lodgingOnReplacement(0, 11_500)).toEqual({ creditCents: 0, refundCents: 0 });
  });
});
