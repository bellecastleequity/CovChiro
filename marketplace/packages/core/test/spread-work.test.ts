import { describe, expect, it } from "vitest";
import { spreadWorkFactor } from "../src";

describe("spread the work", () => {
  const on = { perShiftPercent: 3, freeShifts: 4, maxPercent: 20 };
  it("is off at 0%", () => {
    expect(spreadWorkFactor(30, { ...on, perShiftPercent: 0 })).toBe(1);
  });
  it("costs nothing up to the free shifts, then a few percent per shift, capped", () => {
    expect(spreadWorkFactor(4, on)).toBe(1);
    expect(spreadWorkFactor(5, on)).toBeCloseTo(0.97);
    expect(spreadWorkFactor(8, on)).toBeCloseTo(0.88);
    expect(spreadWorkFactor(40, on)).toBeCloseTo(0.8);
  });
});
