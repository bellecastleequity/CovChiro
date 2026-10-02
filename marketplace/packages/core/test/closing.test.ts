import { describe, expect, it } from "vitest";
import { closingComparison } from "../src/closing";

describe("cost of closing", () => {
  it("compares closing with staying open on the clinic's own numbers", () => {
    const r = closingComparison({ dailyCollections: 3000, days: 2, coverageCost: 1300, recoveredPercent: 0 });
    expect(r).toMatchObject({ atStake: 6000, closingCost: 6000, openAfterCoverage: 4700, difference: 4700, breakEvenDaily: 650 });
    expect(r.coverageShare).toBeCloseTo(0.2167, 3);
  });
  it("counts visits recovered by rescheduling on the closing side", () => {
    const r = closingComparison({ dailyCollections: 3000, days: 2, coverageCost: 1300, recoveredPercent: 25 });
    expect(r).toMatchObject({ recovered: 1500, closingCost: 4500, difference: 3200, breakEvenDaily: 1300 / 1.5 });
  });
  it("can come out in favour of closing, and handles empty input", () => {
    expect(closingComparison({ dailyCollections: 500, days: 1, coverageCost: 600, recoveredPercent: 0 }).difference).toBe(-100);
    const z = closingComparison({ dailyCollections: 0, days: 0, coverageCost: 0, recoveredPercent: 100 });
    expect(z).toMatchObject({ coverageShare: null, breakEvenDaily: null, difference: 0 });
  });
});
