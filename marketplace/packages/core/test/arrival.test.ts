import { describe, expect, it } from "vitest";
import { arrivalPlan, ARRIVAL_DEFAULTS } from "../src/arrival";

const now = new Date("2026-10-06T12:00:00Z");
const base = { status: "CONFIRMED", onMyWayAt: new Date(+now - 5 * 60_000), arrivedAt: null, startsAt: new Date(+now + 30 * 60_000), etaUpdatedAt: null, nearNotifiedAt: null };

describe("arrival ETA", () => {
  it("shares from On my way until clock-in, and stops 30 minutes after the start", () => {
    expect(arrivalPlan({ ...base }, now, ARRIVAL_DEFAULTS).open).toBe(true);
    expect(arrivalPlan({ ...base, onMyWayAt: null }, now, ARRIVAL_DEFAULTS).open).toBe(false);
    expect(arrivalPlan({ ...base, arrivedAt: now }, now, ARRIVAL_DEFAULTS).open).toBe(false);
    expect(arrivalPlan({ ...base, status: "CANCELLED" }, now, ARRIVAL_DEFAULTS).open).toBe(false);
    expect(arrivalPlan({ ...base, startsAt: new Date(+now - 31 * 60_000) }, now, ARRIVAL_DEFAULTS).open).toBe(false);
    expect(arrivalPlan({ ...base, startsAt: new Date(+now - 29 * 60_000) }, now, ARRIVAL_DEFAULTS).open).toBe(true);
  });

  it("asks for a new drive time at most every updateSeconds", () => {
    expect(arrivalPlan({ ...base, etaUpdatedAt: new Date(+now - 30_000) }, now, ARRIVAL_DEFAULTS).recheck).toBe(false);
    expect(arrivalPlan({ ...base, etaUpdatedAt: new Date(+now - 121_000) }, now, ARRIVAL_DEFAULTS).recheck).toBe(true);
    expect(arrivalPlan({ ...base }, now, ARRIVAL_DEFAULTS).recheck).toBe(true);
  });

  it("works out the arrival time and tells the clinic once when it's nearMinutes away", () => {
    const far = arrivalPlan({ ...base }, now, ARRIVAL_DEFAULTS, { minutes: 22, miles: 14.2 });
    expect(far.etaAt?.toISOString()).toBe("2026-10-06T12:22:00.000Z");
    expect(far.notifyNear).toBe(false);
    expect(arrivalPlan({ ...base }, now, ARRIVAL_DEFAULTS, { minutes: 5, miles: 2 }).notifyNear).toBe(true);
    expect(arrivalPlan({ ...base, nearNotifiedAt: now }, now, ARRIVAL_DEFAULTS, { minutes: 3, miles: 1 }).notifyNear).toBe(false);
  });
});
